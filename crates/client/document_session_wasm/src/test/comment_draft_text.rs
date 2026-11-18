use super::*;
use bebop::Record;
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

fn receiver(
    session: &EditorSession,
    msg: wire::QueryMsg,
) -> Result<wire::QueryReplyMsg, Box<dyn std::error::Error>> {
    // Actual existing public serialized query boundary; no new module call.
    let encoded = session.query(&bytes(&msg)?).expect("query receiver");
    Ok(wire::QueryReplyMsg::deserialize(&encoded)?)
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
    let capture = query::query(
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
        let legacy = query::query(&session, message(encoded.clone()))?;
        assert_eq!(legacy.points.len(), 2);
        assert_eq!(legacy.text, "");
        assert_eq!(legacy.count, 0);
        // Move current selection away: the retained cursors still cover both blocks.
        range_request(&mut session, false, true)?;
        let before = session.surface().state().to_json()?;
        let output = session.machine.output.clone();
        let generation = session.machine.generation();
        let machine::Session::Editor(editor) = &session.machine.session else {
            panic!("editor");
        };
        let vv = editor.version();
        let stored = editor.conformance_value();
        // The serialized pending machine packet is compared byte-for-byte below.
        // SessionOutput itself has no Debug/Eq: retain its view/IO allocations,
        // lengths and scalar timer/identity-supply facts without reading payloads.
        let pending = (
            editor.last_output().view.as_ptr(),
            editor.last_output().view.len(),
            editor.last_output().io.as_ptr(),
            editor.last_output().io.len(),
            editor.last_output().wake_at,
            editor.last_output().need_peer_ids,
        );
        let mut value: serde_json::Value = serde_json::from_str(&encoded)?;
        value["markId"] = "missing".into();
        let reply = receiver(&session, message(value.to_string()))?;
        assert_eq!(reply.count, 1);
        assert_eq!(reply.text, "before\nsecond");
        assert_eq!(session.surface().state().to_json()?, before);
        assert_eq!(session.machine.output, output);
        assert_eq!(session.machine.generation(), generation);
        let machine::Session::Editor(editor) = &session.machine.session else {
            panic!("editor");
        };
        assert_eq!(editor.version(), vv);
        assert_eq!(editor.conformance_value(), stored);
        assert_eq!(
            (
                editor.last_output().view.as_ptr(),
                editor.last_output().view.len(),
                editor.last_output().io.as_ptr(),
                editor.last_output().io.len(),
                editor.last_output().wake_at,
                editor.last_output().need_peer_ids,
            ),
            pending
        );
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
    let empty = receiver(&session, message(value.to_string()))?;
    assert_eq!((empty.count, empty.text.as_str()), (1, ""));
    value["anchor"]["nodeId"] = "retired-node".into();
    let absent = receiver(&session, message(value.to_string()))?;
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
    let reply = receiver(&session, message(value.to_string()))?;
    assert_eq!((reply.count, reply.text.as_str()), (1, "before"));
    Ok(())
}

#[test]
fn comment_draft_new_mode_rejects_original_duplicates_unknowns_and_positional_objects(
) -> Result<(), Box<dyn std::error::Error>> {
    let session = fixture(false, "before")?;
    let cursor = r#"{"nodeId":"node","cursor":[1,2]}"#;
    let valid = format!(r#"{{"anchor":{cursor},"focus":{cursor},"markId":"quote"}}"#);
    assert!(query::query(&session, message(valid.clone())).is_ok());
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
        assert!(
            query::query(&session, message(text.clone())).is_err(),
            "{text}"
        );
    }
    Ok(())
}

#[test]
fn comment_draft_whitespace_only_mark_falls_back_to_untrimmed_range(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut session = fixture(true, "   ")?;
    let mut value: serde_json::Value =
        serde_json::from_str(&range_request(&mut session, false, false)?)?;
    value["markId"] = "quote".into();
    let reply = receiver(&session, message(value.to_string()))?;
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
            query::query(&session, msg),
            Err(BoundaryError::Invalid("comment draft text fields"))
        ));
    }
    Ok(())
}

#[test]
fn comment_draft_retained_cursors_follow_an_actual_text_edit(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut session = fixture(false, "before")?;
    let mut value: serde_json::Value =
        serde_json::from_str(&range_request(&mut session, false, false)?)?;
    value["markId"] = "missing".into();
    let key = session
        .surface()
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .unwrap();
    session.machine.editor(
        Input::TextFromView {
            key,
            text: "befZore".into(),
            anchor: Some(Utf16Offset(4)),
            focus: Some(Utf16Offset(4)),
            composition_end: false,
            composition_data: None,
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(4)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
        },
        3.0,
    )?;
    let reply = receiver(&session, message(value.to_string()))?;
    assert_eq!((reply.count, reply.text.as_str()), (1, "befZore\nsecond"));
    Ok(())
}

#[test]
fn comment_draft_resolves_real_table_shadow_range_after_live_caret_moves(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut session = fixture(false, "before")?;
    session.machine.editor(Input::SetState {
        state:serde_json::from_str(include_str!("../../../lexical/macro_document_model/src/plugins_group_b/table/actions/fixtures/before.json"))?,
        tags:TagSet::default(),
    },3.0)?;
    let keys = session
        .surface()
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .collect::<Vec<_>>();
    session.machine.editor(
        Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: Point::text(keys[0], Utf16Offset(1)),
                focus: Point::text(keys[0], Utf16Offset(5)),
                resolution_dirty: false,
            },
            change: None,
        },
        4.0,
    )?;
    let captured = query::query(
        &session,
        wire::QueryMsg {
            kind: 8,
            key: 0,
            flags: 0,
            text: String::new(),
        },
    )?;
    let mut value: serde_json::Value = serde_json::from_str(&captured.nodes[0])?;
    value["markId"] = "missing".into();
    session.machine.editor(
        Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: Point::text(keys[1], Utf16Offset(0)),
                focus: Point::text(keys[1], Utf16Offset(8)),
                resolution_dirty: false,
            },
            change: None,
        },
        5.0,
    )?;
    let reply = receiver(&session, message(value.to_string()))?;
    assert_eq!((reply.count, reply.text.as_str()), (1, "ell "));
    Ok(())
}
