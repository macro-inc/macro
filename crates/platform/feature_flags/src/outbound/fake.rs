//! Deterministic, per-user feature flags for consumer tests.

use crate::{FeatureFlags, FlagSnapshot};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashMap;

#[cfg(test)]
mod test;

/// A fake loader configured with independent successful or failing user results.
/// Unconfigured users fail explicitly to expose missing test setup.
#[derive(Default)]
pub struct FakeFeatureFlags {
    users: HashMap<MacroUserIdStr<'static>, Result<FlagSnapshot, String>>,
}

impl FakeFeatureFlags {
    /// Configure a user's result. An error message simulates a load failure.
    pub fn set(&mut self, user_id: MacroUserIdStr<'static>, result: Result<FlagSnapshot, String>) {
        self.users.insert(user_id, result);
    }
}

impl FeatureFlags for FakeFeatureFlags {
    async fn load(&self, user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        match self.users.get(user_id) {
            Some(Ok(snapshot)) => Ok(snapshot.clone()),
            Some(Err(message)) => Err(rootcause::report!("{message}")),
            None => Err(rootcause::report!(
                "No feature flag result configured for user"
            )),
        }
    }
}
