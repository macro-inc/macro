use crate::*;
// LexicalSelection.test.ts: inserts into existing paragraph when selection is on its parent.
#[test]
fn root_offset_insertion_reuses_existing_paragraph() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))?;
    tx.insert_text("text")?;
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![p.key()]);
    assert_eq!(tx.text_content(NodeKey::ROOT), "text");
    Ok(())
}
#[test]
fn replacing_formatted_text_preserves_original_node_and_format() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("hello")?;
    tx.text(text)?.set_format(TextFormat::BOLD)?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(text, Utf16Offset(0)),
        Point::text(text, Utf16Offset(5)),
    ))))?;
    tx.insert_text("updated")?;
    assert_eq!(tx.children_keys(p)?, vec![text.key()]);
    assert_eq!(tx.text_content(text), "updated");
    assert_eq!(tx.view().text_data(text)?.format, TextFormat::BOLD);
    assert_eq!(tx.anchor()?, Point::text(text, Utf16Offset(7)));
    Ok(())
}
// LexicalSelection.test.ts: extract a substring of a single TextNode.
#[test]
fn extract_partial_text_returns_ragrap_and_moves_endpoints() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("paragraph")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(text, Utf16Offset(2)),
        Point::text(text, Utf16Offset(8)),
    ))))?;
    let extracted = tx.extract()?;
    assert_eq!(extracted.len(), 1);
    assert_eq!(tx.text_content(extracted[0]), "ragrap");
    assert_eq!(tx.anchor()?, Point::text(extracted[0], Utf16Offset(0)));
    assert_eq!(tx.focus()?, Point::text(extracted[0], Utf16Offset(6)));
    Ok(())
}
#[test]
fn paragraph_insertion_splits_text_and_preserves_trailing_text() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("hello world")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(text, Utf16Offset(5)),
    ))))?;
    let next = tx.insert_paragraph()?.expect("next paragraph");
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![p.key(), next]);
    assert_eq!(tx.text_content(p), "hello");
    assert_eq!(tx.text_content(next), " world");
    assert_eq!(tx.anchor()?.offset(), 0);
    Ok(())
}
#[test]
fn raw_text_inserts_tabs_and_line_breaks_as_nodes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))?;
    tx.insert_raw_text("a\tb\nc")?;
    assert_eq!(tx.text_content(NodeKey::ROOT), "a\tb\nc");
    let p = tx.first_child_or_err(NodeKey::ROOT)?;
    let nodes = tx.children_keys(p)?;
    assert!(tx.is::<Tab>(nodes[1]));
    assert!(tx.is::<LineBreak>(nodes[3]));
    Ok(())
}
#[test]
fn replacing_multiple_formats_keeps_first_text_bold() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let first = tx.create_text("hello")?;
    let last = tx.create_text(" world!")?;
    tx.text(first)?.set_format(TextFormat::BOLD)?;
    tx.append(p, &[first.key(), last.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_all(None)?;
    tx.insert_text("hello")?;
    let child = tx.first_child_or_err(p)?;
    assert_eq!(tx.text_content(child), "hello");
    assert!(tx.view().text_data(child)?.has_format(TextFormatType::Bold));
    Ok(())
}
#[test]
fn inserting_two_blocks_over_empty_and_full_paragraphs_preserves_inserted_keys() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let empty = tx.create(Paragraph::default())?;
    let replaced = tx.create(Paragraph::default())?;
    let text = tx.create_text("replaced!")?;
    tx.append(replaced, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[empty.key(), replaced.key()])?;
    tx.select_all(None)?;
    let a = tx.create(Paragraph::default())?;
    let b = tx.create(Paragraph::default())?;
    let at = tx.create_text("p1")?;
    let bt = tx.create_text("p2")?;
    tx.append(a, &[at.key()])?;
    tx.append(b, &[bt.key()])?;
    tx.insert_nodes(&[a.key(), b.key()])?;
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![a.key(), b.key()]);
    Ok(())
}
// lexical-selection/LexicalSelectionHelpers.test.ts: two text nodes into an empty paragraph.
#[test]
fn helper_two_text_nodes_insert_into_empty_paragraph() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (p, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::element(p, ChildIndex(0)),
        ))))?;
        let a = tx.create_text("foo")?;
        let b = tx.create_text("bar")?;
        tx.insert_nodes(&[a.key(), b.key()])?;
        Ok(p)
    })?;
    assert_eq!(editor.state().view().text_content(p), "foobar");
    assert_eq!(editor.state().view().children_size(p), 1);
    Ok(())
}
// lexical-selection/LexicalSelectionHelpers.test.ts: can insert when before empty text node.
#[test]
fn helper_insertion_before_empty_text_keeps_following_content() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let empty = tx.create_text("")?;
    let text = tx.create_text("text")?;
    tx.append(p, &[empty.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(empty, Utf16Offset(0)),
    ))))?;
    let foo = tx.create_text("foo")?;
    tx.insert_nodes_at_selection(&[foo.key()])?;
    assert_eq!(tx.text_content(NodeKey::ROOT), "footext");
    Ok(())
}
#[test]
fn insertion_inside_token_replaces_the_entire_token() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let token = tx.create_text("token")?;
    tx.text(token)?.set_mode(TextMode::Token)?;
    tx.append(p, &[token.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(token, Utf16Offset(2)),
    ))))?;
    tx.insert_text("X")?;
    assert!(!tx.is_attached(token));
    let text = tx.first_child_or_err(p)?;
    assert_eq!(tx.text_content(text), "X");
    assert_eq!(tx.view().text_data(text)?.mode, TextMode::Normal);
    assert_eq!(tx.anchor()?, Point::text(text, Utf16Offset(1)));
    Ok(())
}
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct ProtectedInline {}
impl NodeType for ProtectedInline {
    const TYPE: &'static str = "protected-inline";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for ProtectedInline {
    element_node_base!();
    fn is_inline(&self, _: ElementView<'_>) -> bool {
        true
    }
    fn can_insert_text_before(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn can_insert_text_after(&self, _: ElementView<'_>) -> bool {
        false
    }
}
#[test]
fn inserting_before_protected_inline_places_text_outside_parent() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<ProtectedInline>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let inline = tx.create(ProtectedInline {})?;
    let t = tx.create_text("inside")?;
    tx.append(inline, &[t.key()])?;
    tx.append(p, &[inline.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(0)),
    ))))?;
    tx.insert_text("before")?;
    let first = tx.first_child_or_err(p)?;
    assert_eq!(tx.text_content(first), "before");
    assert_eq!(tx.next_sibling(first), Some(inline.key()));
    assert_eq!(tx.text_content(t), "inside");
    Ok(())
}
#[test]
fn node_selection_inserts_blocks_through_range_insertion() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("selected")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let mut nodes = NodeSelection::new();
    nodes.add(t);
    tx.set_selection(Some(Selection::Node(nodes)))?;
    let a = tx.create(Paragraph::default())?;
    let b = tx.create(Paragraph::default())?;
    let at = tx.create_text("a")?;
    let bt = tx.create_text("b")?;
    tx.append(a, &[at.key()])?;
    tx.append(b, &[bt.key()])?;
    tx.insert_nodes(&[a.key(), b.key()])?;
    assert!(!tx.is_attached(t));
    assert!(
        tx.children(NodeKey::ROOT)
            .all(|key| tx.is::<Paragraph>(key))
    );
    assert_eq!(tx.text_content(NodeKey::ROOT), "a\n\nb");
    Ok(())
}

