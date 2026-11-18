use crate::nodes::{DocumentMentionNode, Maybe, TaskListNode, UserMentionNode};
use crate::{EditorType, surface};
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType};
use serde_json::{Value, json};

fn editor() -> Editor {
    surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .extension_state(crate::NodeClock(std::sync::Arc::new(|| 1_000_000)))
        .extension_state(crate::NodeRandom(std::sync::Arc::new(|length| {
            vec![4; length]
        })))
        .extension_state(crate::NodeHost::default())
        .build()
        .expect("surface")
}

/// A list of checklist items over `titles`, selected from the first item's
/// start to the last item's end (Source addCheckboxes).
fn checklist(editor: &mut Editor, titles: &[&str], kind: ListType) -> Vec<NodeKey> {
    let (keys, _) = editor
        .update(|tx| {
            let list = tx.create(ListNode::new(kind, 1))?;
            let mut items = Vec::new();
            let mut texts = Vec::new();
            for title in titles {
                let item = tx.create(ListItemNode {
                    checked: Some(false),
                    ..ListItemNode::default()
                })?;
                let text = tx.create_text(title)?;
                tx.append(item, &[text.key()])?;
                tx.append(list, &[item.key()])?;
                items.push(item.key());
                texts.push(text);
            }
            tx.append(NodeKey::ROOT, &[list.key()])?;
            let first = texts[0];
            let last = *texts.last().expect("text");
            let mut range = RangeSelection::collapsed(Point::text(first, Utf16Offset(0)));
            range.focus = Point::text(
                last,
                Utf16Offset(tx.view().text_content(last).encode_utf16().count() as u32),
            );
            tx.set_selection(Some(Selection::Range(range)))?;
            Ok(items)
        })
        .expect("checklist");
    keys
}

fn selected(editor: &Editor) -> Value {
    let generation = editor.state().max_key().generation();
    crate::plugins_group_b::query(
        "group-b.selected-checkboxes",
        &json!({}),
        generation,
        editor.state(),
    )
    .expect("query")
    .expect("routed checkbox query")
}

fn replace(editor: &mut Editor, items: Value) -> Result<Handled, Error> {
    let generation = editor.state().max_key().generation();
    let command = surface::decode_command(
        "group-b.checkbox-task-mentions",
        &json!({ "items": items }).to_string(),
        generation,
        None,
    )?
    .expect("routed checkbox replacement");
    Ok(editor.dispatch(&command)?.0)
}

fn mentions(editor: &Editor) -> Vec<(String, String, String)> {
    let view = editor.state().view();
    lexical_rich_nodes::utils::dfs(view, None, None)
        .into_iter()
        .filter_map(|record| view.get::<DocumentMentionNode>(record.node))
        .map(|mention| {
            (
                mention
                    .document_id
                    .as_deref()
                    .unwrap_or_default()
                    .to_owned(),
                mention
                    .document_name
                    .as_deref()
                    .unwrap_or_default()
                    .to_owned(),
                mention.block_name.as_deref().unwrap_or_default().to_owned(),
            )
        })
        .collect()
}

// Source $getSelectedCheckboxes + $parseCheckboxNodes: title trimmed and
// whitespace-collapsed, internal Markdown of the item.
#[test]
fn selected_checkboxes_report_key_title_and_internal_markdown() {
    let mut editor = editor();
    let keys = checklist(
        &mut editor,
        &["  First   task  ", "second"],
        ListType::Check,
    );
    let reply = selected(&editor);
    let items = reply.as_array().expect("items");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["key"], keys[0].index());
    assert_eq!(items[0]["title"], "First task");
    assert!(
        items[0]["markdown"]
            .as_str()
            .expect("markdown")
            .contains("First")
    );
    assert_eq!(items[1]["title"], "second");
}

// Source getChecked: only items of a check list are checkboxes.
#[test]
fn bullet_items_are_not_checkboxes() {
    let mut editor = editor();
    checklist(&mut editor, &["plain"], ListType::Bullet);
    assert_eq!(selected(&editor), json!([]));
}

// Macro's attached body upgrades checklists to TaskListNode.
#[test]
fn task_list_items_are_checkboxes() {
    let mut editor = editor();
    let (item, _) = editor
        .update(|tx| {
            let list = tx.create(TaskListNode {
                list: ListNode::new(ListType::Check, 1),
            })?;
            let item = tx.create(ListItemNode {
                checked: Some(true),
                ..ListItemNode::default()
            })?;
            let text = tx.create_text("task list item")?;
            tx.append(item, &[text.key()])?;
            tx.append(list, &[item.key()])?;
            tx.append(NodeKey::ROOT, &[list.key()])?;
            let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(0)));
            range.focus = Point::text(text, Utf16Offset(4));
            tx.set_selection(Some(Selection::Range(range)))?;
            Ok(item.key())
        })
        .expect("task list");
    let reply = selected(&editor);
    assert_eq!(reply[0]["key"], item.index());
    assert_eq!(reply[0]["title"], "task list item");
}

