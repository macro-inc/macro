use super::*;

#[test]
fn search_uses_actual_application_generation_admission_and_readonly_cache_query(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "search-fixture".into(),
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
    let mut machine =
        machine::Machine::create_macro(generated::ABI_MAJOR, &bytes(&config)?, 0.0, 0.0)?;
    machine.sync(SyncInput::Start, 0.0, None)?;
    machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: lexical_loro::golden::MARKDOWN_GOLDEN.to_vec(),
        },
        1.0,
        None,
    )?;
    machine.editor(Input::SetState {
        state: serde_json::from_value(serde_json::json!({"root":{"type":"root","version":1,"children":[
            {"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":" "}]}
        ]}}))?, tags: TagSet::default(),
    }, 2.0)?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor")
    };
    let view = session.surface().state().view();
    let key = view
        .first_child(view.first_child(NodeKey::ROOT).expect("p"))
        .expect("text");
    machine.editor(
        Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(1)),
                focus: Point::text(key, Utf16Offset(1)),
                resolution_dirty: false,
            },
            change: None,
        },
        2.5,
    )?;
    let generation = machine.generation();
    let mut envelope = wire::SessionInputMsg {
        kind: 2,
        request: 0,
        code: 0,
        flag: false,
        bytes: vec![],
        peers: vec![],
        operations: vec![],
        mark_id: String::new(),
        anchor: vec![],
        focus: vec![],
        expected_text: String::new(),
        editor: wire::EditorInputMsg::EditorApplication {
            name: "group-a.search-trigger".into(),
            json: r#"{"kind":"actions"}"#.into(),
            generation,
            selection: editor_input::empty_selection(),
            keyboard: false,
            key: String::new(),
            mods: 0,
            code: 0,
        },
    };
    let mut stale = envelope.clone();
    if let wire::EditorInputMsg::EditorApplication { generation, .. } = &mut stale.editor {
        *generation += 1;
    }
    assert!(matches!(
        machine.input(&bytes(&stale)?, 3.0, 3.0),
        Err(BoundaryError::Invalid("application command generation"))
    ));
    let flags = machine.input(&bytes(&envelope)?, 4.0, 4.0)?;
    assert_ne!(flags & generated::FLAG_HANDLED, 0);
    // Decode the actual Machine output packet, including all ordered view
    // effects. Equal controller callbacks must survive the existing wire path.
    let packet = &machine.output;
    let words = u32::from_le_bytes(packet[12..16].try_into().expect("words")) as usize;
    let strings = u32::from_le_bytes(packet[16..20].try_into().expect("strings")) as usize;
    let count = u32::from_le_bytes(packet[20..24].try_into().expect("entries"));
    let mut offset = (24 + words * 4 + strings + 3) & !3;
    let mut callbacks = vec![];
    for _ in 0..count {
        let tag = u32::from_le_bytes(packet[offset..offset + 4].try_into().expect("tag"));
        let length =
            u32::from_le_bytes(packet[offset + 12..offset + 16].try_into().expect("length"))
                as usize;
        let start = offset + 16;
        if tag == 16 {
            let event = wire::ViewEffectMsg::deserialize(&packet[start..start + length])?;
            if event.kind == 6 && event.code == 9 && event.text == "group-a.search-change" {
                callbacks.push(serde_json::from_str::<serde_json::Value>(&event.style)?);
            }
        }
        offset = (start + length + 3) & !3;
    }
    assert_eq!(callbacks.len(), 5);
    assert_eq!(callbacks[0]["callback"], "open");
    assert_eq!(callbacks[0]["kind"], "actions");
    for (event, kind) in callbacks[1..]
        .iter()
        .zip(["emojis", "mentions", "snippets", "actions"])
    {
        assert_eq!(event["callback"], "term");
        assert_eq!(event["kind"], kind);
        assert_eq!(event["term"], "");
        assert_eq!(event["open"], kind == "actions");
    }
    if let Some(output) = std::env::var_os("NATIVE_SEARCH_OUTPUT") {
        let output = std::path::PathBuf::from(output);
        std::fs::write(
            output.join("machine-events.json"),
            serde_json::to_vec_pretty(&callbacks)?,
        )
        .expect("raw wire callbacks");
    }
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let view = session.surface().state().view();
    let children = view.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 1);
    let key = view
        .children_keys(children[0])?
        .into_iter()
        .find(|key| {
            view.get::<macro_document_model::nodes::InlineSearchNode>(*key)
                .is_some()
        })
        .expect("actual search");
    assert_eq!(
        macro_document_model::peer::get_peer_id(view, key)?.as_deref(),
        Some("71")
    );
    let snapshot = session
        .surface()
        .application_query(
            "group-a.search-query",
            &serde_json::json!({"kind":"actions"}),
            generation,
        )?
        .expect("query");
    assert_eq!(snapshot["open"], true);
    assert_eq!(snapshot["range"]["expected"], "/");
    assert!(session
        .surface()
        .application_query(
            "group-a.search-query",
            &serde_json::json!({"kind":"actions"}),
            generation + 1
        )
        .is_err());
    // A read-only REMOVE must neither clear the node nor emit a closing callback.
    machine.editor(
        Input::SelectionFromView {
            selection: ViewSelection::KeepModel,
            change: None,
        },
        5.0,
    )?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let before = session.surface().state().to_json()?;
    let before_selection = session.surface().state().selection().cloned();
    machine.sync(
        SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: false,
        }),
        6.0,
        Some(6.0),
    )?;
    if let wire::EditorInputMsg::EditorApplication {
        generation,
        name,
        json,
        ..
    } = &mut envelope.editor
    {
        *name = "group-a.search-remove".into();
        *json = "{}".into();
        *generation = machine.generation();
    }
    machine.input(&bytes(&envelope)?, 7.0, 7.0)?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    assert_eq!(session.surface().state().to_json()?, before);
    assert_eq!(
        session.surface().state().selection(),
        before_selection.as_ref()
    );
    assert!(session.last_output().io.is_empty());
    assert!(session
        .last_output()
        .view
        .iter()
        .any(|effect| matches!(effect, ViewEffect::Error(SessionError::ReadOnly))));
    let session = EditorSession {
        #[cfg(feature = "compatibility")]
        compatibility: None,
        machine,
        hostname: None,
    };
    let request = wire::QueryMsg {
        kind: 9,
        key: 0,
        text: serde_json::json!({"name":"group-a.search-query","data":{"kind":"actions"}})
            .to_string(),
        flags: session.machine.generation(),
    };
    let reply = query::query(&session, request.clone())?;
    let snapshot: serde_json::Value = serde_json::from_str(&reply.text)?;
    assert_eq!(
        snapshot["open"], true,
        "read-only REMOVE did not close the cache"
    );
    let mut stale = request;
    stale.flags += 1;
    assert!(matches!(
        query::query(&session, stale),
        Err(BoundaryError::Invalid("application query generation"))
    ));
    Ok(())
}
