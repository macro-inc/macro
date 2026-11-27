//! How many times an event is attempted, how long the worker waits between
//! attempts, and what the last failure says about the event.

use std::{future::Future, time::Duration};

use opensearch_client::error::OpensearchClientError;
use tokio_util::sync::CancellationToken;

/// Attempts of an event read from Kafka, the first included, unless
/// OpenSearch is refusing writes.
pub(super) const MAX_PROCESSING_ATTEMPTS: u32 = 3;
/// Delay before the first retry; each later delay doubles.
pub(super) const PROCESSING_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);
/// Attempts of an event while OpenSearch refuses its writes. Waiting keeps the
/// worker's events, and once its channel fills every topic, off a cluster that
/// is shedding load, instead of failing each event within seconds.
pub(super) const OVERLOADED_MAX_ATTEMPTS: u32 = 8;
/// Longest wait between two attempts OpenSearch refused.
pub(super) const OVERLOADED_MAX_DELAY: Duration = Duration::from_secs(30);

/// Why an attempt failed, as its span and metrics record it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum Failure {
    /// OpenSearch answered a `_bulk` request and failed items in it.
    BulkItems,
    /// OpenSearch refused the write to protect itself: a full write queue, a
    /// tripped circuit breaker, or a write block.
    Overloaded,
    /// A database row the event needs is not there.
    SourceMissing,
    /// Any other failure.
    Error,
}

/// What an attempt's error says about the event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Diagnosis {
    pub(crate) failure: Failure,
    /// Items OpenSearch failed in the attempt's bulk request.
    pub(crate) failed_items: u32,
}

/// An error an attempt can fail with.
pub(crate) trait AttemptError: std::fmt::Debug {
    fn diagnose(&self) -> Diagnosis;
}

impl AttemptError for anyhow::Error {
    fn diagnose(&self) -> Diagnosis {
        diagnose_causes(self.chain())
    }
}

impl AttemptError for rootcause::Report {
    fn diagnose(&self) -> Diagnosis {
        let contexts = self.iter_reports().flat_map(|report| {
            report
                .downcast_current_context::<OpensearchClientError>()
                .map(|error| error as &(dyn std::error::Error + 'static))
                .into_iter()
                .chain(report.current_context_error_source())
        });
        diagnose_causes(contexts)
    }
}

fn diagnose_causes<'a>(
    causes: impl IntoIterator<Item = &'a (dyn std::error::Error + 'static)>,
) -> Diagnosis {
    let mut diagnosis = Diagnosis {
        failure: Failure::Error,
        failed_items: 0,
    };
    for cause in causes {
        if let Some(error) = cause.downcast_ref::<OpensearchClientError>() {
            diagnosis.failed_items = u32::try_from(error.failed_items()).unwrap_or(u32::MAX);
            if error.refusal().is_some() {
                diagnosis.failure = Failure::Overloaded;
                return diagnosis;
            }
            if diagnosis.failed_items > 0 {
                diagnosis.failure = Failure::BulkItems;
                return diagnosis;
            }
        }
        if let Some(sqlx::Error::RowNotFound) = cause.downcast_ref::<sqlx::Error>() {
            diagnosis.failure = Failure::SourceMissing;
            return diagnosis;
        }
    }
    diagnosis
}

/// An event whose attempts all failed.
#[derive(Debug)]
pub(crate) struct Exhausted {
    /// The last attempt's error, with its causes.
    pub(crate) error: String,
    pub(crate) diagnosis: Diagnosis,
    pub(crate) attempts: u32,
}

/// The successful end of an event's attempts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Handled {
    /// The event's search-index operation succeeded.
    Indexed,
    /// The event needs no search-index operation.
    Ignored,
    /// The event's write found nothing in the index to change: a property
    /// write for an entity the index does not hold yet.
    NoIndexChange,
    /// The event's source is gone for good, so there is nothing to index.
    SourceMissing,
}

/// How a handled event ended, and after how many attempts.
pub(crate) type Attempted = Result<(Handled, u32), Exhausted>;

/// When an event's attempts stop.
#[derive(Debug, Clone)]
pub(crate) enum Attempts {
    /// A Kafka worker retries in place, waiting longer while OpenSearch
    /// refuses writes, until the consumer stops.
    Retry { stopping: CancellationToken },
    /// A replay has one attempt per delivery: the queue redelivers it.
    Once,
}

impl Attempts {
    /// Run `attempt` until it succeeds or the attempts end. `attempt` receives
    /// the 1-based attempt number.
    pub(crate) async fn run<F, Fut, E>(&self, mut attempt: F) -> Attempted
    where
        F: FnMut(u32) -> Fut,
        Fut: Future<Output = Result<(), E>>,
        E: AttemptError,
    {
        self.run_handled(|number| {
            let attempt = attempt(number);
            async move { attempt.await.map(|()| Handled::Indexed) }
        })
        .await
    }

    /// [`Self::run`] for an attempt that says how it handled the event.
    pub(crate) async fn run_handled<F, Fut, E>(&self, mut attempt: F) -> Attempted
    where
        F: FnMut(u32) -> Fut,
        Fut: Future<Output = Result<Handled, E>>,
        E: AttemptError,
    {
        let mut number = 0;
        loop {
            number += 1;
            let error = match attempt(number).await {
                Ok(handled) => return Ok((handled, number)),
                Err(error) => error,
            };
            let diagnosis = error.diagnose();
            let exhausted = || Exhausted {
                error: format!("{error:?}"),
                diagnosis,
                attempts: number,
            };
            let Self::Retry { stopping } = self else {
                return Err(exhausted());
            };
            let Some(delay) = retry_delay(diagnosis.failure, number) else {
                return Err(exhausted());
            };
            tracing::warn!(
                error = ?error,
                attempt = number,
                failure = <&'static str>::from(diagnosis.failure),
                failed_items = diagnosis.failed_items,
                delay_ms = u64::try_from(delay.as_millis()).unwrap_or(u64::MAX),
                "search-index processing failed, retrying"
            );
            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                // A stopping consumer cuts off a started event instead of
                // redelivering it, so the event goes to the replay queue now.
                () = stopping.cancelled() => return Err(exhausted()),
            }
        }
    }
}

/// The wait before the attempt after `attempt` failed with `failure`, or
/// `None` when the attempts are spent.
pub(super) fn retry_delay(failure: Failure, attempt: u32) -> Option<Duration> {
    let doubling = 2u32.saturating_pow(attempt.saturating_sub(1));
    match failure {
        Failure::Overloaded => (attempt < OVERLOADED_MAX_ATTEMPTS).then(|| {
            // Half the doubled delay is fixed and half random, so a burst of
            // refused workers spreads out but every one of them still waits.
            let ceiling = PROCESSING_RETRY_BASE_DELAY
                .saturating_mul(doubling)
                .min(OVERLOADED_MAX_DELAY);
            ceiling / 2 + (ceiling / 2).mul_f64(rand::random::<f64>())
        }),
        Failure::BulkItems | Failure::SourceMissing | Failure::Error => (attempt
            < MAX_PROCESSING_ATTEMPTS)
            .then(|| PROCESSING_RETRY_BASE_DELAY.saturating_mul(doubling)),
    }
}

#[cfg(test)]
mod test;
