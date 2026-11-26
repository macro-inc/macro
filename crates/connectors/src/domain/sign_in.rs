//! Finishing a sign-in to a server by URL, when its authorization server
//! redirects the browser back to Macro.
//!
//! The answer names what the user connected the way the rules do: a server
//! at an overlaid app's address is that app (every app overlaid there), and
//! any other server is itself (rule 5).

use crate::domain::catalog::Overlays;
use crate::domain::models::{ConnectorKey, Result, ServerUrl};
use crate::domain::ports::OverlayCatalog;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// A finished sign-in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignedIn {
    user: MacroUserIdStr<'static>,
    keys: Vec<ConnectorKey>,
}

impl SignedIn {
    /// The user who signed in.
    pub fn user(&self) -> &MacroUserIdStr<'static> {
        &self.user
    }

    /// What they connected: one server, or every app overlaid at its
    /// address.
    pub fn keys(&self) -> &[ConnectorKey] {
        &self.keys
    }
}

/// The OAuth client that signs users in to servers by URL.
///
/// Object-safe (`#[async_trait]`) so [`ServerSignIns`] names no adapter type.
#[async_trait::async_trait]
pub(crate) trait ServerAuthorization: Send + Sync {
    /// Exchange the code the authorization server redirected back with, and
    /// store the grant. Answers whose sign-in it was and the server's address.
    async fn complete(
        &self,
        code: &str,
        state: &str,
    ) -> Result<(MacroUserIdStr<'static>, ServerUrl), rootcause::Report>;

    /// Macro's public OAuth client metadata document, which authorization
    /// servers fetch by the client id URL.
    fn client_metadata(&self) -> serde_json::Value;
}

/// [`OverlayCatalog`], object-safe (`#[async_trait]`) so [`ServerSignIns`]
/// names no adapter type.
#[async_trait::async_trait]
trait ReadOverlays: Send + Sync {
    async fn read(&self) -> Result<Overlays, rootcause::Report>;
}

#[async_trait::async_trait]
impl<O: OverlayCatalog> ReadOverlays for O {
    async fn read(&self) -> Result<Overlays, rootcause::Report> {
        self.overlays().await
    }
}

/// Signing in to servers by URL from a vendor's redirect.
pub trait ServerSignInService: Send + Sync + 'static {
    /// Finish the sign-in the redirect carries.
    fn complete_sign_in(
        &self,
        code: &str,
        state: &str,
    ) -> impl Future<Output = Result<SignedIn>> + Send;

    /// Macro's public OAuth client metadata document.
    fn client_metadata(&self) -> serde_json::Value;
}

/// [`ServerSignInService`] over the OAuth client and the overlay table.
#[derive(Clone)]
pub struct ServerSignIns {
    authorization: Arc<dyn ServerAuthorization>,
    overlays: Arc<dyn ReadOverlays>,
}

impl ServerSignIns {
    /// Sign-ins through `authorization`, named by `overlays`.
    pub(crate) fn new(
        authorization: Arc<dyn ServerAuthorization>,
        overlays: impl OverlayCatalog,
    ) -> Self {
        Self {
            authorization,
            overlays: Arc::new(overlays),
        }
    }
}

impl ServerSignInService for ServerSignIns {
    #[tracing::instrument(name = "connectors.complete_sign_in", skip_all, err, fields(connectors = tracing::field::Empty))]
    async fn complete_sign_in(&self, code: &str, state: &str) -> Result<SignedIn> {
        let (user, url) = self.authorization.complete(code, state).await?;
        let overlays = self.overlays.read().await?;
        let mut keys: Vec<ConnectorKey> = overlays
            .apps_at(&url)
            .cloned()
            .map(ConnectorKey::App)
            .collect();
        if keys.is_empty() {
            keys.push(ConnectorKey::Server(url));
        }
        tracing::Span::current().record("connectors", keys.len());

        Ok(SignedIn { user, keys })
    }

    fn client_metadata(&self) -> serde_json::Value {
        self.authorization.client_metadata()
    }
}
