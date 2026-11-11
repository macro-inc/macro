use super::*;
use crate::{EditorType, surface};
use serde_json::json;

#[test]
fn trigger_uses_committed_eligibility_inserts_active_selection_and_never_prevents_default()
-> Result<(), Error> {
    for (before, offset, active, active_offset, opens, expected) in [
        (" ", 1, "word", 2, true, "wo/rd"),
        ("word", 2, " ", 1, false, " "),
        (" word", 0, " word", 5, true, " word/"),
        ("word ", 2, "word ", 5, false, "word "),
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let (key, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text(before)?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(text)?;
            tx.set_text_node_range(text, Utf16Offset(offset), text, Utf16Offset(offset))?;
            Ok(text.key())
        })?;
        let command = surface::decode_command(
            "group-a.search-trigger",
            r#"{"kind":"actions"}"#,
            key.generation(),
            None,
        )?
        .expect("trigger");
        let (handled, commit) = editor.update(|tx| {
            tx.text(key)?.set_text_content(active)?;
            tx.set_text_node_range(
                key,
                Utf16Offset(active_offset),
                key,
                Utf16Offset(active_offset),
            )?;
            tx.dispatch(&command)
        })?;
        assert_eq!(handled == Handled::Yes, opens);
        assert_eq!(editor.state().root_text_content().as_ref(), expected);
        assert!(!commit.default_prevented);
        assert_eq!(
            surface::query_editor(
                "group-a.search-query",
                &json!({"kind":"actions"}),
                key.generation(),
                &editor
            )?
            .expect("snapshot")["open"],
            opens
        );
    }
    assert!(!surface::key_prevents_default("group-a.search-trigger"));
    Ok(())
}

#[test]
fn callbacks_preserve_registration_order_closed_terms_and_equal_payloads() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (key, created) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let search = tx.create(InlineSearchNode::default())?;
        tx.text(search)?.set_text_content("/")?;
        tx.append(p, &[search.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(search)?;
        Ok(search.key())
    })?;
    let opens = created
        .chain()
        .flat_map(|commit| commit.events_of(&CHANGE))
        .collect::<Vec<_>>();
    assert_eq!(opens.len(), 1);
    assert_eq!(opens[0].snapshot.kind, Kind::Actions);
    for text in ["/term", "/\u{200b}term"] {
        let (_, commit) = editor.update(|tx| {
            tx.text(key)?.set_text_content(text)?;
            Ok(())
        })?;
        let events = commit
            .chain()
            .flat_map(|commit| commit.events_of(&CHANGE))
            .collect::<Vec<_>>();
        assert_eq!(events.len(), 4);
        for (event, kind) in events.iter().zip(KINDS) {
            assert_eq!(event.snapshot.kind, kind);
            assert!(matches!(event.callback, Callback::Term));
            assert_eq!(event.snapshot.term, "term");
            assert_eq!(event.snapshot.open, kind == Kind::Actions);
            assert_eq!(event.snapshot.range.as_ref().expect("range").expected, text);
            assert!(
                surface::event_payload(
                    commit
                        .chain()
                        .flat_map(|commit| &commit.events)
                        .find(|event| event.name() == CHANGE.name())
                        .expect("wire event")
                )?
                .is_some()
            );
        }
    }
    let (_, commit) = editor.update(|tx| tx.remove(key, false))?;
    let events = commit
        .chain()
        .flat_map(|commit| commit.events_of(&CHANGE))
        .collect::<Vec<_>>();
    assert_eq!(events.len(), 4);
    assert!(
        events
            .iter()
            .all(|event| matches!(event.callback, Callback::Close)
                && !event.snapshot.open
                && event.snapshot.term == "term"
                && event.snapshot.range.is_none())
    );
    for kind in KINDS {
        let snapshot = surface::query_editor(
            "group-a.search-query",
            &json!({"kind":kind}),
            key.generation(),
            &editor,
        )?
        .expect("snapshot");
        assert_eq!(snapshot["open"], false);
        assert_eq!(snapshot["term"], "term");
    }
    Ok(())
}

