//! The browser build of [`psd_engine`], the Photoshop viewer's worker module. wasm-pack builds this
//! crate (`--out-name psd_engine`); the wasm-bindgen exports live in `psd_engine`
//! and are linked in through this re-export.

pub use psd_engine::*;
