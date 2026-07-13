//! GraphQL inbound adapter for the properties domain: property object types,
//! property filter inputs, and the DataLoader-backed entity property edge.
#![deny(missing_docs)]

mod inputs;
mod loaders;
mod objects;

pub use inputs::{GraphqlPropertiesBinaryExpr, GraphqlPropertiesExpr};
pub use loaders::{
    EntityPropertiesKey, EntityPropertiesLoader, SoupPropertyEdgeReader, entity_properties_loader,
};
pub use objects::{
    GraphqlSoupProperty, GraphqlSoupPropertyEntityReference, GraphqlSoupPropertyValue,
};
