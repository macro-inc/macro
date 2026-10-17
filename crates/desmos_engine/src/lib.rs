//! A Desmos-style graphing calculator engine: parse expressions, evaluate
//! them, sample plots, and serialize `.desmos` documents.
//!
//! The same code runs natively (tests, later search/AI) and as WebAssembly
//! in the web app's Desmos block worker (`apps/web/src/lib/core/desmos-engine`).

#![deny(missing_docs)]

pub mod document;
pub mod error;
pub mod eval;
pub mod expr;
pub mod latex;
pub mod parse;
pub mod plot;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use document::{COLORS, Expression, GraphDocument, Slider, Viewport};
pub use error::{DesmosError, Result};
pub use parse::parse_statement;
pub use plot::{PlotItem, PlotScene, plot};
