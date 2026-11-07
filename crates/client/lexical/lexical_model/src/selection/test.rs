use crate::*;
#[test]
fn selection_values_compare_content_without_dirty_or_node_order() {
    let a = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 1,
    });
    let b = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 2,
    });
    let mut range = RangeSelection::new(
        Point::text(a, Utf16Offset(1)),
        Point::text(b, Utf16Offset(2)),
    );
    assert!(!range.is_collapsed());
    assert!(!range.is_dirty());
    let before = range.clone();
    range.set_format(TextFormat::BOLD);
    range.set_format(TextFormat::empty());
    assert_eq!(range, before);
    assert!(range.is_dirty());
    range.toggle_format(TextFormatType::Italic);
    range.set_style("color: red");
    assert!(range.has_format(TextFormatType::Italic));
    assert!(RangeSelection::at_root().is_collapsed());
    let mut nodes = NodeSelection::new();
    nodes.add(a);
    nodes.add(b);
    let mut reverse = NodeSelection::new();
    reverse.add(b);
    reverse.add(a);
    assert_eq!(nodes, reverse);
    assert_eq!(nodes.keys().collect::<Vec<_>>(), vec![a, b]);
    nodes.delete(a);
    assert!(!nodes.has(a));
    nodes.clear();
    assert_eq!(nodes.keys().len(), 0);
    assert_eq!(
        Point::new(a, 3, PointType::Text),
        Point::text(a, Utf16Offset(3))
    );
}
#[test]
fn detached_point_updates_transfer_composition_but_do_not_change_active_range() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("a")?;
    let b = tx.create_text("b")?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(a, Utf16Offset(0)),
    ))))?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        a,
        Utf16Offset(0),
    ))));
    tx.set_composition_key(Some(a.key()))?;
    tx.set_point_at(slot, PointRole::Anchor, Point::text(b, Utf16Offset(1)))?;
    assert_eq!(tx.composition_key(), Some(b.key()));
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(0)));
    assert_eq!(tx.anchor_at(slot)?, Point::text(b, Utf16Offset(1)));
    assert!(tx.range_at(slot)?.is_dirty());
    assert!(matches!(
        tx.set_point_at(slot, PointRole::Focus, Point::text(p, Utf16Offset(0))),
        Err(Error::PointTypeMismatch)
    ));
    tx.set_selection_format_at(slot, TextFormat::BOLD)?;
    tx.set_selection_style_at(slot, "color: blue")?;
    tx.toggle_selection_format_at(slot, TextFormatType::Italic)?;
    let selection = tx.take_detached(slot)?;
    assert!(
        selection
            .as_range()
            .expect("range")
            .has_format(TextFormatType::Italic)
    );
    assert!(matches!(tx.take_detached(slot), Err(Error::NoSelection)));
    tx.set_text_node_range(a, Utf16Offset(1), b, Utf16Offset(0))?;
    assert_eq!(tx.focus()?, Point::text(b, Utf16Offset(0)));
    Ok(())
}
#[test]
fn formatting_splits_partial_text_and_keeps_endpoints_on_formatted_slice() -> Result<(), Error> {
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
        Point::text(text, Utf16Offset(7)),
    ))))?;
    tx.format_text(TextFormatType::Bold, None)?;
    let nodes = tx.children(p).collect::<Vec<_>>();
    assert_eq!(nodes.len(), 3);
    assert_eq!(tx.text_content(nodes[0]), "pa");
    assert_eq!(tx.text_content(nodes[1]), "ragra");
    assert_eq!(tx.text_content(nodes[2]), "ph");
    assert_eq!(tx.view().text_data(nodes[1])?.format, TextFormat::BOLD);
    assert_eq!(tx.anchor()?, Point::text(nodes[1], Utf16Offset(0)));
    assert_eq!(tx.focus()?, Point::text(nodes[1], Utf16Offset(5)));
    Ok(())
}
#[test]
fn view_selection_changes_typing_attributes_when_anchor_node_changes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let ((a, b), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let a = tx.create_text("bold")?;
        let b = tx.create_text("plain")?;
        tx.text(a)?.set_format(TextFormat::BOLD)?;
        tx.append(p, &[a.key(), b.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.text(a)?.select(Some(Utf16Offset(1)), None)?;
        Ok((a, b))
    })?;
    editor.update(|tx| {
        tx.selection_from_view(ViewSelection::Range {
            anchor: Point::text(b, Utf16Offset(2)),
            focus: Point::text(b, Utf16Offset(2)),
            resolution_dirty: false,
        })?;
        assert_eq!(tx.range_selection()?.format, TextFormat::empty());
        assert_eq!(tx.range_selection()?.style.as_ref(), "");
        assert!(
            Point::text(a, Utf16Offset(2)).is_before(tx.view(), &Point::text(b, Utf16Offset(1)))?
        );
        tx.selection_change_format(&SelectionChangeContext {
            marked: Some(MarkedSelectionFormat {
                format: TextFormat::ITALIC,
                style: "color:red".into(),
                key: b.key(),
                offset: 2,
            }),
            ..SelectionChangeContext::default()
        })?;
        assert_eq!(tx.range_selection()?.format, TextFormat::ITALIC);
        Ok(())
    })?;
    Ok(())
}
#[test]
fn formatting_segmented_text_does_not_split_or_move_endpoints() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("segment text")?;
    tx.text(t)?.set_mode(TextMode::Segmented)?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let range = RangeSelection::new(
        Point::text(t, Utf16Offset(2)),
        Point::text(t, Utf16Offset(4)),
    );
    tx.set_selection(Some(Selection::Range(range.clone())))?;
    tx.format_text(TextFormatType::Bold, None)?;
    assert_eq!(tx.children_keys(p)?, vec![t.key()]);
    assert_eq!(tx.anchor()?, range.anchor);
    assert_eq!(tx.focus()?, range.focus);
    assert_eq!(tx.view().text_data(t)?.format, TextFormat::BOLD);
    Ok(())
}
#[test]
fn formatting_selected_empty_paragraph_updates_typing_format() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::element(NodeKey::ROOT, ChildIndex(0)),
        Point::element(NodeKey::ROOT, ChildIndex(1)),
    ))))?;
    tx.format_text(TextFormatType::Bold, None)?;
    assert_eq!(tx.view().element_data(p)?.text_format, TextFormat::BOLD);
    assert!(tx.range_selection()?.has_format(TextFormatType::Bold));
    Ok(())
}
#[test]
fn equivalent_element_and_text_boundaries_are_not_before_each_other() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("abc")?;
    tx.append(p, &[t.key()])?;
    let element = Point::element(p, ChildIndex(0));
    let text = Point::text(t, Utf16Offset(0));
    assert!(!element.is_before(tx.view(), &text)?);
    assert!(!text.is_before(tx.view(), &element)?);
    let element = Point::element(p, ChildIndex(1));
    let text = Point::text(t, Utf16Offset(3));
    assert!(!element.is_before(tx.view(), &text)?);
    assert!(!text.is_before(tx.view(), &element)?);
    Ok(())
}
#[test]
fn multiple_node_formatting_keeps_first_and_last_format_union() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("a")?;
    let b = tx.create_text("b")?;
    tx.text(a)?.set_format(TextFormat::BOLD)?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(0)),
        Point::text(b, Utf16Offset(1)),
    ))))?;
    tx.format_text(TextFormatType::Italic, None)?;
    assert_eq!(
        tx.range_selection()?.format,
        TextFormat::BOLD | TextFormat::ITALIC
    );
    assert_eq!(tx.view().text_data(b)?.format, TextFormat::ITALIC);
    Ok(())
}
struct TestTableHooks;
impl TableSelectionHooks for TestTableHooks {
    fn nodes(&self, _: StateRef<'_>, selection: &TableSelection) -> Result<Vec<NodeKey>, Error> {
        Ok(vec![
            selection.table,
            selection.anchor.key(),
            selection.focus.key(),
        ])
    }
    fn text_content(&self, _: StateRef<'_>, _: &TableSelection) -> Result<String, Error> {
        Ok("cells".into())
    }
    fn insert_nodes(
        &self,
        _: &mut Transaction<'_>,
        _: SelectionSlot,
        _: &[NodeKey],
    ) -> Result<(), Error> {
        Err(Error::Invariant("table insertion hook"))
    }
}
#[test]
fn table_selection_uses_registered_geometry_and_ignores_dirty_for_equality() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .table_selection_hooks(TestTableHooks)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let table = tx.create(Paragraph::default())?;
    let a = tx.create(Paragraph::default())?;
    let b = tx.create(Paragraph::default())?;
    tx.append(table, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let mut value = TableSelection::new(table.key(), a.key(), b.key());
    assert!(value.is_valid(tx.view()));
    let original = value;
    value.set(table.key(), a.key(), b.key());
    assert!(value.is_dirty());
    assert_eq!(original, value);
    let selection = Selection::Table(value);
    assert!(selection.is_table());
    assert!(!selection.is_range());
    assert!(!selection.is_node());
    assert!(!selection.is_collapsed());
    assert_eq!(
        selection.nodes(tx.view())?,
        vec![table.key(), a.key(), b.key()]
    );
    assert_eq!(selection.text_content(tx.view())?, "cells");
    assert!(selection.as_table().is_some());
    tx.selection_from_view(ViewSelection::Table {
        table: table.key(),
        anchor_cell: a.key(),
        focus_cell: b.key(),
    })?;
    assert!(tx.is_selected(a, None));
    Ok(())
}
#[test]
fn taken_and_unknown_slots_have_distinct_errors() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    assert!(matches!(tx.range_selection(), Err(Error::NoRangeSelection)));
    assert!(matches!(
        tx.take_detached(SelectionSlot::Active),
        Err(Error::NoSelection)
    ));
    let unknown = SelectionSlot::Detached(DetachedSelectionId(999));
    assert!(matches!(
        tx.selection_at(unknown),
        Err(Error::UnknownSelectionSlot)
    ));
    let slot = tx.detach_selection(Selection::Range(RangeSelection::at_root()));
    tx.set_text_node_range_at(
        slot,
        NodeKey::ROOT,
        Utf16Offset(0),
        NodeKey::ROOT,
        Utf16Offset(0),
    )
    .expect_err("wrong point kind");
    let taken = tx.take_detached(slot)?;
    assert_eq!(
        taken.start_end_points(),
        Some((
            Point::element(NodeKey::ROOT, ChildIndex(0)),
            Point::element(NodeKey::ROOT, ChildIndex(0))
        ))
    );
    assert!(tx.selection_at(slot)?.is_none());
    Ok(())
}

