use crate::{Result, error::OpensearchClientError};

const MAX_REASONABLE_SECONDS: i64 = 32503680000; // Year ~3000
const MAX_REASONABLE_MILLIS: i64 = MAX_REASONABLE_SECONDS * 1000;

/// An epoch-milliseconds timestamp, serialized as a raw `i64` for OpenSearch
/// date fields mapped with `format: epoch_millis`.
///
/// Zero and negative values are valid. Values past year 3000 are rejected.
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

    /// The timestamp, or `None` if it is rejected.
    pub fn plausible(millis: i64) -> Option<Self> {
        Self::new(millis).ok()
    }

    pub fn get(&self) -> i64 {
        self.0
    }
}

#[cfg(test)]
mod test;
