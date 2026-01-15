//! Toolset inbound adapter for the Soup service.

mod list_entities;

#[cfg(test)]
mod test;

use crate::domain::ports::SoupService;
use ai::tool::AsyncToolSet;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

pub use list_entities::{
    EntityItem, ItemType, ListEntities, ListEntitiesResponse, SortBy,
};

/// Service context for soup AI tools
#[derive(Clone)]
pub struct SoupToolContext<T> {
    pub service: Arc<T>,
}

impl<T> SoupToolContext<T> {
    /// Create a new soup tool context
    pub fn new(service: T) -> Self {
        Self {
            service: Arc::new(service),
        }
    }
}

/// Request context for soup AI tools
#[derive(Debug, Clone)]
pub struct SoupRequestContext {
    pub user_id: MacroUserIdStr<'static>,
}

/// Create a soup toolset
pub fn soup_toolset<T>() -> AsyncToolSet<SoupToolContext<T>, SoupRequestContext>
where
    T: SoupService,
{
    AsyncToolSet::new()
        .add_tool::<ListEntities>()
        .expect("failed to add ListEntities tool")
}
