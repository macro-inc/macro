use crate::*;
#[test]
fn headless_character_movement_does_not_invent_layout() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("words")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(2)),
    ))))?;
    tx.modify_selection(
        Alter::Extend,
        EditDirection::Forward,
        Granularity::Character,
        ModifyTarget::NoView,
    )?;
    assert_eq!(tx.focus()?, Point::text(t, Utf16Offset(2)));
    tx.delete_character(EditDirection::Forward, ModifyTarget::NoView)?;
    assert_eq!(tx.text_content(t), "words");
    Ok(())
}
#[test]
fn word_deletion_uses_distinct_character_fallback_target() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("abc")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(1)),
    ))))?;
    tx.delete_word(
        EditDirection::Forward,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(1)),
            focus: Point::text(t, Utf16Offset(1)),
            resolution_dirty: false,
            is_backward_in_dom: false,
        },
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(1)),
            focus: Point::text(t, Utf16Offset(2)),
            resolution_dirty: false,
            is_backward_in_dom: false,
        },
    )?;
    assert_eq!(tx.text_content(t), "ac");
    assert_eq!(tx.anchor()?, Point::text(t, Utf16Offset(1)));
    Ok(())
}
#[test]
fn character_deletion_expands_a_split_surrogate_target() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("a😀b")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(3)),
    ))))?;
    tx.delete_character(
        EditDirection::Backward,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(2)),
            focus: Point::text(t, Utf16Offset(3)),
            resolution_dirty: false,
            is_backward_in_dom: true,
        },
    )?;
    assert_eq!(tx.text_content(t), "ab");
    assert_eq!(tx.anchor()?, Point::text(t, Utf16Offset(1)));
    Ok(())
}
#[cfg(feature = "model-segmentation")]
#[test]
fn model_segmentation_removes_an_extended_grapheme_cluster() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("e\u{301}x")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(2)),
    ))))?;
    tx.delete_character(EditDirection::Backward, ModifyTarget::ModelSegmentation)?;
    assert_eq!(tx.text_content(t), "x");
    assert!(matches!(
        tx.modify_selection(
            Alter::Move,
            EditDirection::Forward,
            Granularity::LineBoundary,
            ModifyTarget::ModelSegmentation
        ),
        Err(Error::LayoutRequired)
    ));
    Ok(())
}
#[test]
fn segmented_last_word_deletion_trims_and_selects_the_end() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("one two")?;
    tx.text(t)?.set_mode(TextMode::Segmented)?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(7)),
    ))))?;
    tx.delete_character(
        EditDirection::Backward,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(6)),
            focus: Point::text(t, Utf16Offset(7)),
            resolution_dirty: false,
            is_backward_in_dom: true,
        },
    )?;
    assert_eq!(tx.text_content(t), "one");
    assert_eq!(tx.anchor()?, Point::text(t, Utf16Offset(3)));
    Ok(())
}
#[test]
fn backward_view_range_swaps_host_range_endpoints() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("abc")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(2)),
    ))))?;
    tx.modify_selection(
        Alter::Extend,
        EditDirection::Backward,
        Granularity::Character,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(0)),
            focus: Point::text(t, Utf16Offset(2)),
            resolution_dirty: false,
            is_backward_in_dom: true,
        },
    )?;
    assert_eq!(tx.anchor()?, Point::text(t, Utf16Offset(2)));
    assert_eq!(tx.focus()?, Point::text(t, Utf16Offset(0)));
    Ok(())
}
#[test]
fn view_grapheme_deletion_shrinks_non_emoji_to_one_code_unit() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("e\u{301}")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(2)),
    ))))?;
    tx.delete_character(
        EditDirection::Backward,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(0)),
            focus: Point::text(t, Utf16Offset(2)),
            resolution_dirty: false,
            is_backward_in_dom: true,
        },
    )?;
    assert_eq!(tx.text_content(t), "e");
    assert_eq!(tx.anchor()?, Point::text(t, Utf16Offset(1)));
    Ok(())
}
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct Shadow {}
impl NodeType for Shadow {
    const TYPE: &'static str = "shadow";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for Shadow {
    element_node_base!();
    fn is_shadow_root(&self, _: ElementView<'_>) -> bool {
        true
    }
}
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct BlockDecorator {}
impl NodeType for BlockDecorator {
    const TYPE: &'static str = "block-decorator";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for BlockDecorator {
    decorator_node_base!();
}
#[test]
fn forward_delete_cannot_cross_into_adjacent_shadow_root() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Shadow>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("abc")?;
    let shadow = tx.create(Shadow {})?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key(), shadow.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(3)),
    ))))?;
    assert!(
        tx.range_selection()?
            .forward_deletion(tx.view(), EditDirection::Forward)?
    );
    tx.delete_character(EditDirection::Forward, ModifyTarget::NoView)?;
    assert!(tx.is_attached(shadow));
    assert_eq!(tx.text_content(t), "abc");
    Ok(())
}
#[test]
fn deleting_next_to_block_decorator_selects_it_and_removes_empty_paragraph() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<BlockDecorator>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let d = tx.create(BlockDecorator {})?;
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[d.key(), p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(p, ChildIndex(0)),
    ))))?;
    tx.delete_character(EditDirection::Backward, ModifyTarget::NoView)?;
    assert!(tx.is_attached(d));
    assert!(!tx.is_attached(p));
    assert!(
        tx.selection_at(SelectionSlot::Active)?
            .and_then(Selection::as_node)
            .expect("node selection")
            .has(d)
    );
    Ok(())
}
#[test]
fn backward_host_extension_stays_inside_shadow_root() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Shadow>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let outer = tx.create_text("out")?;
    let shadow = tx.create(Shadow {})?;
    let inner = tx.create_text("in")?;
    tx.append(p, &[outer.key()])?;
    tx.append(shadow, &[inner.key()])?;
    tx.append(NodeKey::ROOT, &[p.key(), shadow.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(inner, Utf16Offset(1)),
    ))))?;
    tx.modify_selection(
        Alter::Extend,
        EditDirection::Backward,
        Granularity::Word,
        ModifyTarget::View {
            anchor: Point::text(outer, Utf16Offset(0)),
            focus: Point::text(inner, Utf16Offset(1)),
            resolution_dirty: false,
            is_backward_in_dom: true,
        },
    )?;
    assert_eq!(tx.anchor()?, Point::text(inner, Utf16Offset(1)));
    assert_eq!(tx.focus()?, Point::text(inner, Utf16Offset(0)));
    Ok(())
}
#[test]
fn segmented_bom_separator_follows_ecmascript_whitespace() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("one\u{feff}two")?;
    tx.text(t)?.set_mode(TextMode::Segmented)?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(7)),
    ))))?;
    tx.delete_character(
        EditDirection::Backward,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(6)),
            focus: Point::text(t, Utf16Offset(7)),
            resolution_dirty: false,
            is_backward_in_dom: true,
        },
    )?;
    assert_eq!(tx.text_content(t), "one");
    Ok(())
}

