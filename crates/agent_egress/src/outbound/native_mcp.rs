//! The owner's authenticated custom MCP servers, answered on their own route.
//!
//! Unlike Pipedream connections, these rows hold the OAuth grant. The
//! sandbox never sees it: this adapter stamps the access token onto the
//! upstream call. v1 does not refresh; a stale token 401s until the user
//! reconnects (chat already refreshes via PersistingCredentialStore).

use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use oauth2::TokenResponse;
use url::Url;

use crate::domain::error::EgressError;
use crate::domain::model::{BearerToken, CustomMcpId, McpDestination, McpServerSlug, UpstreamCall};
use crate::domain::ports::McpCredentials;

#[cfg(test)]
mod test;

/// Layers custom MCP destinations over another resolver.
///
/// [`McpDestination::Custom`] is answered here; everything else passes
/// straight through to `Inner`.
pub struct WithNativeMcp<Inner, Store> {
    inner: Inner,
    store: Store,
}

impl<Inner, Store> WithNativeMcp<Inner, Store>
where
    Inner: McpCredentials,
    Store: McpServerStore,
{
    /// Wrap `inner`, answering [`McpDestination::Custom`] from `store`.
    pub fn new(inner: Inner, store: Store) -> Self {
        Self { inner, store }
    }
}

impl<Inner, Store> McpCredentials for WithNativeMcp<Inner, Store>
where
    Inner: McpCredentials,
    Store: McpServerStore,
{
    #[tracing::instrument(skip_all, err, fields(%owner, ?destination))]
    async fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        destination: &McpDestination,
    ) -> Result<UpstreamCall, EgressError> {
        let McpDestination::Custom(id) = destination else {
            return self.inner.resolve(owner, destination).await;
        };

        let record = self
            .store
            .list(owner)
            .await
            .map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "could not list native MCP servers: {error:?}"
                ))
            })?
            .into_iter()
            .find(|record| record.enabled && CustomMcpId::from_url(&record.url) == *id)
            .ok_or_else(|| unknown_custom(id))?;

        let token = record
            .credentials
            .as_ref()
            .and_then(|credentials| credentials.token_response.as_ref())
            .ok_or_else(|| unknown_custom(id))?;

        let url = Url::parse(&record.url).map_err(|error| {
            EgressError::Internal(rootcause::report!("native MCP url is not a url: {error}"))
        })?;

        UpstreamCall::bearer(
            url,
            BearerToken::new(token.access_token().secret().to_string()),
        )
    }
}

fn unknown_custom(id: &CustomMcpId) -> EgressError {
    EgressError::UnknownServer(
        McpServerSlug::parse(id.as_str()).expect("a custom id is a valid slug charset"),
    )
}
