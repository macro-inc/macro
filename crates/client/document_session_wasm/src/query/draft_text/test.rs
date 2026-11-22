use super::*;
use doc_sync_core::*;

fn fixture(marked: bool, first: &str) -> Result<crate::EditorSession, Box<dyn std::error::Error>> {
    let context = macro_document_model::DocumentContext {
        clock: macro_document_model::NodeClock(std::sync::Arc::new(|| 1794052800000)),
        random: macro_document_model::NodeRandom(std::sync::Arc::new({
            let next = std::sync::atomic::AtomicU8::new(7);
            move |size| vec![next.fetch_add(1, std::sync::atomic::Ordering::Relaxed); size]
        })),
        host: macro_document_model::NodeHost::default(),
        keys: KeySource::default(),
        editor_created: None,
    };
    let original =
        macro_document_model::snapshot::markdown_to_loro_snapshot("before\n\nsecond", &context)?;
    let doc = lexical_loro::new_doc(91)?;
    doc.import(&original)?;
    let initial =
        lexical_loro::reconstruct_state(&doc, &macro_document_model::sync::MACRO_SYNC_POLICY)?;
    let mut raw = serde_json::to_value(initial)?;
    raw["root"]["children"][0]["children"][0]["text"] = first.into();
    if marked {
        let children = raw["root"]["children"][0]["children"].take();
        raw["root"]["children"][0]["children"] = serde_json::json!([{
            "type":"comment-mark", "version":1, "ids":["quote"],
            "isDraft":false, "threadId":null, "children":children,
            "format":"", "indent":0, "direction":null,
            "$":{"id":"quote-node"}
        }]);
    }
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&raw, Some(&original))?;
    let config = wire::SessionConfigMsg {
        doc: "comment-draft-text".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![71, 72, 73],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: false,
        view_engine: 1,
        view_os: 0,
        token: String::new(),
        traceparent: String::new(),
        coalesce: 25,
        snapshot_interval: 0,
        observed: vec![],
    };
    let mut machine = crate::machine::Machine::create_macro(
        crate::generated::ABI_MAJOR,
        &crate::bytes(&config)?,
        0.0,
        0.0,
    )?;
    machine.sync(SyncInput::Start, 0.0, None)?;
    machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        },
        1.0,
        None,
    )?;
    Ok(crate::EditorSession {
        #[cfg(feature = "compatibility")]
        compatibility: None,
        machine,
        hostname: None,
        code_tokens: None,
    })
}

fn message(text: String) -> wire::QueryMsg {
    wire::QueryMsg {
        kind: 12,
        key: 0,
        flags: 0,
        text,
    }
}
fn range_request(
    session: &mut crate::EditorSession,
    backward: bool,
    collapsed: bool,
) -> Result<String, Box<dyn std::error::Error>> {
    let keys = session
        .surface()
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .collect::<Vec<_>>();
    let anchor = Point::text(keys[0], Utf16Offset(0));
    let focus = if collapsed {
        anchor
    } else {
        Point::text(keys[1], Utf16Offset(6))
    };
    let (anchor, focus) = if backward {
        (focus, anchor)
    } else {
        (anchor, focus)
    };
    session.machine.editor(
        Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor,
                focus,
                resolution_dirty: false,
            },
            change: None,
        },
        2.0,
    )?;
    let capture = super::super::query(
        session,
        wire::QueryMsg {
            kind: 8,
            key: 0,
            flags: 0,
            text: String::new(),
        },
    )?;
    Ok(capture.nodes[0].clone())
}

