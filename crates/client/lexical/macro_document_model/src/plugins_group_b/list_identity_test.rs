use super::*;
use crate::nodes::TaskListNode;
use crate::{EditorType, surface};
use lexical_rich_nodes::list::ListNode;
use serde_json::json;

#[test]
fn plain_markdown_bullet_paste_retains_the_configured_task_list_identity() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface registry");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_start(paragraph)
    })?;
    let mut clipboard = ClipboardPayload::default();
    clipboard.data.insert(
        "text/plain".into(),
        "# Head\n\n- a\n- b\n\n**bold** text".into(),
    );
    assert_eq!(editor.dispatch(&Command::Paste(clipboard))?.0, Handled::Yes);
    let state = editor.state().to_json()?;
    let list = &state.root["children"][1];
    assert_eq!(list["type"], "task-list");
    assert_eq!(list["listType"], "bullet");
    assert_eq!(list["tag"], "ul");
    assert_eq!(list["children"][0]["children"][0]["text"], "a");
    assert_eq!(list["children"][1]["children"][0]["text"], "b");
    Ok(())
}

#[test]
fn cold_plain_list_upgrades_on_a_dirty_update_without_losing_children_state_or_selection()
-> Result<(), Error> {
    let initial = serde_json::from_value(json!({"root": {
        "type":"root", "version":1, "children":[{
            "type":"list", "version":1, "listType":"number", "tag":"ol", "start":3,
            "format":"center", "indent":2, "direction":"rtl",
            "$":{"id":"stored-list", "taskListView":{"filters":{"status":["done"]},"future":true},"futureState":{"keep":[1,2]}},
            "children":[{"type":"listitem","version":1,"value":3,
                "children":[{"type":"text","version":1,"text":"keep"}]}]
        }]
    }})).expect("stored fixture");
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .initial_state(initial)
            .build()
            .expect("surface registry");
    let list = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    let children = editor.state().view().children_keys(list)?;
    let before = editor.state().to_json()?;
    assert_eq!(before.root["children"][0]["type"], "list");
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::element(list, ChildIndex(1)),
        ))))?;
        tx.get_mut::<ListNode>(list)?.set_start(7);
        Ok(())
    })?;
    let replacement = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    assert_ne!(list, replacement);
    assert!(editor.state().view().is::<TaskListNode>(replacement));
    assert_eq!(editor.state().view().children_keys(replacement)?, children);
    let after = editor.state().to_json()?;
    let upgraded = &after.root["children"][0];
    assert_eq!(upgraded["type"], "task-list");
    assert_eq!(upgraded["start"], 7);
    assert_eq!(upgraded["listType"], "number");
    assert_eq!(upgraded["tag"], "ol");
    assert_eq!(upgraded["format"], "center");
    assert_eq!(upgraded["indent"], 2);
    assert_eq!(upgraded["direction"], "rtl");
    assert_eq!(upgraded["$"], before.root["children"][0]["$"]);
    let selection = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(selection.anchor, Point::element(replacement, ChildIndex(1)));
    assert_eq!(selection.focus, selection.anchor);
    editor.update(|tx| {
        tx.get_mut::<ListNode>(replacement)?.set_start(8);
        Ok(())
    })?;
    assert_eq!(
        editor.state().view().children_keys(NodeKey::ROOT)?[0],
        replacement
    );
    Ok(())
}

#[test]
fn registry_only_stored_import_keeps_its_plain_list_class_after_a_dirty_update() -> Result<(), Error>
{
    let mut editor = crate::editor::headless_editor();
    editor.update(|tx| {
        let list = tx.import_node(
            json!({
                "type":"list", "version":1, "listType":"bullet", "tag":"ul", "start":1,
                "children":[{"type":"listitem","version":1,"value":1,
                    "children":[{"type":"text","version":1,"text":"generic"}]}]
            })
            .as_object()
            .expect("stored list"),
        )?;
        tx.append(NodeKey::ROOT, &[list])?;
        tx.get_mut::<ListNode>(list)?.set_start(2);
        Ok(())
    })?;
    assert_eq!(
        editor.state().to_json()?.root["children"][0]["type"],
        "list"
    );
    Ok(())
}

#[test]
fn headless_and_non_sync_surfaces_do_not_install_the_body_controls_transform() -> Result<(), Error>
{
    for (preset, mode) in [
        (EditorType::MarkdownSync, EditorMode::Headless),
        (EditorType::Markdown, EditorMode::ViewAttached),
    ] {
        let mut editor = surface::preset_builder_with_mode(preset, mode)
            .build()
            .expect("surface registry");
        editor.update(|tx| {
            let list = tx.import_node(
                json!({
                    "type":"list", "version":1, "listType":"bullet", "tag":"ul", "start":1,
                    "children":[{"type":"listitem","version":1,"value":1,
                        "children":[{"type":"text","version":1,"text":"outside body"}]}]
                })
                .as_object()
                .expect("stored list"),
            )?;
            tx.append(NodeKey::ROOT, &[list])?;
            tx.get_mut::<ListNode>(list)?.set_start(2);
            Ok(())
        })?;
        assert_eq!(
            editor.state().to_json()?.root["children"][0]["type"],
            "list"
        );
    }
    Ok(())
}

