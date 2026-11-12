//! GitHub's MCP server, authorized by the user's Macro GitHub account link.
//!
//! The account link and GitHub's MCP server use the same GitHub App, so the
//! link's token is a valid bearer there. Rather than ask the user to
//! authorize GitHub a second time, this store decorator answers every read
//! of GitHub's server with the link's token: a linked user has GitHub
//! connected wherever native MCP servers are read (chat, agent sessions,
//! sandbox egress, discovery), and an unlinked one does not.
//!
//! The token is never persisted. It carries no expiry, so nothing tries to
//! refresh it through MCP OAuth; when GitHub stops accepting it the link
//! reports reauthentication and the server reads as disconnected until the
//! user links again. A stored row for GitHub still holds the user's
//! enabled toggle.

use std::sync::Arc;

use oauth2::basic::BasicTokenType;
use oauth2::{AccessToken, StandardTokenResponse};
use rmcp::transport::auth::VendorExtraTokenFields;

use crate::domain::models::{
    GITHUB_MCP_SERVER_URL, MacroUserIdStr, McpServerRecord, StoredCredentials,
};
use crate::domain::ports::{LinkedGithubTokens, McpServerStore};

#[cfg(test)]
mod test;

/// Marks credentials that came from the account link rather than an MCP
/// OAuth grant, so a save never persists them.
const LINKED_CLIENT_ID: &str = "macro-github-link";

/// Name of the GitHub server a linked user has without having added it.
const GITHUB_SERVER_NAME: &str = "GitHub";

fn is_github(url: &str) -> bool {
    url.trim_end_matches('/') == GITHUB_MCP_SERVER_URL
}

fn linked_credentials(token: String) -> StoredCredentials {
    StoredCredentials::new(
        LINKED_CLIENT_ID.to_owned(),
        Some(StandardTokenResponse::new(
            AccessToken::new(token),
            BasicTokenType::Bearer,
            VendorExtraTokenFields::default(),
        )),
        Vec::new(),
        None,
    )
}

fn is_linked(credentials: &StoredCredentials) -> bool {
    credentials.client_id == LINKED_CLIENT_ID
}

/// An [`McpServerStore`] whose GitHub server is authorized by the account
/// link. Without a token source it is `inner` unchanged.
#[derive(Clone)]
pub struct WithLinkedGithub<S> {
    inner: S,
    tokens: Option<Arc<dyn LinkedGithubTokens>>,
}

impl<S> WithLinkedGithub<S> {
    /// Decorate `inner`; `None` for a host that cannot read account links.
    pub fn new(inner: S, tokens: Option<Arc<dyn LinkedGithubTokens>>) -> Self {
        Self { inner, tokens }
    }

    /// The link's token, or `None` when unlinked. A failed lookup reads as
    /// unlinked: GitHub goes missing rather than every server failing.
    async fn linked_token(&self, user_id: &MacroUserIdStr<'static>) -> Option<String> {
        let tokens = self.tokens.as_ref()?;
        tokens
            .access_token(user_id)
            .await
            .inspect_err(|error| tracing::warn!(error=?error, "failed to read linked GitHub token"))
            .ok()
            .flatten()
    }
}

impl<S: McpServerStore> McpServerStore for WithLinkedGithub<S> {
    type Err = S::Err;

    async fn save(&self, record: &McpServerRecord) -> Result<(), Self::Err> {
        if record.credentials.as_ref().is_some_and(is_linked) {
            // Keep the enabled toggle; the token lives with the link.
            let mut stored = record.clone();
            stored.credentials = None;
            return self.inner.save(&stored).await;
        }
        self.inner.save(record).await
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        let stored = self.inner.load(user_id, server_url).await?;
        if !is_github(server_url) {
            return Ok(stored);
        }
        let Some(token) = self.linked_token(user_id).await else {
            return Ok(stored);
        };
        Ok(Some(with_link(stored, user_id, token)))
    }

    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<(), Self::Err> {
        self.inner.delete(user_id, server_url).await
    }

    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        let mut records = self.inner.list(user_id).await?;
        let Some(token) = self.linked_token(user_id).await else {
            return Ok(records);
        };
        let stored = records
            .iter()
            .position(|record| is_github(&record.url))
            .map(|index| records.remove(index));
        records.push(with_link(stored, user_id, token));
        Ok(records)
    }
}

/// GitHub's record carrying the link's token, keeping a stored row's name
/// and enabled toggle.
fn with_link(
    stored: Option<McpServerRecord>,
    user_id: &MacroUserIdStr<'static>,
    token: String,
) -> McpServerRecord {
    let mut record = stored.unwrap_or_else(|| McpServerRecord {
        user_id: user_id.clone(),
        url: GITHUB_MCP_SERVER_URL.to_owned(),
        server_name: GITHUB_SERVER_NAME.to_owned(),
        credentials: None,
        enabled: true,
    });
    record.credentials = Some(linked_credentials(token));
    record
}
