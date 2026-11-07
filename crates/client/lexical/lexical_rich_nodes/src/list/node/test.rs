use super::*;
use crate::list::{item::*, register::*, utils::*};
use serde_json::json;

/// upstream: LexicalListNode.test.ts, constructor/getTag and ListItemNode exportJSON.
#[test]
fn number_list_serializes_numbering_and_derived_tag() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Number, 3)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.commit()?;
    assert_eq!(
        serde_json::to_value(editor.state().to_json()?)?,
        json!({"root": {"children":[{"children":[{"children":[],"direction":null,"format":"","indent":0,"type":"listitem","version":1,"value":3}],"direction":null,"format":"","indent":0,"type":"list","version":1,"listType":"number","start":3,"tag":"ol"}],"direction":null,"format":"","indent":0,"type":"root","version":1}})
    );
    Ok(())
}

/// upstream: LexicalListNode.test.ts, constructor/getTag and ListItemNode exportJSON.
#[test]
fn bullet_list_serializes_numbering_and_derived_tag() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 3)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.commit()?;
    assert_eq!(
        serde_json::to_value(editor.state().to_json()?)?,
        json!({"root": {"children":[{"children":[{"children":[],"direction":null,"format":"","indent":0,"type":"listitem","version":1,"value":3}],"direction":null,"format":"","indent":0,"type":"list","version":1,"listType":"bullet","start":3,"tag":"ul"}],"direction":null,"format":"","indent":0,"type":"root","version":1}})
    );
    Ok(())
}

/// upstream: LexicalListNode.test.ts, constructor/getTag and ListItemNode exportJSON.
#[test]
fn check_list_serializes_numbering_and_derived_tag() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Check, 3)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.commit()?;
    assert_eq!(
        serde_json::to_value(editor.state().to_json()?)?,
        json!({"root": {"children":[{"children":[{"children":[],"direction":null,"format":"","indent":0,"type":"listitem","version":1, "checked": false,"value":3}],"direction":null,"format":"","indent":0,"type":"list","version":1,"listType":"check","start":3,"tag":"ul"}],"direction":null,"format":"","indent":0,"type":"root","version":1}})
    );
    Ok(())
}

/// upstream: LexicalListNode.test.ts, append ParagraphNode/splice multiple non-items.
#[test]
fn splice_wraps_blocks_text_and_nested_lists() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let paragraph = tx.create(Paragraph {})?;
    let text = tx.create_text("block")?;
    tx.append(paragraph, &[text.key()])?;
    let plain = tx.create_text("plain")?;
    let inner = create_list_node(&mut tx, ListType::Number, 7)?;
    tx.splice(
        list,
        ChildIndex(0),
        0,
        &[paragraph.key(), plain.key(), inner.key()],
    )?;
    let items = tx.children_keys(list)?;
    assert_eq!(items.len(), 3);
    assert_eq!(tx.text_content(items[0]), "block");
    assert_eq!(tx.first_child(items[1]), Some(plain.key()));
    assert_eq!(tx.first_child(items[2]), Some(inner.key()));
    assert_eq!(get_list_depth(&tx, inner)?, 2);
    assert!(!tx.can_be_empty(list));
    assert!(!tx.can_indent(list));
    assert!(is_list_node(&tx, list.key()));
    assert!(!is_list_node(&tx, plain.key()));
    Ok(())
}
/// upstream: LexicalListNode.test.ts, checklist-to-bullet clears checked attributes.
#[test]
fn switching_marker_type_clears_stored_checked_state_and_merges_lists() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let a = create_list_node(&mut tx, ListType::Check, 2)?;
    let first = create_list_item_node(&mut tx, Some(true))?;
    let b = create_list_node(&mut tx, ListType::Bullet, 99)?;
    let second = create_list_item_node(&mut tx, None)?;
    tx.append(a, &[first.key()])?;
    tx.append(b, &[second.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
    tx.get_mut::<ListNode>(a)?.set_list_type(ListType::Bullet);
    tx.commit()?;
    let st = editor.state();
    assert_eq!(st.children_keys(NodeKey::ROOT)?, vec![a.key()]);
    assert_eq!(st.children_keys(a)?, vec![first.key(), second.key()]);
    assert_eq!(st.get::<ListItemNode>(first).expect("item").checked, None);
    assert_eq!(get_value(st, second)?, 3);
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct TaskList {
    #[serde(flatten)]
    list: ListNode,
}
impl NodeType for TaskList {
    const TYPE: &'static str = "task-list";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for TaskList {
    type Parent = ListNode;
    fn as_parent(&self) -> &ListNode {
        &self.list
    }
    fn as_parent_mut(&mut self) -> Option<&mut ListNode> {
        Some(&mut self.list)
    }
}
/// upstream: LexicalListNode.test.ts, intrinsic transforms are inherited by subclasses.
#[test]
fn subclass_inherits_splice_numbering_and_intrinsic_merge() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .node::<TaskList>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let task = tx.create(TaskList {
        list: ListNode::new(ListType::Number, 8),
    })?;
    let text = tx.create_text("wrapped")?;
    tx.append(task, &[text.key()])?;
    let following = create_list_node(&mut tx, ListType::Number, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(following, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[task.key(), following.key()])?;
    tx.commit()?;
    let st = editor.state();
    assert!(is_list_node(st, task.key()));
    assert_eq!(st.children_keys(NodeKey::ROOT)?, vec![task.key()]);
    assert_eq!(get_value(st, item)?, 9);
    assert_eq!(st.text_content(st.first_child_or_err(task)?), "wrapped");
    Ok(())
}

#[test]
fn splitting_raw_text_in_list_dispatches_parent_splice() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    let text = tx.create_text(" ab")?;
    tx.insert_before(item, text, true)?;
    let parts = tx.text(text)?.split_text(&[Utf16Offset(1)])?;
    assert_eq!(parts.len(), 2);
    let children = tx.children_keys(list)?;
    assert_eq!(children.len(), 2);
    assert!(tx.is::<ListItemNode>(children[0]));
    assert!(tx.is::<ListItemNode>(children[1]));
    assert_eq!(tx.text_content(children[0]), " ");
    assert_eq!(tx.text_content(children[1]), "ab");
    Ok(())
}

#[test]
fn paragraph_insertion_at_a_list_boundary_uses_the_root_fallback() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::element(list, ChildIndex(0)),
    ))))?;
    tx.insert_paragraph()?;
    let children = tx.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 3);
    assert_eq!(children[0], list.key());
    assert!(tx.is::<Paragraph>(children[1]));
    assert!(tx.is::<Paragraph>(children[2]));
    assert_eq!(tx.anchor()?, Point::element(children[2], ChildIndex(0)));
    Ok(())
}
