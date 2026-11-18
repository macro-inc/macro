//! Per-user rollout for human admission, independent of vault maintenance.
use crate::domain::{
    agent::ports::AgentAvailability,
    models::{Actor, Error},
    ports::Availability,
};
use async_trait::async_trait;
use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue};

/// Per-user rollout key shared with the web registry.
pub const PASSWORDS_FLAG: &str = "enable-passwords-v1";
/// Agent vault rollout key; agent routes require it with `PASSWORDS_FLAG`.
pub const AGENT_VAULT_FLAG: &str = "enable-agent-vault";

/// Human admission backed by the shared strict feature-flag transport.
pub struct PasswordAvailability<F> {
    /// Shared evaluator; load failures deny vault access.
    pub flags: F,
    /// True only when the complete explicit provider configuration is present.
    pub provider_configured: bool,
}
#[async_trait]
impl<F: FeatureFlags> Availability for PasswordAvailability<F> {
    #[tracing::instrument(skip_all, err, name = "passwords.admission.flags")]
    async fn require_enabled(&self, actor: &Actor) -> Result<(), Error> {
        let flags = self
            .flags
            .load(&actor.user_id)
            .await
            .map_err(|_| Error::Unavailable)?;
        if !flags.is_enabled(PASSWORDS_FLAG) {
            return Err(Error::NotFound);
        }
        self.require_provider()
    }
    fn require_provider(&self) -> Result<(), Error> {
        if !self.provider_configured {
            return Err(Error::Unavailable);
        }
        Ok(())
    }
}

fn agent_vault(flags: &FlagSnapshot) -> bool {
    flags.is_enabled(PASSWORDS_FLAG) && flags.is_enabled(AGENT_VAULT_FLAG)
}

#[async_trait]
impl<F: FeatureFlags> AgentAvailability for PasswordAvailability<F> {
    #[tracing::instrument(skip_all, name = "passwords.agent.admission.flags")]
    async fn agent_vault_enabled(&self, user: &macro_user_id::user_id::MacroUserIdStr<'_>) -> bool {
        // Each user's own snapshot: an agent never inherits its responsible
        // human's rollout. Off, missing or failed evaluation is disabled.
        self.flags
            .load(user)
            .await
            .is_ok_and(|flags| agent_vault(&flags))
    }
    fn provider_configured(&self) -> bool {
        self.provider_configured
    }
}

/// Explicit local-only development snapshot, selected at the composition root.
pub struct LocalPasswordsFlags;
impl FeatureFlags for LocalPasswordsFlags {
    async fn load(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<FlagSnapshot, rootcause::Report> {
        Ok(FlagSnapshot::new([
            (PASSWORDS_FLAG.into(), FlagValue::Boolean(true)),
            (AGENT_VAULT_FLAG.into(), FlagValue::Boolean(true)),
        ]))
    }
}
#[cfg(test)]
mod test;
