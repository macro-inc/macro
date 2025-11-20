//! Inbound adapters - HTTP handlers and other entry points

pub mod http;

pub use http::create_property_definition;

// TODO: Implement remaining handlers
// pub use http::{
//     create_property_option, delete_all_entity_properties,
//     delete_entity_property, delete_property_definition, delete_property_option,
//     get_bulk_entity_properties, get_entity_properties, get_property_definition,
//     get_property_options, list_property_definitions, set_entity_property,
// };