#[test]
fn close_preserves_literal_utf16_caret_while_remove_leaves_empty_paragraph() -> Result<(), Error> {
    for remove in [false, true] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let ((paragraph, key), _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let search = tx.create(InlineSearchNode::default())?;
            tx.text(search)?.set_text_content("/🐺term")?;
            tx.append(p, &[search.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(search)?;
            Ok((p.key(), search.key()))
        })?;
        let command = surface::decode_command(
            if remove {
                "group-a.search-remove"
            } else {
                "group-a.search-close"
            },
            "{}",
            key.generation(),
            None,
        )?
        .expect("command");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        let range = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret");
        if remove {
            assert_eq!(editor.state().root_text_content().as_ref(), "");
            assert_eq!(range.anchor, Point::element(paragraph, ChildIndex(0)));
        } else {
            assert_eq!(editor.state().root_text_content().as_ref(), "/🐺term");
            assert_eq!(range.anchor.offset(), 7);
            assert!(
                editor
                    .state()
                    .view()
                    .get::<Text>(range.anchor.key())
                    .is_some()
            );
        }
        assert_eq!(range.anchor, range.focus);
        assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    }
    Ok(())
}

#[test]
fn imported_peer_ownership_is_not_adopted_and_global_close_preserves_remote_nodes()
-> Result<(), Error> {
    for owner in [None, Some(""), Some("remote-peer"), Some("local-peer")] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(peer::PeerIdState {
                    peer_id: Some("local-peer".into()),
                })
                .build()
                .expect("surface");
        let node = json!({"type":"inline-search","version":1,"text":"/","$":{"sharedPeerIds":["local-peer"]}});
        let mut node = node;
        if let Some(owner) = owner {
            node["$"]["peerId"] = json!(owner);
        }
        let state = serde_json::from_value(
            json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[node]}]}}),
        )?;
        let state = editor.parse_editor_state(&state)?;
        let imported = editor.set_editor_state(state, TagSet::default())?;
        let events = imported
            .chain()
            .flat_map(|commit| commit.events_of(&CHANGE))
            .collect::<Vec<_>>();
        if owner == Some("local-peer") {
            assert_eq!(events.len(), 5);
            assert_eq!(events[0].snapshot.kind, Kind::Actions);
            assert!(matches!(events[0].callback, Callback::Open));
            for (event, kind) in events[1..].iter().zip(KINDS) {
                assert_eq!(event.snapshot.kind, kind);
                assert!(matches!(event.callback, Callback::Term));
                assert_eq!(event.snapshot.term, "");
                assert_eq!(event.snapshot.open, kind == Kind::Actions);
            }
        } else {
            assert!(events.is_empty());
        }
        if let Some(output) = std::env::var_os("NATIVE_SEARCH_OUTPUT") {
            let output = std::path::PathBuf::from(output);
            let raw = json!({"json":editor.state().to_json()?, "selection":format!("{:?}",editor.state().selection()), "events":events.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>()?});
            std::fs::write(
                output.join(format!("import-{}.json", owner.unwrap_or("missing"))),
                serde_json::to_vec_pretty(&raw)?,
            )
            .expect("raw native proof");
        }
        let view = editor.state().view();
        let p = view.first_child(NodeKey::ROOT).expect("p");
        let key = view.first_child(p).expect("search");
        assert_eq!(
            peer::get_local(view, key)?,
            owner.map(|owner| owner == "local-peer")
        );
        let before = editor.state().to_json()?;
        let snapshot = surface::query_editor(
            "group-a.search-query",
            &json!({"kind":"actions"}),
            key.generation(),
            &editor,
        )?
        .expect("query");
        assert_eq!(snapshot["open"], owner == Some("local-peer"));
        assert_eq!(editor.state().to_json()?, before);
        assert_eq!(
            peer::get_peer_id(editor.state().view(), key)?.as_deref(),
            owner
        );
        let command =
            surface::decode_command("group-a.search-close", "{}", key.generation(), None)?
                .expect("close");
        assert_eq!(
            editor.dispatch(&command)?.0 == Handled::Yes,
            owner == Some("local-peer")
        );
        if owner != Some("local-peer") {
            assert_eq!(editor.state().to_json()?, before);
        }
    }
    Ok(())
}

