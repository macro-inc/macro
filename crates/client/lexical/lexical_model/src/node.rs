//! Node type contracts and typed inheritance.
mod base;
mod builtin;
pub use base::*;
mod data;
mod dispatch;
use crate::*;
pub use builtin::*;
pub use data::*;
pub(crate) use data::{AbsentKeys, AnyNodeData, Links, NodeSlot};
pub use dispatch::NodeVTable;
use serde::{Serialize, de::DeserializeOwned};
use std::{borrow::Cow, fmt, ops::Range};
/// JSON object used for node properties.
pub type SerializedNode = serde_json::Map<String, serde_json::Value>;
/// A typed node payload, separate from its framework-owned fields.
/// s2: CFG-01, CFG-02, CFG-03, CFG-04, CFG-06, CFG-08
pub trait NodeType:
    Clone + PartialEq + fmt::Debug + Send + Sync + Serialize + DeserializeOwned + 'static
{
    /// Unique serialized name.
    const TYPE: &'static str;
    /// Terminal parent, never registered.
    const IS_MARKER: bool = false;
    /// Base kind and dispatch bridge.
    type Kind: NodeKindMarker + KindOf<Self>;
    /// State declared at this inheritance level.
    const REQUIRED_STATE: &'static [RequiredState] = &[];
    /// Whether the type declares a language field.
    const HAS_LANGUAGE_FIELD: bool = false;
    /// Whether view flags depend on instance state.
    const FLAGS_PER_INSTANCE: bool = false;
    /// Human-readable class name.
    fn class_name() -> &'static str {
        std::any::type_name::<Self>()
            .rsplit("::")
            .next()
            .unwrap_or(Self::TYPE)
    }
    /// Transform declared at this level.
    fn static_transform() -> Option<TransformFn<Self>> {
        None
    }
    /// Optional constructor without arguments.
    fn default_node() -> Option<Self> {
        None
    }
    /// Create a no-argument instance with access to host-provided editor context.
    /// Types with constructor side effects override this instead of reading global state.
    fn create_default(tx: &mut Transaction<'_>) -> Result<NodeKey, Error> {
        let node = Self::default_node().ok_or(Error::NoDefault(Self::TYPE))?;
        Ok(tx.create_exact(node)?.key())
    }
    /// Representative instance used to compute static view flags.
    fn flag_probe() -> Option<Self> {
        Self::default_node()
    }
    /// Import a payload and apply the framework fields.
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> Result<NodeKey, Error> {
        let node = match Self::default_node() {
            Some(node) => node,
            None => Self::import_json(json)?,
        };
        let key = tx.create(node)?.key();
        tx.update_from_json(key, json)?;
        Ok(key)
    }
    /// Decode this type's own fields.
    fn import_json(json: &SerializedNode) -> Result<Self, Error> {
        Ok(serde_json::from_value(serde_json::Value::Object(
            json.clone(),
        ))?)
    }
    /// Update this type's own fields.
    fn update_from_json(&mut self, json: &SerializedNode) -> Result<(), Error> {
        *self = Self::import_json(json)?;
        Ok(())
    }
    /// Optional normalization when a shared record is cloned for writing.
    fn after_clone(&self) -> Option<Self> {
        None
    }
}
/// A transform receives the full transaction and a typed key.
pub type TransformFn<Node> = fn(&mut Transaction<'_>, Id<Node>) -> Result<(), Error>;
/// Outcome of a text splice hook.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpliceText {
    /// Apply the requested splice.
    Apply,
    /// Leave text unchanged.
    Skip,
}
mod sealed {
    pub trait Sealed {}
}
/// A sealed node kind.
pub trait NodeKindMarker: sealed::Sealed + 'static {
    /// Runtime kind value.
    const KIND: NodeKind;
}
/// Bridge from a kind to the matching typed parent chain.
pub trait KindOf<Node: NodeType>: sealed::Sealed {
    /// Declared immediate parent.
    type Parent: NodeType;
    /// Internal registration dispatch.
    #[doc(hidden)]
    fn vtable() -> NodeVTable;
}
/// Immediate parent of any node type.
pub type ParentOf<Node> = <<Node as NodeType>::Kind as KindOf<Node>>::Parent;
/// Sealed element kind marker.
pub struct ElementKind;
impl sealed::Sealed for ElementKind {}
impl NodeKindMarker for ElementKind {
    const KIND: NodeKind = NodeKind::Element;
}
macro_rules! common_node_hooks {
    ($View:ident, $Trait:ident) => {
        /// Inherited `json_version` hook.
        fn json_version(&self) -> u32 {
            self.as_parent().json_version()
        }
        /// Inherited `adjust_export_json` hook.
        fn adjust_export_json(
            &self,
            node: NodeView<'_>,
            json: &mut SerializedNode,
        ) -> Result<(), Error> {
            self.as_parent().adjust_export_json(node, json)
        }
        /// Inherited `is_parent_required` hook.
        fn is_parent_required(&self, node: $View<'_>) -> bool {
            self.as_parent().is_parent_required(node)
        }
        /// Inherited `reset_on_copy` hook.
        fn reset_on_copy(
            tx: &mut Transaction<'_>,
            this: Id<Self>,
            original: NodeKey,
        ) -> Result<(), Error> {
            <Self::Parent as $Trait>::reset_on_copy(tx, this.upcast(), original)
        }
        /// Inherited `remove` hook.
        fn remove(
            tx: &mut Transaction<'_>,
            this: Id<Self>,
            preserve_empty_parent: bool,
        ) -> Result<(), Error> {
            <Self::Parent as $Trait>::remove(tx, this.upcast(), preserve_empty_parent)
        }
        /// Inherited `replace` hook.
        fn replace(
            tx: &mut Transaction<'_>,
            this: Id<Self>,
            replacement: NodeKey,
            include_children: bool,
        ) -> Result<NodeKey, Error> {
            <Self::Parent as $Trait>::replace(tx, this.upcast(), replacement, include_children)
        }
        /// Inherited `insert_after` hook.
        fn insert_after(
            tx: &mut Transaction<'_>,
            this: Id<Self>,
            node: NodeKey,
            restore_selection: bool,
        ) -> Result<NodeKey, Error> {
            <Self::Parent as $Trait>::insert_after(tx, this.upcast(), node, restore_selection)
        }
        /// Inherited `insert_before` hook.
        fn insert_before(
            tx: &mut Transaction<'_>,
            this: Id<Self>,
            node: NodeKey,
            restore_selection: bool,
        ) -> Result<NodeKey, Error> {
            <Self::Parent as $Trait>::insert_before(tx, this.upcast(), node, restore_selection)
        }
        /// Inherited `create_parent_element` hook.
        fn create_parent_element(
            tx: &mut Transaction<'_>,
            this: Id<Self>,
        ) -> Result<NodeKey, Error> {
            <Self::Parent as $Trait>::create_parent_element(tx, this.upcast())
        }
    };
}
/// Hooks inherited by element node types.
/// s2: EL-04, EL-05, EL-06, EL-07, EL-08, EL-09
pub trait ElementNode: NodeType<Kind = ElementKind> {
    /// Immediate parent of the same kind.
    type Parent: ElementNode;
    /// Borrow the parent payload.
    fn as_parent(&self) -> &Self::Parent;
    /// Mutably borrow a non-marker parent payload.
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent>;
    common_node_hooks!(ElementView, ElementNode);