// LexicalSelection.insertText: spliceText(..., true) updates the active
// range, while a detached receiver keeps its own endpoints.
#[test]
fn detached_text_insertion_updates_only_the_existing_active_caret() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("abc")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let point = Point::text(t, Utf16Offset(1));
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(point)));
    tx.insert_text_at(slot, "X")?;
    assert_eq!(tx.text_content(t), "aXbc");
    assert!(tx.selection().is_none());
    assert_eq!(tx.anchor_at(slot)?, point);
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(4)),
    ))))?;
    tx.insert_text_at(slot, "Y")?;
    assert_eq!(tx.text_content(t), "aYXbc");
    assert_eq!(tx.anchor()?, Point::text(t, Utf16Offset(2)));
    assert_eq!(tx.anchor_at(slot)?, point);
    Ok(())
}

// A format mismatch creates a node and calls select(), even with no active range.
#[test]
fn detached_formatted_insertion_creates_an_active_selection() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("abc")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let point = Point::text(t, Utf16Offset(1));
    let mut range = RangeSelection::collapsed(point);
    range.format = TextFormat::BOLD;
    let slot = tx.detach_selection(Selection::Range(range));
    tx.insert_text_at(slot, "X")?;
    let inserted = tx.anchor()?.key();
    assert_eq!(tx.text_content(inserted), "X");
    assert_eq!(
        tx.view().text(inserted).expect("text").format,
        TextFormat::BOLD
    );
    assert_eq!(tx.anchor_at(slot)?, point);
    Ok(())
}

