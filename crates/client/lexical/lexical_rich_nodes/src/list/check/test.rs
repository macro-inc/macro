use super::*;
use crate::list::{item::*, register::*};

/// upstream: checkList.ts, navigation crosses nested wrappers and selects the next leaf.
#[test]
fn checklist_navigation_crosses_nested_wrappers() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Check, 1)?;
    let a = create_list_item_node(&mut tx, None)?;
    let wrapper = create_list_item_node(&mut tx, None)?;
    let inner = create_list_node(&mut tx, ListType::Check, 1)?;
    let b = create_list_item_node(&mut tx, None)?;
    tx.append(inner, &[b.key()])?;
    tx.append(wrapper, &[inner.key()])?;
    tx.append(list, &[a.key(), wrapper.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    assert_eq!(find_check_list_item_sibling(&tx, a, false), Some(b));
    assert_eq!(find_check_list_item_sibling(&tx, b, true), Some(a));
    assert_eq!(select_check_list_item_sibling(&mut tx, a, false)?, Some(b));
    assert_eq!(check_list_item_at_caret_start(&tx), Some(b));
    assert_eq!(find_check_list_item_sibling(&tx, b, false), None);
    Ok(())
}

/// upstream: checkList.ts, left-arrow checks the nearest block, not any ancestor.
#[test]
fn nested_paragraph_does_not_claim_outer_check_item() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Check, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("nested")?;
    tx.append(p, &[text.key()])?;
    // Bypass the item append override to exercise a nested block before normalization.
    tx.splice(item, ChildIndex(0), 0, &[p.key()])?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
    assert_eq!(check_list_item_at_caret_start(&tx), None);
    Ok(())
}

/// upstream: checkList.ts, backward descent starts at the previous item's last child.
#[test]
fn backward_navigation_descends_the_last_nested_list() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Check, 1)?;
    let previous = create_list_item_node(&mut tx, None)?;
    let prefix = tx.create_text("prefix")?;
    let inner = create_list_node(&mut tx, ListType::Check, 1)?;
    let leaf = create_list_item_node(&mut tx, None)?;
    let current = create_list_item_node(&mut tx, None)?;
    tx.append(inner, &[leaf.key()])?;
    tx.append(previous, &[prefix.key(), inner.key()])?;
    tx.append(list, &[previous.key(), current.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    assert_eq!(find_check_list_item_sibling(&tx, current, true), Some(leaf));
    Ok(())
}
