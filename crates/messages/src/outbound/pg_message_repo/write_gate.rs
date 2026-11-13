//! A per-channel limit on the writes this process runs at once.
//!
//! A channel's writes commit one at a time (see `change_log`), so writers to
//! one channel beyond the first wait. Waiting inside the database holds a
//! pool connection each: a burst into one channel would take the whole pool
//! and stall every other channel. The gate makes the rest wait here, before
//! they take a connection.

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex, PoisonError},
    time::Duration,
};

use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use crate::domain::{models::MessageParent, ports::MessageError};

#[cfg(test)]
mod test;

/// Writes to one channel that hold a connection at once. They prepare in
/// parallel and commit in turn; more would only queue in the database.
const WRITES_IN_FLIGHT: usize = 4;
/// How long a write waits for its turn before it fails as busy.
const TURN_WAIT: Duration = Duration::from_secs(2);

/// The gate every repository in this process shares, so the limit holds
/// however many repositories a service builds.
static PROCESS_GATE: LazyLock<ChannelWriteGate> = LazyLock::new(ChannelWriteGate::default);

/// Hands out turns to write to a channel.
#[derive(Clone, Default)]
pub(super) struct ChannelWriteGate {
    channels: Arc<Mutex<HashMap<Uuid, Arc<Semaphore>>>>,
}

/// A turn to write to a channel, held until the write's transaction ends.
pub(super) struct ChannelWriteTurn {
    gate: ChannelWriteGate,
    channel_id: Uuid,
    permit: Option<OwnedSemaphorePermit>,
}

impl ChannelWriteGate {
    /// The gate shared by every repository in this process.
    pub(super) fn process() -> Self {
        PROCESS_GATE.clone()
    }

    /// Wait for a turn to write to `parent`. Parents other than channels
    /// have no shared counter and need no turn.
    pub(super) async fn enter(
        &self,
        parent: &MessageParent,
    ) -> Result<Option<ChannelWriteTurn>, MessageError> {
        let MessageParent::Channel(channel_id) = parent else {
            return Ok(None);
        };
        self.enter_channel(*channel_id).await.map(Some)
    }

    /// Wait for a turn to write to the channel.
    #[tracing::instrument(
        name = "messages.channel_write_turn",
        skip(self),
        fields(waited = tracing::field::Empty),
        err
    )]
    pub(super) async fn enter_channel(
        &self,
        channel_id: Uuid,
    ) -> Result<ChannelWriteTurn, MessageError> {
        let turns = self
            .channels
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(channel_id)
            .or_insert_with(|| Arc::new(Semaphore::new(WRITES_IN_FLIGHT)))
            .clone();
        // A turn that is not taken still leaves through `Drop`, which clears
        // the channel's entry once nobody waits on it.
        let mut turn = ChannelWriteTurn {
            gate: self.clone(),
            channel_id,
            permit: None,
        };
        let free = turns.clone().try_acquire_owned().ok();
        tracing::Span::current().record("waited", free.is_none());
        if let Some(permit) = free {
            turn.permit = Some(permit);
            return Ok(turn);
        }
        match tokio::time::timeout(TURN_WAIT, turns.acquire_owned()).await {
            Ok(Ok(permit)) => {
                turn.permit = Some(permit);
                Ok(turn)
            }
            // The semaphore is never closed; a timeout is the only way out.
            Ok(Err(_)) | Err(_) => Err(MessageError::Busy),
        }
    }

    #[cfg(test)]
    fn channels(&self) -> usize {
        self.channels
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }
}

impl Drop for ChannelWriteTurn {
    fn drop(&mut self) {
        self.permit = None;
        let mut channels = self
            .gate
            .channels
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        // Clones are only made under this lock, so a count of one means no
        // writer holds or waits for a turn.
        if channels
            .get(&self.channel_id)
            .is_some_and(|turns| Arc::strong_count(turns) == 1)
        {
            channels.remove(&self.channel_id);
        }
    }
}
