//! A Figma (`.fig`) file engine: decoding, instance expansion, rendering,
//! hit testing, and inspection. The same code runs natively (tests, the
//! `fig_render` CLI) and as WebAssembly in the web app's `.fig` viewer worker.

pub mod container;
pub mod decode;
pub mod document;
pub mod error;
pub mod geometry;
pub mod images;
pub mod inspect;
pub mod kiwi;
pub mod model;
pub mod render;
pub mod scene;
#[cfg(test)]
pub(crate) mod testing;
#[cfg(target_arch = "wasm32")]
pub mod wasm;
mod zip;

pub use document::{Document, NodeIdx};
pub use error::{FigError, Result};
pub use scene::{Scene, SceneIdx};
