//! Signing in to a server by URL over Macro's own OAuth client: the
//! completion the OAuth callback route drives.

use crate::domain::models::ServerUrl;
use crate::domain::sign_in::ServerAuthorization;
use crate::outbound::native::domain::models::OAuthClientMetadata;
use crate::outbound::native::domain::ports::OAuthClient;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::compat::IntoRootcause as _;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// [`ServerAuthorization`] over the native OAuth client.
pub(crate) struct OAuthSignIn<O> {
    oauth: Arc<O>,
    metadata: serde_json::Value,
}

impl<O> OAuthSignIn<O> {
    /// Sign-ins through `oauth`, publishing `metadata` as Macro's client
    /// metadata document.
    pub(crate) fn new(oauth: Arc<O>, metadata: &OAuthClientMetadata) -> Result<Self, Report> {
        Ok(Self {
            oauth,
            metadata: serde_json::to_value(metadata)?,
        })
    }
}

#[async_trait::async_trait]
impl<O: OAuthClient> ServerAuthorization for OAuthSignIn<O> {
    async fn complete(
        &self,
        code: &str,
        state: &str,
    ) -> Result<(MacroUserIdStr<'static>, ServerUrl), Report> {
        let record = self
            .oauth
            .exchange_authorization_code(code, state)
            .await
            .into_rootcause()?;
        let url = ServerUrl::parse(&record.url)?;

        Ok((record.user_id, url))
    }

    fn client_metadata(&self) -> serde_json::Value {
        self.metadata.clone()
    }
}
