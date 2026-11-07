use super::*;
use crate::heading::{HeadingNode, HeadingTagType};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct InlineDecorator {}
impl NodeType for InlineDecorator {
    const TYPE: &'static str = "inline-test";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for InlineDecorator {
    decorator_node_base!();
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
}

// Upstream RichTextInlineDecoratorMoveToStart.test.ts.
#[test]
fn inline_decorator_start_paragraph() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<HeadingNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let block = tx.create(Paragraph {})?;
    let decorator = tx.create(InlineDecorator {})?;
    let text = tx.create_text("hello")?;
    tx.append(block, &[decorator.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[block.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
    assert_eq!(move_to_start(&mut tx, false)?, ArrowOutcome::Handled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::element(block, ChildIndex(0))
    );
    assert_eq!(
        tx.range_selection()?.focus,
        Point::element(block, ChildIndex(0))
    );
    Ok(())
}

// Upstream RichTextInlineDecoratorMoveToStart.test.ts.
#[test]
fn inline_decorator_shift_start_paragraph() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<HeadingNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let block = tx.create(Paragraph {})?;
    let decorator = tx.create(InlineDecorator {})?;
    let text = tx.create_text("hello")?;
    tx.append(block, &[decorator.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[block.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
    assert_eq!(move_to_start(&mut tx, true)?, ArrowOutcome::Handled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(text, Utf16Offset(5))
    );
    assert_eq!(
        tx.range_selection()?.focus,
        Point::element(block, ChildIndex(0))
    );
    Ok(())
}

// Upstream RichTextInlineDecoratorMoveToStart.test.ts.
#[test]
fn inline_decorator_start_heading() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<HeadingNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let block = tx.create(HeadingNode {
        tag: HeadingTagType::H2,
    })?;
    let decorator = tx.create(InlineDecorator {})?;
    let text = tx.create_text("hello")?;
    tx.append(block, &[decorator.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[block.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
    assert_eq!(move_to_start(&mut tx, false)?, ArrowOutcome::Handled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::element(block, ChildIndex(0))
    );
    assert_eq!(
        tx.range_selection()?.focus,
        Point::element(block, ChildIndex(0))
    );
    Ok(())
}

// Upstream RichTextInlineDecoratorMoveToEnd.test.ts.
#[test]
fn inline_decorator_end_paragraph() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<HeadingNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let block = tx.create(Paragraph {})?;
    let decorator = tx.create(InlineDecorator {})?;
    let text = tx.create_text("hello")?;
    tx.append(block, &[decorator.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[block.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(block, ChildIndex(0)),
    ))))?;
    assert_eq!(move_to_end(&mut tx, false)?, ArrowOutcome::Handled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(text, Utf16Offset(5))
    );
    assert_eq!(
        tx.range_selection()?.focus,
        Point::text(text, Utf16Offset(5))
    );
    Ok(())
}

// Upstream RichTextInlineDecoratorMoveToEnd.test.ts.
#[test]
fn inline_decorator_shift_end_paragraph() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<HeadingNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let block = tx.create(Paragraph {})?;
    let decorator = tx.create(InlineDecorator {})?;
    let text = tx.create_text("hello")?;
    tx.append(block, &[decorator.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[block.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(block, ChildIndex(0)),
    ))))?;
    assert_eq!(move_to_end(&mut tx, true)?, ArrowOutcome::Handled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::element(block, ChildIndex(0))
    );
    assert_eq!(
        tx.range_selection()?.focus,
        Point::text(text, Utf16Offset(5))
    );
    Ok(())
}

// Upstream RichTextInlineDecoratorMoveToEnd.test.ts.
#[test]
fn inline_decorator_end_heading() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<HeadingNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let block = tx.create(HeadingNode {
        tag: HeadingTagType::H2,
    })?;
    let decorator = tx.create(InlineDecorator {})?;
    let text = tx.create_text("hello")?;
    tx.append(block, &[decorator.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[block.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(block, ChildIndex(0)),
    ))))?;
    assert_eq!(move_to_end(&mut tx, false)?, ArrowOutcome::Handled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(text, Utf16Offset(5))
    );
    assert_eq!(
        tx.range_selection()?.focus,
        Point::text(text, Utf16Offset(5))
    );
    Ok(())
}

