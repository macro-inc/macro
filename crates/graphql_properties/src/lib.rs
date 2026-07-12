//! GraphQL inbound adapter for the properties domain: property object types,
//! property filter inputs, and the DataLoader-backed entity property edge.
#![deny(missing_docs)]

mod loaders;
mod mutations;
mod objects;

pub use graphql_common::{
    GraphqlPropertiesBinaryExpr, GraphqlPropertiesExpr, GraphqlPropertyEntityType,
};
pub use loaders::{
    EntityPropertiesLoader, NoOpSoupPropertyEdgeReader, PropertiesSoupPropertyEdgeReader,
    SoupPropertyEdgeReader, entity_properties_loader,
};
pub use mutations::{
    EntityPropertyWriter, NoOpEntityPropertyWriter, PropertiesEntityPropertyWriter,
    PropertiesMutationRoot,
};
pub use objects::{
    GraphqlSoupProperty, GraphqlSoupPropertyEntityReference, GraphqlSoupPropertyValue,
    load_entity_properties,
};
