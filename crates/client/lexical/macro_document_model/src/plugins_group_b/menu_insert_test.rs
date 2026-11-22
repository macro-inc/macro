use crate::nodes::{AgentSessionMentionNode, BookingLinkMentionNode, GroupMentionNode, Maybe};
use crate::{EditorType, surface};
use lexical_model::*;
use serde_json::json;

fn editor_with_text(text: &str, offset: u32) -> Result<Editor, Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let leaf = tx.create_text(text)?;
        tx.append(p, &[leaf.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(leaf)?;
        tx.set_text_node_range(leaf, Utf16Offset(offset), leaf, Utf16Offset(offset))
    })?;
    Ok(editor)
}

fn insert(editor: &mut Editor, name: &str, payload: serde_json::Value) -> Result<Handled, Error> {
    let generation = editor.state().max_key().generation();
    let command = surface::decode_command(name, &payload.to_string(), generation, None)?
        .expect("routed native mention insertion");
    Ok(editor.dispatch(&command)?.0)
}

fn inserted<Node: NodeType + Clone>(editor: &Editor) -> Node {
    let view = editor.state().view();
    let p = view.first_child(NodeKey::ROOT).expect("p");
    view.children_keys(p)
        .expect("children")
        .into_iter()
        .find_map(|key| view.get::<Node>(key).cloned())
        .expect("inserted mention")
}

// Source INSERT_GROUP_MENTION_COMMAND: $insertNodes at the caret, then selectEnd.
#[test]
fn group_mention_inserts_at_the_caret() -> Result<(), Error> {
    let mut editor = editor_with_text("ab", 1)?;
    let handled = insert(
        &mut editor,
        "group-b.insert-group-mention",
        json!({ "groupAlias": "here" }),
    )?;
    assert_eq!(handled, Handled::Yes);
    assert_eq!(
        inserted::<GroupMentionNode>(&editor),
        GroupMentionNode {
            group_alias: Maybe::Value("here".into())
        }
    );
    assert_eq!(editor.state().root_text_content().as_ref(), "a@hereb");
    Ok(())
}

// Source INSERT_AGENT_SESSION_MENTION_COMMAND: an undefined label and uuid stay absent.
#[test]
fn agent_session_mention_inserts_with_optional_fields() -> Result<(), Error> {
    let mut editor = editor_with_text("ab", 2)?;
    insert(
        &mut editor,
        "group-b.insert-agent-session-mention",
        json!({ "id": "session-1" }),
    )?;
    assert_eq!(
        inserted::<AgentSessionMentionNode>(&editor),
        AgentSessionMentionNode {
            id: Maybe::Value("session-1".into()),
            ..Default::default()
        }
    );
    let mut editor = editor_with_text("ab", 2)?;
    insert(
        &mut editor,
        "group-b.insert-agent-session-mention",
        json!({ "id": "session-1", "label": "Fix it", "mentionUuid": "m-1" }),
    )?;
    assert_eq!(
        inserted::<AgentSessionMentionNode>(&editor),
        AgentSessionMentionNode {
            id: Maybe::Value("session-1".into()),
            label: Maybe::Value("Fix it".into()),
            mention_uuid: Maybe::Value("m-1".into()),
            expanded: false,
        }
    );
    Ok(())
}

// Source INSERT_BOOKING_LINK_MENTION_COMMAND with the menu's built URL.
#[test]
fn booking_link_mention_keeps_the_given_url() -> Result<(), Error> {
    let mut editor = editor_with_text("", 0)?;
    insert(
        &mut editor,
        "group-b.insert-booking-link-mention",
        json!({
            "profileId": "p-1",
            "slug": "intro",
            "label": "Intro call",
            "url": "https://macro.com/app/book/p-1/intro",
        }),
    )?;
    let node = inserted::<BookingLinkMentionNode>(&editor);
    assert_eq!(node.profile_id, Maybe::Value("p-1".into()));
    assert_eq!(node.slug, Maybe::Value("intro".into()));
    assert_eq!(node.label, Maybe::Value("Intro call".into()));
    assert_eq!(node.url, "https://macro.com/app/book/p-1/intro");
    Ok(())
}

#[test]
fn stale_generation_is_not_handled() -> Result<(), Error> {
    let mut editor = editor_with_text("ab", 1)?;
    let generation = editor.state().max_key().generation();
    let command = surface::decode_command(
        "group-b.insert-group-mention",
        &json!({ "groupAlias": "here" }).to_string(),
        generation + 1,
        None,
    )?
    .expect("routed");
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    assert_eq!(editor.state().root_text_content().as_ref(), "ab");
    Ok(())
}

// Source INSERT_TEXT_COMMAND: a new unformatted text node, then selectEnd.
#[test]
fn insert_text_adds_an_unformatted_node_at_the_caret() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let leaf = tx.create_text("ab")?;
        tx.text(leaf)?.set_format(TextFormat::BOLD)?;
        tx.append(p, &[leaf.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(leaf)?;
        tx.set_text_node_range(leaf, Utf16Offset(1), leaf, Utf16Offset(1))
    })?;
    let handled = insert(&mut editor, "group-b.insert-text", json!({ "text": "😀" }))?;
    assert_eq!(handled, Handled::Yes);
    assert_eq!(editor.state().root_text_content().as_ref(), "a😀b");
    let view = editor.state().view();
    let p = view.first_child(NodeKey::ROOT).expect("p");
    let emoji = view
        .children_keys(p)?
        .into_iter()
        .find(|key| view.text_content(*key) == "😀")
        .expect("inserted text node");
    assert_eq!(view.text(emoji).expect("text").format, TextFormat::empty());
    Ok(())
}

// The view's listener metadata cache rejects a table with two rows for one
// command, so each command name has one registering plugin.
#[test]
fn every_application_command_name_is_registered_once() {
    let editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let mut seen = std::collections::HashSet::new();
    let duplicates: Vec<String> = editor
        .listener_table()
        .iter()
        .map(|(kind, _)| format!("{kind:?}"))
        .filter(|name| !seen.insert(name.clone()))
        .collect();
    assert_eq!(duplicates, Vec::<String>::new());
}