#[test]
fn comment_draft_read_uses_resolved_range_not_current_selection_and_preserves_output(
) -> Result<(), Box<dyn std::error::Error>> {
    for backward in [false, true] {
        let mut session = fixture(false, "before")?;
        let encoded = range_request(&mut session, backward, false)?;
        let legacy = super::super::query(&session, message(encoded.clone()))?;
        assert_eq!(legacy.points.len(), 2);
        assert_eq!(legacy.text, "");
        assert_eq!(legacy.count, 0);
        // Move current selection away: the retained cursors still cover both blocks.
        range_request(&mut session, false, true)?;
        let before = session.surface().state().to_json()?;
        let output = session.machine.output.clone();
        let generation = session.machine.generation();
        let mut value: serde_json::Value = serde_json::from_str(&encoded)?;
        value["markId"] = "missing".into();
        let reply = query(&session, &message(value.to_string()))?;
        assert_eq!(reply.count, 1);
        assert_eq!(reply.text, "before\nsecond");
        assert_eq!(session.surface().state().to_json()?, before);
        assert_eq!(session.machine.output, output);
        assert_eq!(session.machine.generation(), generation);
    }
    Ok(())
}

#[test]
fn comment_draft_resolved_empty_is_distinct_from_unavailable(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut session = fixture(false, "before")?;
    let mut value: serde_json::Value =
        serde_json::from_str(&range_request(&mut session, false, true)?)?;
    value["markId"] = "missing".into();
    let empty = query(&session, &message(value.to_string()))?;
    assert_eq!((empty.count, empty.text.as_str()), (1, ""));
    value["anchor"]["nodeId"] = "retired-node".into();
    let absent = query(&session, &message(value.to_string()))?;
    assert_eq!((absent.count, absent.text.as_str()), (0, ""));
    Ok(())
}

#[test]
fn comment_draft_nonempty_mark_wins_even_when_cursor_nodes_no_longer_resolve(
) -> Result<(), Box<dyn std::error::Error>> {
    let session = fixture(true, "before")?;
    let value = serde_json::json!({
        "anchor":{"nodeId":"retired","cursor":[]},
        "focus":{"nodeId":"retired","cursor":[]}, "markId":"quote"
    });
    let reply = query(&session, &message(value.to_string()))?;
    assert_eq!((reply.count, reply.text.as_str()), (1, "before"));
    Ok(())
}

#[test]
fn comment_draft_new_mode_rejects_original_duplicates_unknowns_and_positional_objects() {
    let cursor = r#"{"nodeId":"node","cursor":[1,2]}"#;
    let valid = format!(r#"{{"anchor":{cursor},"focus":{cursor},"markId":"quote"}}"#);
    assert!(request(&valid).is_ok());
    let bad = [
        valid.replace("\"markId\":\"quote\"", "\"markId\":\"a\",\"markId\":\"b\""),
        valid.replace("\"markId\":\"quote\"", "\"markId\":null"),
        valid.replace("\"markId\":\"quote\"", "\"markId\":\"quote\",\"extra\":0"),
        valid.replacen(cursor, r#"["node",[1,2]]"#, 1),
        valid.replacen(cursor, r#"{"nodeId":"a","nodeId":"b","cursor":[1,2]}"#, 1),
        valid.replacen(cursor, r#"{"nodeId":"a","cursor":[1,2],"extra":0}"#, 1),
        valid.replace("[1,2]", "[256]"),
        format!("[{cursor},{cursor},\"quote\"]"),
    ];
    for text in bad {
        assert!(request(&text).is_err(), "{text}");
    }
}

#[test]
fn comment_draft_whitespace_only_mark_falls_back_to_untrimmed_range(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut session = fixture(true, "   ")?;
    let mut value: serde_json::Value =
        serde_json::from_str(&range_request(&mut session, false, false)?)?;
    value["markId"] = "quote".into();
    let reply = query(&session, &message(value.to_string()))?;
    assert_eq!((reply.count, reply.text.as_str()), (1, "   \nsecond"));
    Ok(())
}

#[test]
fn comment_draft_reserved_fields_reject_before_read() -> Result<(), Box<dyn std::error::Error>> {
    let session = fixture(false, "before")?;
    let text = r#"{"anchor":{"nodeId":"retired","cursor":[]},"focus":{"nodeId":"retired","cursor":[]},"markId":"quote"}"#;
    for (key, flags) in [(1, 0), (0, 1)] {
        let mut msg = message(text.into());
        msg.key = key;
        msg.flags = flags;
        assert!(matches!(
            query(&session, &msg),
            Err(BoundaryError::Invalid("comment draft text fields"))
        ));
    }
    Ok(())
}
