//! A from-scratch Photoshop (`.psd`, `.psb`) engine: it splits files into
//! their parts, decodes layers into an editable model, composites them,
//! applies edits with undo, shares edits between people, and saves files
//! that keep everything it does not model.
//!
//! The same code runs natively (tests, the `psd_render` CLI, AI tools,
//! search indexing) and as WebAssembly in the web app's Photoshop editor
//! worker (`apps/web/src/lib/core/psd-engine`).

#![deny(missing_docs)]

pub mod binary;
pub mod channels;
pub mod codec;
pub mod color;
pub mod edit;
pub mod error;
pub mod file;
pub mod model;
pub mod raster;
pub mod render;
pub mod resources;

pub use error::{PsdError, Result};
pub use model::{Document, Layer, LayerIdx};
pub use raster::{IRect, Raster, Selection};