// LexicalSelection Point.isBefore: a sibling caret at child index one
// normalizes to the preceding text endpoint.
#[test]
fn middle_element_boundary_equals_preceding_text_end() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("a")?;
    let b = tx.create_text("b")?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let boundary = Point::element(p, ChildIndex(1));
    let left = Point::text(a, Utf16Offset(1));
    assert!(!boundary.is_before(tx.view(), &left)?);
    assert!(!left.is_before(tx.view(), &boundary)?);
    assert!(boundary.is_before(tx.view(), &Point::text(b, Utf16Offset(1)))?);
    Ok(())
}

#[test]
fn triple_click_trims_next_block_and_orients_backward_range() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let q = tx.create(Paragraph::default())?;
    let a = tx.create_text("first")?;
    let b = tx.create_text("second")?;
    tx.append(p, &[a.key()])?;
    tx.append(q, &[b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key(), q.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))?;
    tx.set_text_node_range(b, Utf16Offset(0), a, Utf16Offset(0))?;
    assert!(tx.range_selection()?.is_backward(tx.view())?);
    assert!(tx.selection().expect("selection").is_backward(tx.view())?);
    assert!(tx.fix_focus_overselection()?);
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(0)));
    assert_eq!(tx.focus()?, Point::text(a, Utf16Offset(5)));
    assert_eq!(tx.focus()?.point_type(), PointType::Text);
    tx.set_point(PointRole::Focus, Point::element(q, ChildIndex(1)))?;
    assert!(tx.fix_focus_overselection()?);
    assert_eq!(tx.focus()?, Point::text(b, Utf16Offset(6)));
    Ok(())
}

