//! The browser build of [`ai_engine`], the Illustrator editor's worker module. wasm-pack builds this
//! crate (`--out-name ai_engine`); the wasm-bindgen exports live in `ai_engine`
//! and are linked in through this re-export.

pub use ai_engine::*;