#[test]
fn explicit_slot_word_and_line_deletion_use_host_ranges() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("one two three")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        t,
        Utf16Offset(0),
    ))));
    tx.modify_selection_at(
        slot,
        Alter::Move,
        EditDirection::Forward,
        Granularity::Character,
        ModifyTarget::NoView,
    )?;
    assert_eq!(tx.focus_at(slot)?, Point::text(t, Utf16Offset(0)));
    tx.delete_word_at(
        slot,
        EditDirection::Forward,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(0)),
            focus: Point::text(t, Utf16Offset(4)),
            resolution_dirty: false,
            is_backward_in_dom: false,
        },
        ModifyTarget::NoView,
    )?;
    assert_eq!(tx.text_content(t), "two three");
    assert!(tx.selection().is_none());
    tx.delete_character_at(
        slot,
        EditDirection::Forward,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(0)),
            focus: Point::text(t, Utf16Offset(1)),
            resolution_dirty: false,
            is_backward_in_dom: false,
        },
    )?;
    assert_eq!(tx.text_content(t), "wo three");
    tx.delete_line_at(
        slot,
        EditDirection::Forward,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(0)),
            focus: Point::text(t, Utf16Offset(3)),
            resolution_dirty: false,
            is_backward_in_dom: false,
        },
        ModifyTarget::NoView,
    )?;
    assert_eq!(tx.text_content(t), "three");
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(2)),
    ))))?;
    tx.delete_line(
        EditDirection::Backward,
        ModifyTarget::View {
            anchor: Point::text(t, Utf16Offset(2)),
            focus: Point::text(t, Utf16Offset(0)),
            resolution_dirty: false,
            is_backward_in_dom: true,
        },
        ModifyTarget::NoView,
    )?;
    assert_eq!(tx.text_content(t), "ree");
    Ok(())
}

#[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct InlineDecorator {}
impl NodeType for InlineDecorator {
    const TYPE: &'static str = "inline-decorator";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for InlineDecorator {
    decorator_node_base!();
    fn is_inline(&self, _: NodeView<'_>) -> bool {
        true
    }
}

#[test]
fn line_boundary_continues_to_host_after_an_inline_decorator() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("a")?;
    let decorator = tx.create(InlineDecorator::default())?;
    let b = tx.create_text("b")?;
    tx.append(p, &[a.key(), decorator.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(a, Utf16Offset(1)),
    ))))?;
    tx.modify_selection(
        Alter::Move,
        EditDirection::Forward,
        Granularity::LineBoundary,
        ModifyTarget::View {
            anchor: Point::text(b, Utf16Offset(1)),
            focus: Point::text(b, Utf16Offset(1)),
            resolution_dirty: false,
            is_backward_in_dom: false,
        },
    )?;
    assert_eq!(tx.anchor()?, Point::text(b, Utf16Offset(1)));
    assert_eq!(tx.focus()?, Point::text(b, Utf16Offset(1)));
    Ok(())
}

