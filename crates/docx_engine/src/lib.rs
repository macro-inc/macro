//! A from-scratch Word (`.docx`) engine: parse, lay out, render, edit, save.
//!
//! The same code runs natively (tests, the corpus CLI) and as WebAssembly in
//! the browser editor's worker. Paragraphs are attributed strings (text plus
//! formatting spans) inside a tree of blocks with stable ids, which is also
//! the shape of the collaborative state, so local edits map to small CRDT
//! operations and remote ones apply to single blocks. Content the engine does
//! not interpret is kept as XML snippets and written back unchanged.

#![deny(missing_docs)]

pub mod document;
mod error;
pub mod layout;
pub mod model;
pub mod render;
#[cfg(test)]
mod test_support;
pub mod units;
pub mod xml;

pub use document::Document;
pub use error::{Error, Result};
