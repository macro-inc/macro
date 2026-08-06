//! Queue worker driving reminder dispatch.
//!
//! Every message on the dispatch queue is one of two things: the minutely tick
//! an EventBridge rule puts there, or one firing that a tick fanned out. This
//! adapter tells them apart and calls the matching use case — it makes no
//! decisions of its own beyond what to do with the message afterwards.
//!
//! Several of these run at once, one per service task, all on the same queue.
//! That is the point: fan-out only buys parallelism if more than one worker is
//! pulling from the pool.

#[cfg(test)]
mod test;

use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::domain::models::{
    DueFiring, ReminderDispatchMessage, ReminderDispatchOperation, SweepSummary,
};
use crate::domain::ports::{RawDispatchMessage, ReminderDispatch, ReminderDispatchQueue};

/// How long to wait after a failed receive before trying again.
///
/// Only covers the queue being unreachable; an idle queue is handled by the
/// adapter's long poll, not by sleeping here.
const RECEIVE_BACKOFF: Duration = Duration::from_secs(1);

/// Polls the dispatch queue and runs what it finds.
pub struct DispatchWorker<S, Q> {
    service: S,
    queue: Q,
}

impl<S, Q> DispatchWorker<S, Q>
where
    S: ReminderDispatch,
    Q: ReminderDispatchQueue,
{
    /// Build a worker over a dispatch service and its queue.
    pub fn new(service: S, queue: Q) -> Self {
        Self { service, queue }
    }

    /// Poll until cancelled.
    ///
    /// A batch already received is finished before shutdown, so a delivery is
    /// never abandoned between claiming and completing.
    pub async fn run(&self, cancellation_token: CancellationToken) {
        loop {
            let received = tokio::select! {
                biased;
                () = cancellation_token.cancelled() => return,
                received = self.queue.receive_messages() => received,
            };

            match received {
                Ok(messages) => {
                    for message in messages {
                        self.handle_message(message).await;
                    }
                }
                Err(e) => {
                    tracing::error!(error = ?e, "failed to receive reminder dispatch messages");
                    tokio::select! {
                        biased;
                        () = cancellation_token.cancelled() => return,
                        () = tokio::time::sleep(RECEIVE_BACKOFF) => {}
                    }
                }
            }
        }
    }

    /// Run one message and decide whether it is done with.
    async fn handle_message(&self, message: RawDispatchMessage) {
        let operation = match serde_json::from_str::<ReminderDispatchMessage>(&message.body) {
            Ok(message) => message.operation,
            Err(e) => {
                // Unparseable is not retryable. Acking beats leaving it to be
                // redelivered until the redrive policy dead-letters it, which
                // would burn a receive a minute and bury the DLQ alarm in
                // noise that no retry could ever clear.
                tracing::error!(
                    error = ?e,
                    body_length = message.body.len(),
                    "discarding an unparseable reminder dispatch message",
                );
                self.delete(&message.receipt_handle).await;
                return;
            }
        };

        let handled = match operation {
            ReminderDispatchOperation::Sweep => self.sweep().await,
            ReminderDispatchOperation::Deliver {
                reminder_id,
                scheduled_for,
            } => {
                let firing = DueFiring {
                    reminder_id,
                    scheduled_for,
                };
                match self.service.deliver(firing).await {
                    Ok(outcome) => {
                        tracing::debug!(
                            reminder_id = %reminder_id,
                            ?outcome,
                            "handled a reminder firing",
                        );
                        true
                    }
                    Err(e) => {
                        tracing::error!(
                            error = ?e,
                            reminder_id = %reminder_id,
                            "failed to deliver a reminder firing; leaving it for redelivery",
                        );
                        false
                    }
                }
            }
        };

        // Only ack work that finished. Anything left is redelivered once the
        // visibility timeout lapses, and dead-lettered if it keeps failing.
        if handled {
            self.delete(&message.receipt_handle).await;
        }
    }

    /// Run a sweep, reporting whether the message can be acked.
    async fn sweep(&self) -> bool {
        match self.service.sweep().await {
            Ok(summary) => {
                // Most ticks find nothing — the schedule fires every minute
                // whether or not anything is due — so only say so when it did.
                if summary != SweepSummary::default() {
                    tracing::info!(dispatched = summary.dispatched, "fanned out due reminders");
                }
                true
            }
            Err(e) => {
                tracing::error!(error = ?e, "reminder sweep failed; leaving it for redelivery");
                false
            }
        }
    }

    async fn delete(&self, receipt_handle: &str) {
        if let Err(e) = self.queue.delete_message(receipt_handle).await {
            // The message reappears after the visibility timeout. Delivery is
            // idempotent through the claim, so a repeat is wasted work rather
            // than a duplicate notification.
            tracing::error!(error = ?e, "failed to delete a reminder dispatch message");
        }
    }
}
