use crate::{EditorType, NodeClock, nodes::*, surface};
use lexical_model::*;
use std::sync::Arc;

#[test]
fn direct_document_insertion_uses_current_caret_and_appends_after_expanded_text()
-> Result<(), Error> {
    for (anchor, focus, expected) in [(2, 2, "boDocdy"), (1, 3, "bod Docy"), (3, 1, "bod Docy")] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeClock(Arc::new(|| 1234)))
                .build()
                .expect("actual Macro surface");
        let (text, _) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("body")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.select_end(text)?;
            tx.set_text_node_range(text, Utf16Offset(anchor), text, Utf16Offset(focus))?;
            Ok(text.key())
        })?;
        let generation = editor.state().max_key().generation();
        let command = surface::decode_command(
            "group-b.insert-document-mention",
            r#"{"documentId":"fixture-doc","documentName":"Doc","blockName":"md","mentionUuid":"issued-mention"}"#,
            generation,
            None,
        )?
        .expect("direct document insertion must be decoded independently of menu-select");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        assert_eq!(editor.state().root_text_content().as_ref(), expected);
        let view = editor.state().view();
        let paragraph = view.first_child(NodeKey::ROOT).expect("paragraph");
        let mention = view
            .children_keys(paragraph)?
            .into_iter()
            .find_map(|key| view.get::<DocumentMentionNode>(key))
            .expect("actual attached document mention");
        assert_eq!(mention.document_id.as_deref(), Some("fixture-doc"));
        assert_eq!(mention.document_name.as_deref(), Some("Doc"));
        assert_eq!(mention.mention_uuid.as_deref(), Some("issued-mention"));
        assert_eq!(mention.created_at, Maybe::Value(1234));
        let selection = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("Source selectEnd caret");
        assert!(selection.is_collapsed());
        assert_ne!(selection.anchor.key(), text);
    }
    Ok(())
}

#[test]
fn a_decoded_direct_insert_uses_the_selection_at_dispatch_after_host_io() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(NodeClock(Arc::new(|| 1234)))
            .build()
            .expect("actual Macro surface");
    let (text, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("body")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_end(text)?;
        tx.set_text_node_range(text, Utf16Offset(2), text, Utf16Offset(2))?;
        Ok(text.key())
    })?;
    let command = surface::decode_command(
        "group-b.insert-document-mention",
        r#"{"documentId":"fixture-doc","documentName":"Doc","blockName":"md"}"#,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("direct insert");
    editor.update(|tx| tx.select_end(text))?;
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert_eq!(editor.state().root_text_content().as_ref(), "bodyDoc");
    Ok(())
}

#[test]
fn node_null_and_root_selections_use_actual_insertion_and_wrap_once() -> Result<(), Error> {
    for mode in ["node", "none", "root"] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeClock(Arc::new(|| 1234)))
                .build()
                .expect("surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("body")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(text)?;
            match mode {
                "none" => tx.replace_selection(None)?,
                "root" => tx.selection_from_view(ViewSelection::Range {
                    anchor: Point::element(NodeKey::ROOT, ChildIndex(1)),
                    focus: Point::element(NodeKey::ROOT, ChildIndex(1)),
                    resolution_dirty: false,
                })?,
                _ => {
                    let old = tx.create(DocumentMentionNode {
                        document_name: Maybe::Value("old".into()),
                        ..Default::default()
                    })?;
                    tx.append(p, &[old.key()])?;
                    let mut selection = NodeSelection::new();
                    selection.add(old.key());
                    tx.replace_selection(Some(Selection::Node(selection)))?;
                }
            }
            Ok(())
        })?;
        let command = surface::decode_command(
            "group-b.insert-document-mention",
            r#"{"documentId":"fixture-doc","documentName":"Doc","blockName":"md"}"#,
            editor.state().max_key().generation(),
            None,
        )?
        .expect("insert");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes, "{mode}");
        assert_eq!(
            editor.state().root_text_content().as_ref(),
            if mode == "root" {
                "body\n\nDoc"
            } else {
                "bodyDoc"
            },
            "{mode}"
        );
        let view = editor.state().view();
        let keys = lexical_rich_nodes::utils::dfs(view, None, None)
            .into_iter()
            .filter_map(|entry| {
                view.get::<DocumentMentionNode>(entry.node)
                    .filter(|node| node.document_id.as_deref() == Some("fixture-doc"))
                    .map(|_| entry.node)
            })
            .collect::<Vec<_>>();
        assert_eq!(keys.len(), 1, "{mode}");
        let parent = view.parent(keys[0]).expect("attached");
        assert!(view.is::<Paragraph>(parent), "{mode}");
        assert_eq!(
            view.parent(parent),
            Some(NodeKey::ROOT),
            "single wrapper {mode}"
        );
    }
    Ok(())
}