#[test]
fn detached_paragraph_insertion_selects_new_active_paragraph() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("abcd")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let point = Point::text(t, Utf16Offset(2));
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(point)));
    tx.insert_paragraph_at(slot)?;
    let paragraphs = tx.children_keys(NodeKey::ROOT)?;
    assert_eq!(paragraphs.len(), 2);
    assert_eq!(tx.text_content(paragraphs[0]), "ab");
    assert_eq!(tx.text_content(paragraphs[1]), "cd");
    assert_eq!(
        tx.anchor()?,
        Point::text(
            tx.first_child(paragraphs[1]).expect("child"),
            Utf16Offset(0)
        )
    );
    assert_eq!(tx.anchor_at(slot)?, point);
    Ok(())
}

#[test]
fn composing_insertion_keeps_the_inserted_span_selected() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("ab")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(1)),
    ))))?;
    tx.set_composition_key(Some(t.key()))?;
    tx.insert_text("X")?;
    assert_eq!(tx.text_content(t), "aXb");
    assert_eq!(tx.anchor()?, Point::text(t, Utf16Offset(1)));
    assert_eq!(tx.focus()?, Point::text(t, Utf16Offset(2)));
    Ok(())
}

#[test]
fn explicit_slot_raw_text_line_break_and_extract() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("ab")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(1)),
    ))))?;
    tx.insert_raw_text_at(SelectionSlot::Active, "X\tY")?;
    assert_eq!(tx.text_content(p), "aX\tYb");
    tx.insert_line_break_at(SelectionSlot::Active, false)?;
    assert_eq!(tx.text_content(p), "aX\tY\nb");
    tx.insert_line_break(true)?;
    assert_eq!(tx.text_content(p), "aX\tY\n\nb");
    let tail = tx.last_child(p).expect("tail");
    let slot = tx.detach_selection(Selection::Range(RangeSelection::new(
        Point::text(tail, Utf16Offset(0)),
        Point::text(tail, Utf16Offset(1)),
    )));
    assert_eq!(tx.extract_at(slot)?, vec![tail]);
    let inserted = tx.create_text("Z")?;
    tx.insert_nodes_at(SelectionSlot::Active, &[inserted.key()])?;
    assert!(tx.is_attached(inserted));
    assert_eq!(tx.anchor()?, Point::text(inserted, Utf16Offset(1)));
    Ok(())
}

#[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct ParentRequired {}
impl NodeType for ParentRequired {
    const TYPE: &'static str = "parent-required";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for ParentRequired {
    element_node_base!();
    fn is_parent_required(&self, _: ElementView<'_>) -> bool {
        true
    }
}

#[test]
fn mixed_block_insertion_wraps_nodes_requiring_a_parent() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<ParentRequired>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let initial = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[initial.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(initial, ChildIndex(0)),
    ))))?;
    let required = tx.create(ParentRequired::default())?;
    let block = tx.create(Paragraph::default())?;
    let text = tx.create_text("last")?;
    tx.append(block, &[text.key()])?;
    tx.insert_nodes(&[required.key(), block.key()])?;
    let parent = tx.parent_or_err(required)?;
    assert_ne!(parent, NodeKey::ROOT);
    assert!(tx.is::<Paragraph>(parent));
    assert_eq!(tx.parent(block), Some(NodeKey::ROOT));
    Ok(())
}

