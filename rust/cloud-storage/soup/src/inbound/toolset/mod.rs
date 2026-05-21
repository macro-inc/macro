//! Toolset inbound adapter for the Soup service.

mod list_entities;

#[cfg(test)]
mod test;

use crate::domain::ports::SoupService;
use ai::tool::AsyncToolCollection;
use email::domain::ports::EmailService;
use std::sync::Arc;

pub use list_entities::{EntityItem, ItemType, ListEntities, ListEntitiesResponse, SortBy};

/// Service context for soup AI tools
pub struct SoupToolContext<T: SoupService, E: EmailService> {
    /// The soup service instance
    pub service: Arc<T>,
    /// The email service instance for resolving email links
    pub email_service: Arc<E>,
}

impl<T: SoupService, E: EmailService> Clone for SoupToolContext<T, E> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            email_service: self.email_service.clone(),
        }
    }
}

impl<T: SoupService, E: EmailService> SoupToolContext<T, E> {
    /// Create a new soup tool context
    pub fn new(service: T, email_service: E) -> Self {
        Self {
            service: Arc::new(service),
            email_service: Arc::new(email_service),
        }
    }
}

/// Create a soup toolset
pub fn soup_toolset<T, E>() -> AsyncToolCollection<SoupToolContext<T, E>>
where
    T: SoupService,
    E: EmailService,
{
    AsyncToolCollection::new().add_tool::<ListEntities, SoupToolContext<T, E>>()
}
