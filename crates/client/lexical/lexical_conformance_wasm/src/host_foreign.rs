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
        let supported = ForeignHook::CoerceTextContent.bit()
            | ForeignHook::CheckSpliceText.bit()
            | ForeignHook::CoerceDetail.bit()
            | ForeignHook::CoerceMode.bit()
            | ForeignHook::CoerceFormat.bit()
            | ForeignHook::Remove.bit()
            | ForeignHook::ResetOnCopy.bit()
            | ForeignHook::Splice.bit()
            | ForeignHook::Append.bit()
            | ForeignHook::SetIndent.bit()
            | ForeignHook::UpdateFromJson.bit();
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
}
impl ForeignHooks for ForeignNode {
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
        assert!(ForeignNode::new(ForeignHook::IsInline.bit()).is_err());
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
