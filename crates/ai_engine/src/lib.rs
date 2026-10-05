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

pub mod color;
pub mod error;
pub mod font;
pub mod function;
pub mod image;
pub mod pdf;
pub mod shading;

pub use error::{AiError, Result};
