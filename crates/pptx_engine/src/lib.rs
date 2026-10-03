//! A from-scratch PowerPoint (`.pptx`) engine: parse, render, edit, and save.
//!
//! The same code runs natively (AI tools, tests, the corpus CLI) and as
//! WebAssembly inside a browser worker. The XML of every part stays the source
//! of truth: rendering derives a model from it, and edits mutate it in place,
//! so content the engine does not understand survives a round trip untouched.

#![deny(missing_docs)]

pub mod collab;
pub mod edit;
mod error;
pub mod fidelity;
pub mod font;
pub mod geometry;
pub mod inspect;
mod integrity;
pub mod model;
pub mod opc;
pub mod path;
pub mod render;
#[cfg(test)]
mod test_support;
pub mod units;
#[cfg(target_arch = "wasm32")]
mod wasm;
pub mod xml;
pub mod zip;

pub use edit::{EditOp, EditResult, Editor};
pub use error::{Error, Result};
pub use model::presentation::Presentation;
