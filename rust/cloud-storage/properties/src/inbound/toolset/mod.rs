//! Toolset inbound adapter for the Properties service.

mod get_entity_properties;
mod set_entity_property;

#[cfg(test)]
mod test;

use crate::domain::service::PropertiesService;
use ai_toolset::AsyncToolCollection;
use std::sync::Arc;

pub use get_entity_properties::{GetEntityProperties, GetEntityPropertiesResponse};
pub use set_entity_property::{SetEntityProperty, SetEntityPropertyResponse};

/// Service context for properties AI tools.
pub struct PropertiesToolContext<T: PropertiesService> {
    /// The properties service instance.
    pub service: Arc<T>,
}

impl<T: PropertiesService> Clone for PropertiesToolContext<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<T: PropertiesService> PropertiesToolContext<T> {
    /// Create a new properties tool context.
    pub fn new(service: T) -> Self {
        Self {
            service: Arc::new(service),
        }
    }
}

/// Create a properties toolset.
pub fn properties_toolset<T>() -> AsyncToolCollection<PropertiesToolContext<T>>
where
    T: PropertiesService,
{
    AsyncToolCollection::new()
        .add_tool::<GetEntityProperties, PropertiesToolContext<T>>()
        .add_tool::<SetEntityProperty, PropertiesToolContext<T>>()
}