#[test]
fn dirty_imported_checklist_preserves_its_existing_text_caret() -> Result<(), Error> {
    let initial = serde_json::from_value(json!({"root": {
        "type":"root", "version":1, "children":[{
            "type":"list", "version":1, "listType":"check", "tag":"ul", "start":1,
            "children":[{"type":"listitem","version":1,"value":1,"checked":true,
                "children":[{"type":"text","version":1,"text":"keep"}]}]
        }]
    }}))
    .expect("stored fixture");
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .initial_state(initial)
            .build()
            .expect("surface registry");
    let list = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    let item = editor.state().view().children_keys(list)?[0];
    let text = editor.state().view().children_keys(item)?[0];
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::text(text, Utf16Offset(2)),
        ))))?;
        tx.get_mut::<ListNode>(list)?.set_start(2);
        Ok(())
    })?;
    let replacement = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    assert!(editor.state().view().is::<TaskListNode>(replacement));
    assert_eq!(
        editor.state().view().children_keys(replacement)?,
        vec![item]
    );
    assert_eq!(editor.state().view().children_keys(item)?, vec![text]);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.anchor, Point::text(text, Utf16Offset(2)));
    assert_eq!(range.focus, range.anchor);
    assert_eq!(
        editor.state().to_json()?.root["children"][0]["children"][0]["checked"],
        true
    );
    Ok(())
}

#[test]
fn native_remote_dirty_list_admits_the_transform_without_claiming_remote_writer_policy()
-> Result<(), Error> {
    let initial = serde_json::from_value(json!({"root": {
        "type":"root", "version":1, "children":[{
            "type":"list", "version":1, "listType":"bullet", "tag":"ul", "start":1,
            "$":{"id":"remote-list"},
            "children":[{"type":"listitem","version":1,"value":1,
                "children":[{"type":"text","version":1,"text":"remote child"}]}]
        }]
    }}))
    .expect("stored fixture");
    let editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .initial_state(initial)
            .build()
            .expect("surface registry");
    let list = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    let children = editor.state().view().children_keys(list)?;
    let mut fields = editor.state().to_json()?.root["children"][0]
        .as_object()
        .expect("list")
        .clone();
    fields.remove("children");
    fields.insert("start".into(), 9.into());
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.apply(
        Input::ApplyRemote {
            changes: vec![NodeChange::Update {
                node: NodeTarget::Key(list),
                json: fields,
            }],
            options: UpdateOptions {
                skip_transforms: false,
                tags: TagSet::from_tags([UpdateTag::Collaboration]),
            },
        },
        HistoryTime(1),
    )
    .expect("actual native remote update");
    let replacement = core.state().view().children_keys(NodeKey::ROOT)?[0];
    assert!(core.state().view().is::<TaskListNode>(replacement));
    assert_eq!(core.state().view().children_keys(replacement)?, children);
    let state = core.state().to_json()?;
    assert_eq!(state.root["children"][0]["start"], 9);
    assert_eq!(state.root["children"][0]["$"]["id"], "remote-list");
    Ok(())
}

#[test]
fn dirty_nested_imported_lists_upgrade_without_a_top_level_or_checklist_only_guard()
-> Result<(), Error> {
    let initial = serde_json::from_value(json!({"root": {
        "type":"root", "version":1, "children":[{
            "type":"list", "version":1, "listType":"bullet", "tag":"ul", "start":1,
            "children":[{"type":"listitem","version":1,"value":1,"children":[
                {"type":"list","version":1,"listType":"check","tag":"ul","start":1,
                    "children":[{"type":"listitem","version":1,"value":1,"checked":false,
                        "children":[{"type":"text","version":1,"text":"nested"}]}]}
            ]}]
        }]
    }}))
    .expect("stored fixture");
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .initial_state(initial)
            .build()
            .expect("surface registry");
    let outer = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    let wrapper = editor.state().view().children_keys(outer)?[0];
    let inner = editor.state().view().children_keys(wrapper)?[0];
    let items = editor.state().view().children_keys(inner)?;
    editor.update(|tx| {
        tx.get_mut::<ListNode>(outer)?.set_start(2);
        tx.get_mut::<ListNode>(inner)?.set_start(3);
        Ok(())
    })?;
    let actual_outer = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    let actual_inner = editor.state().view().children_keys(wrapper)?[0];
    assert!(editor.state().view().is::<TaskListNode>(actual_outer));
    assert!(editor.state().view().is::<TaskListNode>(actual_inner));
    assert_eq!(
        editor.state().view().children_keys(actual_outer)?,
        vec![wrapper]
    );
    assert_eq!(editor.state().view().children_keys(actual_inner)?, items);
    assert_eq!(editor.state().view().text_content(actual_inner), "nested");
    Ok(())
}
