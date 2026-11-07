//! The browser build of [`pptx_engine`], the presentation editor's worker module. wasm-pack builds this
//! crate (`--out-name pptx_engine`); the wasm-bindgen exports live in `pptx_engine`
//! and are linked in through this re-export.

pub use pptx_engine::*;
