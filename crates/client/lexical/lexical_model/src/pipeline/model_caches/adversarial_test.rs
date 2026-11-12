use crate::*;
use serde::{Deserialize, Serialize};
use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    sync::Arc,
};

fn agrees_with_full_text(tx: &Transaction<'_>) -> bool {
    let expected =
        tx.view().text_content(NodeKey::ROOT) != tx.editor.state.view().text_content(NodeKey::ROOT);
    let actual = super::root_text_changed(tx);
    assert_eq!(actual, expected);
    actual
}

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct Block {}
impl NodeType for Block {
    const TYPE: &'static str = "cache-block";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for Block {
    element_node_base!();
}

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct Inline {}
impl NodeType for Inline {
    const TYPE: &'static str = "cache-inline";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for Inline {
    element_node_base!();
    fn is_inline(&self, _: ElementView<'_>) -> bool {
        true
    }
}

#[test]
fn empty_first_and_last_block_removal_preserves_separator_changes() -> Result<(), Error> {
    for remove_first in [true, false] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let ((first, last), _) = editor.update(|tx| {
            let first = tx.create(Paragraph::default())?;
            let last = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[first.key(), last.key()])?;
            Ok((first.key(), last.key()))
        })?;
        let mut tx = editor.transaction();
        tx.remove(if remove_first { first } else { last }, true)?;
        tx.flush()?;
        assert!(agrees_with_full_text(&tx));
        assert_eq!(tx.editor.state.view().text_content(NodeKey::ROOT), "\n\n");
        assert_eq!(tx.text_content(NodeKey::ROOT), "");
    }
    Ok(())
}

#[test]
fn empty_inline_and_block_insertion_have_different_separator_effects() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .build()
        .expect("editor");
    let (paragraph, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(paragraph.key())
    })?;
    {
        let mut tx = editor.transaction();
        let inline = tx.create(Inline {})?;
        tx.insert_before(paragraph, inline, false)?;
        assert!(!agrees_with_full_text(&tx));
        assert_eq!(tx.text_content(NodeKey::ROOT), "");
    }
    {
        let mut tx = editor.transaction();
        let inline = tx.create(Inline {})?;
        tx.insert_after(paragraph, inline, false)?;
        assert!(agrees_with_full_text(&tx));
        assert_eq!(tx.text_content(NodeKey::ROOT), "\n\n");
    }
    Ok(())
}

#[test]
fn equal_length_rewrites_canceling_deltas_and_reorders_keep_exact_comparison() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((first, second, a, b), _) = editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let second = tx.create(Paragraph::default())?;
        let a = tx.create_text("red")?;
        let b = tx.create_text("blue")?;
        tx.append(first, &[a.key()])?;
        tx.append(second, &[b.key()])?;
        tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
        Ok((first.key(), second.key(), a.key(), b.key()))
    })?;
    {
        let mut tx = editor.transaction();
        tx.text(a)?.set_text_content("RED")?;
        tx.text(b)?.set_text_content("BLUE")?;
        assert!(agrees_with_full_text(&tx));
        assert!(
            tx.pending.root_text.get().is_some(),
            "equal lengths must fall back"
        );
        assert_eq!(tx.text_content(NodeKey::ROOT), "RED\n\nBLUE");
    }
    {
        let mut tx = editor.transaction();
        tx.text(a)?.set_text_content("redd")?;
        tx.text(b)?.set_text_content("blu")?;
        assert!(agrees_with_full_text(&tx));
        assert!(
            tx.pending.root_text.get().is_some(),
            "canceling deltas must fall back"
        );
        assert_eq!(tx.text_content(NodeKey::ROOT), "redd\n\nblu");
    }
    {
        let mut tx = editor.transaction();
        tx.insert_before(first, second, false)?;
        assert!(agrees_with_full_text(&tx));
        assert!(
            tx.pending.root_text.get().is_some(),
            "reorders must fall back"
        );
        assert_eq!(tx.text_content(NodeKey::ROOT), "blue\n\nred");
    }
    Ok(())
}

