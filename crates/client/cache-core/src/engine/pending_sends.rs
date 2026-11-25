//! Queued sends whose message the device already has.

use super::channel_write::ChannelAdmission;
use super::{Engine, EngineError, Storage};
use crate::channel_timeline::{ChannelGuardQuery, MESSAGE_TYPENAME, project_channel_timeline};
use crate::normalize::RecordUpdates;
use crate::queue::QueuedMutation;
use crate::value::{EntityKey, Record};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

/// What the device has of an entry.
#[derive(Clone, Copy)]
pub(super) struct Known {
    pub(super) seq: i64,
    pub(super) removed: bool,
}

/// The messages of queued sends that arrived: held, or known removed since.
pub(super) struct ArrivedSends(HashMap<EntityKey<'static>, Known>);

/// The message a mutation sends, if it is a send: its mutation has its
/// message's id.
pub(super) fn sent_message(uuid: Uuid) -> EntityKey<'static> {
    EntityKey::entity(MESSAGE_TYPENAME, &[&uuid.to_string()])
}

impl<S: Storage> Engine<S> {
    /// Reads which messages `queued` sends the device has. A send whose answer
    /// was lost stays queued while its message comes back in a push or a page.
    /// `admission` is the write under way, whose rows are not stored yet.
    pub(super) async fn arrived_sends(
        &self,
        queued: &[QueuedMutation],
        admission: Option<&ChannelAdmission>,
    ) -> Result<ArrivedSends, EngineError<S::Error>> {
        let sent = queued.iter().map(|queued| sent_message(queued.uuid));
        let arrived = self.known_entries(sent.collect(), admission).await?;
        Ok(ArrivedSends(arrived))
    }

    /// Takes out of a send's `updates`, once its message arrived, what it
    /// predicted of entries that are listed, with every field it predicted,
    /// at least as new as the message.
    pub(super) async fn yield_to_server(
        &self,
        arrived: &ArrivedSends,
        uuid: Uuid,
        updates: &mut RecordUpdates,
        bases: &HashMap<EntityKey<'static>, Record>,
        admission: Option<&ChannelAdmission>,
    ) -> Result<(), EngineError<S::Error>> {
        let sent = sent_message(uuid);
        let Some(arrival) = arrived.0.get(&sent) else {
            return Ok(());
        };
        if !updates.contains_key(&sent) {
            return Ok(());
        }
        let covered = updates
            .iter()
            .filter(|(key, update)| covers(bases.get(*key), key, update))
            .map(|(key, _)| key.clone())
            .collect();
        let known = self.known_entries(covered, admission).await?;
        updates.retain(|key, _| {
            !known
                .get(key)
                .is_some_and(|known| !known.removed && known.seq >= arrival.seq)
        });
        Ok(())
    }

    /// What the device has of `keys`. A copy stored without a sequence is not
    /// known: no timeline lists it.
    async fn known_entries(
        &self,
        keys: BTreeSet<EntityKey<'static>>,
        admission: Option<&ChannelAdmission>,
    ) -> Result<HashMap<EntityKey<'static>, Known>, EngineError<S::Error>> {
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
        let known = query.keys.into_iter().filter_map(|key| {
            let written = admission.and_then(|admission| admission.written(&key));
            let stored = guard.entries.get(&key).map(|state| Known {
                seq: state.seq,
                removed: state.removed,
            });
            Some((key, written.or(stored)?))
        });
        Ok(known.collect())
    }
}

/// Whether `base` can be listed and has every field of `update`.
fn covers(base: Option<&Record>, key: &EntityKey<'static>, update: &Record) -> bool {
    base.is_some_and(|base| {
        update.fields.keys().all(|f| base.fields.contains_key(f))
            && project_channel_timeline(key, base).is_some()
    })
}
