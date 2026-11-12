//! Queue worker driving calendar reminder dispatch.
//!
//! Every message on the dispatch queue is one of two things: the minutely
//! tick an EventBridge rule puts there, or one firing that a tick fanned out.
//! This adapter tells them apart and calls the matching use case. Several of
//! these run at once, one per service task, all on the same queue — that is
//! what makes the fan-out deliver in parallel.

use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::domain::models::{
    CalendarReminderDispatchMessage, CalendarReminderDispatchOperation,
    CalendarReminderSweepSummary,
};
use crate::domain::ports::{
    CalendarReminderDispatch, CalendarReminderDispatchQueue, RawCalendarDispatchMessage,
};

/// How long to wait after a failed receive before trying again. Only covers
/// the queue being unreachable; an idle queue is handled by the adapter's
/// long poll, not by sleeping here.
const RECEIVE_BACKOFF: Duration = Duration::from_secs(1);

/// Polls the dispatch queue and runs what it finds.
pub struct CalendarReminderDispatchWorker<S, Q> {
    service: S,
    queue: Q,
}

impl<S, Q> CalendarReminderDispatchWorker<S, Q>
where
    S: CalendarReminderDispatch,
    Q: CalendarReminderDispatchQueue,
{
    /// Build a worker over a dispatch service and its queue.
    pub fn new(service: S, queue: Q) -> Self {
        Self { service, queue }
    }

    /// Poll until cancelled. A batch already received is finished before
    /// shutdown, so a delivery is never abandoned between claiming and
    /// completing.
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
                Err(error) => {
                    tracing::error!(error = ?error, "failed to receive calendar dispatch messages");
                    tokio::select! {
                        biased;
                        () = cancellation_token.cancelled() => return,
                        () = tokio::time::sleep(RECEIVE_BACKOFF) => {}
                    }
                }
            }
        }
    }

    /// Ack every message without running it: the deploy-time kill switch.
    /// The EventBridge tick keeps arriving whether or not dispatch is
    /// enabled, and draining it beats letting it back up into the DLQ.
    pub async fn drain(&self, cancellation_token: CancellationToken) {
        loop {
            let received = tokio::select! {
                biased;
                () = cancellation_token.cancelled() => return,
                received = self.queue.receive_messages() => received,
            };

            match received {
                Ok(messages) => {
                    for message in messages {
                        self.delete(&message.receipt_handle).await;
                    }
                }
                Err(error) => {
                    tracing::error!(error = ?error, "failed to receive calendar dispatch messages");
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
    async fn handle_message(&self, message: RawCalendarDispatchMessage) {
        let operation = match serde_json::from_str::<CalendarReminderDispatchMessage>(&message.body)
        {
            Ok(message) => message.operation,
            Err(error) => {
                // Unparseable is not retryable. Acking beats leaving it to be
                // redelivered until the redrive policy dead-letters it.
                tracing::error!(
                    error = ?error,
                    body_length = message.body.len(),
                    "discarding an unparseable calendar dispatch message",
                );
                self.delete(&message.receipt_handle).await;
                return;
            }
        };

        let handled = match operation {
            CalendarReminderDispatchOperation::Sweep => self.sweep().await,
            CalendarReminderDispatchOperation::Deliver(firing) => {
                let event_id = firing.event_id;
                match self.service.deliver(firing).await {
                    Ok(outcome) => {
                        tracing::debug!(
                            event_id = %event_id,
                            ?outcome,
                            "handled a calendar reminder firing",
                        );
                        true
                    }
                    Err(error) => {
                        tracing::error!(
                            error = ?error,
                            event_id = %event_id,
                            "failed to deliver a calendar reminder; leaving it for redelivery",
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
                if summary != CalendarReminderSweepSummary::default() {
                    tracing::info!(
                        dispatched = summary.dispatched,
                        "fanned out due calendar reminders"
                    );
                }
                true
            }
            Err(error) => {
                tracing::error!(error = ?error, "calendar reminder sweep failed; leaving it for redelivery");
                false
            }
        }
    }

    async fn delete(&self, receipt_handle: &str) {
        if let Err(error) = self.queue.delete_message(receipt_handle).await {
            // The message reappears after the visibility timeout. Delivery is
            // idempotent through the claim, so a repeat is wasted work rather
            // than a duplicate notification.
            tracing::error!(error = ?error, "failed to delete a calendar dispatch message");
        }
    }
}