#[test]
fn agent_truthy_uuid_ignores_document_fields_and_never_reads_clock() -> Result<(), Error> {
    for uuid in ["null", r#""""#, r#""issued""#] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeClock(Arc::new(|| {
                    panic!("Agent constructor must not read clock")
                })))
                .build()
                .expect("surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(p)
        })?;
        let command = surface::decode_command("group-b.insert-document-mention",
            &format!(r#"{{"documentId":"fixture-agent","documentName":"Agent","blockName":"agent","mentionUuid":{uuid},"collapsed":true,"createdAt":1.5,"channelType":"thread","blockParams":{{"message":"fixture-message"}}}}"#),
            editor.state().max_key().generation(), None)?.expect("insert");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        let view = editor.state().view();
        let p = view.first_child(NodeKey::ROOT).expect("p");
        let agent = view
            .children_keys(p)?
            .into_iter()
            .find_map(|key| view.get::<AgentSessionMentionNode>(key))
            .expect("agent");
        assert_eq!(agent.id.as_deref(), Some("fixture-agent"));
        assert_eq!(agent.label.as_deref(), Some("Agent"));
        assert_eq!(
            agent.mention_uuid,
            if uuid == r#""issued""# {
                Maybe::Value("issued".into())
            } else {
                Maybe::Missing
            }
        );
        assert!(!agent.expanded);
    }
    Ok(())
}

#[test]
fn stale_generation_and_nonobject_payloads_refuse_before_construction() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(NodeClock(Arc::new(|| {
                panic!("stale insert must not construct")
            })))
            .build()
            .expect("surface");
    let before = editor.state().to_json()?;
    let generation = editor.state().max_key().generation();
    let command = surface::decode_command(
        "group-b.insert-document-mention",
        r#"{"documentId":"fixture-doc","documentName":"Doc","blockName":"md"}"#,
        generation + 1,
        None,
    )?
    .expect("decoded");
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    assert_eq!(editor.state().to_json()?, before);
    for payload in [
        "null",
        "[]",
        r#"["id","name","md"]"#,
        r#"{"documentId":"id","documentName":"name","blockName":"md","extra":1}"#,
    ] {
        assert!(
            surface::decode_command("group-b.insert-document-mention", payload, generation, None)
                .is_err()
        );
    }
    Ok(())
}

#[test]
fn document_constructor_retains_nullish_defaults_and_explicit_clock_values() -> Result<(), Error> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    for (created, expected, calls) in [("null", 1234, 1), ("0", 0, 0), ("-3", -3, 0)] {
        let clock_calls = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&clock_calls);
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeClock(Arc::new(move || {
                    observed.fetch_add(1, Ordering::SeqCst);
                    1234
                })))
                .build()
                .expect("surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(p)
        })?;
        let command = surface::decode_command("group-b.insert-document-mention",
            &format!(r#"{{"documentId":"","documentName":"","blockName":"channel","createdAt":{created},"blockParams":{{"thread":"fixture-thread","message":"fixture-message"}},"channelType":"thread","mentionUuid":"","collapsed":null}}"#),
            editor.state().max_key().generation(), None)?.expect("insert");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        assert_eq!(clock_calls.load(Ordering::SeqCst), calls);
        let view = editor.state().view();
        let p = view.first_child(NodeKey::ROOT).expect("p");
        let node = view
            .children_keys(p)?
            .into_iter()
            .find_map(|key| view.get::<DocumentMentionNode>(key))
            .expect("mention");
        assert_eq!(node.created_at, Maybe::Value(expected));
        assert_eq!(node.document_id.as_deref(), Some(""));
        assert_eq!(node.document_name.as_deref(), Some(""));
        assert_eq!(node.mention_uuid.as_deref(), Some(""));
        assert_eq!(node.channel_type.as_deref(), Some("thread"));
        assert_eq!(
            node.block_params
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["thread", "message"]
        );
        assert!(!node.collapsed);
    }
    Ok(())
}

