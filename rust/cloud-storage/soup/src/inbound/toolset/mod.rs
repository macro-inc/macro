//! Toolset inbound adapter for the Soup service.

mod list_entities;

#[cfg(test)]
mod test;

use crate::domain::ports::SoupService;
use ai::tool::AsyncToolSet;
use std::sync::Arc;

pub use list_entities::{EntityItem, ItemType, ListEntities, ListEntitiesResponse, SortBy};

/// Service context for soup AI tools
pub struct SoupToolContext<T> {
    /// The soup service instance
    pub service: Arc<T>,
}

impl<T> Clone for SoupToolContext<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<T> SoupToolContext<T> {
    /// Create a new soup tool context
    pub fn new(service: T) -> Self {
        Self {
            service: Arc::new(service),
        }
    }
}

/// Create a soup toolset
pub fn soup_toolset<T>() -> AsyncToolSet<SoupToolContext<T>>
where
    T: SoupService,
{
    AsyncToolSet::new()
        .add_tool::<ListEntities, SoupToolContext<T>>()
        .expect("failed to add ListEntities tool")
}
