//! The browser build of [`docx_engine`], the Word document editor's worker module. wasm-pack builds this
//! crate (`--out-name docx_engine`); the wasm-bindgen exports live in `docx_engine`
//! and are linked in through this re-export.

pub use docx_engine::*;
