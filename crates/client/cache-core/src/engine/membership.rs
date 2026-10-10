//! Engine side of derived list membership (see [`crate::membership`]): the
//! durable clock, stamps on base writes, an index of stamped children, and
//! derivation between read passes.

use super::*;
use crate::denormalize::{DerivationRequest, DerivedField};
use crate::membership::{
    CHANGED_AT_FIELD, CLOCK_FIELD, CLOCK_KEY, Child, evidence_key, stamp_child, stamp_of,
};
use crate::value::{CacheNumber, CacheValue};

/// Derive-then-reread rounds before a read keeps any remaining evidence.
pub(super) const MAX_DERIVATION_ROUNDS: usize = 4;

/// Lists derived at one revision, by owner record and evidence field.
pub(super) type DerivedLists = HashMap<EntityKey<'static>, HashMap<String, DerivedEntry>>;

#[derive(Default)]
pub(super) struct MembershipState {
    /// Stamped children of each child type, loaded on first derivation.
    index: HashMap<String, ChildIndex>,
    /// Lists derived at `derived_revision`; reads at that revision reuse them.
    derived: DerivedLists,
    derived_revision: Option<CacheRevision>,
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
        self.derived.clear();
        self.derived_revision = None;
    }

    /// Derived lists valid at `revision`; other revisions' are discarded.
    pub(super) fn derived_at(&mut self, revision: CacheRevision) -> &DerivedLists {
        if self.derived_revision != Some(revision) {
            self.derived.clear();
            self.derived_revision = Some(revision);
        }
        &self.derived
    }

    /// Lists derived so far at the current revision.
    pub(super) fn derived(&self) -> &DerivedLists {
        &self.derived
    }

    /// Whether a derived list kept its evidence because membership was unknown.
    pub(super) fn unknown(&self, owner: &EntityKey<'static>, field: &str) -> bool {
        self.entry(owner, field).is_some_and(|entry| entry.unknown)
    }

    fn entry(&self, owner: &EntityKey<'static>, field: &str) -> Option<&DerivedEntry> {
        self.derived.get(owner)?.get(field)
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

/// How a read source answers a declared list from the derived lists.
pub(super) fn derived_field<'a>(
    derived: &'a DerivedLists,
    owner: &EntityKey<'static>,
    field: &str,
) -> DerivedField<'a> {
    match derived.get(owner).and_then(|fields| fields.get(field)) {
        None => DerivedField::Pending,
        Some(DerivedEntry { list: None, .. }) => DerivedField::Evidence,
        Some(DerivedEntry {
            list: Some(list), ..
        }) => DerivedField::List(list),
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

    /// Derives requested lists into the per-revision lists the next pass
    /// reads. A list equal to its evidence is recorded as such, so the pass
    /// that requested it is already correct.
    pub(super) async fn derive_lists(
        &mut self,
        requests: &[DerivationRequest],
    ) -> Result<Derived, EngineError<S::Error>> {
        self.membership.derived_at(self.revision);
        let mut outcome = Derived::default();
        for request in requests {
            if let Some(entry) = self.membership.entry(&request.owner, &request.field) {
                outcome.unknown |= entry.unknown;
                continue;
            }
            let entry = self.derive_list(request).await?;
            outcome.unknown |= entry.unknown;
            outcome.changed |= entry.list.is_some();
            self.membership
                .derived
                .entry(request.owner.clone())
                .or_default()
                .insert(request.field.clone(), entry);
        }
        Ok(outcome)
    }

    /// Derives one list from its effective evidence and the effective state of
    /// children changed after that evidence. Hot records are borrowed.
    async fn derive_list(
        &mut self,
        request: &DerivationRequest,
    ) -> Result<DerivedEntry, EngineError<S::Error>> {
        let schema = Arc::clone(&self.schema);
        let relation = schema.membership().get(request.relation);
        let optimistic = merged_optimistic(&self.optimistic);
        let mut loaded = Loaded::default();
        let stamps = evidence_key(&request.owner);
        self.load_effective(
            &mut loaded,
            &optimistic,
            [request.owner.clone(), stamps.clone()],
        )
        .await?;
        let seen_at = loaded
            .get(&self.hot, &stamps)
            .and_then(|record| stamp_of(record, &request.field));
        // Evidence written before stamping existed cannot be compared, and
        // undeclared arguments cannot be evaluated: keep the evidence.
        let (Some(seen_at), Some(filter)) =
            (seen_at, relation.filter(&request.owner, &request.arguments))
        else {
            return Ok(DerivedEntry::evidence(true));
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
            return Ok(DerivedEntry::evidence(false));
        }
        let evidence_keys: Vec<_> = match loaded
            .get(&self.hot, &request.owner)
            .and_then(|owner| owner.fields.get(&request.field))
        {
            Some(CacheValue::List(items)) => items
                .iter()
                .filter_map(|item| match item {
                    CacheValue::Ref(key) => Some(key.clone()),
                    _ => None,
                })
                .collect(),
            _ => return Ok(DerivedEntry::evidence(false)),
        };
        self.load_effective(
            &mut loaded,
            &optimistic,
            changed.iter().cloned().chain(evidence_keys),
        )
        .await?;
        let view = View {
            hot: &self.hot,
            loaded: &loaded,
        };
        let Some(CacheValue::List(evidence)) = view
            .get(&request.owner)
            .and_then(|owner| owner.fields.get(&request.field))
        else {
            return Ok(DerivedEntry::evidence(false));
        };
        let derivation = crate::membership::derive(relation, &filter, evidence, &changed, &|key| {
            view.child(key)
        });
        let same = matches!(&derivation.value, CacheValue::List(items) if items == evidence);
        Ok(DerivedEntry {
            list: (!same).then_some(derivation.value),
            unknown: derivation.unknown,
        })
    }

    /// Makes effective records (base plus layers) of `keys` and their
    /// committed alias targets readable through `loaded` and the hot tier.
    async fn load_effective(
        &mut self,
        loaded: &mut Loaded,
        optimistic: &BTreeMap<EntityKey<'static>, Record>,
        keys: impl IntoIterator<Item = EntityKey<'static>>,
    ) -> Result<(), EngineError<S::Error>> {
        let mut pending: BTreeSet<_> = keys.into_iter().collect();
        for _ in 0..=identity::MAX_ALIAS_CHAIN_DEPTH {
            let cold: Vec<_> = pending
                .iter()
                .filter(|key| {
                    !self.hot.contains(*key)
                        && !loaded.fetched.contains_key(*key)
                        && !loaded.absent.contains(*key)
                })
                .cloned()
                .collect();
            if !cold.is_empty() {
                let records = self
                    .storage
                    .get_batch(&cold)
                    .await
                    .map_err(EngineError::Storage)?;
                for (key, record) in cold.into_iter().zip(records) {
                    match record {
                        Some(record) => {
                            loaded.fetched.insert(key, record);
                        }
                        None => {
                            loaded.absent.insert(key);
                        }
                    }
                }
            }
            for key in &pending {
                if let Some(update) = optimistic.get(key)
                    && !loaded.composed.contains_key(key)
                {
                    let mut record = self
                        .hot
                        .peek(key)
                        .or_else(|| loaded.fetched.get(key))
                        .cloned()
                        .unwrap_or_default();
                    record.merge(update.clone());
                    loaded.composed.insert(key.clone(), record);
                }
            }
            pending = pending
                .iter()
                .filter_map(|key| loaded.get(&self.hot, key).and_then(identity::alias_target))
                .filter(|target| !loaded.contains(&self.hot, target))
                .cloned()
                .collect();
            if pending.is_empty() {
                break;
            }
        }
        Ok(())
    }
}

