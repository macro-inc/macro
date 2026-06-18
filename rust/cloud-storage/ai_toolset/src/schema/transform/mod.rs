//! Schema transformers composed by the pipelines in
//! [`generate`](super::generate).
//!
//! Internal to the `schema` module — outside consumers go through the entry
//! points in `generate` instead. These implement schemars'
//! [`Transform`](schemars::transform::Transform) and are applied via
//! [`RecursiveTransform`](schemars::transform::RecursiveTransform); read-only
//! checks belong in the `validate` module instead.

mod additional_properties;
mod nullify_optional;
mod ref_siblings;
mod required;
mod rewrite_one_of;
mod strip_unsupported;

pub use additional_properties::AdditionalPropertiesFalse;
pub(crate) use additional_properties::is_object_schema;
pub use nullify_optional::NullifyOptional;
pub use ref_siblings::NormaliseRefSiblings;
pub use required::AddRequired;
pub use rewrite_one_of::OneOfToAnyOf;
pub use strip_unsupported::StripUnsupported;
