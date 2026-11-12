//! Shared service authority with additional actor targeting for human admissions.
use crate::domain::{
    models::{Actor, Error},
    ports::Availability,
};
use async_trait::async_trait;
use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue, ServiceContext, ServiceFeatureFlags};

/// Fresh global rollout key shared with the web registry.
pub const PASSWORDS_FLAG: &str = "enable-passwords-v1";
/// Stable service context; never an authenticated or fabricated user ID.
pub const PASSWORDS_CONTEXT: ServiceContext = ServiceContext::new("passwords-v1");

/// Global remote rollout backed by the shared strict feature-flag transport.
pub struct PasswordAvailability<F> {
    /// Shared evaluator; load failures deny vault access.
    pub flags: F,
    /// True only when the complete explicit provider configuration is present.
    pub provider_configured: bool,
}
#[async_trait]
impl<F: FeatureFlags + ServiceFeatureFlags> Availability for PasswordAvailability<F> {
    #[tracing::instrument(skip_all, err, name = "passwords.admission.flags")]
    async fn require_enabled(&self, actor: &Actor) -> Result<(), Error> {
        self.require_service_enabled().await?;
        let flags = self
            .flags
            .load(&actor.user_id)
            .await
            .map_err(|_| Error::Unavailable)?;
        if !flags.is_enabled(PASSWORDS_FLAG) {
            return Err(Error::NotFound);
        }
        Ok(())
    }
    #[tracing::instrument(skip_all, err, name = "passwords.availability")]
    async fn require_service_enabled(&self) -> Result<(), Error> {
        let flags = self
            .flags
            .load_service(PASSWORDS_CONTEXT)
            .await
            .map_err(|_| Error::Unavailable)?;
        if !flags.is_enabled(PASSWORDS_FLAG) {
            return Err(Error::NotFound);
        }
        if !self.provider_configured {
            return Err(Error::Unavailable);
        }
        Ok(())
    }
}

/// Explicit local-only development snapshot, selected at the composition root.
pub struct LocalPasswordsFlags;
impl FeatureFlags for LocalPasswordsFlags {
    async fn load(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<FlagSnapshot, rootcause::Report> {
        self.load_service(PASSWORDS_CONTEXT).await
    }
}
impl ServiceFeatureFlags for LocalPasswordsFlags {
    async fn load_service(&self, _: ServiceContext) -> Result<FlagSnapshot, rootcause::Report> {
        Ok(FlagSnapshot::new([(
            PASSWORDS_FLAG.into(),
            FlagValue::Boolean(true),
        )]))
    }
}
#[cfg(test)]
mod test;