/// What deriving one list found, kept for the rest of its revision.
#[derive(Debug, Clone)]
pub(super) struct DerivedEntry {
    /// The derived list; `None` when it equals the stored evidence.
    list: Option<CacheValue>,
    /// Membership could not be decided; the evidence is used.
    pub unknown: bool,
}

impl DerivedEntry {
    fn evidence(unknown: bool) -> Self {
        Self {
            list: None,
            unknown,
        }
    }
}

/// Outcome of deriving a pass's requests.
#[derive(Default)]
pub(super) struct Derived {
    /// Some list kept its evidence because membership was unknown.
    pub unknown: bool,
    /// Some list differs from the evidence the requesting pass read.
    pub changed: bool,
}

/// Records loaded for one derivation beyond the hot tier.
#[derive(Default)]
struct Loaded {
    /// Cold durable records.
    fetched: HashMap<EntityKey<'static>, Record>,
    /// Base plus pending layers, for layer-touched keys.
    composed: HashMap<EntityKey<'static>, Record>,
    absent: BTreeSet<EntityKey<'static>>,
}

impl Loaded {
    fn get<'a>(
        &'a self,
        hot: &'a LruCache<EntityKey<'static>, Record>,
        key: &EntityKey<'static>,
    ) -> Option<&'a Record> {
        self.composed
            .get(key)
            .or_else(|| self.fetched.get(key))
            .or_else(|| hot.peek(key))
    }

    fn contains(
        &self,
        hot: &LruCache<EntityKey<'static>, Record>,
        key: &EntityKey<'static>,
    ) -> bool {
        self.absent.contains(key) || self.get(hot, key).is_some()
    }
}

/// Effective records of one derivation, borrowing the hot tier.
struct View<'a> {
    hot: &'a LruCache<EntityKey<'static>, Record>,
    loaded: &'a Loaded,
}

impl<'a> View<'a> {
    fn get(&self, key: &EntityKey<'static>) -> Option<&'a Record> {
        self.loaded.get(self.hot, key)
    }

    /// Follows committed aliases; deleted and absent records have no record.
    fn child(&self, key: &EntityKey<'static>) -> Child<'a> {
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
