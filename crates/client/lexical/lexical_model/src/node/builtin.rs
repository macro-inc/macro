//! Always-registered upstream node types.
use crate::*;
use serde::{Deserialize, Serialize};
use std::{borrow::Cow, ops::Range};
/// Upstream `RootNode`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
/// s2: NODE-08, NODE-09
pub struct Root {}
impl NodeType for Root {
    const TYPE: &'static str = "root";
    type Kind = ElementKind;
    fn class_name() -> &'static str {
        "RootNode"
    }
    impl_default_node!();
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> Result<NodeKey, Error> {
        tx.update_from_json(NodeKey::ROOT, json)?;
        Ok(NodeKey::ROOT)
    }
}
impl ElementNode for Root {
    type Parent = ElementBase;
    fn as_parent(&self) -> &Self::Parent {
        &ElementBase
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        None
    }
    fn remove(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        preserve_empty_parent: bool,
    ) -> Result<(), Error> {
        let _ = (tx, this, preserve_empty_parent);
        Err(Error::RemoveRoot)
    }
    fn replace(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        replacement: NodeKey,
        include_children: bool,
    ) -> Result<NodeKey, Error> {
        let _ = (tx, this, replacement, include_children);
        Err(Error::ReplaceRoot)
    }
    fn insert_before(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        let _ = (tx, this, node, restore_selection);
        Err(Error::InsertBeforeRoot)
    }
    fn insert_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        let _ = (tx, this, node, restore_selection);
        Err(Error::InsertAfterRoot)
    }
    fn collapse_at_start(
        _tx: &mut Transaction<'_>,
        _this: Id<Self>,
        _selection: SelectionSlot,
    ) -> Result<bool, Error> {
        Ok(true)
    }
    fn splice(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        start: ChildIndex,
        delete_count: u32,
        nodes: &[NodeKey],
    ) -> Result<(), Error> {
        for key in nodes {
            if !matches!(tx.kind(*key), Some(NodeKind::Element | NodeKind::Decorator)) {
                return Err(Error::RootSpliceNonBlock);
            }
        }
        tx.default_splice(this.key(), start, delete_count, nodes)
    }
}
/// Upstream `TextNode`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Text {}
impl NodeType for Text {
    const TYPE: &'static str = "text";
    type Kind = TextKind;
    fn class_name() -> &'static str {
        "TextNode"
    }
    impl_default_node!();
}
impl TextNode for Text {
    type Parent = TextBase;
    fn as_parent(&self) -> &Self::Parent {
        &TextBase
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        None
    }
}
/// Upstream `LineBreakNode`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
/// s2: NODE-01
pub struct LineBreak {}
impl NodeType for LineBreak {
    const TYPE: &'static str = "linebreak";
    type Kind = LineBreakKind;
    fn class_name() -> &'static str {
        "LineBreakNode"
    }
    impl_default_node!();
}
impl LineBreakNode for LineBreak {
    type Parent = LineBreakBase;
    fn as_parent(&self) -> &Self::Parent {
        &LineBreakBase
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        None
    }
}
/// Upstream `TabNode`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
/// s2: NODE-03
pub struct Tab {}
impl NodeType for Tab {
    const TYPE: &'static str = "tab";
    type Kind = TextKind;
    fn class_name() -> &'static str {
        "TabNode"
    }
    impl_default_node!();
}
impl TextNode for Tab {
    type Parent = Text;
    fn as_parent(&self) -> &Self::Parent {
        &Text {}
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        None
    }
    fn initial_text_data(&self) -> TextData {
        TextData {
            detail: TextDetail::UNMERGEABLE,
            ..TextData::new("\t")
        }
    }
    fn can_insert_text_before(&self, _node: TextView<'_>) -> bool {
        false
    }
    fn can_insert_text_after(&self, _node: TextView<'_>) -> bool {
        false
    }
    fn coerce_text_content<'text>(
        &self,
        _node: TextView<'_>,
        requested: &'text str,
    ) -> Result<Cow<'text, str>, Error> {
        if requested.is_empty() || requested == "\t" {
            Ok(Cow::Borrowed("\t"))
        } else {
            Err(Error::TabSetTextContent)
        }
    }
    fn check_splice_text(
        &self,
        node: TextView<'_>,
        range: Range<Utf16Offset>,
        insert: &str,
    ) -> Result<SpliceText, Error> {
        let _ = node;
        let deleted = range.end.0.saturating_sub(range.start.0);
        if (insert.is_empty() && deleted == 0) || (insert == "\t" && deleted == 1) {
            Ok(SpliceText::Skip)
        } else {
            Err(Error::TabSpliceText)
        }
    }

    fn coerce_detail(
        &self,
        _node: TextView<'_>,
        requested: TextDetail,
    ) -> Result<Option<TextDetail>, Error> {
        if requested == TextDetail::UNMERGEABLE {
            Ok(None)
        } else {
            Err(Error::TabSetDetail)
        }
    }
    fn coerce_mode(
        &self,
        _node: TextView<'_>,
        requested: TextMode,
    ) -> Result<Option<TextMode>, Error> {
        if requested == TextMode::Normal {
            Ok(None)
        } else {
            Err(Error::TabSetMode)
        }
    }
}
/// Upstream `ParagraphNode`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
/// s2: NODE-04, NODE-05, NODE-06
pub struct Paragraph {}
impl NodeType for Paragraph {
    const TYPE: &'static str = "paragraph";
    type Kind = ElementKind;
    fn class_name() -> &'static str {
        "ParagraphNode"
    }
    impl_default_node!();
}
impl ElementNode for Paragraph {
    fn adjust_export_json(
        &self,
        node: NodeView<'_>,
        json: &mut SerializedNode,
    ) -> Result<(), Error> {
        let data = node
            .state
            .element(node.key)
            .ok_or(Error::NotAnElement(node.key))?;
        let first = node
            .state
            .children(node.key)
            .find_map(|key| node.state.text(key));
        let format = first.map_or(data.text_format, |text| text.format);
        let style = first.map_or(data.text_style.as_ref(), |text| text.style.as_ref());
        json.insert("textFormat".into(), serde_json::json!(format.bits()));
        json.insert("textStyle".into(), serde_json::json!(style));
        if first.is_some_and(|text| text.absent.contains(crate::node::AbsentKeys::FORMAT)) {
            json.remove("textFormat");
        }
        if first.is_some_and(|text| text.absent.contains(crate::node::AbsentKeys::STYLE)) {
            json.remove("textStyle");
        }
        Ok(())
    }

