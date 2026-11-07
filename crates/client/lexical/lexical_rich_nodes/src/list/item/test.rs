use super::*;
use crate::list::register::*;
use serde_json::json;

/// upstream: LexicalListItemNode.test.ts, can serialize a node that is not attached.
#[test]
fn detached_item_export_omits_checked_and_ignores_import_indent() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let item = create_list_item_node(&mut tx, Some(true))?;
    set_indent(&mut tx, item, 3)?;
    set_value(&mut tx, item, 9)?;
    assert_eq!(get_indent(&tx, item), 0);
    assert_eq!(get_checked(&tx, item), None);
    assert_eq!(
        serde_json::Value::Object(tx.export_json(item)?),
        json!({"children":[],"direction":null,"format":"","indent":0,"type":"listitem","version":1,"value":9})
    );
    tx.update_from_json(
        item,
        &json!({"type":"listitem","version":1,"value":4,"checked":true,"indent":7})
            .as_object()
            .expect("object")
            .clone(),
    )?;
    assert_eq!(get_indent(&tx, item), 0);
    assert_eq!(get_value(&tx, item)?, 4);
    Ok(())
}
/// upstream: LexicalListItemNode.test.ts, indents/outdents and reset-on-copy checked.
#[test]
fn item_indent_restructures_and_copy_resets_checked_in_checklist() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Check, 1)?;
    let a = create_list_item_node(&mut tx, Some(true))?;
    let b = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    assert_eq!(get_checked(&tx, a), Some(true));
    let copy = tx.copy_node(a, false)?;
    assert_eq!(
        tx.get::<ListItemNode>(copy).expect("copy").checked,
        Some(false)
    );
    toggle_checked(&mut tx, b)?;
    assert_eq!(get_checked(&tx, b), Some(true));
    set_indent(&mut tx, b, 2)?;
    assert_eq!(get_indent(&tx, b), 2);
    assert_eq!(get_list_depth(&tx, list_id(&tx, tx.parent_or_err(b)?)?)?, 3);
    assert_eq!(get_top_list_node(&tx, b.key())?, list);
    assert!(is_last_item_in_list(&tx, b));
    set_indent(&mut tx, b, 0)?;
    assert_eq!(tx.children_keys(list)?, vec![a.key(), b.key()]);
    Ok(())
}
/// upstream: LexicalListItemNode.test.ts, append another item/paragraph flattens children.
#[test]
fn append_merges_item_and_paragraph_children() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let a = create_list_item_node(&mut tx, None)?;
    let b = create_list_item_node(&mut tx, None)?;
    let p = tx.create(Paragraph {})?;
    let x = tx.create_text("x")?;
    let y = tx.create_text("y")?;
    tx.append(b, &[x.key()])?;
    tx.append(p, &[y.key()])?;
    tx.append(a, &[b.key(), p.key()])?;
    assert_eq!(tx.children_keys(a)?, vec![x.key(), y.key()]);
    assert_eq!(tx.parent(b), None);
    assert_eq!(tx.parent(p), None);
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, replace first item with a non-item.
#[test]
fn replace_first_item_lifts_block_and_preserves_children() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let a = create_list_item_node(&mut tx, None)?;
    let b = create_list_item_node(&mut tx, None)?;
    let c = create_list_item_node(&mut tx, None)?;
    let old = [a, b, c][0];
    let text = tx.create_text("kept")?;
    tx.append(old, &[text.key()])?;
    tx.append(list, &[a.key(), b.key(), c.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.element(old)?
        .select(Some(ChildIndex(0)), Some(ChildIndex(1)))?;
    let p = tx.create(Paragraph {})?;
    tx.replace(old, p, true)?;
    assert_eq!(tx.parent(text), Some(p.key()));
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.anchor,
        Point::element(p.key(), ChildIndex(0))
    );
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.focus,
        Point::element(p.key(), ChildIndex(1))
    );
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![p.key(), list.key()]);
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, replace middle item with a non-item.
#[test]
fn replace_middle_item_lifts_block_and_preserves_children() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let a = create_list_item_node(&mut tx, None)?;
    let b = create_list_item_node(&mut tx, None)?;
    let c = create_list_item_node(&mut tx, None)?;
    let old = [a, b, c][1];
    let text = tx.create_text("kept")?;
    tx.append(old, &[text.key()])?;
    tx.append(list, &[a.key(), b.key(), c.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.element(old)?
        .select(Some(ChildIndex(0)), Some(ChildIndex(1)))?;
    let p = tx.create(Paragraph {})?;
    tx.replace(old, p, true)?;
    assert_eq!(tx.parent(text), Some(p.key()));
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.anchor,
        Point::element(p.key(), ChildIndex(0))
    );
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.focus,
        Point::element(p.key(), ChildIndex(1))
    );
    let tail = tx.next_sibling(p).expect("split list");
    assert_eq!(tx.children_keys(tail)?, vec![c.key()]);
    assert_eq!(
        tx.children_keys(NodeKey::ROOT)?,
        vec![list.key(), p.key(), tail]
    );
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, replace last item with a non-item.
#[test]
fn replace_last_item_lifts_block_and_preserves_children() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let a = create_list_item_node(&mut tx, None)?;
    let b = create_list_item_node(&mut tx, None)?;
    let c = create_list_item_node(&mut tx, None)?;
    let old = [a, b, c][2];
    let text = tx.create_text("kept")?;
    tx.append(old, &[text.key()])?;
    tx.append(list, &[a.key(), b.key(), c.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.element(old)?
        .select(Some(ChildIndex(0)), Some(ChildIndex(1)))?;
    let p = tx.create(Paragraph {})?;
    tx.replace(old, p, true)?;
    assert_eq!(tx.parent(text), Some(p.key()));
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.anchor,
        Point::element(p.key(), ChildIndex(0))
    );
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.focus,
        Point::element(p.key(), ChildIndex(1))
    );
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![list.key(), p.key()]);
    Ok(())
}