#[test]
fn committed_null_and_selected_text_match_source_while_previous_caret_crash_is_safe()
-> Result<(), Error> {
    for (mode, expected) in [
        ("committed-null", "bodyDoc"),
        ("node-text", "Doc"),
        ("active-null-previous-caret", "boDocdy"),
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeClock(Arc::new(|| 1234)))
                .build()
                .expect("surface");
        let (text, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("body")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(text)?;
            tx.set_text_node_range(text, Utf16Offset(2), text, Utf16Offset(2))?;
            Ok(text.key())
        })?;
        let command = surface::decode_command(
            "group-b.insert-document-mention",
            r#"{"documentId":"fixture-doc","documentName":"Doc","blockName":"md"}"#,
            editor.state().max_key().generation(),
            None,
        )?
        .expect("insert");
        if mode == "committed-null" {
            editor.update(|tx| tx.replace_selection(None))?;
            assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        } else {
            editor.update(|tx| {
                if mode == "node-text" {
                    let mut selection = NodeSelection::new();
                    selection.add(text);
                    tx.replace_selection(Some(Selection::Node(selection)))?;
                } else {
                    // Named OFF bug: Source's previous-caret fallback mutates a frozen range.
                    tx.replace_selection(None)?;
                }
                assert_eq!(tx.dispatch(&command)?, Handled::Yes);
                Ok(())
            })?;
        }
        assert_eq!(
            editor.state().root_text_content().as_ref(),
            expected,
            "{mode}"
        );
    }
    Ok(())
}

#[test]
fn fractional_document_timestamp_is_unsupported_without_rounding_or_clock() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(NodeClock(Arc::new(|| {
                panic!("invalid timestamp must not read clock")
            })))
            .build()
            .expect("surface");
    let command = surface::decode_command(
        "group-b.insert-document-mention",
        r#"{"documentId":"fixture-doc","documentName":"Doc","blockName":"md","createdAt":1.5}"#,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("decode before branch");
    let before = editor.state().to_json()?;
    assert!(editor.dispatch(&command).is_err());
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct ReplacedAgent {
    parent: AgentSessionMentionNode,
}
impl NodeType for ReplacedAgent {
    const TYPE: &'static str = "fixture-replaced-agent";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for ReplacedAgent {
    type Parent = AgentSessionMentionNode;
    fn as_parent(&self) -> &Self::Parent {
        &self.parent
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.parent)
    }
}
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct ReplacedDocument {
    parent: DocumentMentionNode,
}
impl NodeType for ReplacedDocument {
    const TYPE: &'static str = "fixture-replaced-document";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for ReplacedDocument {
    type Parent = DocumentMentionNode;
    fn as_parent(&self) -> &Self::Parent {
        &self.parent
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.parent)
    }
}

#[test]
fn truthy_uuid_is_applied_after_the_returned_factory_payload() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(NodeClock(Arc::new(|| 1234)))
            .replace::<AgentSessionMentionNode, ReplacedAgent>(|mut parent| {
                assert_eq!(
                    parent.mention_uuid,
                    Maybe::Missing,
                    "Source Agent constructor gets only id/label"
                );
                parent.mention_uuid = Maybe::Value("factory-value".into());
                ReplacedAgent { parent }
            })
            .replace::<DocumentMentionNode, ReplacedDocument>(|mut parent| {
                assert_eq!(parent.mention_uuid.as_deref(), Some("issued"));
                parent.mention_uuid = Maybe::Value("factory-value".into());
                ReplacedDocument { parent }
            })
            .build()
            .expect("surface with actual typed replacements");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(p)
    })?;
    for block in ["agent", "md"] {
        let command = surface::decode_command("group-b.insert-document-mention",
            &format!(r#"{{"documentId":"fixture-doc","documentName":"Doc","blockName":"{block}","mentionUuid":"issued"}}"#),
            editor.state().max_key().generation(), None)?.expect("insert");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    }
    let view = editor.state().view();
    let p = view.first_child(NodeKey::ROOT).expect("p");
    let children = view.children_keys(p)?;
    let agent = children
        .iter()
        .find_map(|key| view.get::<ReplacedAgent>(*key))
        .expect("returned Agent factory node");
    let document = children
        .iter()
        .find_map(|key| view.get::<ReplacedDocument>(*key))
        .expect("returned document factory node");
    assert_eq!(agent.parent.mention_uuid.as_deref(), Some("issued"));
    assert_eq!(document.parent.mention_uuid.as_deref(), Some("issued"));
    Ok(())
}

