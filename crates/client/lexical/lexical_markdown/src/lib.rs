//! Portable upstream markdown engine with UTF-16 transformer contracts.
#![deny(missing_docs)]
pub mod builtin;
pub mod export;
pub mod import;
pub mod matcher;
pub mod normalize;
pub mod options;
mod patterns;
pub mod shortcuts;
pub use shortcuts::*;
pub mod state;
pub mod transformer;
pub mod util;
pub use export::{ExportCx, convert_selection_to_markdown_string, convert_to_markdown_string};
pub use import::convert_from_markdown_string;
pub use normalize::normalize_markdown;
pub use options::MarkdownOptions;
pub use transformer::*;
/// Markdown operation failure.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Underlying model edit or read failed.
    #[error(transparent)]
    Model(#[from] lexical_model::Error),
    /// Rich-node construction failed.
    #[error(transparent)]
    Rich(#[from] lexical_rich_nodes::Error),
    /// Invalid regular expression or flags.
    #[error(transparent)]
    Matcher(#[from] lexical_rich_nodes::utils::matcher::MatcherError),
    /// Invalid caller argument.
    #[error("invalid markdown argument: {0}")]
    InvalidArgument(&'static str),
    /// Required transformer node type is absent.
    #[error("markdown transformer requires node type {type_name}")]
    MissingNode {
        /// Registered TYPE string.
        type_name: &'static str,
    },
}
/// Markdown result.
pub type Result<T> = std::result::Result<T, Error>;
