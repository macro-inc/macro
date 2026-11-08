//! Mutable foreign node methods over the exact current callback lease.
use crate::host_callbacks::Callback;
use lexical_model::*;
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};

pub(super) struct ForeignNode {
    overrides: AtomicU64,
    callback: Mutex<Option<Arc<Callback>>>,
}
impl ForeignNode {
    pub fn new(overrides: u64) -> Result<Self, Error> {
        Self::check_supported(overrides)?;
        Ok(Self {
            overrides: AtomicU64::new(overrides),
            callback: Mutex::default(),
        })
    }
    fn check_supported(mask: u64) -> Result<(), Error> {
        let supported = ForeignHook::IsInline.bit()
            | ForeignHook::CanBeEmpty.bit()
            | ForeignHook::CanIndent.bit()
            | ForeignHook::IsShadowRoot.bit()
            | ForeignHook::CanInsertTextBefore.bit()
            | ForeignHook::CanInsertTextAfter.bit()
            | ForeignHook::CanMergeWhenEmpty.bit()
            | ForeignHook::IsParentRequired.bit()
            | ForeignHook::IsTextEntity.bit()
            | ForeignHook::CanHaveFormat.bit()
            | ForeignHook::IsIsolated.bit()
            | ForeignHook::IsKeyboardSelectable.bit()
            | ForeignHook::CoerceTextContent.bit()
            | ForeignHook::CheckSpliceText.bit()
            | ForeignHook::CoerceDetail.bit()
            | ForeignHook::CoerceMode.bit()
            | ForeignHook::CoerceFormat.bit()
            | ForeignHook::Remove.bit()
            | ForeignHook::ResetOnCopy.bit()
            | ForeignHook::Splice.bit()
            | ForeignHook::Append.bit()
            | ForeignHook::SetIndent.bit()
            | ForeignHook::UpdateFromJson.bit()
            | ForeignHook::Replace.bit()
            | ForeignHook::InsertAfter.bit()
            | ForeignHook::InsertBefore.bit()
            | ForeignHook::CreateParentElement.bit()
            | ForeignHook::InsertNewAfter.bit()
            | ForeignHook::CollapseAtStart.bit()
            | ForeignHook::StaticTransform.bit()
            | ForeignHook::Import.bit()
            | ForeignHook::SelectionTransform.bit()
            | ForeignHook::AdjustExportJson.bit();
        if let Some(hook) = ForeignHook::ALL
            .iter()
            .find(|hook| mask & !supported & hook.bit() != 0)
        {
            return Err(Error::invariant(format!(
                "foreign host hook {} is not wired yet",
                hook.upstream_name()
            )));
        }
        if mask
            & !ForeignHook::ALL
                .iter()
                .fold(0, |mask, hook| mask | hook.bit())
            != 0
        {
            return Err(Error::Invariant("unknown foreign hook mask bit"));
        }
        Ok(())
    }
    pub fn set_mask(&self, mask: u64, started: bool) -> Result<(), Error> {
        Self::check_supported(mask)?;
        let previous = self.overrides.load(Ordering::SeqCst);
        if started && mask & !previous != 0 {
            return Err(Error::Invariant(
                "cannot enable a foreign hook after the first update",
            ));
        }
        self.overrides.store(mask, Ordering::SeqCst);
        Ok(())
    }
    pub fn install(&self, callback: Arc<Callback>) {
        let previous = {
            self.callback
                .lock()
                .expect("foreign dispatcher")
                .replace(callback)
        };
        drop(previous);
    }
    pub fn ready(&self) -> bool {
        self.overrides.load(Ordering::SeqCst) == 0
            || self.callback.lock().expect("foreign dispatcher").is_some()
    }
    fn invoke_result(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        hook: ForeignHook,
        nodes: &[NodeKey],
        trailing_args: Vec<Value>,
    ) -> Override<Result<NodeKey, Error>> {
        if self.overrides.load(Ordering::SeqCst) & hook.bit() == 0 {
            return Override::Inherit;
        }
        let callback = { self.callback.lock().expect("foreign dispatcher").clone() };
        Override::Value(match callback {
            Some(callback) => callback.nodes(tx, nodes).and_then(|mut args| {
                args.extend(trailing_args);
                callback.node_result(tx, key, hook, args)
            }),
            None => Err(Error::Invariant("foreign dispatcher is not installed")),
        })
    }
    fn invoke(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        hook: ForeignHook,
        args: Vec<Value>,
    ) -> Override<Result<(), Error>> {
        self.invoke_with(tx, key, hook, |_, _| Ok(args))
    }
    fn invoke_with(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        hook: ForeignHook,
        args: impl FnOnce(&Callback, &Transaction<'_>) -> Result<Vec<Value>, Error>,
    ) -> Override<Result<(), Error>> {
        if self.overrides.load(Ordering::SeqCst) & hook.bit() == 0 {
            return Override::Inherit;
        }
        let callback = { self.callback.lock().expect("foreign dispatcher").clone() };
        Override::Value(match callback {
            Some(callback) => {
                args(&callback, tx).and_then(|args| callback.node_mutation(tx, key, hook, args))
            }
            None => Err(Error::Invariant("foreign dispatcher is not installed")),
        })
    }
    fn predicate(&self, node: NodeView<'_>, hook: ForeignHook) -> Override<bool> {
        if self.overrides.load(Ordering::SeqCst) & hook.bit() == 0 {
            return Override::Inherit;
        }
        // This private adapter is reachable only through the fallible host ABI.
        // Direct unscoped model reads cannot invoke JS-backed pure predicates.
        if !ForeignReadOperation::is_active() {
            return Override::Inherit;
        }
        let callback = { self.callback.lock().expect("foreign dispatcher").clone() };
        let result = match callback {
            Some(callback) => node
                .state
                .snapshot_for_foreign_read()
                .and_then(|snapshot| callback.predicate(&snapshot, node.key, hook)),
            None => Err(Error::Invariant("foreign dispatcher is not installed")),
        };
        match result {
            Ok(value) => Override::Value(value),
            Err(error) => {
                // The active operation owns the error; native control flow may
                // only continue through checked reads until its Result barrier.
                // The caller's operation remains active through JS reentry.
                match ForeignReadOperation::defer(error) {
                    Ok(()) => Override::Value(false),
                    Err(_) => Override::Inherit,
                }
            }
        }
    }
}
impl ForeignHooks for ForeignNode {
    fn is_inline(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::IsInline)
    }
    fn can_be_empty(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::CanBeEmpty)
    }

    fn can_indent(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::CanIndent)
    }
    fn is_shadow_root(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::IsShadowRoot)
    }
    fn can_insert_text_before(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::CanInsertTextBefore)
    }
    fn can_insert_text_after(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::CanInsertTextAfter)
    }
    fn can_merge_when_empty(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::CanMergeWhenEmpty)
    }
    fn is_parent_required(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::IsParentRequired)
    }
    fn is_text_entity(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::IsTextEntity)
    }
    fn can_have_format(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::CanHaveFormat)
    }
    fn is_isolated(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::IsIsolated)
    }
    fn is_keyboard_selectable(&self, node: NodeView<'_>, _data: &ForeignData) -> Override<bool> {
        self.predicate(node, ForeignHook::IsKeyboardSelectable)
    }

    fn adjust_export_json(
        &self,
        node: NodeView<'_>,
        _data: &ForeignData,
        json: &mut SerializedNode,
    ) -> Override<Result<(), Error>> {
        if self.overrides.load(Ordering::SeqCst) & ForeignHook::AdjustExportJson.bit() == 0 {
            return Override::Inherit;
        }
        let callback = { self.callback.lock().expect("foreign dispatcher").clone() };
        Override::Value(match callback {
            Some(callback) => node.state.snapshot_for_foreign_read().and_then(|snapshot| {
                let result = callback.export_json(&snapshot, node.key)?;
                *json = result;
                Ok(())
            }),
            None => Err(Error::Invariant("foreign dispatcher is not installed")),
        })
    }

    fn selection_transform(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
    ) -> Override<Result<(), Error>> {
        if self.overrides.load(Ordering::SeqCst) & ForeignHook::SelectionTransform.bit() == 0 {
            return Override::Inherit;
        }
        let callback = { self.callback.lock().expect("foreign dispatcher").clone() };
        Override::Value(match callback {
            Some(callback) => callback.selection_transform(tx, key),
            None => Err(Error::Invariant("foreign dispatcher is not installed")),
        })
    }
    fn import(
        &self,
        tx: &mut Transaction<'_>,
        json: &SerializedNode,
    ) -> Override<Result<NodeKey, Error>> {
        if self.overrides.load(Ordering::SeqCst) & ForeignHook::Import.bit() == 0 {
            return Override::Inherit;
        }
        let callback = { self.callback.lock().expect("foreign dispatcher").clone() };
        Override::Value(match callback {
            Some(callback) => callback.import_node(tx, json),
            None => Err(Error::Invariant("foreign dispatcher is not installed")),
        })
    }
    fn static_transform(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
    ) -> Override<Result<(), Error>> {
        self.invoke(tx, key, ForeignHook::StaticTransform, vec![])
    }
    fn insert_new_after(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        selection: SelectionSlot,
        restore_selection: bool,
    ) -> Override<Result<Option<NodeKey>, Error>> {
        if self.overrides.load(Ordering::SeqCst) & ForeignHook::InsertNewAfter.bit() == 0 {
            return Override::Inherit;
        }
        let callback = { self.callback.lock().expect("foreign dispatcher").clone() };
        Override::Value(match callback {
            Some(callback) => callback.selection(tx, selection).and_then(|selection| {
                callback.node_optional_result(
                    tx,
                    key,
                    ForeignHook::InsertNewAfter,
                    vec![selection, json!(restore_selection)],
                )
            }),
            None => Err(Error::Invariant("foreign dispatcher is not installed")),
        })
    }
    fn collapse_at_start(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        selection: SelectionSlot,
    ) -> Override<Result<bool, Error>> {
        if self.overrides.load(Ordering::SeqCst) & ForeignHook::CollapseAtStart.bit() == 0 {
            return Override::Inherit;
        }
        let callback = { self.callback.lock().expect("foreign dispatcher").clone() };
        Override::Value(match callback {
            Some(callback) => callback.selection(tx, selection).and_then(|selection| {
                callback.node_boolean(tx, key, ForeignHook::CollapseAtStart, vec![selection])
            }),
            None => Err(Error::Invariant("foreign dispatcher is not installed")),
        })
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        replacement: NodeKey,
        include_children: bool,
    ) -> Override<Result<NodeKey, Error>> {
        self.invoke_result(
            tx,
            key,
            ForeignHook::Replace,
            &[replacement],
            vec![json!(include_children)],
        )
    }
    fn insert_after(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        node: NodeKey,
        restore_selection: bool,
    ) -> Override<Result<NodeKey, Error>> {
        self.invoke_result(
            tx,
            key,
            ForeignHook::InsertAfter,
            &[node],
            vec![json!(restore_selection)],
        )
    }
    fn insert_before(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        node: NodeKey,
        restore_selection: bool,
    ) -> Override<Result<NodeKey, Error>> {
        self.invoke_result(
            tx,
            key,
            ForeignHook::InsertBefore,
            &[node],
            vec![json!(restore_selection)],
        )
    }
    fn create_parent_element(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
    ) -> Override<Result<NodeKey, Error>> {
        self.invoke_result(tx, key, ForeignHook::CreateParentElement, &[], vec![])
    }
    fn remove(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        preserve_empty_parent: bool,
    ) -> Override<Result<(), Error>> {
        self.invoke(
            tx,
            key,
            ForeignHook::Remove,
            vec![json!(preserve_empty_parent)],
        )
    }
    fn reset_on_copy(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        original: NodeKey,
    ) -> Override<Result<(), Error>> {
        self.invoke_with(tx, key, ForeignHook::ResetOnCopy, |callback, tx| {
            callback.nodes(tx, &[original])
        })
    }
    fn splice(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        start: ChildIndex,
        delete_count: u32,
        nodes: &[NodeKey],
    ) -> Override<Result<(), Error>> {
        self.invoke_with(tx, key, ForeignHook::Splice, |callback, tx| {
            Ok(vec![
                json!(start.0),
                json!(delete_count),
                Value::Array(callback.nodes(tx, nodes)?),
            ])
        })
    }
    fn append(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        nodes: &[NodeKey],
    ) -> Override<Result<(), Error>> {
        self.invoke_with(tx, key, ForeignHook::Append, |callback, tx| {
            callback.nodes(tx, nodes)
        })
    }
    fn set_indent(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        indent: u32,
    ) -> Override<Result<(), Error>> {
        self.invoke(tx, key, ForeignHook::SetIndent, vec![json!(indent)])
    }
    fn update_from_json(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        json: &SerializedNode,
    ) -> Override<Result<(), Error>> {
        self.invoke(tx, key, ForeignHook::UpdateFromJson, vec![json!(json)])
    }

    fn coerce_text_content(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        value: &str,
    ) -> Override<Result<(), Error>> {
        self.invoke(tx, key, ForeignHook::CoerceTextContent, vec![json!(value)])
    }
    fn coerce_detail(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        value: TextDetail,
    ) -> Override<Result<(), Error>> {
        self.invoke(
            tx,
            key,
            ForeignHook::CoerceDetail,
            vec![json!(value.bits())],
        )
    }
    fn coerce_format(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        value: TextFormat,
    ) -> Override<Result<(), Error>> {
        self.invoke(
            tx,
            key,
            ForeignHook::CoerceFormat,
            vec![json!(value.bits())],
        )
    }
    fn coerce_mode(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        value: TextMode,
    ) -> Override<Result<(), Error>> {
        self.invoke(tx, key, ForeignHook::CoerceMode, vec![json!(value)])
    }
    fn check_splice_text(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        range: std::ops::Range<Utf16Offset>,
        insert: &str,
        move_selection: bool,
    ) -> Override<Result<(), Error>> {
        if self.overrides.load(Ordering::SeqCst) & ForeignHook::CheckSpliceText.bit() == 0 {
            return Override::Inherit;
        }
        let Some(count) = range.end.0.checked_sub(range.start.0) else {
            return Override::Value(Err(Error::Utf16OffsetOutOfRange(range.end)));
        };
        self.invoke(
            tx,
            key,
            ForeignHook::CheckSpliceText,
            vec![
                json!(range.start.0),
                json!(count),
                json!(insert),
                json!(move_selection),
            ],
        )
    }
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn masks_reject_unknown_or_unwired_hooks_and_freeze_native_flips() -> Result<(), Error> {
        let node = ForeignNode::new(0)?;
        assert!(node.ready());
        node.set_mask(ForeignHook::CoerceTextContent.bit(), false)?;
        assert!(!node.ready());
        node.set_mask(0, true)?;
        assert!(node.ready());
        assert!(node.set_mask(ForeignHook::CoerceMode.bit(), true).is_err());
        assert!(ForeignNode::new(ForeignHook::IsInline.bit()).is_ok());
        assert!(ForeignNode::new(ForeignHook::CanBeEmpty.bit()).is_ok());
        assert!(ForeignNode::new(ForeignHook::AfterClone.bit()).is_err());
        assert!(ForeignNode::new(1u64 << 63).is_err());
        Ok(())
    }
    #[test]
    fn unset_splice_hook_inherits_even_for_a_range_that_native_code_will_reject()
    -> Result<(), Error> {
        let node = ForeignNode::new(0)?;
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let mut tx = editor.transaction();
        let key = tx.create_text("text")?.key();
        assert!(matches!(
            node.check_splice_text(&mut tx, key, Utf16Offset(2)..Utf16Offset(1), "", false),
            Override::Inherit
        ));
        Ok(())
    }
}
