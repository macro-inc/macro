//! Editing: operations on the document, applied as undoable steps.
//!
//! The tools that work on pixels live in submodules: painting, selections,
//! transforms, and filters.

pub mod filters;
pub mod paint;
pub mod select;
pub mod transform;