#[test]
fn element_destinations_insert_at_the_boundary_instead_of_source_point_type_crash()
-> Result<(), Error> {
    for mode in [
        "paragraph-forward",
        "paragraph-backward",
        "root-forward",
        "root-backward",
        "mixed-forward",
        "mixed-backward",
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeClock(Arc::new(|| 1234)))
                .build()
                .expect("surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("body")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            let start = if mode.starts_with("root") {
                Point::element(NodeKey::ROOT, ChildIndex(0))
            } else if mode.starts_with("mixed") {
                Point::text(text, Utf16Offset(1))
            } else {
                Point::element(p, ChildIndex(0))
            };
            let end = if mode.starts_with("root") {
                Point::element(NodeKey::ROOT, ChildIndex(1))
            } else {
                Point::element(p, ChildIndex(1))
            };
            let (anchor, focus) = if mode.ends_with("backward") {
                (end, start)
            } else {
                (start, end)
            };
            tx.replace_selection(Some(Selection::Range(RangeSelection::new(anchor, focus))))
        })?;
        let command = surface::decode_command(
            "group-b.insert-document-mention",
            r#"{"documentId":"fixture-doc","documentName":"Doc","blockName":"md"}"#,
            editor.state().max_key().generation(),
            None,
        )?
        .expect("insert");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes, "{mode}");
        assert_eq!(
            editor.state().root_text_content().as_ref(),
            if mode.starts_with("root") {
                "body\n\n Doc"
            } else {
                "body Doc"
            },
            "{mode}"
        );
        let selection = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("restored caret");
        assert!(selection.is_collapsed(), "{mode}");
    }
    Ok(())
}

#[test]
fn mixed_text_destinations_match_source_text_and_trailing_text_caret() -> Result<(), Error> {
    for backward in [false, true] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeClock(Arc::new(|| 1234)))
                .build()
                .expect("surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("body")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            let start = Point::element(p, ChildIndex(0));
            let end = Point::text(text, Utf16Offset(3));
            let (anchor, focus) = if backward { (end, start) } else { (start, end) };
            tx.replace_selection(Some(Selection::Range(RangeSelection::new(anchor, focus))))
        })?;
        let command = surface::decode_command(
            "group-b.insert-document-mention",
            r#"{"documentId":"fixture-doc","documentName":"Doc","blockName":"md"}"#,
            editor.state().max_key().generation(),
            None,
        )?
        .expect("insert");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        assert_eq!(editor.state().root_text_content().as_ref(), "bod Docy");
        let selection = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret");
        assert!(selection.is_collapsed());
        assert!(matches!(
            selection.anchor,
            Point::Text {
                offset: Utf16Offset(0),
                ..
            }
        ));
        assert_eq!(
            editor
                .state()
                .view()
                .text_content(selection.anchor.key())
                .as_ref(),
            "y"
        );
    }
    Ok(())
}

// Source INSERT_AGENT_SESSION_MENTION (mentionsPlugin.ts:657-667): $insertNodes at the
// selection current at dispatch, a paragraph wrap at the root, then selectEnd.
// Expected values are the Source rows of agent-session-control run-03.
fn agent_editor() -> Editor {
    surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .extension_state(NodeClock(Arc::new(|| 1234)))
        .build()
        .expect("actual Macro surface")
}

/// One paragraph holding the text left after the mention search was removed.
fn agent_seed(editor: &mut Editor) -> Result<(NodeKey, NodeKey), Error> {
    let (keys, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("Hello  world")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_end(text)?;
        Ok((paragraph.key(), text.key()))
    })?;
    Ok(keys)
}

fn agent_insert(editor: &mut Editor, json: &str) -> Result<(Handled, Commit), Error> {
    let command = surface::decode_command(
        "group-b.insert-agent-session-mention",
        json,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("dedicated agent-session insertion must decode");
    editor.dispatch(&command)
}

/// The paragraph's children as exported JSON without node ids.
fn agent_children(editor: &Editor) -> Result<Vec<serde_json::Value>, Error> {
    let view = editor.state().view();
    let paragraph = view.first_child(NodeKey::ROOT).expect("paragraph");
    view.children_keys(paragraph)?
        .into_iter()
        .map(|key| {
            let mut json = view.export_json(key)?;
            json.retain(|name, _| !name.starts_with('$'));
            Ok(serde_json::Value::Object(json))
        })
        .collect()
}

/// The collapsed caret as (index path from the root, is text, offset).
fn agent_caret(editor: &Editor) -> (Vec<usize>, bool, u32) {
    let state = editor.state();
    let view = state.view();
    let range = state
        .selection()
        .and_then(Selection::as_range)
        .expect("Source selectEnd caret");
    assert!(range.is_collapsed());
    let mut path = Vec::new();
    let mut key = range.anchor.key();
    while let Some(parent) = view.parent(key) {
        let index = view
            .children_keys(parent)
            .expect("parent children")
            .iter()
            .position(|child| *child == key)
            .expect("child index");
        path.insert(0, index);
        key = parent;
    }
    (
        path,
        matches!(range.anchor, Point::Text { .. }),
        range.anchor.offset(),
    )
}

const AGENT_FULL: &str = r#"{"id":"session","label":"Fix mentions","mentionUuid":"mention-uuid"}"#;

fn agent_mention() -> serde_json::Value {
    serde_json::json!({
        "type": "agent-session-mention", "version": 3,
        "id": "session", "label": "Fix mentions", "mentionUuid": "mention-uuid"
    })
}

fn agent_text(text: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "text", "version": 1, "text": text,
        "detail": 0, "format": 0, "mode": "normal", "style": ""
    })
}

