use std::{future::Future, pin::Pin, sync::Arc};

use model_user::UserContext;
use rootcause::Report;

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

/// The cloneable, type-erased authorization service implementation.
///
/// Store this service by value in application state so Axum extractors can
/// resolve authorization without adding concrete service types to router and
/// handler signatures.
#[derive(Clone)]
pub struct MacroAuthorizationServiceImpl {
    inner: Arc<dyn ErasedMacroAuthorizationService>,
}

impl MacroAuthorizationServiceImpl {
    /// Create a service from an authorization implementation.
    pub fn new<T>(service: T) -> Self
    where
        T: MacroAuthorizationService,
    {
        Self {
            inner: Arc::new(service),
        }
    }
}

impl MacroAuthorizationService for MacroAuthorizationServiceImpl {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.inner.authorize_erased(jwt).await
    }
}
