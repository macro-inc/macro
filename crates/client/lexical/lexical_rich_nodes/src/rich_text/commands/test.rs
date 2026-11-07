use super::*;
#[test]
fn null_selection_handlers_return_upstream_booleans() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    assert!(controlled_text_insertion(&mut tx, "x")?);
    assert!(!delete_character(
        &mut tx,
        EditDirection::Forward,
        ModifyTarget::NoView
    )?);
    assert!(!delete_word(
        &mut tx,
        EditDirection::Backward,
        ModifyTarget::NoView,
        ModifyTarget::NoView
    )?);
    assert!(!delete_line(
        &mut tx,
        EditDirection::Backward,
        ModifyTarget::NoView,
        ModifyTarget::NoView
    )?);
    assert!(!click(&mut tx, &EscapeFormatTriggerConfig::default())?);
    assert!(!remove_text(&mut tx)?);
    assert!(!format_text(&mut tx, TextFormatType::Bold)?);
    assert!(!format_element(&mut tx, ElementFormat::Center)?);
    assert!(!insert_line_break(&mut tx, false)?);
    assert!(!insert_paragraph(&mut tx)?);
    assert!(!indent_content(&mut tx)?);
    assert!(!outdent_content(&mut tx)?);
    cut_selection(&mut tx)?;
    assert!(select_all(&mut tx)?);
    Ok(())
}
#[test]
fn clicking_node_selection_clears_keys_and_keeps_node_selection() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let mut nodes = NodeSelection::new();
    nodes.add(p);
    tx.set_selection(Some(Selection::Node(nodes)))?;
    assert!(controlled_text_insertion(&mut tx, "ignored")?);
    assert_eq!(tx.text_content(p), "");
    assert!(click(&mut tx, &EscapeFormatTriggerConfig::default())?);
    let Selection::Node(nodes) = tx.selection().unwrap() else {
        panic!("node selection")
    };
    assert_eq!(nodes.keys().count(), 0);
    assert_eq!(tx.first_child(NodeKey::ROOT), Some(p.key()));
    Ok(())
}
#[test]
fn delete_character_removes_selected_nodes() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph {})?;
    let b = tx.create(Paragraph {})?;
    tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
    let mut nodes = NodeSelection::new();
    nodes.add(a);
    tx.set_selection(Some(Selection::Node(nodes)))?;
    assert!(delete_character(
        &mut tx,
        EditDirection::Backward,
        ModifyTarget::NoView
    )?);
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![b.key()]);
    Ok(())
}
#[test]
fn delete_character_removes_range_contents() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello world")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(5)))?;
    assert!(delete_character(
        &mut tx,
        EditDirection::Forward,
        ModifyTarget::NoView
    )?);
    assert_eq!(tx.text_content(p), " world");
    Ok(())
}
#[test]
fn delete_word_uses_host_resolved_word_range() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello world")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    let target = ModifyTarget::View {
        anchor: Point::text(t, Utf16Offset(11)),
        focus: Point::text(t, Utf16Offset(6)),
        resolution_dirty: false,
        is_backward_in_dom: true,
    };
    assert!(delete_word(
        &mut tx,
        EditDirection::Backward,
        target,
        ModifyTarget::NoView
    )?);
    assert_eq!(tx.text_content(p), "hello ");
    Ok(())
}
#[test]
fn delete_line_uses_host_resolved_line_boundary() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello world")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    let target = ModifyTarget::View {
        anchor: Point::text(t, Utf16Offset(11)),
        focus: Point::text(t, Utf16Offset(0)),
        resolution_dirty: false,
        is_backward_in_dom: true,
    };
    assert!(delete_line(
        &mut tx,
        EditDirection::Backward,
        target,
        ModifyTarget::NoView
    )?);
    assert_eq!(tx.text_content(p), "");
    Ok(())
}
#[test]
fn block_format_and_indentation_apply_once_per_selected_block() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph {})?;
    let b = tx.create(Paragraph {})?;
    let first = tx.create_text("first")?;
    let second = tx.create_text("second")?;
    let last = tx.create_text("last")?;
    tx.append(a, &[first.key(), second.key()])?;
    tx.append(b, &[last.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(first, Utf16Offset(0)),
        Point::text(last, Utf16Offset(4)),
    ))))?;
    assert!(format_element(&mut tx, ElementFormat::Center)?);
    assert_eq!(tx.element_data(a)?.format, ElementFormat::Center);
    assert_eq!(tx.element_data(b)?.format, ElementFormat::Center);
    assert!(indent_content(&mut tx)?);
    assert_eq!(tx.indent(a), 1);
    assert_eq!(tx.indent(b), 1);
    assert!(outdent_content(&mut tx)?);
    assert_eq!(tx.indent(a), 0);
    assert_eq!(tx.indent(b), 0);
    assert!(outdent_content(&mut tx)?);
    assert_eq!(tx.indent(a), 0);
    Ok(())
}
#[test]
fn rich_enter_splits_paragraph_and_line_break_keeps_block() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("ab")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    assert!(insert_paragraph(&mut tx)?);
    let children = tx.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 2);
    assert_eq!(tx.text_content(children[0]), "a");
    assert_eq!(tx.text_content(children[1]), "b");
    assert!(insert_line_break(&mut tx, true)?);
    assert_eq!(tx.children_size(NodeKey::ROOT), 2);
    assert_eq!(tx.text_content(children[1]), "\nb");
    Ok(())
}
#[test]
fn cut_range_and_node_selection_follow_their_own_removal_paths() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph {})?;
    let b = tx.create(Paragraph {})?;
    let t = tx.create_text("abc")?;
    tx.append(a, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(2)))?;
    cut_selection(&mut tx)?;
    assert_eq!(tx.text_content(a), "ac");
    let mut nodes = NodeSelection::new();
    nodes.add(a);
    tx.set_selection(Some(Selection::Node(nodes)))?;
    cut_selection(&mut tx)?;
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![b.key()]);
    Ok(())
}
#[test]
fn clear_editor_resets_range_format_and_appends_one_empty_paragraph() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("text")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::BOLD)?;
    assert!(clear_editor(&mut tx)?);
    let new = tx.first_child(NodeKey::ROOT).unwrap();
    assert_ne!(new, p.key());
    assert_eq!(tx.children_size(NodeKey::ROOT), 1);
    assert!(tx.is::<Paragraph>(new));
    assert!(tx.is_empty(new));
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::element(new, ChildIndex(0))
    );
    assert_eq!(tx.range_selection()?.format, TextFormat::empty());
    Ok(())
}
#[test]
fn clear_editor_without_selection_does_not_create_selection() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    assert!(clear_editor(&mut tx)?);
    assert!(tx.selection().is_none());
    assert_eq!(tx.children_size(NodeKey::ROOT), 1);
    assert!(tx.is::<Paragraph>(tx.first_child(NodeKey::ROOT).unwrap()));
    Ok(())
}
#[test]
fn drop_uses_utf16_text_offset_or_position_after_nontext_node() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("😀x")?;
    let br = tx.create(LineBreak {})?;
    tx.append(p, &[t.key(), br.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    set_drop_selection(&mut tx, t.key(), Utf16Offset(2))?;
    assert_eq!(tx.range_selection()?.anchor, Point::text(t, Utf16Offset(2)));
    set_drop_selection(&mut tx, br.key(), Utf16Offset(0))?;
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::element(p, ChildIndex(2))
    );
    Ok(())
}