#[test]
fn agent_session_insert_at_a_caret_splits_the_text() -> Result<(), Error> {
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(6), text, Utf16Offset(6)))?;
    let (handled, commit) = agent_insert(&mut editor, AGENT_FULL)?;
    assert_eq!(handled, Handled::Yes);
    // Source dispatches inside its own update: no extra tags.
    assert_eq!(commit.tags.iter().count(), 0, "{:?}", commit.tags);
    assert_eq!(
        agent_children(&editor)?,
        [agent_text("Hello "), agent_mention(), agent_text(" world")]
    );
    assert_eq!(agent_caret(&editor), (vec![0, 2], true, 0));
    Ok(())
}

#[test]
fn agent_session_insert_replaces_a_forward_range_without_a_space() -> Result<(), Error> {
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(1), text, Utf16Offset(6)))?;
    assert_eq!(agent_insert(&mut editor, AGENT_FULL)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?,
        [agent_text("H"), agent_mention(), agent_text(" world")]
    );
    assert_eq!(agent_caret(&editor), (vec![0, 2], true, 0));
    Ok(())
}

#[test]
fn agent_session_insert_replaces_a_backward_range_without_a_space() -> Result<(), Error> {
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(5), text, Utf16Offset(0)))?;
    assert_eq!(agent_insert(&mut editor, AGENT_FULL)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?,
        [agent_mention(), agent_text("  world")]
    );
    assert_eq!(agent_caret(&editor), (vec![0, 1], true, 0));
    Ok(())
}

#[test]
fn agent_session_insert_at_an_element_caret_appends_and_selects_the_paragraph_end()
-> Result<(), Error> {
    let mut editor = agent_editor();
    let (paragraph, _) = agent_seed(&mut editor)?;
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(paragraph, ChildIndex(1)),
            Point::element(paragraph, ChildIndex(1)),
        ))))
    })?;
    assert_eq!(agent_insert(&mut editor, AGENT_FULL)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?,
        [agent_text("Hello  world"), agent_mention()]
    );
    assert_eq!(agent_caret(&editor), (vec![0], false, 2));
    Ok(())
}

#[test]
fn agent_session_insert_without_a_selection_appends_and_selects_the_paragraph_end()
-> Result<(), Error> {
    let mut editor = agent_editor();
    agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_selection(None))?;
    assert_eq!(agent_insert(&mut editor, AGENT_FULL)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?,
        [agent_text("Hello  world"), agent_mention()]
    );
    assert_eq!(agent_caret(&editor), (vec![0], false, 2));
    Ok(())
}

#[test]
fn agent_session_insert_keeps_its_payload_exactly() -> Result<(), Error> {
    for (json, expected) in [
        (
            r#"{"id":"session"}"#,
            serde_json::json!({"type":"agent-session-mention","version":3,"id":"session"}),
        ),
        (
            r#"{"id":"session","label":""}"#,
            serde_json::json!({"type":"agent-session-mention","version":3,"id":"session","label":""}),
        ),
        (
            r#"{"id":"session","label":"Fix mentions","mentionUuid":""}"#,
            serde_json::json!({"type":"agent-session-mention","version":3,"id":"session","label":"Fix mentions","mentionUuid":""}),
        ),
    ] {
        let mut editor = agent_editor();
        let (_, text) = agent_seed(&mut editor)?;
        editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(6), text, Utf16Offset(6)))?;
        assert_eq!(agent_insert(&mut editor, json)?.0, Handled::Yes);
        assert_eq!(agent_children(&editor)?[1], expected, "{json}");
    }
    Ok(())
}

