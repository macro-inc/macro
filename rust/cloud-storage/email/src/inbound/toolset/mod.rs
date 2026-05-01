//! Toolset inbound adapter for the Email service.

mod get_thread;
mod list_labels;
mod send_email;
mod update_thread_labels;

#[cfg(test)]
mod test;

use crate::domain::{
    models::Link,
    ports::{EmailService, GmailTokenProvider},
};
use ai::tool::{AsyncToolSet, ToolCallError};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

pub use get_thread::{GetThread, GetThreadResponse};
pub use list_labels::{ListLabels, ListLabelsResponse, ToolLabel};
pub use send_email::{SendEmail, SendEmailResponse};
pub use update_thread_labels::{UpdateThreadLabels, UpdateThreadLabelsResponse};

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

/// Create an email toolset.
pub fn email_toolset<T, G, E>() -> AsyncToolSet<EmailToolContext<T, G, E>>
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    AsyncToolSet::new()
        .add_tool::<UpdateThreadLabels, EmailToolContext<T, G, E>>()
        .add_tool::<GetThread, EmailToolContext<T, G, E>>()
        .add_user_tool::<SendEmail, EmailToolContext<T, G, E>>()
}
