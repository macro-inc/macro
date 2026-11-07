use super::*;
use crate::list::{item::*, register::*};

/// upstream: utils.test.ts, depth/top-list/last-item traversal across nested lists.
#[test]
fn depth_leaf_order_and_top_list_follow_nested_wrappers() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let outer = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let a = create_list_item_node(&mut tx, None)?;
    let wrapper = create_list_item_node(&mut tx, None)?;
    let inner = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let b = create_list_item_node(&mut tx, None)?;
    let c = create_list_item_node(&mut tx, None)?;
    tx.append(inner, &[b.key(), c.key()])?;
    tx.append(wrapper, &[inner.key()])?;
    tx.append(outer, &[a.key(), wrapper.key()])?;
    tx.append(NodeKey::ROOT, &[outer.key()])?;
    assert_eq!(get_list_depth(&tx, outer)?, 1);
    assert_eq!(get_list_depth(&tx, inner)?, 2);
    assert_eq!(get_top_list_node(&tx, b.key())?, outer);
    assert_eq!(get_all_list_items(&tx, outer), vec![a, b, c]);
    assert_eq!(find_nearest_list_item_node(&tx, inner.key()), Some(wrapper));
    assert!(!is_last_item_in_list(&tx, a));
    assert!(!is_last_item_in_list(&tx, b));
    assert!(!is_last_item_in_list(&tx, wrapper));
    assert!(is_last_item_in_list(&tx, c));
    assert_eq!(get_new_list_start(&tx, inner, c)?, 2);
    remove_highest_empty_list_parent(&mut tx, c.key())?;
    assert_eq!(tx.children_keys(inner)?, vec![b.key()]);
    Ok(())
}
/// upstream: utils.test.ts, list depth rejects an item without a list parent.
#[test]
fn malformed_ancestor_is_an_invariant() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let item = create_list_item_node(&mut tx, None)?;
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    tx.append(item, &[list.key()])?;
    tx.append(p, &[item.key()])?;
    assert!(matches!(
        get_list_depth(&tx, list),
        Err(Error::Invariant(
            "A ListItemNode must have a ListNode for a parent."
        ))
    ));
    assert!(get_top_list_node(&tx, item.key()).is_err());
    Ok(())
}