#[test]
fn forward_delete_at_segmented_end_removes_last_segment_and_restores_selection() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let segmented = tx.create_text("a")?;
    let tail = tx.create_text("tail")?;
    tx.text(segmented)?.set_mode(TextMode::Segmented)?;
    tx.append(paragraph, &[segmented.key(), tail.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.select_start(segmented)?;
    tx.delete_character(
        EditDirection::Forward,
        ModifyTarget::View {
            anchor: Point::text(segmented, Utf16Offset(0)),
            focus: Point::text(segmented, Utf16Offset(1)),
            resolution_dirty: false,
            is_backward_in_dom: false,
        },
    )?;
    assert_eq!(tx.children_keys(paragraph)?, vec![tail.key()]);
    let range = tx.selection().and_then(Selection::as_range).expect("range");
    assert_eq!(range.anchor, Point::text(tail, Utf16Offset(0)));
    assert_eq!(range.focus, range.anchor);
    Ok(())
}

#[test]
fn no_view_movement_does_not_enter_a_direct_child_block() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let outer = tx.create(Paragraph::default())?;
    let inner = tx.create(Paragraph::default())?;
    tx.append(outer, &[inner.key()])?;
    tx.append(NodeKey::ROOT, &[outer.key()])?;
    let point = Point::element(outer, ChildIndex(0));
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(point))))?;
    tx.delete_word(
        EditDirection::Forward,
        ModifyTarget::NoView,
        ModifyTarget::NoView,
    )?;
    assert_eq!(tx.anchor()?, point);
    assert_eq!(tx.focus()?, point);
    Ok(())
}

#[test]
fn collapsed_node_reads_choose_the_inline_element_beyond_a_break() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let line = tx.create(LineBreak {})?;
    let inline = tx.create(Inline {})?;
    let text = tx.create_text("a")?;
    tx.append(inline, &[text.key()])?;
    tx.append(paragraph, &[line.key(), inline.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    let range = RangeSelection::collapsed(Point::element(paragraph, ChildIndex(1)));
    assert_eq!(range.nodes(tx.view())?, vec![inline.key()]);
    Ok(())
}

#[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Inline {}
impl NodeType for Inline {
    const TYPE: &'static str = "inline-element";
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
fn text_selection_and_caret_reads_allow_surrogate_interiors_but_edits_reject_them()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("a😀b")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    let range = tx.range_selection()?;
    let caret = caret_from_point(tx.view(), &range.anchor, CaretDirection::Next)?;
    assert_eq!(
        point_from_caret(tx.view(), &caret)?,
        Point::text(text, Utf16Offset(2))
    );
    assert_eq!(range.nodes(tx.view())?, vec![text.key()]);
    assert_eq!(
        tx.character_offsets(&Selection::Range(range.clone()))?,
        (Utf16Offset(2), Utf16Offset(2))
    );
    assert!(tx.insert_text("x").is_err());
    assert_eq!(tx.text_content(text), "a😀b");
    Ok(())
}

#[test]
fn collapsing_an_empty_paragraph_selects_its_sibling_element() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let empty = tx.create(Paragraph::default())?;
    let next = tx.create(Paragraph::default())?;
    let inline = tx.create(Inline {})?;
    let text = tx.create_text("link")?;
    tx.append(inline, &[text.key()])?;
    tx.append(next, &[inline.key()])?;
    tx.append(NodeKey::ROOT, &[empty.key(), next.key()])?;
    tx.select_start(empty)?;
    tx.delete_character(EditDirection::Backward, ModifyTarget::NoView)?;
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![next.key()]);
    assert_eq!(tx.anchor()?, Point::element(next, ChildIndex(0)));
    assert_eq!(tx.focus()?, Point::element(next, ChildIndex(0)));
    Ok(())
}

#[test]
fn raw_splice_preserves_parent_offsets_while_sibling_insertion_adjusts_them() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let parent = tx.create(Paragraph::default())?;
    let a = tx.create(Paragraph::default())?;
    let b = tx.create(Paragraph::default())?;
    let c = tx.create(Paragraph::default())?;
    tx.append(parent, &[a.key(), b.key(), c.key()])?;
    tx.append(NodeKey::ROOT, &[parent.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(parent, ChildIndex(2)),
    ))))?;
    let inserted = tx.create(Paragraph::default())?;
    tx.splice(parent, ChildIndex(0), 0, &[inserted.key()])?;
    assert_eq!(tx.anchor()?, Point::element(parent, ChildIndex(2)));
    tx.splice(parent, ChildIndex(0), 1, &[])?;
    assert_eq!(tx.anchor()?, Point::element(parent, ChildIndex(2)));
    tx.insert_before(c, inserted, true)?;
    assert_eq!(tx.anchor()?, Point::element(parent, ChildIndex(3)));
    Ok(())
}

#[test]
fn raw_splice_relocates_a_removed_descendant_after_a_line_break() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let line = tx.create(LineBreak {})?;
    let inline = tx.create(Inline {})?;
    let text = tx.create_text("a")?;
    tx.append(inline, &[text.key()])?;
    tx.append(paragraph, &[line.key(), inline.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.select_start(text)?;
    tx.splice(paragraph, ChildIndex(1), 1, &[])?;
    assert_eq!(tx.anchor()?, Point::element(paragraph, ChildIndex(0)));
    assert_eq!(tx.focus()?, Point::element(paragraph, ChildIndex(0)));
    Ok(())
}
