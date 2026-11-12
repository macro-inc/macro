//! Credential-free audit hook for completed login/session persistence.

use crate::{FusionAuthClient, Result};

/// Observes a successful login at the function that persists its FusionAuth session.
/// Implementations must not retain the access token or any login payload.
pub trait LoginAudit: std::fmt::Debug + Send + Sync + 'static {
    /// Record one completed login. The token is borrowed only to derive the actor id.
    fn record<'a>(
        &'a self,
        access_token: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>>;
}

impl FusionAuthClient {
    pub(crate) async fn audit_completed_login(&self, access_token: &str) -> Result<()> {
        if let Some(audit) = &self.login_audit {
            audit.record(access_token).await?;
        }
        Ok(())
    }
}
