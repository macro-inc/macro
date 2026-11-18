use super::*;
#[test]
fn constructor_and_insert_after_copy_direction() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<QuoteNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let q = create_quote_node(&mut tx)?;
    let other = create_quote_node(&mut tx)?;
    assert_ne!(q.key(), other.key());
    assert_eq!(tx.parent(q), None);
    assert!(is_quote_node(&tx, q.key()));
    tx.append(NodeKey::ROOT, &[q.key()])?;
    tx.element(q)?.set_direction(Some(TextDirection::Rtl))?;
    let next = tx
        .insert_new_after(q, SelectionSlot::Active, true)?
        .unwrap();
    assert!(tx.is::<Paragraph>(next));
    assert_eq!(tx.element_data(next)?.direction, Some(TextDirection::Rtl));
    Ok(())
}
#[test]
fn collapse_quote_moves_children_into_paragraph() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<QuoteNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let q = create_quote_node(&mut tx)?;
    let t = tx.create_text("Quote")?;
    tx.append(q, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[q.key()])?;
    assert!(tx.collapse_at_start(q, SelectionSlot::Active)?);
    let p = tx.first_child(NodeKey::ROOT).unwrap();
    assert!(tx.is::<Paragraph>(p));
    assert_eq!(tx.children_keys(p)?, vec![t.key()]);
    assert_eq!(tx.export_json(p)?["type"], "paragraph");
    Ok(())
}
#[test]
fn quote_merges_when_empty_and_exports_plain_element_fields() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<QuoteNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let quote = create_quote_node(&mut tx)?;
    assert!(tx.can_merge_when_empty(quote));
    assert_eq!(tx.export_json(quote)?["type"], "quote");
    Ok(())
}
