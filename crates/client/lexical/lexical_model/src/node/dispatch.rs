//! Monomorphized dispatch tables for node kinds.
use super::AnyNodeData;
use crate::*;
use std::{
    any::{Any, TypeId},
    borrow::Cow,
    ops::Range,
    sync::Arc,
};
type TransformsHook = Vec<crate::registry::RegisteredTransform>;
type SpliceHook = fn(
    tx: &mut Transaction<'_>,
    this: NodeKey,
    start: ChildIndex,
    delete_count: u32,
    nodes: &[NodeKey],
) -> Result<(), Error>;
type InsertNewAfterHook = fn(
    tx: &mut Transaction<'_>,
    this: NodeKey,
    selection: SelectionSlot,
    restore_selection: bool,
) -> Result<Option<NodeKey>, Error>;
type CoerceTextContentHook = for<'text> fn(
    data: &dyn Any,
    node: NodeView<'_>,
    requested: &'text str,
) -> Result<Cow<'text, str>, Error>;
type CheckSpliceTextHook = fn(
    data: &dyn Any,
    node: NodeView<'_>,
    range: Range<Utf16Offset>,
    insert: &str,
) -> Result<SpliceText, Error>;
type CoerceDetailHook = fn(
    data: &dyn Any,
    node: NodeView<'_>,
    requested: TextDetail,
) -> Result<Option<TextDetail>, Error>;
type CoerceModeHook =
    fn(data: &dyn Any, node: NodeView<'_>, requested: TextMode) -> Result<Option<TextMode>, Error>;
type CoerceFormatHook = fn(
    data: &dyn Any,
    node: NodeView<'_>,
    requested: TextFormat,
) -> Result<Option<TextFormat>, Error>;
/// Opaque table used by the sealed kind bridge.
#[doc(hidden)]
#[derive(Clone)]
pub struct NodeVTable {
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign: Option<Arc<ForeignNodeType>>,
    pub(crate) type_name: &'static str,
    pub(crate) class_name: &'static str,
    pub(crate) kind: NodeKind,
    pub(crate) type_id: TypeId,
    pub(crate) marker: bool,
    pub(crate) ancestry: Vec<TypeId>,
    pub(crate) required: Vec<RequiredState>,
    pub(crate) transforms: TransformsHook,
    pub(crate) language: bool,
    pub(crate) per_instance: bool,
    pub(crate) project: fn(&dyn Any, TypeId) -> Option<&dyn Any>,
    pub(crate) project_mut: fn(&mut dyn Any, TypeId) -> Option<&mut dyn Any>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) decode: fn(&SerializedNode) -> Result<Arc<dyn AnyNodeData>, Error>,
    pub(crate) probe: fn() -> Option<Arc<dyn AnyNodeData>>,
    pub(crate) default_data: fn() -> Option<Arc<dyn AnyNodeData>>,
    pub(crate) initial_base: fn(&dyn Any) -> Result<BaseData, Error>,
    pub(crate) import_exact: fn(&mut Transaction<'_>, &SerializedNode) -> Result<NodeKey, Error>,
    pub(crate) import: fn(&mut Transaction<'_>, &SerializedNode) -> Result<NodeKey, Error>,
    pub(crate) update: fn(&mut dyn Any, &SerializedNode) -> Result<(), Error>,
    pub(crate) json_version: fn(data: &dyn Any) -> u32,
    pub(crate) adjust_export_json:
        fn(data: &dyn Any, node: NodeView<'_>, json: &mut SerializedNode) -> Result<(), Error>,
    pub(crate) selection_transform: AnyTransformFn,
    pub(crate) is_parent_required: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) reset_on_copy:
        fn(tx: &mut Transaction<'_>, this: NodeKey, original: NodeKey) -> Result<(), Error>,
    pub(crate) remove: fn(
        tx: &mut Transaction<'_>,
        this: NodeKey,
        preserve_empty_parent: bool,
    ) -> Result<(), Error>,
    pub(crate) replace: fn(
        tx: &mut Transaction<'_>,
        this: NodeKey,
        replacement: NodeKey,
        include_children: bool,
    ) -> Result<NodeKey, Error>,
    pub(crate) insert_after: fn(
        tx: &mut Transaction<'_>,
        this: NodeKey,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error>,
    pub(crate) insert_before: fn(
        tx: &mut Transaction<'_>,
        this: NodeKey,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error>,
    pub(crate) create_parent_element:
        fn(tx: &mut Transaction<'_>, this: NodeKey) -> Result<NodeKey, Error>,
    pub(crate) is_inline: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) can_be_empty: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) can_insert_text_before: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) can_insert_text_after: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) is_shadow_root: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) can_indent: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) can_merge_with: fn(data: &dyn Any, node: NodeView<'_>, other: NodeKey) -> bool,
    pub(crate) can_merge_when_empty: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) can_replace_with:
        fn(data: &dyn Any, node: NodeView<'_>, replacement: NodeKey) -> bool,
    pub(crate) can_insert_after: fn(data: &dyn Any, node: NodeView<'_>, other: NodeKey) -> bool,
    pub(crate) exclude_from_copy:
        fn(data: &dyn Any, node: NodeView<'_>, destination: Option<CopyDestination>) -> bool,
    pub(crate) extract_with_child: fn(
        data: &dyn Any,
        node: NodeView<'_>,
        child: NodeKey,
        selection: Option<&Selection>,
        destination: CopyDestination,
    ) -> bool,
    pub(crate) indent: fn(data: &dyn Any, node: NodeView<'_>) -> u32,
    pub(crate) splice: SpliceHook,
    pub(crate) append:
        fn(tx: &mut Transaction<'_>, this: NodeKey, nodes: &[NodeKey]) -> Result<(), Error>,
    pub(crate) set_indent:
        fn(tx: &mut Transaction<'_>, this: NodeKey, indent: u32) -> Result<(), Error>,
    pub(crate) insert_new_after: InsertNewAfterHook,
    pub(crate) collapse_at_start: fn(
        tx: &mut Transaction<'_>,
        this: NodeKey,
        selection: SelectionSlot,
    ) -> Result<bool, Error>,
    pub(crate) can_have_format: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) is_text_entity: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) coerce_text_content: CoerceTextContentHook,
    pub(crate) check_splice_text: CheckSpliceTextHook,
    pub(crate) coerce_detail: CoerceDetailHook,
    pub(crate) coerce_mode: CoerceModeHook,
    pub(crate) coerce_format: CoerceFormatHook,
    pub(crate) is_isolated: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) is_keyboard_selectable: fn(data: &dyn Any, node: NodeView<'_>) -> bool,
    pub(crate) text_content:
        for<'state> fn(data: &dyn Any, node: NodeView<'state>) -> Cow<'state, str>,
}

mod element;
pub(super) use element::element;
mod text;
pub(super) use text::text;
mod decorator;
pub(super) use decorator::decorator;
mod linebreak;
pub(super) use linebreak::linebreak;