#[test]
fn active_typing_setters_and_view_range_preserve_attributes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("abcd")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))?;
        tx.set_text_node_range(t, Utf16Offset(0), t, Utf16Offset(0))?;
        Ok(t)
    })?;
    let mut tx = editor.transaction();
    let old = tx.detach_previous_selection()?.expect("previous");
    assert_eq!(tx.focus_at(old)?, Point::text(text, Utf16Offset(0)));
    tx.set_selection_format(TextFormat::BOLD)?;
    tx.set_selection_style("color: red")?;
    tx.toggle_selection_format(TextFormatType::Italic)?;
    tx.apply_view_range(
        Point::text(text, Utf16Offset(1)),
        Point::text(text, Utf16Offset(3)),
        false,
    )?;
    assert_eq!(
        tx.range_selection()?.format,
        TextFormat::BOLD | TextFormat::ITALIC
    );
    assert_eq!(&*tx.range_selection()?.style, "color: red");
    assert!(tx.selection_change_context().is_none());
    tx.format_text_at(SelectionSlot::Active, TextFormatType::Underline, None)?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Underline));
    Ok(())
}

#[test]
fn unchanged_view_range_does_not_create_a_selection_commit() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (p, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(p)?;
        Ok(p.key())
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.selection_from_view(ViewSelection::Range {
            anchor: Point::element(p, ChildIndex(0)),
            focus: Point::element(p, ChildIndex(0)),
            resolution_dirty: false,
        })?;
        tx.selection_change_format(&SelectionChangeContext::default())
    })?;
    assert!(commit.is_noop());
    Ok(())
}
