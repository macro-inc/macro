//! Runtime counterparts of the model's polymorphic node hooks.
use crate::*;
use std::{ops::Range, sync::Arc};

/// A runtime hook either supplies a result or inherits its registered parent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Override<Value> {
    /// Run the parent implementation without calling the host again.
    Inherit,
    /// Use the host implementation's result.
    Value(Value),
}

/// Own serialized properties of a runtime node, in insertion order.
#[derive(Clone, Debug, PartialEq)]
pub struct ForeignData {
    /// Custom properties; framework fields remain in the node record.
    pub fields: SerializedNode,
}

/// A runtime node class supplied by an external host.
pub struct ForeignNodeType {
    /// Serialized type name, unique in the editor registry.
    pub type_name: Arc<str>,
    /// Runtime class name used in diagnostics.
    pub class_name: Arc<str>,
    /// Framework storage kind.
    pub kind: NodeKind,
    /// Registered parent type, including another runtime type.
    pub extends: Option<&'static str>,
    /// Flat and nested state declarations at this inheritance level.
    pub required_state: Vec<RequiredState>,
    /// Polymorphic model operations; view hooks stay in the view registry.
    pub hooks: Arc<dyn ForeignHooks>,
}

/// Runtime polymorphic model hooks.
/// Each default explicitly delegates to the registered parent.
/// Runtime text setters own the complete mutable operation. Their inherited
/// native TextNode coercion hooks remain pure and run only on native fallback.
pub trait ForeignHooks: Send + Sync + 'static {
    /// Runtime counterpart of `is_inline`.
    fn is_inline(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `can_be_empty`.
    fn can_be_empty(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `can_indent`.
    fn can_indent(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `is_shadow_root`.
    fn is_shadow_root(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `can_insert_text_before`.
    fn can_insert_text_before(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `can_insert_text_after`.
    fn can_insert_text_after(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `can_merge_with`.
    fn can_merge_with(
        &self,
        _node: NodeView<'_>,
        _data: &ForeignData,
        _other: NodeKey,
    ) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `can_merge_when_empty`.
    fn can_merge_when_empty(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `can_replace_with`.
    fn can_replace_with(
        &self,
        _node: NodeView<'_>,
        _data: &ForeignData,
        _replacement: NodeKey,
    ) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `can_insert_after`.
    fn can_insert_after(
        &self,
        _node: NodeView<'_>,
        _data: &ForeignData,
        _other: NodeKey,
    ) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `exclude_from_copy`.
    fn exclude_from_copy(
        &self,
        _node: NodeView<'_>,
        _data: &ForeignData,
        _destination: Option<CopyDestination>,
    ) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `extract_with_child`.
    fn extract_with_child(
        &self,
        _node: NodeView<'_>,
        _data: &ForeignData,
        _child: NodeKey,
        _selection: Option<&Selection>,
        _destination: CopyDestination,
    ) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `indent`.
    /// Upstream host method: `getIndent`.
    fn indent(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<u32> {
        Override::Inherit
    }
    /// Runtime counterpart of `is_parent_required`.
    fn is_parent_required(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `is_text_entity`.
    fn is_text_entity(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `can_have_format`.
    fn can_have_format(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `is_isolated`.
    fn is_isolated(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `is_keyboard_selectable`.
    fn is_keyboard_selectable(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        Override::Inherit
    }
    /// Runtime counterpart of `text_content`.
    /// Upstream host method: `getTextContent`.
    fn text_content(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<String> {
        Override::Inherit
    }
    /// Runtime counterpart of `remove`.
    fn remove(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _preserve_empty_parent: bool,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `replace`.
    fn replace(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _replacement: NodeKey,
        _include_children: bool,
    ) -> Override<Result<NodeKey, Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `insert_after`.
    fn insert_after(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _node: NodeKey,
        _restore_selection: bool,
    ) -> Override<Result<NodeKey, Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `insert_before`.
    fn insert_before(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _node: NodeKey,
        _restore_selection: bool,
    ) -> Override<Result<NodeKey, Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `reset_on_copy`.
    /// Upstream host method: `resetOnCopyNodeFrom`.
    fn reset_on_copy(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _original: NodeKey,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `create_parent_element`.
    /// Upstream host method: `createParentElementNode`.
    fn create_parent_element(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
    ) -> Override<Result<NodeKey, Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `splice`.
    fn splice(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _start: ChildIndex,
        _delete_count: u32,
        _nodes: &[NodeKey],
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `append`.
    fn append(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _nodes: &[NodeKey],
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `set_indent`.
    fn set_indent(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _indent: u32,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `insert_new_after`.
    fn insert_new_after(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _selection: SelectionSlot,
        _restore_selection: bool,
    ) -> Override<Result<Option<NodeKey>, Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `collapse_at_start`.
    fn collapse_at_start(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _selection: SelectionSlot,
    ) -> Override<Result<bool, Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `import`.
    /// Upstream host method: `importJSON`.
    fn import(
        &self,
        _tx: &mut Transaction<'_>,
        _json: &SerializedNode,
    ) -> Override<Result<NodeKey, Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `update_from_json`.
    /// Upstream host method: `updateFromJSON`.
    fn update_from_json(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _json: &SerializedNode,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `adjust_export_json`.
    /// Upstream host method: `exportJSON`.
    fn adjust_export_json(
        &self,
        _node: NodeView<'_>,
        _data: &ForeignData,
        _json: &mut SerializedNode,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `after_clone`.
    /// Upstream host method: `afterCloneFrom`.
    fn after_clone(
        &self,
        _key: NodeKey,
        _original: NodeKey,
        _data: &ForeignData,
    ) -> Override<Option<ForeignData>> {
        Override::Inherit
    }
    /// Runtime counterpart of `static_transform`.
    /// Upstream host method: `transform`.
    fn static_transform(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime counterpart of `selection_transform`.
    fn selection_transform(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime `setTextContent` override; owns the complete operation.
    /// Unlike native TextNode coercion, this may call getWritable or native-super.
    /// Upstream host method: `setTextContent`.
    fn coerce_text_content(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _requested: &str,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime `spliceText` override; owns the write and selection movement.
    /// Upstream host method: `spliceText`.
    fn check_splice_text(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _range: Range<Utf16Offset>,
        _insert: &str,
        _move_selection: bool,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime `setDetail` override; owns the complete operation.
    /// Upstream host method: `setDetail`.
    fn coerce_detail(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _requested: TextDetail,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime `setMode` override; owns the complete operation.
    /// Upstream host method: `setMode`.
    fn coerce_mode(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _requested: TextMode,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
    /// Runtime `setFormat` override; owns the complete operation.
    /// Upstream host method: `setFormat`.
    fn coerce_format(
        &self,
        _tx: &mut Transaction<'_>,
        _key: NodeKey,
        _requested: TextFormat,
    ) -> Override<Result<(), Error>> {
        Override::Inherit
    }
}

include!(concat!(env!("OUT_DIR"), "/foreign_hooks.rs"));
