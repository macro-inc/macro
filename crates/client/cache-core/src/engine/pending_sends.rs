//! Queued sends the device already has the server's copy of.

use crate::channel_timeline::MESSAGE_TYPENAME;
use crate::normalize::RecordUpdates;
use crate::value::{EntityKey, Record};
use std::collections::HashMap;
use uuid::Uuid;

/// The messages the queue is sending, as its layers so far predict them. A
/// send whose answer was lost stays queued while its message comes back in a
/// push or a page.
#[derive(Default)]
pub(super) struct PendingSends {
    predicted: HashMap<EntityKey<'static>, Record>,
}

impl PendingSends {
    /// Takes out of one mutation's `updates`, in queue order, what `bases`
    /// know better: a send's prediction of a message the server has, and what
    /// a later mutation repeats of that prediction rather than changes. A
    /// send's mutation has its message's id.
    pub(super) fn yield_to_server(
        &mut self,
        uuid: Uuid,
        updates: &mut RecordUpdates,
        bases: &HashMap<EntityKey<'static>, Record>,
    ) {
        let sent = EntityKey::entity(MESSAGE_TYPENAME, &[&uuid.to_string()]);
        updates.retain(|key, update| {
            if *key != sent && !self.predicted.contains_key(key) {
                return true;
            }
            let before = self.predicted.get(key).cloned();
            self.predicted
                .entry(key.clone())
                .or_default()
                .merge(update.clone());
            let whole = bases
                .get(key)
                .is_some_and(|base| update.fields.keys().all(|f| base.fields.contains_key(f)));
            if !whole {
                return true;
            }
            update.fields.retain(|field, value| {
                before
                    .as_ref()
                    .is_some_and(|before| before.fields.get(field) != Some(value))
            });
            !update.fields.is_empty()
        });
    }
}
