use crate::{Result, error::OpensearchClientError};

const MAX_REASONABLE_SECONDS: i64 = 32503680000; // Year ~3000
const MAX_REASONABLE_MILLIS: i64 = MAX_REASONABLE_SECONDS * 1000;

/// An epoch-milliseconds timestamp, serialized as a raw `i64` for OpenSearch
/// date fields mapped with `format: epoch_millis`.
///
/// Only implausibly *large* values are rejected. There is deliberately no lower
/// bound: OpenSearch accepts zero and negative epoch_millis happily (they index
/// as 1970 and sort oldest-first), and rejecting them cost more than it saved —
/// a single message dated at epoch 0 used to fail its whole
/// `email.thread_backfilled` batch and leave the entire thread unindexed.
/// Passing a garbage date through and letting it sort as ancient also beats
/// discarding it, since a discarded date falls back to index time and the doc
/// then sorts as if it had just arrived.
///
/// The upper bound stays because a far-future date is not survivable the same
/// way: every sort here is descending, so one year-9999 doc pins itself to the
/// top of every result page. It also catches the realistic unit mistake —
/// microseconds or nanoseconds passed as millis land past year 3000. Seconds
/// passed as millis are no longer caught (they would index as January 1970),
/// which is a tradeoff the callers make safe: every one of them builds this
/// from `chrono`'s `timestamp_millis()`, so the unit is guaranteed by type.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct EpochMillis(i64);

impl EpochMillis {
    pub fn new(millis: i64) -> Result<Self> {
        if millis > MAX_REASONABLE_MILLIS {
            return Err(OpensearchClientError::ValidationFailed {
                details: format!(
                    "timestamp {} exceeds year 3000. Expected milliseconds since Unix epoch.",
                    millis
                ),
            });
        }
        Ok(Self(millis))
    }

    /// The timestamp, or `None` when it fails the upper bound.
    ///
    /// For ingestion paths where one row's bad date must not fail the batch it
    /// arrives in. With no lower bound left, this only filters implausibly
    /// future dates — rare, but a single one would otherwise drop every
    /// sibling doc in the same write.
    pub fn plausible(millis: i64) -> Option<Self> {
        Self::new(millis).ok()
    }

    pub fn get(&self) -> i64 {
        self.0
    }
}

#[cfg(test)]
mod test;
