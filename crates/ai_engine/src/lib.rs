//! A from-scratch Illustrator (`.ai`) engine: it reads Illustrator's PDF
//! files (and the PostScript-based files of older versions), turns their
//! pages into an editable model of artboards, layers, and objects, draws
//! it, applies edits with undo, shares edits between people, and saves
//! files Illustrator and every PDF reader open.
//!
//! The same code runs natively (tests, the `ai_render` CLI, AI tools,
//! search indexing) and as WebAssembly in the web app's Illustrator editor
//! worker (`apps/web/src/lib/core/ai-engine`).

#![deny(missing_docs)]

pub mod build;
pub mod collab;
pub mod color;
pub mod describe;
pub mod edit;
pub mod error;
pub mod file;
pub mod font;
pub mod function;
pub mod geom;
pub mod image;
pub mod inspect;
pub mod interp;
pub mod marks;
pub mod model;
pub mod pdf;
pub mod render;
pub mod save;
pub mod shading;
#[cfg(test)]
mod testing;
pub mod text;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use error::{AiError, Result};
