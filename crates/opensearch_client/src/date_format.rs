use crate::{Result, error::OpensearchClientError};

const MAX_REASONABLE_SECONDS: i64 = 32503680000; // Year ~3000
const MIN_REASONABLE_SECONDS: i64 = 946684800; // Year 2000

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct EpochSeconds(i64);

impl EpochSeconds {
    pub fn new(seconds: i64) -> Result<Self> {
        if seconds > MAX_REASONABLE_SECONDS {
            return Err(OpensearchClientError::ValidationFailed {
                details: format!(
                    "timestamp {} appears to be in milliseconds (exceeds year 3000). Expected seconds since Unix epoch.",
                    seconds
                ),
            });
        }
        if seconds < MIN_REASONABLE_SECONDS {
            return Err(OpensearchClientError::ValidationFailed {
                details: format!(
                    "timestamp {} is before year 2000. Expected seconds since Unix epoch.",
                    seconds
                ),
            });
        }
        Ok(Self(seconds))
    }

    pub fn get(&self) -> i64 {
        self.0
    }
}

#[cfg(test)]
mod test;
