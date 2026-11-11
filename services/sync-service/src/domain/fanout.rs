//! Durable notification debt for causally pending operations.

use loro::VersionVector;
use serde::{Deserialize, Serialize};

/// Invalid debt must fail restoration rather than silently discard history.
#[derive(Debug, thiserror::Error)]
#[error("invalid fanout version vectors")]
pub struct FanoutError;

/// Notification metadata outside every legacy operation-prefix scan.
pub const FANOUT_DEBT_KEY: &str = "SYNC_FANOUT_DEBT";
/// Read compatibility for debt created by the earlier activated writer.
pub const LEGACY_FANOUT_DEBT_KEY: &str = "o/~fanout";

/// Both reserved debt keys must stay separate from logical Loro operations.
pub fn is_fanout_debt_key(key: &str) -> bool {
    matches!(key, FANOUT_DEBT_KEY | LEGACY_FANOUT_DEBT_KEY)
}
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
    /// Preserve both histories when a namespace contains either writer format.
    pub fn merged_with(&self, other: &Self) -> Result<Self, FanoutError> {
        let (base, mut required) = self.vectors()?;
        let (other_base, other_required) = other.vectors()?;
        required.merge(&other_required);
        Ok(Self {
            base: base.intersection(&other_base).encode(),
            required: required.encode(),
        })
    }

    /// Decode and validate both vectors before accepting durable metadata.
    pub fn vectors(&self) -> Result<(VersionVector, VersionVector), FanoutError> {
        let base = VersionVector::decode(&self.base).map_err(|_| FanoutError)?;
        let required = VersionVector::decode(&self.required).map_err(|_| FanoutError)?;
        if !required.includes_vv(&base) {
            return Err(FanoutError);
        }
        Ok((base, required))
    }
}

#[cfg(test)]
mod test;