    /// Inherited `is_inline` hook.
    fn is_inline(&self, node: ElementView<'_>) -> bool {
        self.as_parent().is_inline(node)
    }
    /// Inherited `can_be_empty` hook.
    fn can_be_empty(&self, node: ElementView<'_>) -> bool {
        self.as_parent().can_be_empty(node)
    }
    /// Inherited `can_insert_text_before` hook.
    fn can_insert_text_before(&self, node: ElementView<'_>) -> bool {
        self.as_parent().can_insert_text_before(node)
    }
    /// Inherited `can_insert_text_after` hook.
    fn can_insert_text_after(&self, node: ElementView<'_>) -> bool {
        self.as_parent().can_insert_text_after(node)
    }
    /// Inherited `is_shadow_root` hook.
    fn is_shadow_root(&self, node: ElementView<'_>) -> bool {
        self.as_parent().is_shadow_root(node)
    }
    /// Inherited `can_indent` hook.
    fn can_indent(&self, node: ElementView<'_>) -> bool {
        self.as_parent().can_indent(node)
    }
    /// Inherited `can_merge_with` hook.
    fn can_merge_with(&self, node: ElementView<'_>, other: NodeKey) -> bool {
        self.as_parent().can_merge_with(node, other)
    }
    /// Inherited `can_merge_when_empty` hook.
    fn can_merge_when_empty(&self, node: ElementView<'_>) -> bool {
        self.as_parent().can_merge_when_empty(node)
    }
    /// Inherited `can_replace_with` hook.
    fn can_replace_with(&self, node: ElementView<'_>, replacement: NodeKey) -> bool {
        self.as_parent().can_replace_with(node, replacement)
    }
    /// Inherited `can_insert_after` hook.
    fn can_insert_after(&self, node: ElementView<'_>, other: NodeKey) -> bool {
        self.as_parent().can_insert_after(node, other)
    }
    /// Inherited `exclude_from_copy` hook.
    fn exclude_from_copy(
        &self,
        node: ElementView<'_>,
        destination: Option<CopyDestination>,
    ) -> bool {
        self.as_parent().exclude_from_copy(node, destination)
    }
    /// Inherited `extract_with_child` hook.
    fn extract_with_child(
        &self,
        node: ElementView<'_>,
        child: NodeKey,
        selection: Option<&Selection>,
        destination: CopyDestination,
    ) -> bool {
        self.as_parent()
            .extract_with_child(node, child, selection, destination)
    }
    /// Inherited `indent` hook.
    fn indent(&self, node: ElementView<'_>) -> u32 {
        self.as_parent().indent(node)
    }
    /// Inherited `splice` hook.
    fn splice(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        start: ChildIndex,
        delete_count: u32,
        nodes: &[NodeKey],
    ) -> Result<(), Error> {
        <Self::Parent as ElementNode>::splice(tx, this.upcast(), start, delete_count, nodes)
    }
    /// Inherited `append` hook.
    fn append(tx: &mut Transaction<'_>, this: Id<Self>, nodes: &[NodeKey]) -> Result<(), Error> {
        <Self::Parent as ElementNode>::append(tx, this.upcast(), nodes)
    }
    /// Inherited `set_indent` hook.
    fn set_indent(tx: &mut Transaction<'_>, this: Id<Self>, indent: u32) -> Result<(), Error> {
        <Self::Parent as ElementNode>::set_indent(tx, this.upcast(), indent)
    }
    /// Inherited `insert_new_after` hook.
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        selection: SelectionSlot,
        restore_selection: bool,
    ) -> Result<Option<NodeKey>, Error> {
        <Self::Parent as ElementNode>::insert_new_after(
            tx,
            this.upcast(),
            selection,
            restore_selection,
        )
    }
    /// Inherited `collapse_at_start` hook.
    fn collapse_at_start(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        selection: SelectionSlot,
    ) -> Result<bool, Error> {
        <Self::Parent as ElementNode>::collapse_at_start(tx, this.upcast(), selection)
    }
}
impl<Node: ElementNode> KindOf<Node> for ElementKind {
    type Parent = <Node as ElementNode>::Parent;
    fn vtable() -> NodeVTable {
        dispatch::element::<Node>()
    }
}
/// Sealed text kind marker.
pub struct TextKind;
impl sealed::Sealed for TextKind {}
impl NodeKindMarker for TextKind {
    const KIND: NodeKind = NodeKind::Text;
}
/// Hooks inherited by text node types.
/// s2: TX-07
pub trait TextNode: NodeType<Kind = TextKind> {
    /// Immediate parent of the same kind.
    type Parent: TextNode;
    /// Borrow the parent payload.
    fn as_parent(&self) -> &Self::Parent;
    /// Mutably borrow a non-marker parent payload.
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent>;
    common_node_hooks!(TextView, TextNode);