/// upstream: S3 R2-35 / ListItemNode.collapseAtStart nested branch drops item content.
#[test]
fn collapse_at_start_nested_drops_item_content() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let outer = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let wrapper = create_list_item_node(&mut tx, None)?;
    let inner = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    let text = tx.create_text("discarded")?;
    tx.append(item, &[text.key()])?;
    tx.append(inner, &[item.key()])?;
    tx.append(wrapper, &[inner.key()])?;
    tx.append(outer, &[wrapper.key()])?;
    tx.append(NodeKey::ROOT, &[outer.key()])?;
    tx.select_start(item)?;
    assert!(tx.collapse_at_start(item, SelectionSlot::Active)?);
    assert!(tx.children_keys(wrapper)?.is_empty());
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.anchor,
        Point::element(wrapper.key(), ChildIndex(0))
    );
    tx.commit()?;
    assert!(!editor.state().contains(text));
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, orphan inside paragraph with surrounding siblings.
#[test]
fn orphan_inside_paragraph_0_0() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph {})?;
    let item = create_list_item_node(&mut tx, None)?;
    let content = tx.create_text("item")?;
    tx.append(item, &[content.key()])?;
    tx.append(paragraph, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.flush()?;
    let parent = tx.parent_or_err(item)?;
    assert!(tx.is::<ListNode>(parent));
    assert_eq!(tx.parent(parent), Some(NodeKey::ROOT));
    assert_eq!(tx.children_size(NodeKey::ROOT), 1);
    assert_eq!(tx.text_content(NodeKey::ROOT), "item");
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, orphan inside paragraph with surrounding siblings.
#[test]
fn orphan_inside_paragraph_1_0() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph {})?;
    let before = tx.create_text("before")?;
    let item = create_list_item_node(&mut tx, None)?;
    let content = tx.create_text("item")?;
    tx.append(item, &[content.key()])?;
    tx.append(paragraph, &[before.key(), item.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.flush()?;
    let parent = tx.parent_or_err(item)?;
    assert!(tx.is::<ListNode>(parent));
    assert_eq!(tx.parent(parent), Some(NodeKey::ROOT));
    assert_eq!(tx.children_size(NodeKey::ROOT), 2);
    assert_eq!(tx.text_content(NodeKey::ROOT), "before\n\nitem");
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, orphan inside paragraph with surrounding siblings.
#[test]
fn orphan_inside_paragraph_0_1() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph {})?;
    let item = create_list_item_node(&mut tx, None)?;
    let content = tx.create_text("item")?;
    let after = tx.create_text("after")?;
    tx.append(item, &[content.key()])?;
    tx.append(paragraph, &[item.key(), after.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.flush()?;
    let parent = tx.parent_or_err(item)?;
    assert!(tx.is::<ListNode>(parent));
    assert_eq!(tx.parent(parent), Some(NodeKey::ROOT));
    assert_eq!(tx.children_size(NodeKey::ROOT), 2);
    assert_eq!(tx.text_content(NodeKey::ROOT), "item\n\nafter");
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, orphan inside paragraph with surrounding siblings.
#[test]
fn orphan_inside_paragraph_1_1() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph {})?;
    let before = tx.create_text("before")?;
    let item = create_list_item_node(&mut tx, None)?;
    let content = tx.create_text("item")?;
    let after = tx.create_text("after")?;
    tx.append(item, &[content.key()])?;
    tx.append(paragraph, &[before.key(), item.key(), after.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.flush()?;
    let parent = tx.parent_or_err(item)?;
    assert!(tx.is::<ListNode>(parent));
    assert_eq!(tx.parent(parent), Some(NodeKey::ROOT));
    assert_eq!(tx.children_size(NodeKey::ROOT), 3);
    assert_eq!(tx.text_content(NodeKey::ROOT), "before\n\nitem\n\nafter");
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, contiguous orphan items stay in document order.
#[test]
fn orphan_group_stops_at_nonitem_and_keeps_previous_item_order() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let a = create_list_item_node(&mut tx, None)?;
    let b = create_list_item_node(&mut tx, None)?;
    let current = create_list_item_node(&mut tx, None)?;
    tx.append(NodeKey::ROOT, &[p.key(), a.key(), b.key(), current.key()])?;
    list_item_node_transform(&mut tx, current)?;
    let list = tx.parent_or_err(current)?;
    assert_eq!(
        tx.children_keys(list)?,
        vec![a.key(), b.key(), current.key()]
    );
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![p.key(), list]);
    Ok(())
}
/// upstream: LexicalListItemNode.test.ts, insertAfter non-item splits the list.
#[test]
fn insert_after_nonitem_splits_following_siblings() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Number, 5)?;
    let a = create_list_item_node(&mut tx, None)?;
    let b = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    let p = tx.create(Paragraph {})?;
    tx.insert_after(a, p, true)?;
    let trailing = tx.next_sibling(p).expect("trailing list");
    assert_eq!(tx.children_keys(list)?, vec![a.key()]);
    assert_eq!(tx.children_keys(trailing)?, vec![b.key()]);
    assert_eq!(tx.get::<ListNode>(trailing).expect("list").start(), 5);
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, preserves selection on a root orphan.
#[test]
fn wrapping_root_orphan_preserves_text_selection() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let item = create_list_item_node(&mut tx, None)?;
    let text = tx.create_text("orphan")?;
    tx.append(item, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key(), item.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(4)))?;
    tx.flush()?;
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.anchor,
        Point::text(text.key(), Utf16Offset(2))
    );
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.focus,
        Point::text(text.key(), Utf16Offset(4))
    );
    assert!(tx.parent(item).is_some_and(|k| tx.is::<ListNode>(k)));
    Ok(())
}