#[test]
fn nested_move_and_collected_old_subtree_removal_match_full_text() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Block>()
        .build()
        .expect("editor");
    let ((left, right, paragraph), _) = editor.update(|tx| {
        let left = tx.create(Block {})?;
        let right = tx.create(Block {})?;
        let paragraph = tx.create(Paragraph::default())?;
        let other = tx.create(Paragraph::default())?;
        let a = tx.create_text("red")?;
        let b = tx.create_text("blue")?;
        tx.append(paragraph, &[a.key()])?;
        tx.append(other, &[b.key()])?;
        tx.append(left, &[paragraph.key()])?;
        tx.append(right, &[other.key()])?;
        tx.append(NodeKey::ROOT, &[left.key(), right.key()])?;
        Ok((left.key(), right.key(), paragraph.key()))
    })?;
    {
        let mut tx = editor.transaction();
        tx.append(right, &[paragraph])?;
        assert!(agrees_with_full_text(&tx));
        assert_eq!(tx.text_content(NodeKey::ROOT), "\n\nblue\n\nred");
    }
    {
        let mut tx = editor.transaction();
        tx.insert_after(right, paragraph, false)?;
        assert!(agrees_with_full_text(&tx));
        assert_eq!(tx.text_content(NodeKey::ROOT), "\n\nblue\n\nred");
    }
    {
        let mut tx = editor.transaction();
        tx.remove(left, true)?;
        tx.flush()?;
        assert!(!tx.pending.nodes.contains_key(&left));
        assert!(!tx.pending.nodes.contains_key(&paragraph));
        assert!(tx.editor.state.nodes.contains_key(&left));
        assert!(agrees_with_full_text(&tx));
        assert_eq!(tx.text_content(NodeKey::ROOT), "blue");
    }
    Ok(())
}

#[test]
fn raw_byte_and_subtree_walk_budgets_keep_full_comparison() -> Result<(), Error> {
    for large_text in [false, true] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let (paragraph, _) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            if large_text {
                let text = tx.create_text(&"x".repeat(64 * 1024))?;
                tx.append(paragraph, &[text.key()])?;
            } else {
                for _ in 0..300 {
                    let line = tx.create(LineBreak::default())?;
                    tx.append(paragraph, &[line.key()])?;
                }
            }
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(paragraph.key())
        })?;
        let mut tx = editor.transaction();
        let line = tx.create(LineBreak::default())?;
        tx.append(paragraph, &[line.key()])?;
        assert!(agrees_with_full_text(&tx));
        assert!(
            tx.pending.root_text.get().is_some(),
            "over-budget edit must fall back"
        );
        assert!(tx.editor.state.root_text.get().is_some());
    }
    Ok(())
}

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct Opaque {}
impl NodeType for Opaque {
    const TYPE: &'static str = "cache-opaque";
    type Kind = DecoratorKind;
    const FLAGS_PER_INSTANCE: bool = true;
    impl_default_node!();
}
impl DecoratorNode for Opaque {
    decorator_node_base!();
    fn text_content<'a>(&self, _: NodeView<'a>) -> Cow<'a, str> {
        Cow::Borrowed("opaque")
    }
}

#[test]
fn decorator_on_either_side_keeps_full_comparison() -> Result<(), Error> {
    for previously_present in [false, true] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .node::<Opaque>()
            .build()
            .expect("editor");
        let (opaque, _) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            if previously_present {
                let opaque = tx.create(Opaque {})?;
                tx.append(NodeKey::ROOT, &[opaque.key()])?;
                Ok(Some(opaque.key()))
            } else {
                Ok(None)
            }
        })?;
        let mut tx = editor.transaction();
        if let Some(opaque) = opaque {
            tx.remove(opaque, true)?;
            tx.flush()?;
        } else {
            let opaque = tx.create(Opaque {})?;
            tx.append(NodeKey::ROOT, &[opaque.key()])?;
        }
        assert!(agrees_with_full_text(&tx));
        assert!(tx.pending.root_text.get().is_some());
        assert!(tx.editor.state.root_text.get().is_some());
    }
    Ok(())
}

thread_local! {
    static INLINE_CALLS: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
    static INLINE_FAIL: Cell<bool> = const { Cell::new(false) };
}

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct PerInstanceBlock {}
impl NodeType for PerInstanceBlock {
    const TYPE: &'static str = "cache-per-instance-block";
    type Kind = ElementKind;
    const FLAGS_PER_INSTANCE: bool = true;
    impl_default_node!();
}
impl ElementNode for PerInstanceBlock {
    element_node_base!();
    fn is_inline(&self, node: ElementView<'_>) -> bool {
        let indent = node.state.element(node.key).expect("element").indent;
        INLINE_CALLS.with(|calls| calls.borrow_mut().push(indent));
        false
    }
}

