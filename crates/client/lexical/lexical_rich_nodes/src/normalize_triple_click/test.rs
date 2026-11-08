use super::*;
#[test]
fn triple_click_trims_focus_at_start_of_next_block() -> crate::Result<()> {
    let mut editor = register_normalize_triple_click(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph {})?;
    let b = tx.create(Paragraph {})?;
    let first = tx.create_text("first")?;
    let second = tx.create_text("second")?;
    tx.append(a, &[first.key()])?;
    tx.append(b, &[second.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(first, Utf16Offset(0)),
        Point::text(second, Utf16Offset(0)),
    ))))?;
    tx.selection_change_format(&SelectionChangeContext {
        triple_click: true,
        ..SelectionChangeContext::default()
    })?;
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(first, Utf16Offset(0))
    );
    assert_eq!(
        tx.range_selection()?.focus,
        Point::text(first, Utf16Offset(5))
    );
    assert!(tx.selection_change_context().is_none());
    assert_eq!(tx.dispatch(&Command::SelectionChange)?, Handled::No);
    Ok(())
}
#[test]
fn ordinary_selection_change_preserves_focus_in_next_block() -> crate::Result<()> {
    let mut editor = register_normalize_triple_click(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph {})?;
    let b = tx.create(Paragraph {})?;
    let first = tx.create_text("first")?;
    let second = tx.create_text("second")?;
    tx.append(a, &[first.key()])?;
    tx.append(b, &[second.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(first, Utf16Offset(0)),
        Point::text(second, Utf16Offset(0)),
    ))))?;
    tx.selection_change_format(&SelectionChangeContext::default())?;
    assert_eq!(
        tx.range_selection()?.focus,
        Point::text(second, Utf16Offset(0))
    );
    Ok(())
}
#[test]
fn omitting_registration_disables_triple_click_normalization() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph {})?;
    let b = tx.create(Paragraph {})?;
    let first = tx.create_text("first")?;
    let second = tx.create_text("second")?;
    tx.append(a, &[first.key()])?;
    tx.append(b, &[second.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(first, Utf16Offset(0)),
        Point::text(second, Utf16Offset(0)),
    ))))?;
    tx.selection_change_format(&SelectionChangeContext {
        triple_click: true,
        ..SelectionChangeContext::default()
    })?;
    assert_eq!(
        tx.range_selection()?.focus,
        Point::text(second, Utf16Offset(0))
    );
    Ok(())
}