    /// Inherited `can_insert_text_before` hook.
    fn can_insert_text_before(&self, node: TextView<'_>) -> bool {
        self.as_parent().can_insert_text_before(node)
    }
    /// Inherited `can_insert_text_after` hook.
    fn can_insert_text_after(&self, node: TextView<'_>) -> bool {
        self.as_parent().can_insert_text_after(node)
    }
    /// Inherited `can_have_format` hook.
    fn can_have_format(&self, node: TextView<'_>) -> bool {
        self.as_parent().can_have_format(node)
    }
    /// Inherited `is_text_entity` hook.
    fn is_text_entity(&self, node: TextView<'_>) -> bool {
        self.as_parent().is_text_entity(node)
    }
    /// Inherited `initial_text_data` hook.
    fn initial_text_data(&self) -> TextData {
        self.as_parent().initial_text_data()
    }
    /// Inherited `coerce_text_content` hook.
    fn coerce_text_content<'text>(
        &self,
        node: TextView<'_>,
        requested: &'text str,
    ) -> Result<Cow<'text, str>, Error> {
        self.as_parent().coerce_text_content(node, requested)
    }
    /// Inherited `check_splice_text` hook.
    fn check_splice_text(
        &self,
        node: TextView<'_>,
        range: Range<Utf16Offset>,
        insert: &str,
    ) -> Result<SpliceText, Error> {
        self.as_parent().check_splice_text(node, range, insert)
    }
    /// Inherited `coerce_detail` hook.
    fn coerce_detail(
        &self,
        node: TextView<'_>,
        requested: TextDetail,
    ) -> Result<Option<TextDetail>, Error> {
        self.as_parent().coerce_detail(node, requested)
    }
    /// Inherited `coerce_mode` hook.
    fn coerce_mode(
        &self,
        node: TextView<'_>,
        requested: TextMode,
    ) -> Result<Option<TextMode>, Error> {
        self.as_parent().coerce_mode(node, requested)
    }
    /// Inherited `coerce_format` hook.
    fn coerce_format(
        &self,
        node: TextView<'_>,
        requested: TextFormat,
    ) -> Result<Option<TextFormat>, Error> {
        self.as_parent().coerce_format(node, requested)
    }
    /// Inherited `selection_transform` hook.
    fn selection_transform(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<(), Error> {
        <Self::Parent as TextNode>::selection_transform(tx, this.upcast())
    }
}
impl<Node: TextNode> KindOf<Node> for TextKind {
    type Parent = <Node as TextNode>::Parent;
    fn vtable() -> NodeVTable {
        dispatch::text::<Node>()
    }
}
/// Sealed decorator kind marker.
pub struct DecoratorKind;
impl sealed::Sealed for DecoratorKind {}
impl NodeKindMarker for DecoratorKind {
    const KIND: NodeKind = NodeKind::Decorator;
}
/// Hooks inherited by decorator node types.
/// s2: NODE-10, NODE-11
pub trait DecoratorNode: NodeType<Kind = DecoratorKind> {
    /// Immediate parent of the same kind.
    type Parent: DecoratorNode;
    /// Borrow the parent payload.
    fn as_parent(&self) -> &Self::Parent;
    /// Mutably borrow a non-marker parent payload.
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent>;
    common_node_hooks!(DecoratorView, DecoratorNode);

