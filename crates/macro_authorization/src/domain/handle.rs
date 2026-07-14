use std::{future::Future, pin::Pin, sync::Arc};

#[cfg(feature = "outbound")]
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use model_user::UserContext;
use rootcause::Report;

#[cfg(feature = "outbound")]
use crate::{MacroAuthJwtValidator, MacroAuthorizationServiceImpl};
use crate::{MacroAuthorizationError, MacroAuthorizationService};

type AuthorizationFuture<'a> =
    Pin<Box<dyn Future<Output = Result<UserContext, Report<MacroAuthorizationError>>> + Send + 'a>>;

trait ErasedMacroAuthorizationService: Send + Sync {
    fn authorize_erased<'a>(&'a self, jwt: &'a str) -> AuthorizationFuture<'a>;
}

impl<T> ErasedMacroAuthorizationService for T
where
    T: MacroAuthorizationService,
{
    fn authorize_erased<'a>(&'a self, jwt: &'a str) -> AuthorizationFuture<'a> {
        Box::pin(self.authorize(jwt))
    }
}

/// A cloneable, type-erased authorization service handle.
///
/// Store this handle by value in application state so Axum extractors can
/// resolve authorization without adding the concrete service type to router
/// and handler signatures.
#[derive(Clone)]
pub struct MacroAuthorizationServiceHandle {
    inner: Arc<dyn ErasedMacroAuthorizationService>,
}

impl MacroAuthorizationServiceHandle {
    /// Wrap an authorization service implementation in a type-erased handle.
    pub fn new<T>(service: T) -> Self
    where
        T: MacroAuthorizationService,
    {
        Self {
            inner: Arc::new(service),
        }
    }

    /// Create the production authorization service from JWT validation
    /// configuration.
    #[cfg(feature = "outbound")]
    pub fn from_jwt_validation_args(jwt_validation_args: JwtValidationArgs) -> Self {
        let validator = MacroAuthJwtValidator::new(jwt_validation_args);
        Self::new(MacroAuthorizationServiceImpl::new(validator))
    }
}

impl MacroAuthorizationService for MacroAuthorizationServiceHandle {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.inner.authorize_erased(jwt).await
    }
}