#[test]
fn agent_session_insert_rejects_unknown_fields_and_stale_generations() -> Result<(), Error> {
    assert!(
        surface::decode_command(
            "group-b.insert-agent-session-mention",
            r#"{"id":"session","blockName":"agent"}"#,
            0,
            None,
        )
        .is_err()
    );
    assert!(
        surface::decode_command(
            "group-b.insert-agent-session-mention",
            r#"{"id":"session","expanded":true}"#,
            0,
            None,
        )
        .is_err(),
        "expanded is not a native menu field"
    );
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(6), text, Utf16Offset(6)))?;
    let stale = surface::decode_command(
        "group-b.insert-agent-session-mention",
        AGENT_FULL,
        editor.state().max_key().generation() + 1,
        None,
    )?
    .expect("dedicated agent-session insertion must decode");
    assert_eq!(editor.dispatch(&stale)?.0, Handled::No);
    assert_eq!(agent_children(&editor)?, [agent_text("Hello  world")]);
    Ok(())
}

// The document-mention command's agent branch keeps Source INSERT_DOCUMENT_MENTION
// (mentionsPlugin.ts:515-545): an expanded range collapses and a space comes first.
#[test]
fn document_mention_agent_branch_still_collapses_and_adds_a_space() -> Result<(), Error> {
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(1), text, Utf16Offset(6)))?;
    let command = surface::decode_command(
        "group-b.insert-document-mention",
        r#"{"documentId":"session","documentName":"Fix mentions","blockName":"agent"}"#,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("document insertion");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?,
        [
            agent_text("Hello  "),
            serde_json::json!({
                "type": "agent-session-mention", "version": 3,
                "id": "session", "label": "Fix mentions"
            }),
            agent_text(" world"),
        ]
    );
    Ok(())
}

// Source INSERT_BOOKING_LINK_MENTION (mentionsPlugin.ts:746-760): the same
// insertion as the agent-session command; the payload is the Source handler's
// handleBookingLinkMention one, with the url from buildBookingUrl.
const BOOKING_URL: &str = "https://dev.macro.com/app/book/fixture-profile/30min";
const BOOKING_FULL: &str = r#"{"profileId":"fixture-profile","slug":"30min","label":"Intro call","url":"https://dev.macro.com/app/book/fixture-profile/30min"}"#;

fn booking_insert(editor: &mut Editor, json: &str) -> Result<(Handled, Commit), Error> {
    let command = surface::decode_command(
        "group-b.insert-booking-link-mention",
        json,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("dedicated booking-link insertion must decode");
    editor.dispatch(&command)
}

fn booking_mention() -> serde_json::Value {
    serde_json::json!({
        "type": "booking-link-mention", "version": 1,
        "profileId": "fixture-profile", "slug": "30min",
        "label": "Intro call", "url": BOOKING_URL
    })
}

#[test]
fn booking_link_insert_at_a_caret_splits_the_text() -> Result<(), Error> {
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(6), text, Utf16Offset(6)))?;
    let (handled, commit) = booking_insert(&mut editor, BOOKING_FULL)?;
    assert_eq!(handled, Handled::Yes);
    // Source dispatches inside its own update: no extra tags.
    assert_eq!(commit.tags.iter().count(), 0, "{:?}", commit.tags);
    assert_eq!(
        agent_children(&editor)?,
        [
            agent_text("Hello "),
            booking_mention(),
            agent_text(" world")
        ]
    );
    assert_eq!(agent_caret(&editor), (vec![0, 2], true, 0));
    Ok(())
}

#[test]
fn booking_link_insert_replaces_a_forward_range_without_a_space() -> Result<(), Error> {
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(1), text, Utf16Offset(6)))?;
    assert_eq!(booking_insert(&mut editor, BOOKING_FULL)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?,
        [agent_text("H"), booking_mention(), agent_text(" world")]
    );
    assert_eq!(agent_caret(&editor), (vec![0, 2], true, 0));
    Ok(())
}

#[test]
fn booking_link_insert_replaces_a_backward_range_without_a_space() -> Result<(), Error> {
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(5), text, Utf16Offset(0)))?;
    assert_eq!(booking_insert(&mut editor, BOOKING_FULL)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?,
        [booking_mention(), agent_text("  world")]
    );
    assert_eq!(agent_caret(&editor), (vec![0, 1], true, 0));
    Ok(())
}

#[test]
fn booking_link_insert_at_an_element_caret_appends_and_selects_the_paragraph_end()
-> Result<(), Error> {
    let mut editor = agent_editor();
    let (paragraph, _) = agent_seed(&mut editor)?;
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(paragraph, ChildIndex(1)),
            Point::element(paragraph, ChildIndex(1)),
        ))))
    })?;
    assert_eq!(booking_insert(&mut editor, BOOKING_FULL)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?,
        [agent_text("Hello  world"), booking_mention()]
    );
    assert_eq!(agent_caret(&editor), (vec![0], false, 2));
    Ok(())
}