#[test]
fn root_range_paragraph_insertion_preserves_selected_block_contents() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let line = tx.create(LineBreak::default())?;
        tx.append(paragraph, &[line.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(NodeKey::ROOT, ChildIndex(0)),
            Point::element(NodeKey::ROOT, ChildIndex(1)),
        ))))?;
        tx.insert_paragraph()?;
        assert_eq!(tx.children_size(NodeKey::ROOT), 2);
        assert_eq!(tx.children_keys(paragraph)?, vec![line.key()]);
        assert_eq!(
            tx.anchor()?,
            Point::element(tx.first_child(NodeKey::ROOT).unwrap(), ChildIndex(0))
        );
        Ok(())
    })?;
    Ok(())
}

#[test]
fn element_start_transfers_before_resolving_the_end_boundary() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let old = tx.create_text("\t")?;
        tx.append(p, &[old.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(NodeKey::ROOT, ChildIndex(0)),
            Point::element(p, ChildIndex(1)),
        ))))?;
        tx.insert_text("\u{feff}")?;
        Ok(())
    })?;
    assert_eq!(editor.state().root_text_content().as_ref(), "\u{feff}\t");
    Ok(())
}

#[test]
fn splitting_text_resolves_parent_selection_and_dirties_original_neighbors() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let ((p, text, neighbor), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abc")?;
        let neighbor = tx.create(LineBreak::default())?;
        tx.append(p, &[text.key(), neighbor.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), text.key(), neighbor.key()))
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(p, ChildIndex(1)),
            Point::text(text, Utf16Offset(2)),
        ))))?;
        tx.text(text)?.split_text(&[Utf16Offset(2)])?;
        assert_eq!(tx.anchor()?, Point::element(p, ChildIndex(2)));
        Ok(())
    })?;
    assert!(commit.changes.dirty_leaves.contains(&neighbor));
    Ok(())
}

#[test]
fn inserting_line_break_before_text_selects_the_text_start() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("ab")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_points(
            Point::text(text, Utf16Offset(1)),
            Point::text(text, Utf16Offset(1)),
        )?;
        tx.insert_line_break(false)?;
        let tail = tx.last_child(p).unwrap();
        assert_eq!(tx.anchor()?, Point::text(tail, Utf16Offset::ZERO));
        assert_eq!(tx.text_content(tail), "b");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn split_start_prefers_the_next_part_when_the_end_is_later() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abcd")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(2)),
            Point::element(NodeKey::ROOT, ChildIndex(1)),
        ))))?;
        let parts = tx.text(text)?.split_text(&[Utf16Offset(2)])?;
        assert_eq!(tx.anchor()?, Point::text(parts[1], Utf16Offset::ZERO));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn element_text_replacement_shifts_the_end_past_a_leaf_insertion() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let first = tx.create_text("a")?;
        let line = tx.create(LineBreak::default())?;
        let last = tx.create(Tab::default())?;
        tx.append(p, &[first.key(), line.key(), last.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(p, ChildIndex(1)),
            Point::element(p, ChildIndex(2)),
        ))))?;
        tx.insert_text("b")?;
        assert_eq!(tx.text_content(p), "ab\t");
        assert!(!tx.is_attached(line));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn multi_node_formatting_skips_an_unselected_start_text_boundary() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let first = tx.create_text("a")?;
        let middle = tx.create_text("b")?;
        let last = tx.create_text("c")?;
        tx.text(middle)?.set_format(TextFormat::BOLD)?;
        tx.text(last)?.set_format(TextFormat::ITALIC)?;
        tx.append(p, &[first.key(), middle.key(), last.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(last, Utf16Offset(1)),
            Point::text(first, Utf16Offset(1)),
        ))))?;
        tx.format_text(TextFormatType::Underline, None)?;
        assert_eq!(tx.focus()?, Point::text(middle, Utf16Offset::ZERO));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn text_replacement_preserves_the_legacy_root_element_end_rule() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let tab = tx.create(Tab::default())?;
        let tail = tx.create_text("\u{2028}")?;
        tx.append(p, &[tab.key(), tail.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(p, ChildIndex(0)),
            Point::element(NodeKey::ROOT, ChildIndex(1)),
        ))))?;
        tx.insert_text("new")?;
        assert_eq!(tx.text_content(p), "new\u{2028}");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn formatting_inherits_unselected_end_node_flags() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let first = tx.create_text("abc")?;
        let last = tx.create_text("last")?;
        tx.text(first)?.set_format(TextFormat::BOLD)?;
        tx.text(last)?.set_format(TextFormat::ITALIC)?;
        tx.append(p, &[first.key(), last.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(first, Utf16Offset(1)),
            Point::text(last, Utf16Offset(0)),
        ))))?;
        tx.format_text(TextFormatType::Underline, None)?;
        assert_eq!(
            tx.range_selection()?.format,
            TextFormat::BOLD | TextFormat::ITALIC | TextFormat::UNDERLINE
        );
        assert_eq!(tx.view().text_data(last)?.format, TextFormat::ITALIC);
        Ok(())
    })?;
    Ok(())
}