#[test]
fn native_per_instance_element_keeps_getter_order_and_full_comparison() -> Result<(), Error> {
    let mut headless = Editor::builder(EditorMode::Headless)
        .node::<PerInstanceBlock>()
        .build()
        .expect("editor");
    let (block, _) = headless.update(|tx| {
        let block = tx.create(PerInstanceBlock {})?;
        let text = tx.create_text("A")?;
        tx.append(block, &[text.key()])?;
        tx.set_indent(block, 3)?;
        tx.append(NodeKey::ROOT, &[block.key()])?;
        Ok(block.key())
    })?;
    let mut tx = headless.transaction();
    let line = tx.create(LineBreak::default())?;
    tx.append(block, &[line.key()])?;
    tx.set_indent(block, 4)?;
    INLINE_CALLS.with(|calls| calls.borrow_mut().clear());
    assert!(super::root_text_changed(&tx));
    INLINE_CALLS.with(|calls| assert_eq!(*calls.borrow(), vec![4, 3]));
    assert!(tx.pending.root_text.get().is_some());
    assert!(tx.editor.state.root_text.get().is_some());
    Ok(())
}

struct InlineHooks;
impl ForeignHooks for InlineHooks {
    fn is_inline(&self, node: NodeView<'_>, _: &ForeignData) -> Override<bool> {
        let indent = node.state.element(node.key).expect("element").indent;
        INLINE_CALLS.with(|calls| calls.borrow_mut().push(indent));
        if INLINE_FAIL.with(Cell::get) {
            ForeignReadOperation::defer(Error::Invariant("cache inline failure"))
                .expect("actual fallible operation");
        }
        Override::Value(false)
    }
}

#[test]
fn actual_native_overlay_keeps_getter_order_and_full_comparison() -> Result<(), Error> {
    let mut headless = Editor::builder(EditorMode::Headless)
        .foreign_native_hooks("paragraph", Arc::new(InlineHooks))
        .build()
        .expect("editor");
    let (paragraph, _) = headless.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("A")?;
        tx.append(paragraph, &[text.key()])?;
        tx.set_indent(paragraph, 3)?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(paragraph.key())
    })?;
    assert!(!headless.state.registry.native_overlays.is_empty());
    let mut tx = headless.transaction();
    let line = tx.create(LineBreak::default())?;
    tx.append(paragraph, &[line.key()])?;
    tx.set_indent(paragraph, 4)?;
    INLINE_CALLS.with(|calls| calls.borrow_mut().clear());
    assert!(super::root_text_changed(&tx));
    INLINE_CALLS.with(|calls| assert_eq!(*calls.borrow(), vec![4, 3]));
    assert!(tx.pending.root_text.get().is_some());
    assert!(tx.editor.state.root_text.get().is_some());
    Ok(())
}

#[test]
fn overlay_read_failure_does_not_publish_either_root_memo() -> Result<(), Error> {
    let mut headless = Editor::builder(EditorMode::Headless)
        .foreign_native_hooks("paragraph", Arc::new(InlineHooks))
        .build()
        .expect("editor");
    let (paragraph, _) = headless.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("A")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(paragraph.key())
    })?;
    let mut tx = headless.transaction();
    let line = tx.create(LineBreak::default())?;
    tx.append(paragraph, &[line.key()])?;
    INLINE_CALLS.with(|calls| calls.borrow_mut().clear());
    let operation = ForeignReadOperation::begin()?;
    INLINE_FAIL.with(|fail| fail.set(true));
    let _changed = super::root_text_changed(&tx);
    INLINE_FAIL.with(|fail| fail.set(false));
    let result: Result<(), Error> = operation.finish(Ok(()));
    assert!(matches!(result, Err(Error::ForeignReadFailed(_))));
    assert!(!INLINE_CALLS.with(|calls| calls.borrow().is_empty()));
    assert!(tx.pending.root_text.get().is_none());
    assert!(tx.editor.state.root_text.get().is_none());
    Ok(())
}

