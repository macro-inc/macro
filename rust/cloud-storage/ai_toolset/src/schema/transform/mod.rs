//! Schema transformers composed by the pipelines in
//! [`generate`](super::generate).
//!
//! Internal to the `schema` module — outside consumers go through the entry
//! points in `generate` instead. These implement schemars'
//! [`Transform`](schemars::transform::Transform) and are applied via
//! [`RecursiveTransform`](schemars::transform::RecursiveTransform); read-only
//! checks belong in the `validate` module instead.

mod ref_siblings;
mod rewrite_one_of;
mod strip_unsupported;

pub use ref_siblings::NormaliseRefSiblings;
pub use rewrite_one_of::OneOfToAnyOf;
pub use strip_unsupported::StripUnsupported;
