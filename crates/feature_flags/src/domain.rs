//! Provider-neutral flag loading and immutable evaluation results.

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::{collections::HashMap, future::Future};

/// A successfully evaluated boolean flag or multivariate assignment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FlagValue {
    /// Whether a boolean flag is enabled.
    Boolean(bool),
    /// The assigned variant of an enabled multivariate flag.
    Variant(String),
}

/// Stable results from one completed load for one authenticated user.
///
/// Reads perform no evaluation or network requests. Missing keys are distinct
/// from failed loads: only a successful load produces a snapshot.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FlagSnapshot {
    flags: HashMap<String, FlagValue>,
}

impl FlagSnapshot {
    /// Construct a snapshot from successfully evaluated flags.
    pub fn new(flags: impl IntoIterator<Item = (String, FlagValue)>) -> Self {
        Self {
            flags: flags.into_iter().collect(),
        }
    }

    /// Whether a flag is enabled, including any assigned variant.
    /// Disabled and missing keys return `false`.
    pub fn is_enabled(&self, key: &str) -> bool {
        matches!(
            self.get(key),
            Some(FlagValue::Boolean(true) | FlagValue::Variant(_))
        )
    }

    /// Read a flag, preserving the distinction between disabled and missing.
    pub fn get(&self, key: &str) -> Option<&FlagValue> {
        self.flags.get(key)
    }

    /// Read a variant; boolean and missing flags return `None`.
    pub fn variant(&self, key: &str) -> Option<&str> {
        match self.get(key) {
            Some(FlagValue::Variant(variant)) => Some(variant),
            _ => None,
        }
    }
}

/// Capability for loading all flags for an authenticated Macro user.
///
/// Implementations use the exact Macro user ID as the distinct ID, without
/// deriving it from email or normalizing it. Failures, including incomplete
/// evaluations, return an error; callers own fallback policy. No reads on the
/// resulting snapshot can trigger further evaluation.
pub trait FeatureFlags: Send + Sync {
    /// Await evaluation once, then use synchronous reads on the returned snapshot.
    fn load(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<FlagSnapshot, Report>> + Send;
}
