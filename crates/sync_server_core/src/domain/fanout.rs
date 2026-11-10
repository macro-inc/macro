//! Durable notification debt for causally pending operations.
use super::state_error::{ResultExt, StateError};
use loro::VersionVector;
use serde::{Deserialize, Serialize};

/// Reserved metadata in the existing pending-prefix read, never a Loro operation.
pub const FANOUT_DEBT_KEY: &str = "o/~fanout";
/// History that must reach joined readers after its causal parents are durable.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FanoutDebt {
    /// Applied version before the first unresolved suffix became available.
    pub base: Vec<u8>,
    /// Every operation whose coverage is required before the debt may be cleared.
    pub required: Vec<u8>,
}
impl FanoutDebt {
    /// Decode and validate both vectors before accepting durable metadata.
    pub fn vectors(&self) -> Result<(VersionVector, VersionVector), StateError> {
        let base = VersionVector::decode(&self.base).context("invalid fanout base")?;
        let required =
            VersionVector::decode(&self.required).context("invalid fanout requirement")?;
        if !required.includes_vv(&base) {
            return Err(StateError::InvalidSnapshot);
        }
        Ok((base, required))
    }
}
