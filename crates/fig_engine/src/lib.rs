//! A Figma (`.fig`) file engine: decoding, instance expansion, rendering,
//! hit testing, and inspection. The same code runs natively (tests, the
//! `fig_render` CLI) and as WebAssembly in the web app's `.fig` viewer worker.

pub mod boolean;
pub mod collab;
pub mod container;
pub mod decode;
pub mod describe;
pub mod document;
pub mod edit;
pub mod error;
pub mod export;
pub mod geometry;
pub mod images;
pub mod inspect;
pub mod kiwi;
pub mod library;
pub mod model;
pub mod render;
pub mod save;
pub mod scene;
pub mod svg;
#[cfg(test)]
pub(crate) mod testing;
pub mod text;
pub mod vector;
#[cfg(target_arch = "wasm32")]
pub mod wasm;
mod zip;

pub use document::{Document, NodeIdx};
pub use error::{FigError, Result};
pub use scene::{Scene, SceneIdx};
