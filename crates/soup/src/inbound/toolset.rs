//! Toolset inbound adapter for the Soup service.
//!
//! The listing tool itself lives in `soup_query_tool` so it can execute GraphQL
//! without creating a `soup` ↔ `graphql_soup` cycle. This module only owns the
//! context that tool (and any future soup tools) run against.

use crate::domain::ports::SoupService;
use email::domain::ports::EmailService;
use std::sync::Arc;
use uuid::Uuid;

/// Service context for soup AI tools
pub struct SoupToolContext<T: SoupService, E: EmailService> {
    /// The soup service instance
    pub service: Arc<T>,
    /// The email service instance for resolving email links
    pub email_service: Arc<E>,
    /// Entity id of the chat this request belongs to, when the request is an
    /// interactive chat session. `None` for every other feature, in which
    /// case nothing is excluded from the results.
    pub self_chat_id: Option<Uuid>,
}

impl<T: SoupService, E: EmailService> Clone for SoupToolContext<T, E> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            email_service: self.email_service.clone(),
            self_chat_id: self.self_chat_id,
        }
    }
}

impl<T: SoupService, E: EmailService> SoupToolContext<T, E> {
    /// Create a new soup tool context
    pub fn new(service: T, email_service: E) -> Self {
        Self {
            service: Arc::new(service),
            email_service: Arc::new(email_service),
            self_chat_id: None,
        }
    }
}
