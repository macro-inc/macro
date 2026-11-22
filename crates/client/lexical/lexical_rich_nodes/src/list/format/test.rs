use super::*;
use crate::list::register::*;

/// upstream: formatList.test.ts, inserting with empty root selection.
#[test]
fn insert_list_at_empty_root_and_remove_restores_paragraph() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.element(NodeKey::ROOT)?.select(None, None)?;
    insert_list(&mut tx, ListType::Number)?;
    let list = tx.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(
        tx.get::<ListNode>(list).expect("list").list_type(),
        ListType::Number
    );
    let item = tx.first_child_or_err(list)?;
    assert!(is_list_item_node(&tx, item));
    assert_eq!(tx.range_at(SelectionSlot::Active)?.anchor.key(), item);
    remove_list(&mut tx)?;
    let paragraph = tx.first_child_or_err(NodeKey::ROOT)?;
    assert!(tx.is::<Paragraph>(paragraph));
    assert_eq!(tx.range_at(SelectionSlot::Active)?.anchor.key(), paragraph);
    Ok(())
}
/// upstream: formatList.test.ts, preserves element-anchored paragraph selection.
#[test]
fn convert_linebreak_paragraph_preserves_element_points() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let line = tx.create(LineBreak {})?;
    tx.append(p, &[line.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.element(p)?
        .select(Some(ChildIndex(0)), Some(ChildIndex(1)))?;
    insert_list(&mut tx, ListType::Bullet)?;
    let list = tx.first_child_or_err(NodeKey::ROOT)?;
    let item = tx.first_child_or_err(list)?;
    assert_eq!(tx.first_child(item), Some(line.key()));
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.anchor,
        Point::element(item, ChildIndex(0))
    );
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.focus,
        Point::element(item, ChildIndex(1))
    );
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, splitting a list resets numbering.
#[test]
fn enter_empty_middle_item_resets_numbering() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Number, 5)?;
    let a = create_list_item_node(&mut tx, None)?;
    let empty = create_list_item_node(&mut tx, None)?;
    let c = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[a.key(), empty.key(), c.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.select_start(empty)?;
    assert!(handle_list_insert_paragraph(&mut tx, false)?);
    let paragraph = tx.next_sibling(list).expect("paragraph");
    let next = tx.next_sibling(paragraph).expect("trailing list");
    assert_eq!(tx.get::<ListNode>(next).expect("list").start(), 1);
    assert_eq!(tx.children_keys(next)?, vec![c.key()]);
    assert_eq!(tx.children_keys(list)?, vec![a.key()]);
    assert_eq!(tx.range_at(SelectionSlot::Active)?.anchor.key(), paragraph);
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, splitting a list preserves numbering.
#[test]
fn enter_empty_middle_item_preserves_numbering() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Number, 5)?;
    let a = create_list_item_node(&mut tx, None)?;
    let empty = create_list_item_node(&mut tx, None)?;
    let c = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[a.key(), empty.key(), c.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.select_start(empty)?;
    assert!(handle_list_insert_paragraph(&mut tx, true)?);
    let paragraph = tx.next_sibling(list).expect("paragraph");
    let next = tx.next_sibling(paragraph).expect("trailing list");
    assert_eq!(tx.get::<ListNode>(next).expect("list").start(), 6);
    assert_eq!(tx.children_keys(next)?, vec![c.key()]);
    assert_eq!(tx.children_keys(list)?, vec![a.key()]);
    assert_eq!(tx.range_at(SelectionSlot::Active)?.anchor.key(), paragraph);
    Ok(())
}

/// upstream: formatList.test.ts, whitespace-only items exit, non-whitespace stays.
#[test]
fn enter_whitespace_only_item_exits_but_nel_is_content() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    let text = tx.create_text("\u{0085}")?;
    tx.append(item, &[text.key()])?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.text(text)?.select(None, None)?;
    assert!(!handle_list_insert_paragraph(&mut tx, false)?);
    tx.text(text)?.set_text_content(" \t\u{feff}")?;
    assert!(handle_list_insert_paragraph(&mut tx, false)?);
    assert!(tx.is::<Paragraph>(tx.first_child_or_err(NodeKey::ROOT)?));
    Ok(())
}
/// upstream: LexicalListItemNode.test.ts, middle-item outdent splits both wrapper lists.
#[test]
fn outdent_middle_splits_both_sides() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let outer = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let wrapper = create_list_item_node(&mut tx, None)?;
    let inner = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let a = create_list_item_node(&mut tx, None)?;
    let b = create_list_item_node(&mut tx, None)?;
    let c = create_list_item_node(&mut tx, None)?;
    tx.append(inner, &[a.key(), b.key(), c.key()])?;
    tx.append(wrapper, &[inner.key()])?;
    tx.append(outer, &[wrapper.key()])?;
    tx.append(NodeKey::ROOT, &[outer.key()])?;
    handle_outdent(&mut tx, b)?;
    let children = tx.children_keys(outer)?;
    assert_eq!(children.len(), 3);
    assert_eq!(children[1], b.key());
    assert_eq!(
        tx.children_keys(tx.first_child_or_err(children[0])?)?,
        vec![a.key()]
    );
    assert_eq!(
        tx.children_keys(tx.first_child_or_err(children[2])?)?,
        vec![c.key()]
    );
    assert_eq!(get_indent(&tx, b), 0);
    Ok(())
}
