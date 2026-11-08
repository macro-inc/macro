//! Terminal kind implementations.
use super::*;
/// Terminal element parent, not a registered node.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct ElementBase;
impl NodeType for ElementBase {
    const TYPE: &'static str = "";
    const IS_MARKER: bool = true;
    type Kind = ElementKind;
    fn import_json(_json: &SerializedNode) -> Result<Self, Error> {
        // Unit markers have no own fields; foreign projections supply a JSON object.
        Ok(Self)
    }
}
impl ElementNode for ElementBase {
    type Parent = Self;
    fn as_parent(&self) -> &Self {
        self
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self> {
        None
    }
    fn json_version(&self) -> u32 {
        1
    }
    fn adjust_export_json(
        &self,
        node: NodeView<'_>,
        json: &mut SerializedNode,
    ) -> Result<(), Error> {
        let _ = (node, json);
        Ok(())
    }
    fn is_parent_required(&self, node: ElementView<'_>) -> bool {
        let _ = (node,);
        false
    }
    fn reset_on_copy(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        original: NodeKey,
    ) -> Result<(), Error> {
        let _ = (tx, this, original);
        Ok(())
    }
    fn remove(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        preserve_empty_parent: bool,
    ) -> Result<(), Error> {
        tx.default_remove(this.key(), true, preserve_empty_parent)
    }
    fn replace(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        replacement: NodeKey,
        include_children: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_replace(this.key(), replacement, include_children)
    }
    fn insert_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_insert_after(this.key(), node, restore_selection)
    }
    fn insert_before(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_insert_before(this.key(), node, restore_selection)
    }
    fn create_parent_element(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<NodeKey, Error> {
        let _ = (this,);
        Ok(tx.create(Paragraph::default())?.key())
    }
    fn is_inline(&self, node: ElementView<'_>) -> bool {
        let _ = (node,);
        false
    }
    fn can_be_empty(&self, node: ElementView<'_>) -> bool {
        let _ = (node,);
        true
    }
    fn can_insert_text_before(&self, node: ElementView<'_>) -> bool {
        let _ = (node,);
        true
    }
    fn can_insert_text_after(&self, node: ElementView<'_>) -> bool {
        let _ = (node,);
        true
    }
    fn is_shadow_root(&self, node: ElementView<'_>) -> bool {
        let _ = (node,);
        false
    }
    fn can_indent(&self, node: ElementView<'_>) -> bool {
        let _ = (node,);
        true
    }
    fn can_merge_with(&self, node: ElementView<'_>, other: NodeKey) -> bool {
        let _ = (node, other);
        false
    }
    fn can_merge_when_empty(&self, node: ElementView<'_>) -> bool {
        let _ = (node,);
        false
    }
    fn can_replace_with(&self, node: ElementView<'_>, replacement: NodeKey) -> bool {
        let _ = (node, replacement);
        true
    }
    fn can_insert_after(&self, node: ElementView<'_>, other: NodeKey) -> bool {
        let _ = (node, other);
        true
    }
    fn exclude_from_copy(
        &self,
        node: ElementView<'_>,
        destination: Option<CopyDestination>,
    ) -> bool {
        let _ = (node, destination);
        false
    }
    fn extract_with_child(
        &self,
        node: ElementView<'_>,
        child: NodeKey,
        selection: Option<&Selection>,
        destination: CopyDestination,
    ) -> bool {
        let _ = (node, child, selection, destination);
        false
    }
    fn indent(&self, node: ElementView<'_>) -> u32 {
        node.data().indent
    }
    fn splice(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        start: ChildIndex,
        delete_count: u32,
        nodes: &[NodeKey],
    ) -> Result<(), Error> {
        tx.default_splice(this.key(), start, delete_count, nodes)
    }
    fn append(tx: &mut Transaction<'_>, this: Id<Self>, nodes: &[NodeKey]) -> Result<(), Error> {
        tx.default_append(this.key(), nodes)
    }
    fn set_indent(tx: &mut Transaction<'_>, this: Id<Self>, indent: u32) -> Result<(), Error> {
        tx.set_indent_base(this.key(), indent)
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        selection: SelectionSlot,
        restore_selection: bool,
    ) -> Result<Option<NodeKey>, Error> {
        let _ = (tx, this, selection, restore_selection);
        Ok(None)
    }
    fn collapse_at_start(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        selection: SelectionSlot,
    ) -> Result<bool, Error> {
        let _ = (tx, this, selection);
        Ok(false)
    }
}
/// Terminal text parent, not a registered node.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct TextBase;
impl NodeType for TextBase {
    const TYPE: &'static str = "";
    const IS_MARKER: bool = true;
    type Kind = TextKind;
    fn import_json(_json: &SerializedNode) -> Result<Self, Error> {
        // Unit markers have no own fields; foreign projections supply a JSON object.
        Ok(Self)
    }
}
impl TextNode for TextBase {
    type Parent = Self;
    fn as_parent(&self) -> &Self {
        self
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self> {
        None
    }
    fn json_version(&self) -> u32 {
        1
    }
    fn adjust_export_json(
        &self,
        node: NodeView<'_>,
        json: &mut SerializedNode,
    ) -> Result<(), Error> {
        let _ = (node, json);
        Ok(())
    }
    fn is_parent_required(&self, node: TextView<'_>) -> bool {
        let _ = (node,);
        false
    }
    fn reset_on_copy(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        original: NodeKey,
    ) -> Result<(), Error> {
        let _ = (tx, this, original);
        Ok(())
    }
    fn remove(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        preserve_empty_parent: bool,
    ) -> Result<(), Error> {
        tx.default_remove(this.key(), true, preserve_empty_parent)
    }
    fn replace(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        replacement: NodeKey,
        include_children: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_replace(this.key(), replacement, include_children)
    }
    fn insert_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_insert_after(this.key(), node, restore_selection)
    }
    fn insert_before(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_insert_before(this.key(), node, restore_selection)
    }
    fn create_parent_element(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<NodeKey, Error> {
        let _ = (this,);
        Ok(tx.create(Paragraph::default())?.key())
    }
    fn can_insert_text_before(&self, node: TextView<'_>) -> bool {
        let _ = (node,);
        true
    }
    fn can_insert_text_after(&self, node: TextView<'_>) -> bool {
        let _ = (node,);
        true
    }
    fn can_have_format(&self, node: TextView<'_>) -> bool {
        let _ = (node,);
        true
    }
    fn is_text_entity(&self, node: TextView<'_>) -> bool {
        let _ = (node,);
        false
    }
    fn initial_text_data(&self) -> TextData {
        TextData::default()
    }
    fn coerce_text_content<'text>(
        &self,
        node: TextView<'_>,
        requested: &'text str,
    ) -> Result<Cow<'text, str>, Error> {
        let _ = (node,);
        Ok(Cow::Borrowed(requested))
    }
    fn check_splice_text(
        &self,
        node: TextView<'_>,
        range: Range<Utf16Offset>,
        insert: &str,
    ) -> Result<SpliceText, Error> {
        let _ = (node, range, insert);
        Ok(SpliceText::Apply)
    }
    fn coerce_detail(
        &self,
        node: TextView<'_>,
        requested: TextDetail,
    ) -> Result<Option<TextDetail>, Error> {
        let _ = (node,);
        Ok(Some(requested))
    }
    fn coerce_mode(
        &self,
        node: TextView<'_>,
        requested: TextMode,
    ) -> Result<Option<TextMode>, Error> {
        let _ = (node,);
        Ok(Some(requested))
    }
    fn coerce_format(
        &self,
        node: TextView<'_>,
        requested: TextFormat,
    ) -> Result<Option<TextFormat>, Error> {
        let _ = (node,);
        Ok(Some(requested))
    }
    fn selection_transform(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<(), Error> {
        let _ = (tx, this);
        Ok(())
    }
}
/// Terminal decorator parent, not a registered node.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct DecoratorBase;
impl NodeType for DecoratorBase {
    const TYPE: &'static str = "";
    const IS_MARKER: bool = true;
    type Kind = DecoratorKind;
    fn import_json(_json: &SerializedNode) -> Result<Self, Error> {
        // Unit markers have no own fields; foreign projections supply a JSON object.
        Ok(Self)
    }
}
impl DecoratorNode for DecoratorBase {
    type Parent = Self;
    fn as_parent(&self) -> &Self {
        self
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self> {
        None
    }
    fn json_version(&self) -> u32 {
        1
    }
    fn adjust_export_json(
        &self,
        node: NodeView<'_>,
        json: &mut SerializedNode,
    ) -> Result<(), Error> {
        let _ = (node, json);
        Ok(())
    }
    fn is_parent_required(&self, node: DecoratorView<'_>) -> bool {
        let _ = (node,);
        false
    }
    fn reset_on_copy(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        original: NodeKey,
    ) -> Result<(), Error> {
        let _ = (tx, this, original);
        Ok(())
    }
    fn remove(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        preserve_empty_parent: bool,
    ) -> Result<(), Error> {
        tx.default_remove(this.key(), true, preserve_empty_parent)
    }
    fn replace(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        replacement: NodeKey,
        include_children: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_replace(this.key(), replacement, include_children)
    }
    fn insert_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_insert_after(this.key(), node, restore_selection)
    }
    fn insert_before(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_insert_before(this.key(), node, restore_selection)
    }
    fn create_parent_element(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<NodeKey, Error> {
        let _ = (this,);
        Ok(tx.create(Paragraph::default())?.key())
    }
    fn is_inline(&self, node: DecoratorView<'_>) -> bool {
        let _ = (node,);
        true
    }
    fn is_isolated(&self, node: DecoratorView<'_>) -> bool {
        let _ = (node,);
        false
    }
    fn is_keyboard_selectable(&self, node: DecoratorView<'_>) -> bool {
        let _ = (node,);
        true
    }
    fn text_content<'state>(&self, node: DecoratorView<'state>) -> Cow<'state, str> {
        let _ = (node,);
        Cow::Borrowed("")
    }
}
/// Terminal linebreak parent, not a registered node.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct LineBreakBase;
impl NodeType for LineBreakBase {
    const TYPE: &'static str = "";
    const IS_MARKER: bool = true;
    type Kind = LineBreakKind;
    fn import_json(_json: &SerializedNode) -> Result<Self, Error> {
        // Unit markers have no own fields; foreign projections supply a JSON object.
        Ok(Self)
    }
}
impl LineBreakNode for LineBreakBase {
    type Parent = Self;
    fn as_parent(&self) -> &Self {
        self
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self> {
        None
    }
    fn json_version(&self) -> u32 {
        1
    }
    fn adjust_export_json(
        &self,
        node: NodeView<'_>,
        json: &mut SerializedNode,
    ) -> Result<(), Error> {
        let _ = (node, json);
        Ok(())
    }
    fn is_parent_required(&self, node: LineBreakView<'_>) -> bool {
        let _ = (node,);
        false
    }
    fn reset_on_copy(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        original: NodeKey,
    ) -> Result<(), Error> {
        let _ = (tx, this, original);
        Ok(())
    }
    fn remove(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        preserve_empty_parent: bool,
    ) -> Result<(), Error> {
        tx.default_remove(this.key(), true, preserve_empty_parent)
    }
    fn replace(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        replacement: NodeKey,
        include_children: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_replace(this.key(), replacement, include_children)
    }
    fn insert_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_insert_after(this.key(), node, restore_selection)
    }
    fn insert_before(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        tx.default_insert_before(this.key(), node, restore_selection)
    }
    fn create_parent_element(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<NodeKey, Error> {
        let _ = (this,);
        Ok(tx.create(Paragraph::default())?.key())
    }
}

#[cfg(all(test, feature = "foreign-nodes"))]
mod test;