#[test]
fn inserting_list_before_item_text_merges_tail_into_inner_item() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let item = tx.create(ListItemNode::default())?;
        let text = tx.create_text("a")?;
        tx.append(item, &[text.key()])?;
        tx.append(list, &[item.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        tx.select_start(text)?;
        Ok(text)
    })?;
    editor.update(|tx| {
        let pasted = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let item = tx.create(ListItemNode::default())?;
        let inserted = tx.create_text("a")?;
        tx.append(item, &[inserted.key()])?;
        tx.append(pasted, &[item.key()])?;
        tx.insert_nodes(&[pasted.key()])
    })?;
    let state = editor.state();
    let roots = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(roots.len(), 1);
    let list = roots[0];
    assert!(state.is::<ListNode>(list));
    assert_eq!(state.children_keys(list)?.len(), 1);
    assert_eq!(state.text_content(list).as_ref(), "aa");
    assert!(!state.is_attached(text));
    assert_eq!(
        state
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor
            .offset(),
        1
    );
    Ok(())
}

#[test]
fn no_view_backspace_after_line_break_does_not_collapse_list_item() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
    let item = tx.create(ListItemNode::default())?;
    let line = tx.create(LineBreak::default())?;
    let text = tx.create_text("text")?;
    tx.append(item, &[line.key(), text.key()])?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.select_start(text)?;
    tx.delete_character(EditDirection::Backward, ModifyTarget::NoView)?;
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![list.key()]);
    assert_eq!(tx.children_keys(item)?, vec![line.key(), text.key()]);
    Ok(())
}
