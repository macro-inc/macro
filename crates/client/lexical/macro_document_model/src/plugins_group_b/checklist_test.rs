use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType, item::get_checked};

#[test]
fn selected_mixed_checkboxes_toggle_to_the_opposite_of_the_first() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (items, _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let first = tx.create(ListItemNode {
            checked: Some(false),
            ..ListItemNode::default()
        })?;
        let second = tx.create(ListItemNode {
            checked: Some(true),
            ..ListItemNode::default()
        })?;
        let a = tx.create_text("a")?;
        let b = tx.create_text("b")?;
        tx.append(first, &[a.key()])?;
        tx.append(second, &[b.key()])?;
        tx.append(list, &[first.key(), second.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(a, Utf16Offset(0)));
        range.focus = Point::text(b, Utf16Offset(1));
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok([first, second])
    })?;
    let command = decode_command(
        "group-b.checklist",
        "{\"action\":\"toggle-selection\"}",
        items[0].key().generation(),
        None,
    )?
    .expect("checklist command");
    editor.dispatch(&command)?;
    assert_eq!(
        items.map(|item| get_checked(&editor.state().view(), item)),
        [Some(true), Some(true)]
    );
    editor.dispatch(&command)?;
    assert_eq!(
        items.map(|item| get_checked(&editor.state().view(), item)),
        [Some(false), Some(false)]
    );
    Ok(())
}

#[test]
fn checklist_settings_keep_unknown_fields_and_reject_nonobject_values() -> Result<(), Error> {
    use crate::nodes::get_task_list_view_settings;
    use serde_json::json;
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (list, _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let item = tx.create(ListItemNode::default())?;
        tx.append(list, &[item.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        Ok(list)
    })?;
    let command = decode_command("group-b.checklist", &json!({"action":"settings","key":list.key().index(),"settings":{"filters":{"status":["done"]},"future":{"keep":true}}}).to_string(), list.key().generation(), None)?.expect("settings");
    editor.dispatch(&command)?;
    assert_eq!(
        get_task_list_view_settings(&editor.state().view(), list.key())?.as_ref(),
        &json!({"filters":{"status":["done"]},"future":{"keep":true}})
    );
    let before = editor.state().to_json()?;
    let invalid = decode_command(
        "group-b.checklist",
        &json!({"action":"settings","key":list.key().index(),"settings":[]}).to_string(),
        list.key().generation(),
        None,
    )?
    .expect("settings command");
    assert!(editor.dispatch(&invalid).is_err());
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}
