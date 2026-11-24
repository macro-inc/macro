//! Which channels a transaction changed, for hosts to tell their views.

use super::{Engine, EngineError, Storage};
use crate::channel_timeline::{ChannelGuardQuery, entry_channel_id, is_channel_entry};
use crate::value::{EntityKey, Record};
use maybe_send::{MaybeSend, MaybeSync};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// What happened to a channel's timeline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelChangeKind {
    /// Entries, coverage or the watermark changed.
    Changed,
    /// Everything held was dropped for what a response listed.
    Reset,
    /// Everything held was dropped.
    Evicted,
}

/// One channel a transaction changed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelChange {
    /// The channel.
    pub channel_id: String,
    /// What happened to it.
    pub kind: ChannelChangeKind,
}

/// Hears of every channel a transaction changed, right after it committed.
pub trait ChannelListener: MaybeSend + MaybeSync {
    /// Reports one transaction's channels, each once.
    fn channels_changed(&self, changes: &[ChannelChange]);
}

impl<F: Fn(&[ChannelChange]) + MaybeSend + MaybeSync> ChannelListener for F {
    fn channels_changed(&self, changes: &[ChannelChange]) {
        self(changes);
    }
}

/// The channels of one transaction.
pub(super) type ChannelChanges = BTreeMap<String, ChannelChangeKind>;

/// The channels of entries that differ between two composed views.
pub(super) fn composed(
    before: &HashMap<EntityKey<'static>, Option<Record>>,
    after: &HashMap<EntityKey<'static>, Option<Record>>,
) -> ChannelChanges {
    let mut changes = ChannelChanges::new();
    for (key, after) in after.iter().filter(|(key, _)| is_channel_entry(key)) {
        let before = before.get(key).and_then(Option::as_ref);
        if before == after.as_ref() {
            continue;
        }
        for record in [before, after.as_ref()].into_iter().flatten() {
            if let Some(channel_id) = entry_channel_id(record) {
                changes
                    .entry(channel_id.to_owned())
                    .or_insert(ChannelChangeKind::Changed);
            }
        }
    }
    changes
}

impl<S: Storage> Engine<S> {
    /// Tells `listener` of every channel a transaction changes.
    pub fn with_channel_listener(mut self, listener: impl ChannelListener + 'static) -> Self {
        self.set_channel_listener(listener);
        self
    }

    /// [`Self::with_channel_listener`] on an engine already in use.
    pub fn set_channel_listener(&mut self, listener: impl ChannelListener + 'static) {
        self.channel_listener = Some(Box::new(listener));
    }

    pub(super) fn report_channels(&self, changes: ChannelChanges) {
        let Some(listener) = self
            .channel_listener
            .as_ref()
            .filter(|_| !changes.is_empty())
        else {
            return;
        };
        let changes = changes
            .into_iter()
            .map(|(channel_id, kind)| ChannelChange { channel_id, kind })
            .collect::<Vec<_>>();
        listener.channels_changed(&changes);
    }

    /// The channels whose timelines hold any of `keys`, read before they go.
    pub(super) async fn channels_holding(
        &self,
        keys: &[EntityKey<'static>],
    ) -> Result<ChannelChanges, EngineError<S::Error>> {
        let query = ChannelGuardQuery {
            keys: keys
                .iter()
                .filter(|key| is_channel_entry(key))
                .cloned()
                .collect(),
            ..ChannelGuardQuery::default()
        };
        if query.keys.is_empty() {
            return Ok(ChannelChanges::new());
        }
        let guard = self
            .storage
            .load_channel_guard(&query)
            .await
            .map_err(EngineError::Storage)?;
        Ok(guard
            .entries
            .into_values()
            .filter(|state| !state.removed)
            .map(|state| (state.channel_id, ChannelChangeKind::Changed))
            .collect())
    }
}
