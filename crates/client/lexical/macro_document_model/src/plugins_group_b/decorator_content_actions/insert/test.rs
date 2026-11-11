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
