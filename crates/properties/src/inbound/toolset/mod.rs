//! Toolset inbound adapter for the Properties service.

mod get_entity_properties;
mod list_tags;
mod set_entity_property;

#[cfg(test)]
mod test;

use crate::domain::service::PropertiesService;
use ai_toolset::AsyncToolCollection;
use entity_access::domain::ports::EntityAccessService;
use std::sync::Arc;

pub use get_entity_properties::{GetEntityProperties, GetEntityPropertiesResponse};
pub use list_tags::{ListTags, ListTagsResponse};
pub use set_entity_property::{SetEntityProperty, SetEntityPropertyResponse};

/// Service context for properties AI tools.
pub struct PropertiesToolContext<T: PropertiesService, A: EntityAccessService> {
    /// The properties service instance.
    pub service: Arc<T>,
    /// The canonical service used to mint entity access receipts.
    pub entity_access_service: Arc<A>,
}

impl<T: PropertiesService, A: EntityAccessService> Clone for PropertiesToolContext<T, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

impl<T: PropertiesService, A: EntityAccessService> PropertiesToolContext<T, A> {
    /// Create a new properties tool context.
    pub fn new(service: T, entity_access_service: A) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
        }
    }
}

/// Create a properties toolset.
pub fn properties_toolset<T, A>() -> AsyncToolCollection<PropertiesToolContext<T, A>>
where
    T: PropertiesService,
    A: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<GetEntityProperties, PropertiesToolContext<T, A>>()
        .add_tool::<SetEntityProperty, PropertiesToolContext<T, A>>()
        .add_tool::<ListTags, PropertiesToolContext<T, A>>()
}
