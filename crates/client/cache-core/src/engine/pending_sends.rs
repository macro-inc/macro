//! Queued sends the device already has the server's copy of.

use super::channel_write::ChannelAdmission;
use super::{Engine, EngineError, Storage};
use crate::channel_timeline::{ChannelGuardQuery, MESSAGE_TYPENAME, is_channel_entry};
use crate::normalize::RecordUpdates;
use crate::value::{EntityKey, Record};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

/// The messages the queue is sending, as its layers so far predict them. A
/// send whose answer was lost stays queued while its message comes back in a
/// push or a page.
#[derive(Default)]
pub(super) struct PendingSends {
    predicted: HashMap<EntityKey<'static>, Record>,
}

impl<S: Storage> Engine<S> {
    /// Takes out of one mutation's `updates`, in queue order, what `bases`
    /// know better: once the device holds a send's message, what the send
    /// predicted of entries held at least as new as it, and what a later
    /// mutation repeats of a held message's prediction rather than changes. A
    /// send's mutation has its message's id. `admission` is the write under
    /// way, whose rows are not stored yet.
    pub(super) async fn yield_to_server(
        &self,
        sends: &mut PendingSends,
        uuid: Uuid,
        updates: &mut RecordUpdates,
        bases: &HashMap<EntityKey<'static>, Record>,
        admission: Option<&ChannelAdmission>,
    ) -> Result<(), EngineError<S::Error>> {
        let sent = EntityKey::entity(MESSAGE_TYPENAME, &[&uuid.to_string()]);
        let sending = updates.contains_key(&sent);
        let whole = |key: &EntityKey<'static>, update: &Record| {
            bases
                .get(key)
                .is_some_and(|base| update.fields.keys().all(|f| base.fields.contains_key(f)))
        };
        let answered = updates
            .iter()
            .filter(|(key, _)| sending || sends.predicted.contains_key(*key))
            .filter(|(key, update)| is_channel_entry(key) && whole(key, update))
            .map(|(key, _)| key.clone())
            .collect();
        let held = self.held_entries(answered, admission).await?;
        let delivered = held.get(&sent).copied().filter(|_| sending);
        updates.retain(|key, update| {
            let pending = *key == sent || sends.predicted.contains_key(key);
            let before = sends.predicted.get(key).cloned();
            if pending {
                let predicted = sends.predicted.entry(key.clone()).or_default();
                predicted.merge(update.clone());
            }
            let Some(seq) = held.get(key) else {
                return true;
            };
            if delivered.is_some_and(|delivered| delivered <= *seq) {
                return false;
            }
            let Some(before) = before else {
                return true;
            };
            update
                .fields
                .retain(|field, value| before.fields.get(field) != Some(value));
            !update.fields.is_empty()
        });
        Ok(())
    }

    /// The sequences of those of `keys` a timeline lists. A copy written
    /// without one is read, but takes no place in a list.
    async fn held_entries(
        &self,
        keys: BTreeSet<EntityKey<'static>>,
        admission: Option<&ChannelAdmission>,
    ) -> Result<HashMap<EntityKey<'static>, i64>, EngineError<S::Error>> {
        if keys.is_empty() {
            return Ok(HashMap::new());
        }
        let query = ChannelGuardQuery {
            keys,
            ..ChannelGuardQuery::default()
        };
        let guard = self
            .storage
            .load_channel_guard(&query)
            .await
            .map_err(EngineError::Storage)?;
        let held = query.keys.into_iter().filter_map(|key| {
            let written = admission.and_then(|admission| admission.stamp(&key));
            let stored = guard.entries.get(&key).filter(|state| !state.removed);
            let seq = written.or(stored.map(|state| state.seq))?;
            Some((key, seq))
        });
        Ok(held.collect())
    }
}
