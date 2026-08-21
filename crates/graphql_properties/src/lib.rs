//! GraphQL inbound adapter for the properties domain: property object types,
//! property filter inputs, and the DataLoader-backed entity property edge.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// DataLoader implementations for entity property edges.
mod loaders;
/// GraphQL mutations for assigning entity properties.
mod mutations;
/// GraphQL property objects, values, and edge resolver.
mod objects;

pub use graphql_common::{
    GraphqlPropertiesBinaryExpr, GraphqlPropertiesExpr, GraphqlPropertyEntityType,
};
pub use loaders::{
    EntityPropertiesLoader, EntityPropertyReader, NoOpEntityPropertyReader,
    PropertiesEntityPropertyReader, entity_properties_loader,
};
pub use mutations::{
    EntityPropertyWriter, GraphqlPropertyTargetEntityType, NoOpEntityPropertyWriter,
    PropertiesEntityPropertyWriter, PropertiesMutationRoot,
};
pub use objects::{
    GraphqlBooleanPropertyValue, GraphqlDatePropertyValue, GraphqlEntityReferencePropertyValue,
    GraphqlLinkPropertyValue, GraphqlNumberPropertyValue, GraphqlProperty, GraphqlPropertyDataType,
    GraphqlPropertyEntityReference, GraphqlPropertyValue, GraphqlSelectOptionPropertyValue,
    GraphqlStringPropertyValue, load_entity_properties,
};
