//! Separate FIFO admission pools; cancellation always releases the waiting count.
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::{Semaphore, SemaphorePermit};
use tokio::time::Instant;
use tracing::Instrument;

const SATURATION_WAIT: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Clone, Copy, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum AdmissionClass {
    Interactive,
    Ingestion,
    Import,
    Sync,
}

struct Waiting<'a> {
    count: &'a AtomicUsize,
    began: Instant,
    outcome: AdmissionOutcome,
    span: tracing::Span,
    submission: Option<tracing::Span>,
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.count.fetch_sub(1, Ordering::Relaxed);
        let elapsed = self.began.elapsed();
        let millis = i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX);
        let saturated = elapsed >= SATURATION_WAIT;
        self.span.record("admission.wait_ms", millis);
        self.span.record("admission.outcome", self.outcome.as_ref());
        self.span.record("admission.saturated", saturated);
        if let Some(span) = &self.submission {
            span.record("smtp.outcome", self.outcome.as_ref());
        }
        if saturated {
            tracing::warn!(parent: &self.span, "IMAP admission saturated");
        }
    }
}

impl Engine {
    /// Export the current aggregate queued-work signal without ending pending waits.
    pub fn report_admission_saturation(&self) {
        for (class, waiting, capacity) in [
            (
                AdmissionClass::Interactive,
                &self.operation_waiting,
                &self.operation_capacity,
            ),
            (
                AdmissionClass::Ingestion,
                &self.ingestion_waiting,
                &self.ingestion_capacity,
            ),
            (
                AdmissionClass::Import,
                &self.import_waiting,
                &self.import_capacity,
            ),
            (
                AdmissionClass::Sync,
                &self.synchronization_waiting,
                &self.synchronization_capacity,
            ),
        ] {
            let queued = waiting.load(Ordering::Relaxed);
            if queued == 0 || capacity.available_permits() > 0 {
                continue;
            }
            // End an aggregate signal immediately: exporters can report an
            // ongoing queue without waiting for its long-lived parent spans.
            let signal = tracing::info_span!(
                "imap.admission.saturation",
                admission.class = class.as_ref(),
                admission.queue_depth = i64::try_from(queued).unwrap_or(i64::MAX),
                admission.saturated = tracing::field::Empty,
            );
            signal.record("admission.saturated", true);
            drop(signal);
        }
    }

    pub(super) async fn admit_capacity(
        &self,
        operation: &Operation,
        class: OperationClass,
        submission_deadline: Instant,
    ) -> Result<SemaphorePermit<'_>, Error> {
        // A sync never reserves an interactive or ingestion permit while queued.
        let (capacity, waiting, class): (&Semaphore, &AtomicUsize, AdmissionClass) =
            if matches!(operation, Operation::Sync) {
                (
                    &self.synchronization_capacity,
                    &self.synchronization_waiting,
                    AdmissionClass::Sync,
                )
            } else {
                match class {
                    OperationClass::Interactive => (
                        &self.operation_capacity,
                        &self.operation_waiting,
                        AdmissionClass::Interactive,
                    ),
                    OperationClass::Ingestion => (
                        &self.ingestion_capacity,
                        &self.ingestion_waiting,
                        AdmissionClass::Ingestion,
                    ),
                    OperationClass::Import => (
                        &self.import_capacity,
                        &self.import_waiting,
                        AdmissionClass::Import,
                    ),
                }
            };
        let depth = i64::try_from(waiting.fetch_add(1, Ordering::Relaxed) + 1).unwrap_or(i64::MAX);
        let span = tracing::info_span!(
            "imap.admission",
            admission.class = class.as_ref(),
            admission.queue_depth = depth,
            admission.wait_ms = tracing::field::Empty,
            admission.outcome = tracing::field::Empty,
            admission.saturated = tracing::field::Empty,
        );
        let submission = matches!(operation, Operation::Submit { .. }).then(|| {
            tracing::info_span!(parent: &span, "imap.submit.admission", smtp.outcome = tracing::field::Empty)
        });
        let mut wait = Waiting {
            count: waiting,
            began: Instant::now(),
            outcome: AdmissionOutcome::Cancelled,
            span: span.clone(),
            submission,
        };
        let acquisition = capacity.acquire().instrument(span);
        let result = if matches!(operation, Operation::Submit { .. }) {
            // Prior durable send state has not been inspected. Admission timeout
            // remains generic unavailability, never a proof of non-submission.
            match tokio::time::timeout_at(submission_deadline, acquisition).await {
                Ok(result) => result.map_err(|_| AdmissionOutcome::Unavailable),
                Err(_) => Err(AdmissionOutcome::Timeout),
            }
        } else {
            acquisition.await.map_err(|_| AdmissionOutcome::Unavailable)
        };
        wait.outcome = match &result {
            Ok(_) => AdmissionOutcome::Admitted,
            Err(outcome) => *outcome,
        };
        result.map_err(|_| Error::ConnectionUnavailable)
    }
}
