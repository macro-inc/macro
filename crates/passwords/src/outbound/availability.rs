//! PostHog is the single rollout authority. Failed evaluations fail closed.
use crate::domain::{
    models::{Actor, Error},
    ports::Availability,
};
use async_trait::async_trait;
use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue};
/// Remote per-user rollout backed by the shared feature-flag client.
pub struct PasswordAvailability<F> {
    /// Shared PostHog evaluator; load failures deny vault access.
    pub flags: F,
    /// True only when the complete explicit provider configuration is present.
    pub provider_configured: bool,
}
#[async_trait]
impl<F: FeatureFlags> Availability for PasswordAvailability<F> {
    async fn require_enabled(&self, actor: &Actor) -> Result<(), Error> {
        let flags = self
            .flags
            .load(&actor.user_id)
            .await
            .map_err(|_| Error::Unavailable)?;
        if !flags.is_enabled("enable-passwords") {
            return Err(Error::NotFound);
        }
        if !self.provider_configured {
            return Err(Error::Unavailable);
        }
        Ok(())
    }
}

/// Explicit local development snapshot, selected only by the composition root's Local environment.
/// Hosted deployments always use the remote evaluator and remain remotely controllable.
pub struct LocalPasswordsFlags;
impl FeatureFlags for LocalPasswordsFlags {
    async fn load(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<FlagSnapshot, rootcause::Report> {
        Ok(FlagSnapshot::new([(
            "enable-passwords".into(),
            FlagValue::Boolean(true),
        )]))
    }
}
