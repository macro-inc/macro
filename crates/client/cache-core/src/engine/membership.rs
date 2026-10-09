//! Engine side of derived list membership (see [`crate::membership`]): the
//! durable clock, stamps on base writes, an index of stamped children, and
//! derivation between read passes.

use super::*;
use crate::denormalize::DerivationRequest;
use crate::membership::{
    CHANGED_AT_FIELD, CLOCK_FIELD, CLOCK_KEY, Child, Derivation, evidence_key, stamp_child,
    stamp_of,
};
use crate::value::{CacheNumber, CacheValue};

/// Derive-then-reread rounds before a read keeps any remaining evidence.
pub(super) const MAX_DERIVATION_ROUNDS: usize = 4;

/// Lists derived for one read, keyed by owner record and evidence field.
pub(super) type DerivedLists = HashMap<(EntityKey<'static>, String), CacheValue>;

#[derive(Default)]
pub(super) struct MembershipState {
    /// Stamped children of each child type, loaded on first derivation.
    index: HashMap<String, ChildIndex>,
    /// Lists derived at `memo_revision`; any revision change discards them.
    memo: HashMap<(EntityKey<'static>, String), Option<Derivation>>,
    memo_revision: Option<CacheRevision>,
    /// Highest sequence this engine allocated or read.
    clock: u64,
}

/// Children with a durable stamp. Unstamped children predate every stamped
/// evidence list, so they can never have changed after one.
#[derive(Default)]
struct ChildIndex {
    stamps: HashMap<EntityKey<'static>, u64>,
    by_seq: BTreeSet<(u64, EntityKey<'static>)>,
}

impl ChildIndex {
    fn note(&mut self, key: &EntityKey<'static>, seq: Option<u64>) {
        if let Some(previous) = self.stamps.remove(key) {
            self.by_seq.remove(&(previous, key.clone()));
        }
        if let Some(seq) = seq {
            self.stamps.insert(key.clone(), seq);
            self.by_seq.insert((seq, key.clone()));
        }
    }

    fn changed_after(&self, seq: u64) -> impl Iterator<Item = &EntityKey<'static>> {
        self.by_seq
            .range((seq.saturating_add(1), EntityKey(String::new().into()))..)
            .map(|(_, key)| key)
    }
}

impl MembershipState {
    /// Another engine or a reset changed storage: reload indexes lazily.
    pub(super) fn clear(&mut self) {
        self.index.clear();
        self.memo.clear();
        self.memo_revision = None;
    }

    /// A record changed outside this engine: its type's stamps are reread.
    pub(super) fn forget(&mut self, key: &EntityKey<'static>) {
        if let Some(typename) = key.typename() {
            self.index.remove(typename);
        }
    }

    /// Publishes stamps of records durably written by this engine.
    pub(super) fn note_written<'r>(
        &mut self,
        entries: impl IntoIterator<Item = (&'r EntityKey<'static>, &'r Record)>,
    ) {
        if self.index.is_empty() {
            return;
        }
        for (key, record) in entries {
            if let Some(index) = key.typename().and_then(|name| self.index.get_mut(name)) {
                index.note(key, stamp_of(record, CHANGED_AT_FIELD));
            }
        }
    }

    pub(super) fn note_deleted(&mut self, keys: &[EntityKey<'static>]) {
        for key in keys {
            if let Some(index) = key.typename().and_then(|name| self.index.get_mut(name)) {
                index.note(key, None);
            }
        }
    }
}

fn clock_record(seq: u64) -> (EntityKey<'static>, Record) {
    let mut record = Record::default();
    record.fields.insert(
        CLOCK_FIELD.into(),
        CacheValue::Number(CacheNumber::PosInt(seq)),
    );
    (EntityKey(CLOCK_KEY.into()), record)
}

/// A base write's stamp: its sequence and the clock record persisted with it.
pub(super) struct Stamp {
    pub seq: u64,
    pub clock: (EntityKey<'static>, Record),
}

impl Stamp {
    /// Stamps a changed record when it is a relation child.
    pub(super) fn child(
        &self,
        schema: &crate::meta::Schema,
        key: &EntityKey<'static>,
        record: &mut Record,
    ) {
        if key
            .typename()
            .is_some_and(|name| schema.membership().is_child_type(name))
        {
            stamp_child(record, self.seq);
        }
    }
}

impl<S: Storage> Engine<S> {
    /// Allocates a durable sequence for a base write of `updates` and stamps
    /// its evidence lists. `None` when the write touches no relation.
    pub(super) async fn stamp_membership(
        &mut self,
        updates: &mut RecordUpdates,
    ) -> Result<Option<Stamp>, EngineError<S::Error>> {
        if !self.schema.membership().stamps(updates) {
            return Ok(None);
        }
        // Read the durable clock each time: an engine handoff or a dedicated
        // engine in another context may have advanced it.
        let stored = self
            .storage
            .get_batch(&[EntityKey(CLOCK_KEY.into())])
            .await
            .map_err(EngineError::Storage)?
            .into_iter()
            .next()
            .flatten()
            .and_then(|record| stamp_of(&record, CLOCK_FIELD))
            .unwrap_or(0);
        let seq = stored
            .max(self.membership.clock)
            .checked_add(1)
            .ok_or(EngineError::RevisionOverflow)?;
        self.membership.clock = seq;
        self.schema.membership().stamp_evidence(updates, seq);
        Ok(Some(Stamp {
            seq,
            clock: clock_record(seq),
        }))
    }

    async fn ensure_child_index(&mut self, child_type: &str) -> Result<(), EngineError<S::Error>> {
        if self.membership.index.contains_key(child_type) {
            return Ok(());
        }
        let records = self
            .storage
            .scan_records_of_type(child_type)
            .await
            .map_err(EngineError::Storage)?;
        let mut index = ChildIndex::default();
        for (key, record) in &records {
            if let Some(seq) = stamp_of(record, CHANGED_AT_FIELD) {
                index.note(key, Some(seq));
            }
        }
        self.membership.index.insert(child_type.to_owned(), index);
        Ok(())
    }

    /// Derives the requested lists into `derived`. Returns whether any list
    /// kept its evidence because membership could not be decided.
    pub(super) async fn derive_lists(
        &mut self,
        requests: Vec<DerivationRequest>,
        derived: &mut DerivedLists,
        attempted: &mut BTreeSet<(EntityKey<'static>, String)>,
    ) -> Result<bool, EngineError<S::Error>> {
        if self.membership.memo_revision != Some(self.revision) {
            self.membership.memo.clear();
            self.membership.memo_revision = Some(self.revision);
        }
        let mut unknown = false;
        for request in requests {
            let slot = (request.owner.clone(), request.field.clone());
            if !attempted.insert(slot.clone()) {
                continue;
            }
            let derivation = match self.membership.memo.get(&slot) {
                Some(memo) => memo.clone(),
                None => {
                    let derivation = self.derive_list(&request).await?;
                    self.membership
                        .memo
                        .insert(slot.clone(), derivation.clone());
                    derivation
                }
            };
            if let Some(derivation) = derivation {
                unknown |= derivation.unknown;
                derived.insert(slot, derivation.value);
            }
        }
        Ok(unknown)
    }

    /// Derives one list from its effective evidence and the effective state of
    /// children changed after that evidence.
    async fn derive_list(
        &mut self,
        request: &DerivationRequest,
    ) -> Result<Option<Derivation>, EngineError<S::Error>> {
        let schema = Arc::clone(&self.schema);
        let relation = schema.membership().get(request.relation);
        let optimistic = merged_optimistic(&self.optimistic);
        let mut view = EffectiveView::default();
        let stamps = evidence_key(&request.owner);
        self.load_effective(
            &mut view,
            &optimistic,
            [request.owner.clone(), stamps.clone()],
        )
        .await?;
        let Some(owner) = view.get(&request.owner) else {
            return Ok(None);
        };
        let Some(CacheValue::List(evidence)) = owner.fields.get(&request.field) else {
            return Ok(None);
        };
        let evidence = evidence.clone();
        let fallback = |unknown| Derivation {
            value: CacheValue::List(evidence.clone()),
            unknown,
        };
        // Evidence written before stamping existed cannot be compared.
        let Some(seen_at) = view
            .get(&stamps)
            .and_then(|record| stamp_of(record, &request.field))
        else {
            return Ok(Some(fallback(true)));
        };
        let Some(filter) = relation.filter(&request.owner, &request.arguments) else {
            return Ok(Some(fallback(true)));
        };
        self.ensure_child_index(&relation.child_type).await?;
        let mut changed: BTreeSet<EntityKey<'static>> = self.membership.index[&relation.child_type]
            .changed_after(seen_at)
            .cloned()
            .collect();
        // Pending layers are local intent the evidence cannot have observed.
        changed.extend(
            optimistic
                .keys()
                .filter(|key| key.typename() == Some(relation.child_type.as_str()))
                .cloned(),
        );
        if changed.is_empty() {
            return Ok(Some(fallback(false)));
        }
        let evidence_keys = evidence.iter().filter_map(|item| match item {
            CacheValue::Ref(key) => Some(key.clone()),
            _ => None,
        });
        self.load_effective(
            &mut view,
            &optimistic,
            changed.iter().cloned().chain(evidence_keys),
        )
        .await?;
        let children = |key: &EntityKey<'static>| view.child(key);
        Ok(Some(crate::membership::derive(
            relation, &filter, &evidence, &changed, &children,
        )))
    }

    /// Loads effective records (base plus layers) for `keys` and their
    /// committed alias targets into `view`.
    async fn load_effective(
        &mut self,
        view: &mut EffectiveView,
        optimistic: &BTreeMap<EntityKey<'static>, Record>,
        keys: impl IntoIterator<Item = EntityKey<'static>>,
    ) -> Result<(), EngineError<S::Error>> {
        let mut pending: BTreeSet<_> = keys
            .into_iter()
            .filter(|key| !view.records.contains_key(key))
            .collect();
        for _ in 0..=identity::MAX_ALIAS_CHAIN_DEPTH {
            if pending.is_empty() {
                break;
            }
            let bases = self.load_bases(&pending).await?;
            let mut next = BTreeSet::new();
            for key in std::mem::take(&mut pending) {
                let mut record = bases.get(&key).cloned();
                if let Some(update) = optimistic.get(&key) {
                    record
                        .get_or_insert_with(Record::default)
                        .merge(update.clone());
                }
                if let Some(target) = record.as_ref().and_then(identity::alias_target)
                    && !view.records.contains_key(target)
                {
                    next.insert(target.clone());
                }
                view.records.insert(key, record);
            }
            pending = next;
        }
        Ok(())
    }
}

/// Effective records loaded for one derivation.
#[derive(Default)]
struct EffectiveView {
    records: HashMap<EntityKey<'static>, Option<Record>>,
}

impl EffectiveView {
    fn get(&self, key: &EntityKey<'static>) -> Option<&Record> {
        self.records.get(key)?.as_ref()
    }

    /// Follows committed aliases; deleted and absent records have no record.
    fn child(&self, key: &EntityKey<'static>) -> Child<'_> {
        let mut resolved = key.clone();
        for _ in 0..identity::MAX_ALIAS_CHAIN_DEPTH {
            match self.get(&resolved).and_then(identity::alias_target) {
                Some(target) => resolved = target.clone(),
                None => break,
            }
        }
        let record = self.get(&resolved).filter(|record| {
            record.fields.get(identity::DELETED_FIELD) != Some(&CacheValue::Bool(true))
                && identity::alias_target(record).is_none()
        });
        Child { resolved, record }
    }
}

#[cfg(test)]
mod test;
