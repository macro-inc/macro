//! The browser build of [`agent_fold`], the agent transcript fold the web app runs in a worker. wasm-pack builds this
//! crate (`--out-name agent_fold`); the wasm-bindgen exports live in `agent_fold`
//! and are linked in through this re-export.

pub use agent_fold::*;
