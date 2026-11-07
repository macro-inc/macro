//! The browser build of [`fig_engine`], the Figma viewer's worker module. wasm-pack builds this
//! crate (`--out-name fig_engine`); the wasm-bindgen exports live in `fig_engine`
//! and are linked in through this re-export.

pub use fig_engine::*;