    /// Optional nonserialized component lifetime, read without graph or host callbacks.
    /// Clones retain this value; only the node's actual invalidating setter changes it.
    fn render_revision(&self) -> Option<u64> {
        self.as_parent().render_revision()
    }

    /// Inherited `is_inline` hook.
    fn is_inline(&self, node: DecoratorView<'_>) -> bool {
        self.as_parent().is_inline(node)
    }
    /// Inherited `is_isolated` hook.
    fn is_isolated(&self, node: DecoratorView<'_>) -> bool {
        self.as_parent().is_isolated(node)
    }
    /// Inherited `is_keyboard_selectable` hook.
    fn is_keyboard_selectable(&self, node: DecoratorView<'_>) -> bool {
        self.as_parent().is_keyboard_selectable(node)
    }
    /// Inherited `text_content` hook.
    fn text_content<'state>(&self, node: DecoratorView<'state>) -> Cow<'state, str> {
        self.as_parent().text_content(node)
    }
}
impl<Node: DecoratorNode> KindOf<Node> for DecoratorKind {
    type Parent = <Node as DecoratorNode>::Parent;
    fn vtable() -> NodeVTable {
        dispatch::decorator::<Node>()
    }
}
/// Sealed linebreak kind marker.
pub struct LineBreakKind;
impl sealed::Sealed for LineBreakKind {}
impl NodeKindMarker for LineBreakKind {
    const KIND: NodeKind = NodeKind::LineBreak;
}
/// Hooks inherited by linebreak node types.
pub trait LineBreakNode: NodeType<Kind = LineBreakKind> {
    /// Immediate parent of the same kind.
    type Parent: LineBreakNode;
    /// Borrow the parent payload.
    fn as_parent(&self) -> &Self::Parent;
    /// Mutably borrow a non-marker parent payload.
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent>;
    common_node_hooks!(LineBreakView, LineBreakNode);
}
impl<Node: LineBreakNode> KindOf<Node> for LineBreakKind {
    type Parent = <Node as LineBreakNode>::Parent;
    fn vtable() -> NodeVTable {
        dispatch::linebreak::<Node>()
    }
}
/// Declare the direct element parent and its projections.
#[macro_export]
macro_rules! element_node_base {
    () => {
        type Parent = $crate::ElementBase;
        fn as_parent(&self) -> &Self::Parent {
            &$crate::ElementBase
        }
        fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
            None
        }
    };
}
/// Declare the direct text parent and its projections.
#[macro_export]
macro_rules! text_node_base {
    () => {
        type Parent = $crate::Text;
        fn as_parent(&self) -> &Self::Parent {
            &$crate::Text {}
        }
        fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
            None
        }
    };
}
/// Declare the direct decorator parent and its projections.
#[macro_export]
macro_rules! decorator_node_base {
    () => {
        type Parent = $crate::DecoratorBase;
        fn as_parent(&self) -> &Self::Parent {
            &$crate::DecoratorBase
        }
        fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
            None
        }
    };
}
/// Declare the direct linebreak parent and its projections.
#[macro_export]
macro_rules! line_break_node_base {
    () => {
        type Parent = $crate::LineBreakBase;
        fn as_parent(&self) -> &Self::Parent {
            &$crate::LineBreakBase
        }
        fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
            None
        }
    };
}
/// Opt into a zero-argument default constructor.
#[macro_export]
macro_rules! impl_default_node {
    () => {
        fn default_node() -> Option<Self> {
            Some(Self::default())
        }
    };
}
