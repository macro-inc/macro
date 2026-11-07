//! Portable Lexical editor values, node registry, and transactional model.
#![deny(missing_docs)]

mod error;
mod format;
mod key;
mod offset;
mod style;
pub use error::*;
pub use format::*;
pub use key::*;
pub use offset::*;
pub use style::*;
mod editor;
mod node;
mod node_state;
mod read;
mod registry;
mod selection;
mod state;
mod transaction;
pub use editor::*;
pub use node::*;
pub use node_state::*;
pub use read::*;
pub use registry::*;
pub use selection::*;
pub use state::*;
pub use transaction::*;
#[cfg(test)]
mod test;

mod collections;
pub mod json;
pub use json::*;
mod raw_text;
pub use raw_text::*;

const _: () = {
    const fn assert_send_sync<Value: Send + Sync>() {}
    assert_send_sync::<Editor>();
    assert_send_sync::<EditorState>();
    assert_send_sync::<Registry>();
    assert_send_sync::<Commit>();
    assert_send_sync::<Selection>();
};

mod tags;
pub use tags::*;

mod pipeline;
pub use pipeline::*;
mod commit;
pub use commit::*;

mod caret;
pub use caret::*;

mod command;
pub use command::*;
mod extension;
pub use extension::*;
mod plugin;
pub use plugin::*;

mod history;
pub use history::*;
