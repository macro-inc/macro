use crate::{Result, error::OpensearchClientError};

const MAX_REASONABLE_SECONDS: i64 = 32503680000; // Year ~3000
const MIN_REASONABLE_SECONDS: i64 = 946684800; // Year 2000

const MAX_REASONABLE_MILLIS: i64 = MAX_REASONABLE_SECONDS * 1000;
const MIN_REASONABLE_MILLIS: i64 = MIN_REASONABLE_SECONDS * 1000;

/// A validated epoch-milliseconds timestamp, serialized as a raw `i64` for
/// OpenSearch date fields mapped with `format: epoch_millis`.
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
        if millis < MIN_REASONABLE_MILLIS {
            // A value at or below the epoch is a missing or zeroed timestamp,
            // not a unit mix-up. Saying "appears to be in seconds" for `0`
            // sends whoever reads the log looking for a seconds/millis bug
            // that isn't there.
            let details = if millis <= 0 {
                format!(
                    "timestamp {} is at or before the Unix epoch, so it is missing rather than in the wrong unit. Expected milliseconds since Unix epoch.",
                    millis
                )
            } else {
                format!(
                    "timestamp {} appears to be in seconds (before year 2000). Expected milliseconds since Unix epoch.",
                    millis
                )
            };
            return Err(OpensearchClientError::ValidationFailed { details });
        }
        Ok(Self(millis))
    }

    /// The timestamp if it is plausible, `None` if it isn't.
    ///
    /// For fields where a bad source timestamp should mean "no timestamp"
    /// rather than a failed write. Some upstream rows carry a zeroed or
    /// pre-epoch date (prod has ~11.7k email messages before year 2000, 3.4k
    /// exactly at epoch 0); indexing those without a date beats rejecting the
    /// batch they arrive in, which drops every sibling doc with them.
    pub fn plausible(millis: i64) -> Option<Self> {
        Self::new(millis).ok()
    }

    pub fn get(&self) -> i64 {
        self.0
    }
}

#[cfg(test)]
mod test;
