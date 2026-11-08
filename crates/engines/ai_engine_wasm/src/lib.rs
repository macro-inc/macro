//! The browser build of [`illustrator_engine`], the Illustrator editor's worker module. wasm-pack builds this
//! crate (`--out-name illustrator_engine`); the wasm-bindgen exports live in `illustrator_engine`
//! and are linked in through this re-export.

pub use illustrator_engine::*;