#[test]
fn booking_link_insert_without_a_selection_appends_and_selects_the_paragraph_end()
-> Result<(), Error> {
    let mut editor = agent_editor();
    agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_selection(None))?;
    assert_eq!(booking_insert(&mut editor, BOOKING_FULL)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?,
        [agent_text("Hello  world"), booking_mention()]
    );
    assert_eq!(agent_caret(&editor), (vec![0], false, 2));
    Ok(())
}

#[test]
fn booking_link_insert_keeps_its_payload_exactly() -> Result<(), Error> {
    for (json, expected) in [
        (
            r#"{"profileId":"fixture-profile","url":"https://dev.macro.com/app/book/fixture-profile"}"#,
            serde_json::json!({"type":"booking-link-mention","version":1,"profileId":"fixture-profile","url":"https://dev.macro.com/app/book/fixture-profile"}),
        ),
        (
            r#"{"profileId":"fixture-profile","slug":"","label":"","url":"https://dev.macro.com/app/book/fixture-profile/"}"#,
            serde_json::json!({"type":"booking-link-mention","version":1,"profileId":"fixture-profile","slug":"","label":"","url":"https://dev.macro.com/app/book/fixture-profile/"}),
        ),
        (BOOKING_FULL, booking_mention()),
    ] {
        let mut editor = agent_editor();
        let (_, text) = agent_seed(&mut editor)?;
        editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(6), text, Utf16Offset(6)))?;
        assert_eq!(booking_insert(&mut editor, json)?.0, Handled::Yes);
        assert_eq!(agent_children(&editor)?[1], expected, "{json}");
    }
    Ok(())
}

#[test]
fn booking_link_insert_rejects_unknown_or_missing_fields_and_stale_generations() -> Result<(), Error>
{
    for json in [
        r#"{"profileId":"fixture-profile","url":"https://dev.macro.com/app/book/fixture-profile","title":"Intro"}"#,
        r#"{"profileId":"fixture-profile"}"#,
        r#"{"url":"https://dev.macro.com/app/book/fixture-profile"}"#,
    ] {
        assert!(
            surface::decode_command("group-b.insert-booking-link-mention", json, 0, None).is_err(),
            "{json}"
        );
    }
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(6), text, Utf16Offset(6)))?;
    let stale = surface::decode_command(
        "group-b.insert-booking-link-mention",
        BOOKING_FULL,
        editor.state().max_key().generation() + 1,
        None,
    )?
    .expect("dedicated booking-link insertion must decode");
    assert_eq!(editor.dispatch(&stale)?.0, Handled::No);
    assert_eq!(agent_children(&editor)?, [agent_text("Hello  world")]);
    Ok(())
}

// The rendered component's existing label update still applies to a node this
// command inserted.
#[test]
fn booking_link_insert_node_takes_the_existing_label_update() -> Result<(), Error> {
    let mut editor = agent_editor();
    let (_, text) = agent_seed(&mut editor)?;
    editor.update(|tx| tx.set_text_node_range(text, Utf16Offset(6), text, Utf16Offset(6)))?;
    assert_eq!(booking_insert(&mut editor, BOOKING_FULL)?.0, Handled::Yes);
    let view = editor.state().view();
    let paragraph = view.first_child(NodeKey::ROOT).expect("paragraph");
    let key = view.children_keys(paragraph)?[1];
    let label = surface::decode_command(
        "group-b.booking-mention-label",
        &serde_json::json!({ "key": key.index(), "label": "Resolved label" }).to_string(),
        key.generation(),
        None,
    )?
    .expect("booking label decoder");
    assert_eq!(editor.dispatch(&label)?.0, Handled::Yes);
    assert_eq!(
        agent_children(&editor)?[1],
        serde_json::json!({
            "type": "booking-link-mention", "version": 1,
            "profileId": "fixture-profile", "slug": "30min",
            "label": "Resolved label", "url": BOOKING_URL
        })
    );
    Ok(())
}