struct InstanceHost;
impl ForeignInstanceHooks for InstanceHost {
    fn validate_instance(&self, type_name: &str, _: &ForeignInstance) -> Result<(), Error> {
        if type_name == "root" {
            Ok(())
        } else {
            Err(Error::Invariant("unexpected instance type"))
        }
    }
    fn clone_instance(
        &self,
        _: ForeignInstanceCloneRequest,
    ) -> Result<ForeignInstanceClone, Error> {
        Err(Error::Invariant(
            "text comparison must not clone an instance",
        ))
    }
}

#[test]
fn actual_instance_host_and_bound_root_keep_full_comparison() -> Result<(), Error> {
    for bind_root in [false, true] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let (paragraph, _) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("A")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(paragraph.key())
        })?;
        editor.install_foreign_instance_hooks(Arc::new(InstanceHost))?;
        if bind_root {
            let instance = ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?;
            let view = editor.state().view();
            let identity = view.foreign_record_identity(NodeKey::ROOT)?;
            view.bind_foreign_instance(NodeKey::ROOT, &identity, instance)?;
        }
        let mut tx = editor.transaction();
        let line = tx.create(LineBreak::default())?;
        tx.append(paragraph, &[line.key()])?;
        assert!(agrees_with_full_text(&tx));
        assert!(tx.pending.root_text.get().is_some());
        assert!(tx.editor.state.root_text.get().is_some());
    }
    Ok(())
}

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct DynamicText {}
impl NodeType for DynamicText {
    const TYPE: &'static str = "cache-dynamic-text";
    type Kind = TextKind;
    const FLAGS_PER_INSTANCE: bool = true;
    impl_default_node!();
}
impl TextNode for DynamicText {
    text_node_base!();
    fn can_insert_text_before(&self, _: TextView<'_>) -> bool {
        INLINE_CALLS.with(|calls| calls.borrow_mut().push(99));
        false
    }
}

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct DynamicLineBreak {}
impl NodeType for DynamicLineBreak {
    const TYPE: &'static str = "cache-dynamic-linebreak";
    type Kind = LineBreakKind;
    const FLAGS_PER_INSTANCE: bool = true;
    impl_default_node!();
}
impl LineBreakNode for DynamicLineBreak {
    line_break_node_base!();
}

#[test]
fn raw_text_and_linebreak_reads_do_not_invoke_per_instance_predicates() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<DynamicText>()
        .node::<DynamicLineBreak>()
        .build()
        .expect("editor");
    let (paragraph, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create(DynamicText {})?;
        tx.text(text)?.set_text_content("A")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(paragraph.key())
    })?;
    let mut tx = editor.transaction();
    let line = tx.create(DynamicLineBreak {})?;
    tx.append(paragraph, &[line.key()])?;
    INLINE_CALLS.with(|calls| calls.borrow_mut().clear());
    assert!(super::root_text_changed(&tx));
    INLINE_CALLS.with(|calls| assert!(calls.borrow().is_empty()));
    assert!(
        tx.pending.root_text.get().is_none(),
        "raw leaf flag metadata is not an Element hook"
    );
    assert_eq!(tx.text_content(NodeKey::ROOT), "A\n");
    Ok(())
}

#[test]
fn native_root_cache_read_through_survives_a_format_only_followup() -> Result<(), Error> {
    for warm in [false, true] {
        let mut editor = Editor::builder(EditorMode::ViewAttached)
            .build()
            .expect("editor");
        let (text, _) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("hello world")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(text.key())
        })?;
        let (_, split) = editor.update(|tx| {
            tx.text(text)?
                .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
            tx.insert_paragraph()
        })?;
        let saved = split.next.clone();
        if warm {
            assert_eq!(saved.root_text_content().as_ref(), "hello\n\n world");
        }
        editor.update(|tx| {
            tx.text(text)?.set_format(TextFormat::BOLD)?;
            Ok(())
        })?;
        assert_eq!(
            editor.state().view().foreign_root_cached_text()?.as_deref(),
            Some("hello\n\n world")
        );
        assert_eq!(
            saved.view().foreign_root_cached_text()?.as_deref(),
            Some("hello\n\n world")
        );
        assert_eq!(
            editor.state().root_text_content().as_ref(),
            "hello\n\n world"
        );
    }
    Ok(())
}

