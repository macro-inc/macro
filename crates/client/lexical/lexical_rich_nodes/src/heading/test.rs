use super::*;
use crate::register_rich_text_nodes;

#[test]
fn constructor_tag_setter_and_distinct_creation() -> crate::Result<()> {
    let mut editor = register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let h = create_heading_node(&mut tx, HeadingTagType::H1)?;
    let other = create_heading_node(&mut tx, HeadingTagType::H1)?;
    assert_ne!(h.key(), other.key());
    assert_eq!(tx.parent(h), None);
    assert!(is_heading_node(&tx, h.key()));
    assert_eq!(get_tag(&tx, h), Some(HeadingTagType::H1));
    set_tag(&mut tx, h, HeadingTagType::H2)?;
    assert_eq!(get_tag(&tx, h), Some(HeadingTagType::H2));
    assert!(serde_json::from_str::<HeadingTagType>("\"h7\"").is_err());
    Ok(())
}
#[test]
fn export_heading_json_keeps_element_key_order_and_tag() -> crate::Result<()> {
    let mut editor = register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let h = create_heading_node(&mut tx, HeadingTagType::H2)?;
    assert_eq!(
        serde_json::to_string(&tx.export_json(h)?).unwrap(),
        r#"{"children":[],"direction":null,"format":"","indent":0,"type":"heading","version":1,"tag":"h2"}"#
    );
    Ok(())
}
#[test]
fn insert_after_empty_heading_creates_paragraph_with_direction() -> crate::Result<()> {
    let mut editor = register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let h = create_heading_node(&mut tx, HeadingTagType::H1)?;
    tx.append(NodeKey::ROOT, &[h.key()])?;
    tx.element(h)?.set_direction(Some(TextDirection::Rtl))?;
    let next = tx
        .insert_new_after(h, SelectionSlot::Active, true)?
        .unwrap();
    assert!(tx.is::<Paragraph>(next));
    assert_eq!(tx.element_data(next)?.direction, Some(TextDirection::Rtl));
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![h.key(), next]);
    Ok(())
}
#[test]
fn insert_after_middle_keeps_heading_level() -> crate::Result<()> {
    let mut editor = register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let h = create_heading_node(&mut tx, HeadingTagType::H1)?;
    let text = tx.create_text("hello world")?;
    tx.append(h, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[h.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
    let next = tx
        .insert_new_after(h, SelectionSlot::Active, true)?
        .unwrap();
    assert_eq!(tx.get::<HeadingNode>(next).unwrap().tag, HeadingTagType::H1);
    assert_eq!(tx.text_content(h), "hello world");
    Ok(())
}
#[test]
fn insert_after_end_creates_paragraph() -> crate::Result<()> {
    let mut editor = register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let h = create_heading_node(&mut tx, HeadingTagType::H1)?;
    let first = tx.create_text("hello")?;
    let last = tx.create_text(" world")?;
    tx.text(last)?.set_format(TextFormat::BOLD)?;
    tx.append(h, &[first.key(), last.key()])?;
    tx.append(NodeKey::ROOT, &[h.key()])?;
    tx.select_end(last)?;
    let next = tx
        .insert_new_after(h, SelectionSlot::Active, true)?
        .unwrap();
    assert!(tx.is::<Paragraph>(next));
    assert_eq!(tx.text_content(h), "hello world");
    Ok(())
}
#[test]
fn insert_after_h2_without_range_creates_paragraph() -> crate::Result<()> {
    let mut editor = register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let h = create_heading_node(&mut tx, HeadingTagType::H2)?;
    let text = tx.create_text("hello world")?;
    tx.append(h, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[h.key()])?;
    let next = tx
        .insert_new_after(h, SelectionSlot::Active, true)?
        .unwrap();
    assert!(tx.is::<Paragraph>(next));
    Ok(())
}
#[test]
fn zero_offset_in_second_text_replaces_original_heading() -> crate::Result<()> {
    let mut editor = register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let h = create_heading_node(&mut tx, HeadingTagType::H3)?;
    let first = tx.create_text("first")?;
    let second = tx.create_text("second")?;
    tx.append(h, &[first.key(), second.key()])?;
    tx.append(NodeKey::ROOT, &[h.key()])?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        second,
        Utf16Offset(0),
    ))));
    let next = tx.insert_new_after(h, slot, false)?.unwrap();
    let p = tx.first_child(NodeKey::ROOT).unwrap();
    assert!(tx.is::<Paragraph>(p));
    assert_eq!(tx.children_keys(p)?, vec![first.key(), second.key()]);
    assert!(tx.is::<HeadingNode>(next));
    Ok(())
}
#[test]
fn collapse_nonempty_heading_keeps_type_and_children() -> crate::Result<()> {
    let mut editor = register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let h = create_heading_node(&mut tx, HeadingTagType::H2)?;
    let text = tx.create_text("Heading")?;
    tx.append(h, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[h.key()])?;
    assert!(tx.collapse_at_start(h, SelectionSlot::Active)?);
    assert_eq!(tx.first_child(NodeKey::ROOT), Some(h.key()));
    assert_eq!(tx.text_content(h), "Heading");
    Ok(())
}
#[test]
fn collapse_empty_heading_converts_to_paragraph() -> crate::Result<()> {
    let mut editor = register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let h = create_heading_node(&mut tx, HeadingTagType::H2)?;
    tx.append(NodeKey::ROOT, &[h.key()])?;
    assert!(tx.collapse_at_start(h, SelectionSlot::Active)?);
    let p = tx.first_child(NodeKey::ROOT).unwrap();
    assert!(tx.is::<Paragraph>(p));
    assert!(tx.is_empty(p));
    Ok(())
}