#[test]
fn authored_trigger_uses_current_peer_without_registering_global_adoption() -> Result<(), Error> {
    for peer_id in [None, Some(""), Some("current-peer")] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(peer::PeerIdState {
                    peer_id: peer_id.map(str::to_owned),
                })
                .build()
                .expect("surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(p)
        })?;
        let generation = editor.state().max_key().generation();
        let command = surface::decode_command(
            "group-a.search-trigger",
            r#"{"kind":"mentions"}"#,
            generation,
            None,
        )?
        .expect("trigger");
        let (handled, created) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        let events = created
            .chain()
            .flat_map(|commit| commit.events_of(&CHANGE))
            .collect::<Vec<_>>();
        assert_eq!(
            events.len(),
            if peer_id.is_some_and(|peer| !peer.is_empty()) {
                5
            } else {
                1
            }
        );
        assert_eq!(events[0].snapshot.kind, Kind::Mentions);
        assert!(matches!(events[0].callback, Callback::Open));
        for (event, kind) in events[1..].iter().zip(KINDS) {
            assert_eq!(event.snapshot.kind, kind);
            assert!(matches!(event.callback, Callback::Term));
            assert_eq!(event.snapshot.open, kind == Kind::Mentions);
        }
        if let Some(output) = std::env::var_os("NATIVE_SEARCH_OUTPUT") {
            let output = std::path::PathBuf::from(output);
            let raw = json!({"json":editor.state().to_json()?, "selection":format!("{:?}",editor.state().selection()), "events":events.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>()?});
            std::fs::write(
                output.join(format!("authored-{}.json", peer_id.unwrap_or("disabled"))),
                serde_json::to_vec_pretty(&raw)?,
            )
            .expect("raw native proof");
        }
        let view = editor.state().view();
        let key = view
            .first_child(view.first_child(NodeKey::ROOT).expect("p"))
            .expect("search");
        assert_eq!(
            peer::get_peer_id(view, key)?.as_deref(),
            peer_id.filter(|peer| !peer.is_empty())
        );
        assert_eq!(
            peer::get_local(view, key)?,
            peer_id.filter(|peer| !peer.is_empty()).map(|_| true)
        );
        assert_eq!(
            surface::query_editor(
                "group-a.search-query",
                &json!({"kind":"mentions"}),
                generation,
                &editor
            )?
            .expect("query")["open"],
            true
        );
        let stale = surface::decode_command("group-a.search-remove", "{}", generation + 1, None)?
            .expect("stale");
        let before = editor.state().to_json()?;
        assert_eq!(editor.dispatch(&stale)?.0, Handled::No);
        assert_eq!(editor.state().to_json()?, before);
        assert!(
            surface::query_editor(
                "group-a.search-query",
                &json!({"kind":"mentions"}),
                generation + 1,
                &editor
            )
            .is_err()
        );
    }
    Ok(())
}

#[test]
fn mixed_imports_stop_each_controller_at_first_valid_mismatching_creation() -> Result<(), Error> {
    for symbols in [
        vec!["@", "/", ":", ";"],
        vec!["/", ":", ";", "@"],
        vec![":", ";", "@", "/"],
        vec![";", "@", "/", ":"],
        vec!["@term", "/", ":", ";"],
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(peer::PeerIdState {
                    peer_id: Some("local-peer".into()),
                })
                .build()
                .expect("surface");
        let children = symbols.iter().map(|symbol| json!({"type":"paragraph","version":1,"children":[{"type":"inline-search","version":1,"text":symbol,"$":{"peerId":"local-peer"}}]})).collect::<Vec<_>>();
        let state = editor.parse_editor_state(&serde_json::from_value(
            json!({"root":{"type":"root","version":1,"children":children}}),
        )?)?;
        editor.set_editor_state(state, TagSet::default())?;
        let generation = editor.state().max_key().generation();
        for kind in KINDS {
            let snapshot = surface::query_editor(
                "group-a.search-query",
                &json!({"kind":kind}),
                generation,
                &editor,
            )?
            .expect("query");
            assert_eq!(snapshot["open"], symbols[0] == kind.symbol());
            assert_eq!(snapshot["term"], "");
        }
        let view = editor.state().view();
        let paragraphs = view.children_keys(NodeKey::ROOT)?;
        let key = view.first_child(paragraphs[1]).expect("second search");
        editor.update(|tx| {
            tx.text(key)?.set_text_content("/updated")?;
            Ok(())
        })?;
        for kind in KINDS {
            let snapshot = surface::query_editor(
                "group-a.search-query",
                &json!({"kind":kind}),
                generation,
                &editor,
            )?
            .expect("query");
            assert_eq!(snapshot["open"], symbols[0] == kind.symbol());
            assert_eq!(snapshot["term"], "updated");
        }
        let close = surface::decode_command("group-a.search-close", "{}", generation, None)?
            .expect("close");
        assert_eq!(editor.dispatch(&close)?.0, Handled::Yes);
        assert!(
            editor
                .state()
                .view()
                .all_text_nodes(NodeKey::ROOT)
                .into_iter()
                .all(|key| editor.state().view().get::<InlineSearchNode>(key).is_none())
        );
        assert_eq!(
            editor.state().view().children_keys(NodeKey::ROOT)?,
            paragraphs
        );
    }
    Ok(())
}