    type Parent = ElementBase;
    fn as_parent(&self) -> &Self::Parent {
        &ElementBase
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        None
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        selection: SelectionSlot,
        restore_selection: bool,
    ) -> Result<Option<NodeKey>, Error> {
        let source = tx
            .view()
            .element(this)
            .cloned()
            .ok_or(Error::NotAnElement(this.key()))?;
        let range = tx.try_range_at(selection).cloned();
        let next = tx.create(Paragraph::default())?;
        let mut target = tx.element(next)?;
        target
            .set_direction(source.direction)?
            .set_format(source.format)?
            .set_style(&source.style)?;
        if let Some(range) = range {
            target
                .set_text_format(range.format)?
                .set_text_style(&range.style)?;
        }
        tx.insert_after(this, next, restore_selection)?;
        Ok(Some(next.key()))
    }
    fn collapse_at_start(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _selection: SelectionSlot,
    ) -> Result<bool, Error> {
        let children = tx.children_keys(this)?;
        let empty = children.is_empty()
            || children.first().is_some_and(|key| {
                tx.view()
                    .text(*key)
                    .is_some_and(|text| text.text.as_str().trim().is_empty())
            });
        if empty {
            if tx.next_sibling(this).is_some() {
                tx.select_next(this, None, None)?;
                tx.remove(this, false)?;
                return Ok(true);
            }
            if tx.prev_sibling(this).is_some() {
                tx.select_previous(this, None, None)?;
                tx.remove(this, false)?;
                return Ok(true);
            }
        }
        Ok(false)
    }
}
/// Upstream `ArtificialNode__DO_NOT_USE`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
/// s2: NODE-14
pub struct Artificial {}
impl NodeType for Artificial {
    const TYPE: &'static str = "artificial";
    type Kind = ElementKind;
    fn class_name() -> &'static str {
        "ArtificialNode__DO_NOT_USE"
    }
    impl_default_node!();
}
impl ElementNode for Artificial {
    type Parent = ElementBase;
    fn as_parent(&self) -> &Self::Parent {
        &ElementBase
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        None
    }
}