#[test]
fn formatting_resolves_an_element_start_mutated_by_text_split() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abcd")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(p, ChildIndex(0)),
            Point::text(text, Utf16Offset(2)),
        ))))?;
        tx.format_text(TextFormatType::Bold, None)?;
        assert_eq!(tx.anchor()?, Point::text(text, Utf16Offset(0)));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn a_single_text_replacement_stops_at_the_selected_root_child() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let last = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[first.key(), last.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(NodeKey::ROOT, ChildIndex(0)),
            Point::element(NodeKey::ROOT, ChildIndex(1)),
        ))))?;
        tx.insert_text("x")?;
        assert_eq!(
            tx.children_keys(NodeKey::ROOT)?,
            vec![first.key(), last.key()]
        );
        assert_eq!(tx.text_content(first), "x");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn formatting_a_structural_range_without_characters_preserves_typing_flags() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abc")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(p, ChildIndex(0)),
            Point::text(text, Utf16Offset(0)),
        ))))?;
        tx.format_text(TextFormatType::Lowercase, None)?;
        assert_eq!(tx.range_selection()?.format, TextFormat::empty());
        Ok(())
    })?;
    Ok(())
}

#[test]
fn replacing_a_token_preserves_typing_format_independently_of_the_new_text() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let token = tx.create_text("x")?;
        tx.text(token)?
            .set_mode(TextMode::Token)?
            .set_format(TextFormat::BOLD)?;
        let tail = tx.create_text("tail")?;
        tx.append(p, &[token.key(), tail.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let mut range = RangeSelection::new(
            Point::text(token, Utf16Offset(0)),
            Point::text(tail, Utf16Offset(1)),
        );
        range.format = TextFormat::ITALIC;
        tx.set_selection(Some(Selection::Range(range)))?;
        tx.insert_text("new")?;
        assert_eq!(tx.range_selection()?.format, TextFormat::ITALIC);
        let replacement = tx.first_child(p).unwrap();
        assert_eq!(
            tx.view().text_data(replacement)?.format,
            TextFormat::empty()
        );
        Ok(())
    })?;
    Ok(())
}

#[test]
fn paragraph_insertion_after_root_caret_removal_uses_the_split_fallback() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let last = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[first.key(), last.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(last, ChildIndex(0)),
            Point::element(NodeKey::ROOT, ChildIndex(1)),
        ))))?;
        tx.insert_paragraph()?;
        assert_eq!(tx.children_size(NodeKey::ROOT), 4);
        assert_eq!(tx.anchor()?.key(), tx.last_child(NodeKey::ROOT).unwrap());
        Ok(())
    })?;
    Ok(())
}

#[test]
fn text_insertion_keeps_endpoint_roles_chosen_before_element_transfer() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("old")?;
        let line = tx.create(LineBreak::default())?;
        let tab = tx.create(Tab::default())?;
        tx.append(p, &[text.key(), line.key(), tab.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(p, ChildIndex(1)),
            Point::text(text, Utf16Offset(3)),
        ))))?;
        tx.insert_text("new")?;
        assert_eq!(tx.text_content(p), "new\n\t");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn typing_between_tabs_creates_plain_text_instead_of_splicing_a_tab() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let first = tx.create(Tab::default())?;
        let last = tx.create(Tab::default())?;
        tx.append(p, &[first.key(), last.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(Point::text(first, Utf16Offset(1))))))?;
        tx.insert_text("x")?;
        assert_eq!(tx.text_content(p).as_ref(), "\tx\t");
        Ok(())
    })?;
    Ok(())
}
