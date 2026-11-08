//! Import-only legacy highlight nodes. Rust never tokenizes code.
use super::CodeNode;
use lexical_model::*;
use serde::{Deserialize, Serialize};

/// Tolerated stored `code-highlight`; no public creation factory is provided.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeHighlightNode {
    /// Stored token class, omitting absent, null and empty values.
    #[serde(
        default,
        deserialize_with = "super::falsy_string_as_none",
        skip_serializing_if = "Option::is_none"
    )]
    pub highlight_type: Option<String>,
}
impl NodeType for CodeHighlightNode {
    const TYPE: &'static str = "code-highlight";
    type Kind = TextKind;
    impl_default_node!();
}
impl TextNode for CodeHighlightNode {
    text_node_base!();
    fn can_have_format(&self, _node: TextView<'_>) -> bool {
        false
    }
    fn coerce_format(
        &self,
        _node: TextView<'_>,
        _format: TextFormat,
    ) -> Result<Option<TextFormat>, Error> {
        Ok(None)
    }
    fn is_parent_required(&self, _node: TextView<'_>) -> bool {
        true
    }
    fn create_parent_element(tx: &mut Transaction<'_>, _this: Id<Self>) -> Result<NodeKey, Error> {
        Ok(tx.create(CodeNode::default())?.key())
    }
}
/// Test legacy highlight ancestry.
pub fn is_code_highlight_node(state: &impl Read, key: NodeKey) -> bool {
    state.is::<CodeHighlightNode>(key)
}
/// Drop empty highlights and plainify orphaned highlights as upstream Prism does.
pub fn code_highlight_orphan_transform(
    tx: &mut Transaction<'_>,
    node: Id<CodeHighlightNode>,
) -> Result<(), Error> {
    let text = tx.text_content(node).into_owned();
    if text.is_empty() {
        tx.remove(node, false)?;
    } else if !tx
        .parent(node)
        .is_some_and(|parent| tx.is::<CodeNode>(parent))
    {
        let plain = tx.create_text(&text)?;
        tx.replace(node, plain, false)?;
    }
    Ok(())
}
#[cfg(test)]
mod test;
