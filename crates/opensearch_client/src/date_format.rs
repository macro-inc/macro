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
            return Err(OpensearchClientError::ValidationFailed {
                details: format!(
                    "timestamp {} appears to be in seconds (before year 2000). Expected milliseconds since Unix epoch.",
                    millis
                ),
            });
        }
        Ok(Self(millis))
    }

    pub fn get(&self) -> i64 {
        self.0
    }
}

#[cfg(test)]
mod test;