// Source $extractTitleFromNode skips user and date mentions.
#[test]
fn titles_skip_user_mentions() {
    let mut editor = editor();
    editor
        .update(|tx| {
            let list = tx.create(ListNode::new(ListType::Check, 1))?;
            let item = tx.create(ListItemNode {
                checked: Some(false),
                ..ListItemNode::default()
            })?;
            let before = tx.create_text("Ship ")?;
            let user = tx.create(UserMentionNode {
                user_id: Maybe::Value("user-1".into()),
                email: Maybe::Value("ada@example.com".into()),
                ..UserMentionNode::default()
            })?;
            let after = tx.create_text(" now")?;
            tx.append(item, &[before.key(), user.key(), after.key()])?;
            tx.append(list, &[item.key()])?;
            tx.append(NodeKey::ROOT, &[list.key()])?;
            let mut range = RangeSelection::collapsed(Point::text(before, Utf16Offset(0)));
            range.focus = Point::text(after, Utf16Offset(4));
            tx.set_selection(Some(Selection::Range(range)))
        })
        .expect("mention item");
    let reply = selected(&editor);
    assert_eq!(reply[0]["title"], "Ship now");
    assert!(
        reply[0]["markdown"]
            .as_str()
            .expect("markdown")
            .contains("m-user-mention")
    );
}

// Source: a non-range selection converts nothing and completes nothing.
#[test]
fn a_non_range_selection_reports_null() {
    let mut editor = editor();
    checklist(&mut editor, &["item"], ListType::Check);
    editor.update(|tx| tx.set_selection(None)).expect("clear");
    assert_eq!(selected(&editor), Value::Null);
}

// Source $replaceCheckboxWithMention: each still-attached item becomes a
// paragraph holding a task document mention, in one update; the list splits.
#[test]
fn replacement_swaps_attached_items_for_task_mentions_in_one_update() -> Result<(), Error> {
    let mut editor = editor();
    let keys = checklist(&mut editor, &["first", "middle", "last"], ListType::Check);
    let handled = replace(
        &mut editor,
        json!([
            { "key": keys[0].index(), "documentId": "task-1", "taskTitle": "first" },
            { "key": keys[1].index(), "documentId": "task-2", "taskTitle": "middle" },
        ]),
    )?;
    assert_eq!(handled, Handled::Yes);
    assert_eq!(
        mentions(&editor),
        vec![
            ("task-1".into(), "first".into(), "task".into()),
            ("task-2".into(), "middle".into(), "task".into()),
        ]
    );
    let view = editor.state().view();
    // Source $replaceCheckboxWithMention passes no createdAt, and
    // $createDocumentMentionNode then defaults it to Date.now().
    let stamped = lexical_rich_nodes::utils::dfs(view, None, None)
        .into_iter()
        .filter_map(|record| view.get::<DocumentMentionNode>(record.node))
        .all(|mention| mention.created_at == Maybe::Value(1_000_000));
    assert!(stamped);
    assert!(!view.contains(keys[0]) && !view.contains(keys[1]));
    assert!(view.contains(keys[2]));
    let roots: Vec<_> = view.children_keys(NodeKey::ROOT)?;
    assert!(view.get::<Paragraph>(roots[0]).is_some());
    assert!(view.get::<Paragraph>(roots[1]).is_some());
    assert!(view.get::<ListNode>(roots[2]).is_some());
    Ok(())
}

// Source does not resurrect an item deleted before its task was created.
#[test]
fn replacement_skips_detached_items_and_stale_generations() -> Result<(), Error> {
    let mut editor = editor();
    let keys = checklist(&mut editor, &["gone", "kept"], ListType::Check);
    editor.update(|tx| tx.remove(keys[0], false))?;
    let handled = replace(
        &mut editor,
        json!([{ "key": keys[0].index(), "documentId": "task-1", "taskTitle": "gone" }]),
    )?;
    assert_eq!(handled, Handled::No);
    assert!(mentions(&editor).is_empty());

    let generation = editor.state().max_key().generation();
    let stale = surface::decode_command(
        "group-b.checkbox-task-mentions",
        &json!({ "items": [{ "key": keys[1].index(), "documentId": "t", "taskTitle": "kept" }] })
            .to_string(),
        generation + 1,
        None,
    )?
    .expect("routed");
    assert_eq!(editor.dispatch(&stale)?.0, Handled::No);
    assert!(editor.state().view().contains(keys[1]));
    Ok(())
}

// Source MarkdownPopup's selectedCheckboxCount: items with a title only.
#[test]
fn the_count_query_counts_titled_items() {
    let mut editor = editor();
    checklist(&mut editor, &["one", "   ", "two"], ListType::Check);
    let generation = editor.state().max_key().generation();
    let count = crate::plugins_group_b::query(
        "group-b.selected-checkbox-count",
        &json!({}),
        generation,
        editor.state(),
    )
    .expect("query")
    .expect("routed count");
    assert_eq!(count, json!(2));
}

// JS trim and \s include NBSP and U+FEFF (Rust char::is_whitespace omits U+FEFF).
#[test]
fn titles_collapse_js_whitespace() {
    let mut editor = editor();
    checklist(
        &mut editor,
        &["\u{a0}Wrapped\u{feff}\u{a0} title\u{feff}"],
        ListType::Check,
    );
    assert_eq!(selected(&editor)[0]["title"], "Wrapped title");
}