#[test]
fn decorator_only_move_to_start_false_falls_through() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let d = tx.create(InlineDecorator {})?;
    tx.append(p, &[d.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(p, ChildIndex(0)),
    ))))?;
    assert_eq!(move_to_start(&mut tx, false)?, ArrowOutcome::NotHandled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::element(p, ChildIndex(0))
    );
    Ok(())
}

#[test]
fn decorator_only_move_to_end_false_falls_through() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let d = tx.create(InlineDecorator {})?;
    tx.append(p, &[d.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(p, ChildIndex(0)),
    ))))?;
    assert_eq!(move_to_end(&mut tx, false)?, ArrowOutcome::NotHandled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::element(p, ChildIndex(0))
    );
    Ok(())
}

#[test]
fn decorator_only_move_to_end_true_falls_through() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let d = tx.create(InlineDecorator {})?;
    tx.append(p, &[d.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(p, ChildIndex(0)),
    ))))?;
    assert_eq!(move_to_end(&mut tx, true)?, ArrowOutcome::NotHandled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::element(p, ChildIndex(0))
    );
    Ok(())
}
#[test]
fn move_to_start_cross_block_selection_is_unhandled() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph {})?;
    let b = tx.create(Paragraph {})?;
    let before = tx.create_text("before")?;
    let text = tx.create_text("hello")?;
    let d = tx.create(InlineDecorator {})?;
    tx.append(a, &[before.key()])?;
    tx.append(b, &[d.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(before, Utf16Offset(0)),
        Point::text(text, Utf16Offset(5)),
    ))))?;
    assert_eq!(move_to_start(&mut tx, false)?, ArrowOutcome::NotHandled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(before, Utf16Offset(0))
    );
    Ok(())
}
#[test]
fn move_to_start_at_element_start_is_unhandled() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let d = tx.create(InlineDecorator {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[d.key(), t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(p, ChildIndex(0)),
    ))))?;
    assert_eq!(move_to_start(&mut tx, false)?, ArrowOutcome::NotHandled);
    Ok(())
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct BlockDecorator {}
impl NodeType for BlockDecorator {
    const TYPE: &'static str = "block-test";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for BlockDecorator {
    decorator_node_base!();
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
}
#[test]
fn vertical_arrows_move_around_adjacent_block_decorator() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph {})?;
    let b = tx.create(Paragraph {})?;
    let d = tx.create(BlockDecorator {})?;
    let first = tx.create_text("first")?;
    let last = tx.create_text("last")?;
    tx.append(a, &[first.key()])?;
    tx.append(b, &[last.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), d.key(), b.key()])?;
    tx.select_start(last)?;
    assert_eq!(arrow_up(&mut tx, true)?, ArrowOutcome::NotHandled);
    assert_eq!(arrow_up(&mut tx, false)?, ArrowOutcome::Handled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(first, Utf16Offset(5))
    );
    assert_eq!(arrow_down(&mut tx, false)?, ArrowOutcome::Handled);
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(last, Utf16Offset(0))
    );
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(first, Utf16Offset(0)),
        Point::element(NodeKey::ROOT, ChildIndex(3)),
    ))))?;
    assert_eq!(arrow_down(&mut tx, true)?, ArrowOutcome::Handled);
    Ok(())
}
#[test]
fn node_selection_arrows_honor_horizontal_rtl_and_vertical_direction() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph {})?;
    let b = tx.create(Paragraph {})?;
    let d = tx.create(BlockDecorator {})?;
    let first = tx.create_text("first")?;
    let last = tx.create_text("last")?;
    tx.append(a, &[first.key()])?;
    tx.append(b, &[last.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), d.key(), b.key()])?;
    let mut nodes = NodeSelection::new();
    nodes.add(d);
    tx.set_selection(Some(Selection::Node(nodes.clone())))?;
    assert_eq!(arrow_up(&mut tx, false)?, ArrowOutcome::Handled);
    assert_eq!(tx.anchor()?, Point::text(first, Utf16Offset(5)));
    tx.set_selection(Some(Selection::Node(nodes.clone())))?;
    assert_eq!(arrow_down(&mut tx, false)?, ArrowOutcome::Handled);
    assert_eq!(tx.anchor()?, Point::text(last, Utf16Offset(0)));
    tx.set_selection(Some(Selection::Node(nodes.clone())))?;
    assert_eq!(
        arrow_left(&mut tx, false, true, &EscapeFormatTriggerConfig::default())?,
        ArrowOutcome::Handled
    );
    assert_eq!(tx.anchor()?, Point::text(last, Utf16Offset(0)));
    tx.set_selection(Some(Selection::Node(nodes)))?;
    assert_eq!(
        arrow_right(&mut tx, false, true, &EscapeFormatTriggerConfig::default())?,
        ArrowOutcome::Handled
    );
    assert_eq!(tx.anchor()?, Point::text(first, Utf16Offset(5)));
    Ok(())
}
#[test]
fn backspace_routes_only_at_collapsed_front_of_indented_block() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    assert_eq!(backspace_action(&tx), BackspaceAction::NotHandled);
    assert!(!delete_key_applies(&tx));
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_indent(p, 2)?;
    tx.select_start(t)?;
    assert_eq!(backspace_action(&tx), BackspaceAction::Outdent);
    assert!(delete_key_applies(&tx));
    tx.text(t)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    assert_eq!(backspace_action(&tx), BackspaceAction::DeleteCharacter);
    let mut nodes = NodeSelection::new();
    nodes.add(p);
    tx.set_selection(Some(Selection::Node(nodes)))?;
    assert_eq!(backspace_action(&tx), BackspaceAction::DeleteCharacter);
    assert!(delete_key_applies(&tx));
    Ok(())
}

