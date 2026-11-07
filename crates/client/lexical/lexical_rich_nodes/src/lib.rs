//! Portable model halves of Lexical's rich-text packages.
#![deny(missing_docs)]

pub mod heading;
pub mod overflow;
pub mod quote;

use lexical_model::EditorBuilder;

/// Errors returned by the package's model operations.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A core model operation failed.
    #[error(transparent)]
    Model(#[from] lexical_model::Error),
}
/// Result of a rich-node operation.
pub type Result<T> = std::result::Result<T, Error>;

/// Register the nodes supplied by `RichTextExtension`.
pub fn register_rich_text_nodes(builder: EditorBuilder) -> EditorBuilder {
    builder
        .node::<heading::HeadingNode>()
        .node::<quote::QuoteNode>()
}

pub mod text;
/// Compatibility module name from the rich-node package map; one implementation lives in `text::entity`.
pub mod text_entity {
    pub use crate::text::entity::*;
}
pub mod click_after_last_block;
pub mod hashtag;
pub mod normalize_triple_click;
pub mod plain_text;
pub mod rich_text;
pub mod selection;
pub mod tab;
pub mod utils;

pub mod list;

pub mod code;
pub mod link;

pub mod mark;

pub mod offset;

pub mod clipboard;
