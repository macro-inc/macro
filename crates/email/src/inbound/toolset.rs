//! Toolset inbound adapter for the Email service.

mod get_thread;
mod list_inboxes;
mod list_labels;
mod send_email;
mod set_sender_policy;
mod update_thread_labels;

#[cfg(test)]
mod test;

use crate::domain::{
    models::Link,
    ports::{EmailService, GmailTokenProvider},
};
use ai_toolset::{AsyncToolCollection, ToolCallError};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

pub use get_thread::{GetThread, GetThreadResponse};
pub use list_inboxes::{ListInboxes, ListInboxesResponse, ToolInbox};
pub use list_labels::{ListLabels, ListLabelsResponse, ToolLabel};
pub use send_email::{SendEmail, SendEmailResponse};
pub use set_sender_policy::{SetSenderPolicy, SetSenderPolicyResponse, ToolSenderPolicy};
pub use update_thread_labels::{UpdateThreadLabels, UpdateThreadLabelsResponse};

/// The caller's default inbox: the primary link they own. Falls back to any
/// link they own, then any accessible inbox. `caller_macro_id` is the caller's
/// own macro id (e.g. `macro|user@example.com`).
pub fn caller_primary_inbox<'a>(inboxes: &'a [Link], caller_macro_id: &str) -> Option<&'a Link> {
    inboxes
        .iter()
        .find(|l| l.is_primary && l.macro_id.to_string() == caller_macro_id)
        .or_else(|| {
            inboxes
                .iter()
                .find(|l| l.macro_id.to_string() == caller_macro_id)
        })
        .or_else(|| inboxes.first())
}

/// Resolve an optional inbox selector (an inbox's email address) against the
/// caller's accessible inboxes. `None` resolves to the caller's primary inbox.
/// Errors when the address matches no accessible inbox, so a caller can never
/// scope to an inbox they don't have.
pub fn resolve_inbox_selector<'a>(
    inboxes: &'a [Link],
    caller_macro_id: &str,
    requested: Option<&str>,
) -> Result<&'a Link, ToolCallError> {
    let Some(addr) = requested.map(str::trim).filter(|s| !s.is_empty()) else {
        return caller_primary_inbox(inboxes, caller_macro_id).ok_or_else(|| ToolCallError {
            description: "No email account is linked for this user.".to_string(),
            internal_error: anyhow::anyhow!("no accessible inboxes"),
        });
    };

    let mut matches = inboxes
        .iter()
        .filter(|l| l.email_address.0.as_ref().eq_ignore_ascii_case(addr));
    match (matches.next(), matches.next()) {
        (Some(link), None) => Ok(link),
        (Some(_), Some(_)) => Err(ToolCallError {
            description: format!("Multiple connected inboxes match \"{addr}\"; cannot pick one."),
            internal_error: anyhow::anyhow!("ambiguous inbox selector: {addr}"),
        }),
        (None, _) => Err(ToolCallError {
            description: format!(
                "No connected inbox matches \"{addr}\". Connected inboxes: {}.",
                inboxes
                    .iter()
                    .map(|l| l.email_address.0.as_ref())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            internal_error: anyhow::anyhow!("unknown inbox selector: {addr}"),
        }),
    }
}

/// Service context for email AI tools.
pub struct EmailToolContext<
    T: EmailService,
    G: GmailTokenProvider = crate::domain::ports::NoOpGmailTokenProvider,
    E: EntityAccessService = entity_access::domain::service::EntityAccessServiceImpl<
        entity_access::outbound::PgAccessRepository,
    >,
> {
    /// The email service instance.
    pub service: Arc<T>,
    /// The Gmail token provider for resolving OAuth access tokens.
    pub token_provider: Arc<G>,
    /// The entity access service for verifying thread access.
    pub entity_access_service: Arc<E>,
}

impl<T: EmailService, G: GmailTokenProvider, E: EntityAccessService> Clone
    for EmailToolContext<T, G, E>
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            token_provider: self.token_provider.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

impl<T: EmailService, G: GmailTokenProvider, E: EntityAccessService> EmailToolContext<T, G, E> {
    /// Create a new email tool context.
    pub fn new(service: Arc<T>, token_provider: Arc<G>, entity_access_service: Arc<E>) -> Self {
        Self {
            service,
            token_provider,
            entity_access_service,
        }
    }

    /// Resolve the user's email link from their macro ID.
    ///
    /// This is shared across all email tools that need an authenticated link.
    pub async fn resolve_link(&self, macro_id: MacroUserIdStr<'_>) -> Result<Link, ToolCallError> {
        self.service
            .get_link_by_macro_id(macro_id)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to resolve email link: {e}"),
                internal_error: e.into(),
            })?
            .ok_or_else(|| ToolCallError {
                description: "No email account linked for this user.".to_string(),
                internal_error: anyhow::anyhow!("No email link found for user"),
            })
    }

    /// Resolve a Gmail OAuth access token for the given link.
    pub async fn resolve_access_token(&self, link: &Link) -> Result<String, ToolCallError> {
        self.token_provider
            .fetch_gmail_access_token(link)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to fetch Gmail access token: {e}"),
                internal_error: e.into(),
            })
    }
}

/// Create the full email toolset including SendEmail.
pub fn email_toolset<T, G, E>() -> AsyncToolCollection<EmailToolContext<T, G, E>>
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    mcp_toolset().add_user_tool::<SendEmail, EmailToolContext<T, G, E>>()
}

/// Email toolset for the MCP server — excludes SendEmail.
pub fn mcp_toolset<T, G, E>() -> AsyncToolCollection<EmailToolContext<T, G, E>>
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<UpdateThreadLabels, EmailToolContext<T, G, E>>()
        .add_tool::<GetThread, EmailToolContext<T, G, E>>()
        .add_tool::<ListLabels, EmailToolContext<T, G, E>>()
        .add_tool::<ListInboxes, EmailToolContext<T, G, E>>()
        .add_tool::<SetSenderPolicy, EmailToolContext<T, G, E>>()
}
