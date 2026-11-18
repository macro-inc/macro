use crate::nodes::{DocumentMentionNode, Maybe};
use crate::{EditorType, surface};
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType};
use serde_json::{Value, json};

fn builder() -> EditorBuilder {
    surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .extension_state(crate::NodeClock(std::sync::Arc::new(|| 1_000_000)))
        .extension_state(crate::NodeRandom(std::sync::Arc::new(|length| {
            vec![4; length]
        })))
        .extension_state(crate::NodeHost::default())
}

fn with_text(text: &str) -> (Editor, NodeKey) {
    let mut editor = builder().build().expect("surface");
    let (key, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let leaf = tx.create_text(text)?;
            tx.append(p, &[leaf.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            // The live caret is elsewhere: insertion follows the saved point.
            tx.select_start(leaf)?;
            Ok(leaf.key())
        })
        .expect("text");
    (editor, key)
}

/// Insert one task mention; the point after it, from the emitted event.
fn insert(editor: &mut Editor, point: Value, title: &str) -> Result<Option<Value>, Error> {
    let generation = editor.state().max_key().generation();
    let command = surface::decode_command(
        "group-b.insert-task-mention-at-point",
        &json!({ "point": point, "documentId": format!("id-{title}"), "documentName": title, "mentionUuid": "m-1" })
            .to_string(),
        generation,
        None,
    )?
    .expect("routed task mention insertion");
    let (handled, commit) = editor.dispatch(&command)?;
    if handled == Handled::No {
        return Ok(None);
    }
    Ok(commit
        .events
        .iter()
        .find_map(|event| crate::plugins_group_b::event_payload(event).ok().flatten()))
}

/// Paragraph children rendered as text, with each mention as `[title]`.
fn paragraph(editor: &Editor) -> String {
    let view = editor.state().view();
    let p = view.first_child(NodeKey::ROOT).expect("p");
    view.children(p)
        .map(|key| match view.get::<DocumentMentionNode>(key) {
            Some(mention) => format!("[{}]", mention.document_name.as_deref().unwrap_or_default()),
            None => view.text_content(key).into_owned(),
        })
        .collect()
}

#[test]
fn inserts_a_space_and_the_task_mention_at_the_saved_point() -> Result<(), Error> {
    let (mut editor, key) = with_text("buy milk today.");
    let next = insert(
        &mut editor,
        json!({"key": key.index(), "offset": 14, "type": "text"}),
        "task",
    )?;
    assert!(next.is_some());
    assert_eq!(paragraph(&editor), "buy milk today [task].");
    let view = editor.state().view();
    let mention = view
        .children(view.first_child(NodeKey::ROOT).expect("p"))
        .find_map(|key| view.get::<DocumentMentionNode>(key))
        .expect("mention");
    assert_eq!(mention.block_name, Maybe::Value("task".into()));
    assert_eq!(mention.mention_uuid, Maybe::Value("m-1".into()));
    // Source $createDocumentMentionNode stamps createdAt (Date.now()); the
    // model stamps it from the session clock.
    assert_eq!(mention.created_at, Maybe::Value(1_000_000));
    Ok(())
}

#[test]
fn successive_inserts_follow_the_returned_point() -> Result<(), Error> {
    let (mut editor, key) = with_text("buy milk today.");
    let next = insert(
        &mut editor,
        json!({"key": key.index(), "offset": 14, "type": "text"}),
        "one",
    )?
    .expect("first point");
    assert_eq!(next["type"], "element");
    insert(&mut editor, next.clone(), "two")?.expect("second point");
    // Source returns the point before normalization merges the space into
    // the text, so the second link lands after the trailing "." (checked
    // against real Lexical $insertAtSavedPoint with the same two nodes).
    assert_eq!(paragraph(&editor), "buy milk today [one]. [two]");
    Ok(())
}

#[test]
fn inserts_at_the_start_and_end_of_a_text_node() -> Result<(), Error> {
    let (mut start, key) = with_text("today");
    insert(
        &mut start,
        json!({"key": key.index(), "offset": 0, "type": "text"}),
        "task",
    )?;
    assert_eq!(paragraph(&start), " [task]today");
    let (mut end, key) = with_text("today");
    insert(
        &mut end,
        json!({"key": key.index(), "offset": 5, "type": "text"}),
        "task",
    )?;
    assert_eq!(paragraph(&end), "today [task]");
    Ok(())
}

fn checklist() -> (Editor, NodeKey) {
    let mut editor = builder().build().expect("surface");
    let (list, _) = editor
        .update(|tx| {
            let list = tx.create(ListNode::new(ListType::Check, 1))?;
            for title in ["a", "b", "c"] {
                let item = tx.create(ListItemNode {
                    checked: Some(false),
                    ..ListItemNode::default()
                })?;
                let text = tx.create_text(title)?;
                tx.append(item, &[text.key()])?;
                tx.append(list, &[item.key()])?;
            }
            tx.append(NodeKey::ROOT, &[list.key()])?;
            Ok(list.key())
        })
        .expect("checklist");
    (editor, list)
}

fn item_texts(editor: &Editor, list: NodeKey) -> Vec<String> {
    let view = editor.state().view();
    view.children(list)
        .map(|item| {
            view.children(item)
                .map(|key| match view.get::<DocumentMentionNode>(key) {
                    Some(mention) => {
                        format!("[{}]", mention.document_name.as_deref().unwrap_or_default())
                    }
                    None => view.text_content(key).into_owned(),
                })
                .collect()
        })
        .collect()
}

#[test]
fn between_checklist_items_links_after_the_item_text() -> Result<(), Error> {
    let (mut editor, list) = checklist();
    assert!(
        insert(
            &mut editor,
            json!({"key": list.index(), "offset": 2, "type": "element"}),
            "task"
        )?
        .is_some()
    );
    assert_eq!(item_texts(&editor, list), vec!["a", "b [task]", "c"]);
    Ok(())
}

#[test]
fn before_the_first_item_adds_nothing() -> Result<(), Error> {
    let (mut editor, list) = checklist();
    assert!(
        insert(
            &mut editor,
            json!({"key": list.index(), "offset": 0, "type": "element"}),
            "task"
        )?
        .is_none()
    );
    assert_eq!(item_texts(&editor, list), vec!["a", "b", "c"]);
    Ok(())
}

#[test]
fn a_removed_node_inserts_nothing() -> Result<(), Error> {
    let (mut editor, key) = with_text("today");
    editor.update(|tx| tx.remove(key, false))?;
    assert!(
        insert(
            &mut editor,
            json!({"key": key.index(), "offset": 2, "type": "text"}),
            "task"
        )?
        .is_none()
    );
    Ok(())
}
