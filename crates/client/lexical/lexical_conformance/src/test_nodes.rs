//! Literal ports of the upstream test node classes and OverflowNode.
use lexical_model::*;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
/// Upstream `TestElementNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TestElementNode {}
impl NodeType for TestElementNode {
    const TYPE: &'static str = "test_block";
    type Kind = ElementKind;
    impl_default_node!();
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> Result<NodeKey, Error> {
        // The pinned upstream test helper returns its inline class.
        let key = tx.create(TestInlineElementNode::default())?.key();
        tx.update_from_json(key, json)?;
        Ok(key)
    }
}
impl ElementNode for TestElementNode {
    element_node_base!();
}
/// Upstream `TestInlineElementNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TestInlineElementNode {}
impl NodeType for TestInlineElementNode {
    const TYPE: &'static str = "test_inline_block";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for TestInlineElementNode {
    element_node_base!();
    fn is_inline(&self, _: ElementView<'_>) -> bool {
        true
    }
    fn can_be_empty(&self, _: ElementView<'_>) -> bool {
        false
    }
}
/// Upstream `TestShadowRootNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TestShadowRootNode {}
impl NodeType for TestShadowRootNode {
    const TYPE: &'static str = "test_shadow_root";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for TestShadowRootNode {
    element_node_base!();
    fn is_shadow_root(&self, _: ElementView<'_>) -> bool {
        true
    }
}
/// Upstream `TestExcludeFromCopyElementNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TestExcludeFromCopyElementNode {}
impl NodeType for TestExcludeFromCopyElementNode {
    const TYPE: &'static str = "test_exclude_from_copy_block";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for TestExcludeFromCopyElementNode {
    element_node_base!();
    fn exclude_from_copy(&self, _: ElementView<'_>, _: Option<CopyDestination>) -> bool {
        true
    }
}
/// Upstream `TestTextNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TestTextNode {}
impl NodeType for TestTextNode {
    const TYPE: &'static str = "test_text";
    type Kind = TextKind;
    impl_default_node!();
}
impl TextNode for TestTextNode {
    text_node_base!();
}
/// Upstream `TestSegmentedNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TestSegmentedNode {}
impl NodeType for TestSegmentedNode {
    const TYPE: &'static str = "test_segmented";
    type Kind = TextKind;
    impl_default_node!();
}
impl TextNode for TestSegmentedNode {
    text_node_base!();
}
/// Upstream `OverflowNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct OverflowNode {}
impl NodeType for OverflowNode {
    const TYPE: &'static str = "overflow";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for OverflowNode {
    element_node_base!();
    fn exclude_from_copy(&self, _: ElementView<'_>, _: Option<CopyDestination>) -> bool {
        true
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        selection: SelectionSlot,
        restore: bool,
    ) -> Result<Option<NodeKey>, Error> {
        let parent = tx.parent_or_err(this)?;
        tx.insert_new_after(parent, selection, restore)
    }
}
/// Upstream test decorator, including its instance-dependent block flag.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TestDecoratorNode {
    /// Whether this decorator is a block.
    #[serde(default)]
    pub block: bool,
}
impl NodeType for TestDecoratorNode {
    const TYPE: &'static str = "test_decorator";
    const FLAGS_PER_INSTANCE: bool = true;
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for TestDecoratorNode {
    decorator_node_base!();
    fn adjust_export_json(&self, _: NodeView<'_>, json: &mut SerializedNode) -> Result<(), Error> {
        if !self.block {
            json.remove("block");
        }
        Ok(())
    }
    fn is_inline(&self, _: NodeView<'_>) -> bool {
        !self.block
    }
    fn text_content<'a>(&self, _: NodeView<'a>) -> Cow<'a, str> {
        Cow::Borrowed("Hello world")
    }
}
/// Register the seven DEFAULT_NODES test classes plus Overflow.
pub fn builder() -> EditorBuilder {
    Editor::builder(EditorMode::ViewAttached)
        .node::<TestElementNode>()
        .node::<TestInlineElementNode>()
        .node::<TestShadowRootNode>()
        .node::<TestExcludeFromCopyElementNode>()
        .node::<TestTextNode>()
        .node::<TestSegmentedNode>()
        .node::<TestDecoratorNode>()
        .node::<OverflowNode>()
        .transform::<OverflowNode>(remove_empty_overflow)
}
fn remove_empty_overflow(tx: &mut Transaction<'_>, node: Id<OverflowNode>) -> Result<(), Error> {
    if tx.is_empty(node) {
        tx.remove(node, false)?;
    }
    Ok(())
}

pub(crate) fn configured_builder(nodes: &[String], attached: bool) -> Result<EditorBuilder, Error> {
    let mut builder = Editor::builder(if attached {
        EditorMode::ViewAttached
    } else {
        EditorMode::Headless
    });
    for node in nodes {
        builder = match node.as_str() {
            "test_block" => builder.node::<TestElementNode>(),
            "test_inline_block" => builder.node::<TestInlineElementNode>(),
            "test_shadow_root" => builder.node::<TestShadowRootNode>(),
            "test_exclude_from_copy_block" => builder.node::<TestExcludeFromCopyElementNode>(),
            "test_text" => builder.node::<TestTextNode>(),
            "test_segmented" => builder.node::<TestSegmentedNode>(),
            "test_decorator" => builder.node::<TestDecoratorNode>(),
            "overflow" => builder
                .node::<OverflowNode>()
                .transform::<OverflowNode>(remove_empty_overflow),
            "link" => builder.node::<lexical_rich_nodes::link::LinkNode>(),
            "autolink" => builder.node::<lexical_rich_nodes::link::AutoLinkNode>(),
            "list" => builder.node::<lexical_rich_nodes::list::ListNode>(),
            "listitem" => builder.node::<lexical_rich_nodes::list::ListItemNode>(),
            "table" => builder.node::<lexical_rich_nodes::table::TableNode>(),
            "tablerow" => builder.node::<lexical_rich_nodes::table::TableRowNode>(),
            "tablecell" => builder.node::<lexical_rich_nodes::table::TableCellNode>(),
            "heading" => builder.node::<lexical_rich_nodes::heading::HeadingNode>(),
            "quote" => builder.node::<lexical_rich_nodes::quote::QuoteNode>(),
            "code" => builder.node::<lexical_rich_nodes::code::CodeNode>(),
            "code-highlight" => builder.node::<lexical_rich_nodes::code::CodeHighlightNode>(),
            "mark" => builder.node::<lexical_rich_nodes::mark::MarkNode>(),
            "hashtag" => builder.node::<lexical_rich_nodes::hashtag::HashtagNode>(),
            "root" | "paragraph" | "text" | "tab" | "linebreak" | "artificial" => builder,
            _ => macro_document_model::register_supported_node(builder, node)?,
        };
    }
    Ok(builder)
}

#[cfg(test)]
mod test;
