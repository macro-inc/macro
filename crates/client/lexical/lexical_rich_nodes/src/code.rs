//! Code blocks and tolerated stored highlights; tokenization belongs to the view.
mod highlight;
mod node;
pub use highlight::{CodeHighlightNode, code_highlight_orphan_transform, is_code_highlight_node};
use lexical_model::EditorBuilder;
pub use node::{CodeNode, create_code_node, hooks, is_code_node};
use serde::Deserialize;

/// Upstream's default language label; new nodes may still have no language.
pub const DEFAULT_CODE_LANGUAGE: &str = "javascript";
/// Return the upstream default language label.
pub fn get_default_code_language() -> &'static str {
    DEFAULT_CODE_LANGUAGE
}
/// Register code blocks and legacy highlight import support without a tokenizer.
pub fn register_code_nodes(builder: EditorBuilder) -> EditorBuilder {
    builder.node::<CodeNode>().node::<CodeHighlightNode>()
}
fn falsy_string_as_none<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.filter(|value| !value.is_empty()))
}

pub mod indent;
pub mod language;
pub mod line;
pub mod plain;
pub use language::*;
pub use line::*;
pub use plain::*;
