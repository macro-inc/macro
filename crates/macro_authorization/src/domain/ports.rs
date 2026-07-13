use std::future::Future;

use model_user::UserContext;
use rootcause::Report;

use super::models::{MacroAuthorizationError, ValidatedIdentity};

/// Cryptographic credential validation used by the authorization domain.
///
/// Implementations resolve any required secrets during startup, allowing this
/// operation to remain synchronous.
pub trait JwtValidator: Clone + Send + Sync + 'static {
    /// Validate a credential and return its transport-independent identity.
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>>;
}

/// Authorizes credentials and constructs application user contexts.
///
/// The operation is asynchronous so implementations can later enrich an
/// identity from persistent storage without changing this interface.
pub trait MacroAuthorizationService: Clone + Send + Sync + 'static {
    /// Authorize a credential and return its authenticated user context.
    fn authorize(
        &self,
        jwt: &str,
    ) -> impl Future<Output = Result<UserContext, Report<MacroAuthorizationError>>> + Send;
}