#[test]
fn trigger_policy_does_not_strengthen_source_range_composition_or_mentions_suffix_rules()
-> Result<(), Error> {
    for (kind, text, offset, focus, composing, expected) in [
        (Kind::Actions, "word", 2, 2, false, false),
        (Kind::Actions, " word", 0, 0, false, true),
        (Kind::Actions, "word", 0, 0, false, false),
        (Kind::Mentions, "word", 0, 0, false, true),
        (Kind::Actions, " ", 1, 0, false, true),
        (Kind::Actions, " ", 1, 1, true, true),
        (Kind::Actions, "` ", 1, 1, false, false),
        (Kind::Actions, "\u{feff}", 1, 1, false, true),
        (Kind::Actions, "\u{85}", 1, 1, false, false),
    ] {
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
            tx.set_text_node_range(leaf, Utf16Offset(offset), leaf, Utf16Offset(focus))?;
            tx.set_composition_key(composing.then_some(leaf.key()))
        })?;
        let generation = editor.state().max_key().generation();
        let command = surface::decode_command(
            "group-a.search-trigger",
            &json!({"kind":kind}).to_string(),
            generation,
            None,
        )?
        .expect("trigger");
        assert_eq!(
            editor.dispatch(&command)?.0 == Handled::Yes,
            expected,
            "{kind:?} {text:?}"
        );
    }
    Ok(())
}

#[test]
fn malformed_search_requests_fail_before_dispatch_and_unknown_routes_remain_unclaimed()
-> Result<(), Error> {
    for (name, payload) in [
        ("group-a.search-trigger", r#"{"kind":"tags"}"#),
        ("group-a.search-trigger", r#"{"kind":"actions","key":1}"#),
        ("group-a.search-close", "null"),
        ("group-a.search-remove", r#"{"kind":"actions"}"#),
    ] {
        assert!(surface::decode_command(name, payload, 0, None).is_err());
    }
    let editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    assert!(
        surface::query_editor(
            "group-a.search-query",
            &json!({"kind":"unknown"}),
            0,
            &editor
        )
        .is_err()
    );
    assert!(
        surface::query_editor(
            "group-a.search-query",
            &json!({"kind":"actions","key":1}),
            0,
            &editor
        )
        .is_err()
    );
    assert!(surface::query_editor("unrelated-query", &json!({}), 0, &editor)?.is_none());
    assert!(surface::decode_command("unrelated-command", "{}", 0, None)?.is_none());
    Ok(())
}

#[test]
fn dirty_missing_peer_and_equal_format_only_callbacks_match_source_followups() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(peer::PeerIdState {
                peer_id: Some("local-peer".into()),
            })
            .build()
            .expect("surface");
    let state = editor.parse_editor_state(&serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"inline-search","version":1,"text":"/"}]}]}}))?)?;
    editor.set_editor_state(state, TagSet::default())?;
    let view = editor.state().view();
    let key = view
        .first_child(view.first_child(NodeKey::ROOT).expect("p"))
        .expect("search");
    assert_eq!(peer::get_peer_id(view, key)?, None);
    let (_, changed) = editor.update(|tx| {
        tx.text(key)?.set_text_content("/term")?;
        Ok(())
    })?;
    assert_eq!(
        peer::get_peer_id(editor.state().view(), key)?.as_deref(),
        Some("local-peer")
    );
    assert_eq!(
        peer::get_local(editor.state().view(), key)?,
        None,
        "updated missing owner is not a created-node local-status callback"
    );
    let callbacks = changed
        .chain()
        .flat_map(|commit| commit.events_of(&CHANGE))
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(callbacks.len(), 4);
    let (_, format) = editor.update(|tx| {
        tx.text(key)?.set_format(TextFormat::BOLD)?;
        Ok(())
    })?;
    let repeated = format
        .chain()
        .flat_map(|commit| commit.events_of(&CHANGE))
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(
        repeated, callbacks,
        "equal full payloads are emitted again, never deduplicated"
    );
    assert!(
        repeated
            .iter()
            .all(|event| event["term"] == "term" && event["open"] == false)
    );
    Ok(())
}
