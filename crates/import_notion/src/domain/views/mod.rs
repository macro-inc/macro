//! Saved Notion views translated to Macro with explicit fidelity losses.
mod filter;
mod layout;
mod model;
mod translate;

pub(crate) use model::ViewList;
pub use model::*;
pub use translate::{bindings, translate, translate_with_schema};

#[cfg(test)]
mod test;
