//! What a queued write shows of messages the device has, and of those it lacks.

use super::channel_write::ChannelAdmission;
use super::{Engine, EngineError, Storage};
use crate::channel_timeline::{
    ChannelGuardQuery, MESSAGE_TYPENAME, is_channel_entry, project_channel_timeline,
};
use crate::normalize::RecordUpdates;
use crate::value::{CacheValue, EntityKey, Record};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

/// The message a mutation sends, if it is a send: its mutation has its
/// message's id.
pub(super) fn sent_message(uuid: Uuid) -> EntityKey<'static> {
    EntityKey::entity(MESSAGE_TYPENAME, &[&uuid.to_string()])
}

/// Takes out of `updates` the entries they only name that `held`, what is under
/// them, cannot show: a list naming one would not be readable.
pub(super) fn leave_out_unheld(
    updates: &mut RecordUpdates,
    held: &HashMap<EntityKey<'static>, Option<Record>>,
) {
    let shows = |key: &EntityKey<'static>| {
        let record = held.get(key).and_then(Option::as_ref);
        record.is_some_and(|record| project_channel_timeline(key, record).is_some())
    };
    let unheld = |(key, update): &(&EntityKey<'static>, &Record)| {
        let mut fields = update.fields.keys();
        let only_named = fields.all(|field| field == "id" || field == "__typename");
        only_named && is_channel_entry(key) && !shows(key)
    };
    let unheld: BTreeSet<_> = updates
        .iter()
        .filter(unheld)
        .map(|(key, _)| key.clone())
        .collect();
    if unheld.is_empty() {
        return;
    }
    updates.retain(|key, _| !unheld.contains(key));
    for value in updates
        .values_mut()
        .flat_map(|update| update.fields.values_mut())
    {
        unlist(value, &unheld);
    }
}

fn unlist(value: &mut CacheValue, keys: &BTreeSet<EntityKey<'static>>) {
    match value {
        CacheValue::List(items) => {
            items.retain(|item| !matches!(item, CacheValue::Ref(key) if keys.contains(key)));
            items.iter_mut().for_each(|item| unlist(item, keys));
        }
        CacheValue::Object(fields) => fields.values_mut().for_each(|field| unlist(field, keys)),
        _ => {}
    }
}

/// What the device has of an entry a timeline lists or knows removed.
#[derive(Clone, Copy)]
struct Known {
    seq: i64,
    removed: bool,
}

impl<S: Storage> Engine<S> {
    /// Takes out of a send's `updates`, once its message arrived, what it
    /// predicted of entries that are listed, with every field it predicted, at
    /// least as new as the message. A send whose answer was lost stays queued
    /// while its message comes back in a push or a page. `bases` and
    /// `admission` include the write under way, which is not stored yet.
    /// Returns the sequence the message arrived by.
    pub(super) async fn yield_to_server(
        &self,
        uuid: Uuid,
        updates: &mut RecordUpdates,
        bases: &HashMap<EntityKey<'static>, Record>,
        admission: Option<&ChannelAdmission>,
    ) -> Result<Option<i64>, EngineError<S::Error>> {
        let sent = sent_message(uuid);
        if !updates.contains_key(&sent) {
            return Ok(None);
        }
        let keys = updates.keys().cloned().collect();
        let known = self.known_entries(keys, bases, admission).await?;
        let Some(arrival) = known.get(&sent) else {
            return Ok(None);
        };
        // A later read of the message alone dates it anew, not its root.
        let mut before = self.optimistic.iter().filter(|layer| layer.uuid == uuid);
        let before = before.find_map(|layer| layer.arrived);
        let arrived = before.map_or(arrival.seq, |seq| seq.min(arrival.seq));
        updates.retain(|key, update| {
            let listed = known.get(key).filter(|known| !known.removed);
            let whole = bases
                .get(key)
                .is_some_and(|base| update.fields.keys().all(|f| base.fields.contains_key(f)));
            !whole || listed.is_none_or(|listed| listed.seq < arrived)
        });
        Ok(Some(arrived))
    }

    /// What the device has of `keys` once the write under way is stored. A
    /// copy without a sequence is not known: no timeline lists it.
    async fn known_entries(
        &self,
        keys: BTreeSet<EntityKey<'static>>,
        bases: &HashMap<EntityKey<'static>, Record>,
        admission: Option<&ChannelAdmission>,
    ) -> Result<HashMap<EntityKey<'static>, Known>, EngineError<S::Error>> {
        let query = ChannelGuardQuery {
            keys,
            ..ChannelGuardQuery::default()
        };
        let guard = self
            .storage
            .load_channel_guard(&query)
            .await
            .map_err(EngineError::Storage)?;
        let known = query.keys.into_iter().filter_map(|key| {
            // The write deletes an entry together with its row.
            let base = bases.get(&key)?;
            let tombstone = admission.and_then(|admission| admission.tombstone(&key));
            let stamp = admission.and_then(|admission| admission.stamp(&key));
            let known = match (tombstone, stamp) {
                (Some(seq), _) => Known { seq, removed: true },
                (None, Some(seq)) => {
                    project_channel_timeline(&key, base)?;
                    Known {
                        seq,
                        removed: false,
                    }
                }
                (None, None) => {
                    let state = guard.entries.get(&key)?;
                    Known {
                        seq: state.seq,
                        removed: state.removed,
                    }
                }
            };
            Some((key, known))
        });
        Ok(known.collect())
    }
}