// A root-level element caret: Source's root-anchor insertParagraph
// (Lexical.dev.mjs:8471-8477, :8553-8557) puts the mention in a NEW paragraph at
// root(1) and selectNext(0,0) selects after it.
#[test]
fn booking_link_insert_at_a_root_caret_lands_in_a_new_paragraph() -> Result<(), Error> {
    let mut editor = agent_editor();
    agent_seed(&mut editor)?;
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(NodeKey::ROOT, ChildIndex(1)),
            Point::element(NodeKey::ROOT, ChildIndex(1)),
        ))))
    })?;
    assert_eq!(booking_insert(&mut editor, BOOKING_FULL)?.0, Handled::Yes);
    let view = editor.state().view();
    let blocks = view.children_keys(NodeKey::ROOT)?;
    assert_eq!(blocks.len(), 2);
    let block = |key: NodeKey| -> Result<serde_json::Value, Error> {
        let mut json = view.export_json(key)?;
        json.retain(|name, _| !name.starts_with('$'));
        let children = view
            .children_keys(key)?
            .into_iter()
            .map(|child| {
                let mut json = view.export_json(child)?;
                json.retain(|name, _| !name.starts_with('$'));
                Ok(serde_json::Value::Object(json))
            })
            .collect::<Result<Vec<_>, Error>>()?;
        Ok(serde_json::json!({ "type": json["type"], "children": children }))
    };
    assert_eq!(
        block(blocks[0])?,
        serde_json::json!({ "type": "paragraph", "children": [agent_text("Hello  world")] })
    );
    assert_eq!(
        block(blocks[1])?,
        serde_json::json!({ "type": "paragraph", "children": [booking_mention()] })
    );
    assert_eq!(agent_caret(&editor), (vec![1], false, 1));
    Ok(())
}

#[test]
fn a_dropped_item_is_wrapped_in_a_new_paragraph_beside_the_target_block() -> Result<(), Error> {
    for (before, expected) in [
        (true, ["Dropped", "first", "second"]),
        (false, ["first", "Dropped", "second"]),
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeClock(Arc::new(|| 1234)))
                .build()
                .expect("actual Macro surface");
        let (first, _) = editor.update(|tx| {
            let mut keys = Vec::new();
            for text in ["first", "second"] {
                let paragraph = tx.create(Paragraph::default())?;
                let leaf = tx.create_text(text)?;
                tx.append(paragraph, &[leaf.key()])?;
                tx.append(NodeKey::ROOT, &[paragraph.key()])?;
                keys.push(paragraph.key());
            }
            Ok(keys[0])
        })?;
        let generation = editor.state().max_key().generation();
        let payload = format!(
            r#"{{"key":{},"before":{before},"mention":{{"documentId":"dropped-doc","documentName":"Dropped","blockName":"md","mentionUuid":"drop-mention","createdAt":99}}}}"#,
            first.index()
        );
        let command =
            surface::decode_command("group-b.drop-document-mention", &payload, generation, None)?
                .expect("drop insertion is decoded");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        let view = editor.state().view();
        let blocks = view.children_keys(NodeKey::ROOT)?;
        assert_eq!(
            blocks
                .iter()
                .map(|key| view.text_content(*key).into_owned())
                .collect::<Vec<_>>(),
            expected
        );
        let wrapper = blocks[usize::from(!before)];
        assert!(view.is::<Paragraph>(wrapper));
        let children = view.children_keys(wrapper)?;
        assert_eq!(children.len(), 1);
        let mention = view
            .get::<DocumentMentionNode>(children[0])
            .expect("dropped document mention");
        assert_eq!(mention.document_id.as_deref(), Some("dropped-doc"));
        assert_eq!(mention.document_name.as_deref(), Some("Dropped"));
        assert_eq!(mention.block_name.as_deref(), Some("md"));
        assert_eq!(mention.mention_uuid.as_deref(), Some("drop-mention"));
        assert_eq!(mention.created_at, Maybe::Value(99));
        // Source mention.selectEnd() is selectNext(0, 0): the wrapper after the mention.
        let selection = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("Source selectEnd caret");
        assert!(selection.is_collapsed());
        assert_eq!(selection.anchor, Point::element(wrapper, ChildIndex(1)));
    }
    Ok(())
}

#[test]
fn a_drop_on_a_detached_or_stale_target_does_nothing() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("actual Macro surface");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(())
    })?;
    let generation = editor.state().max_key().generation();
    let mention = r#""mention":{"documentId":"d","documentName":"D","blockName":"md"}"#;
    for (payload, generation) in [
        (
            format!(r#"{{"key":999,"before":true,{mention}}}"#),
            generation,
        ),
        (
            format!(r#"{{"key":0,"before":true,{mention}}}"#),
            generation,
        ),
    ] {
        let command =
            surface::decode_command("group-b.drop-document-mention", &payload, generation, None)?
                .expect("decoded");
        assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    }
    assert_eq!(editor.state().view().children_keys(NodeKey::ROOT)?.len(), 1);
    Ok(())
}