#[test]
fn old_capture_is_readable_before_source_after_split_and_format() -> Result<(), Error> {
    for warm in [false, true] {
        let mut editor = Editor::builder(EditorMode::ViewAttached)
            .build()
            .expect("editor");
        let (text, _) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("hello world")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(text.key())
        })?;
        let (_, split) = editor.update(|tx| {
            tx.text(text)?
                .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
            tx.insert_paragraph()
        })?;
        let saved = split.next.clone();
        if warm {
            assert_eq!(saved.root_text_content().as_ref(), "hello\n\n world");
        }
        // Capture before any cached-text read in the cold arm. Its own read memo
        // stays independent; the root's exact source cache must still be readable.
        let capture = saved.view().snapshot_for_foreign_read()?;
        assert!(!Arc::ptr_eq(
            &saved.root_text,
            &capture.view().state.root_text
        ));
        editor.update(|tx| {
            tx.text(text)?.set_format(TextFormat::BOLD)?;
            Ok(())
        })?;
        assert_eq!(
            capture.view().foreign_root_cached_text()?.as_deref(),
            Some("hello\n\n world")
        );
        assert_eq!(
            saved.view().foreign_root_cached_text()?.as_deref(),
            Some("hello\n\n world")
        );
        assert_eq!(
            editor.state().view().foreign_root_cached_text()?.as_deref(),
            Some("hello\n\n world")
        );
        editor.update(|tx| {
            tx.text(text)?.set_text_content("HELLO")?;
            Ok(())
        })?;
        assert_eq!(
            editor.state().view().foreign_root_cached_text()?.as_deref(),
            Some("HELLO\n\n world")
        );
        assert_eq!(
            capture.view().foreign_root_cached_text()?.as_deref(),
            Some("hello\n\n world")
        );
        assert_eq!(
            saved.view().foreign_root_cached_text()?.as_deref(),
            Some("hello\n\n world")
        );
    }
    Ok(())
}

#[test]
fn failed_native_read_scope_does_not_reuse_pending_memo() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("child")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(text.key())
    })?;
    let mut tx = editor.transaction();
    tx.text(text)?.set_format(TextFormat::BOLD)?;
    let pending_memo = tx.pending.root_text.clone();
    assert!(!Arc::ptr_eq(&pending_memo, &tx.editor.state.root_text));
    let operation = ForeignReadOperation::begin()?;
    ForeignReadOperation::defer(Error::Invariant("actual failed read scope"))?;
    super::apply(&mut tx)?;
    assert!(Arc::ptr_eq(&pending_memo, &tx.pending.root_text));
    assert!(tx.pending.root_text.get().is_none());
    let result: Result<(), Error> = operation.finish(Ok(()));
    assert!(matches!(result, Err(Error::ForeignReadFailed(_))));
    Ok(())
}

#[test]
fn failed_native_capture_does_not_materialize_the_source_memo() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("editor");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("child")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(())
    })?;
    assert!(editor.state().root_text.get().is_none());
    let operation = ForeignReadOperation::begin()?;
    ForeignReadOperation::defer(Error::Invariant("failed native capture"))?;
    let _capture = editor.state().view().snapshot_for_foreign_read();
    assert!(editor.state().root_text.get().is_none());
    let result: Result<(), Error> = operation.finish(Ok(()));
    assert!(matches!(result, Err(Error::ForeignReadFailed(_))));
    Ok(())
}

struct TextHooks;
impl ForeignHooks for TextHooks {
    fn can_insert_text_before(&self, _: NodeView<'_>, _: &ForeignData) -> Override<bool> {
        INLINE_CALLS.with(|calls| calls.borrow_mut().push(99));
        Override::Value(false)
    }
}

#[test]
fn overlay_capture_keeps_existing_no_host_materialization_policy() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .foreign_native_hooks("text", Arc::new(TextHooks))
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(text.key())
    })?;
    editor.update(|tx| {
        tx.text(text)?.set_text_content("after")?;
        Ok(())
    })?;
    assert!(!editor.state.registry.native_overlays.is_empty());
    assert!(editor.state().root_text.get().is_none());
    INLINE_CALLS.with(|calls| calls.borrow_mut().clear());
    let capture = editor.state().view().snapshot_for_foreign_read()?;
    INLINE_CALLS.with(|calls| assert!(calls.borrow().is_empty()));
    assert!(editor.state().root_text.get().is_none());
    assert!(capture.view().state.root_text.get().is_none());
    Ok(())
}