#[test]
fn upstream_noop_start_plain_text() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("plain")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
    let before = tx.range_selection()?.clone();
    assert_eq!(move_to_start(&mut tx, false)?, ArrowOutcome::NotHandled);
    assert_eq!(tx.range_selection()?, &before);
    Ok(())
}

#[test]
fn upstream_noop_start_block_decorator() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let decorator = tx.create(BlockDecorator {})?;
    let text = tx.create_text("after")?;
    tx.append(p, &[decorator.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    let before = tx.range_selection()?.clone();
    assert_eq!(move_to_start(&mut tx, false)?, ArrowOutcome::NotHandled);
    assert_eq!(tx.range_selection()?, &before);
    Ok(())
}

#[test]
fn upstream_noop_start_decorator_only_at_one() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let decorator = tx.create(InlineDecorator {})?;
    tx.append(p, &[decorator.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(p, ChildIndex(1)),
    ))))?;
    let before = tx.range_selection()?.clone();
    assert_eq!(move_to_start(&mut tx, false)?, ArrowOutcome::NotHandled);
    assert_eq!(tx.range_selection()?, &before);
    Ok(())
}

#[test]
fn upstream_noop_end_plain_text() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("plain")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(p, ChildIndex(0)),
    ))))?;
    let before = tx.range_selection()?.clone();
    assert_eq!(move_to_end(&mut tx, false)?, ArrowOutcome::NotHandled);
    assert_eq!(tx.range_selection()?, &before);
    Ok(())
}

#[test]
fn upstream_noop_end_block_decorator() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let decorator = tx.create(BlockDecorator {})?;
    let text = tx.create_text("after")?;
    tx.append(p, &[decorator.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(p, ChildIndex(0)),
    ))))?;
    let before = tx.range_selection()?.clone();
    assert_eq!(move_to_end(&mut tx, false)?, ArrowOutcome::NotHandled);
    assert_eq!(tx.range_selection()?, &before);
    Ok(())
}

#[test]
fn upstream_noop_end_past_element_zero() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let decorator = tx.create(InlineDecorator {})?;
    let text = tx.create_text("hello")?;
    tx.append(p, &[decorator.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(p, ChildIndex(1)),
    ))))?;
    let before = tx.range_selection()?.clone();
    assert_eq!(move_to_end(&mut tx, false)?, ArrowOutcome::NotHandled);
    assert_eq!(tx.range_selection()?, &before);
    Ok(())
}
