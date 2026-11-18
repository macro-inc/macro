use super::*;
use macro_document_model::nodes::{EquationNode, Maybe, UserMentionNode};

#[test]
fn media_size_application_respects_generation_class_and_actual_authorization_downgrade(
) -> Result<(), BoundaryError> {
    use macro_document_model::nodes::{ImageNode, JsNumber};

    let config = wire::SessionConfigMsg {
        doc: "media-size-fixture".into(),
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
    machine.editor(
        Input::SetState {
            state: serde_json::from_value(serde_json::json!({
                "root":{"type":"root","version":1,"children":[
                    {"type":"image","version":1,"srcType":"url","id":"image-id",
                     "url":"https://example.com/image","width":256,"height":128,"scale":1,"alt":""}
                ]}
            }))?,
            tags: TagSet::default(),
        },
        2.0,
    )?;
    let image = {
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        session
            .surface()
            .state()
            .view()
            .descendants(NodeKey::ROOT)
            .find(|(key, _)| session.surface().state().view().is::<ImageNode>(*key))
            .expect("actual image")
            .0
    };
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
            name: "group-b.media-resize".into(),
            json: serde_json::json!({"key":image.index(),"kind":"image","width":640,"height":480})
                .to_string(),
            generation: image.generation(),
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
    machine.input(&bytes(&envelope)?, 4.0, 4.0)?;
    let before = {
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        let node = session
            .surface()
            .state()
            .get::<ImageNode>(image)
            .expect("image");
        assert_eq!(node.media.width, Maybe::Value(JsNumber(640.0)));
        assert_eq!(node.media.height, Maybe::Value(JsNumber(480.0)));
        assert_eq!(node.render_revision, 0);
        session.surface().state().to_json()?
    };
    if let wire::EditorInputMsg::EditorApplication { json, .. } = &mut envelope.editor {
        *json = serde_json::json!({"key":image.index(),"kind":"video","width":1,"height":2})
            .to_string();
    }
    let flags = machine.input(&bytes(&envelope)?, 5.0, 5.0)?;
    assert_ne!(flags & generated::FLAG_HANDLED, 0);
    {
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        assert_eq!(session.surface().state().to_json()?, before);
    }
    machine.sync(
        SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: false,
        }),
        6.0,
        Some(6.0),
    )?;
    if let wire::EditorInputMsg::EditorApplication { json, .. } = &mut envelope.editor {
        *json = serde_json::json!({"key":image.index(),"kind":"image","width":1,"height":2})
            .to_string();
    }
    machine.input(&bytes(&envelope)?, 7.0, 7.0)?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    assert_eq!(session.surface().state().to_json()?, before);
    assert!(session.last_output().io.is_empty());
    assert!(session.last_output().view.iter().any(|effect| matches!(
        effect,
        ViewEffect::Error(document_session::SessionError::ReadOnly)
    )));
    Ok(())
}

#[test]
fn production_macro_machine_admits_decorator_actions_with_current_generation() {
    let config = wire::SessionConfigMsg {
        doc: "decorator-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![7, 8, 9],
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
    let mut machine = machine::Machine::create_macro(
        generated::ABI_MAJOR,
        &bytes(&config).expect("config"),
        0.0,
        1794052800000.0,
    )
    .expect("macro machine");
    machine.sync(SyncInput::Start, 0.0, None).expect("start");
    machine
        .sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: lexical_loro::golden::MARKDOWN_GOLDEN.to_vec(),
            },
            1.0,
            None,
        )
        .expect("seed");
    let state = serde_json::from_value(serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"equation","version":1,"equation":"x","inline":false},{"type":"user-mention","version":1,"userId":"literal|Identity","email":"","displayName":"Old"}]}]}})).expect("state");
    machine
        .editor(
            Input::SetState {
                state,
                tags: TagSet::default(),
            },
            2.0,
        )
        .expect("load");
    let (equation, mention) = {
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor")
        };
        let view = session.surface().state().view();
        let equation = view
            .descendants(NodeKey::ROOT)
            .find(|(key, _)| view.is::<EquationNode>(*key))
            .expect("equation")
            .0;
        let mention = view
            .descendants(NodeKey::ROOT)
            .find(|(key, _)| view.is::<UserMentionNode>(*key))
            .expect("mention")
            .0;
        (equation, mention)
    };
    let selection = wire::SelectionMsg {
        kind: 0,
        anchor: wire::PointMsg {
            key: 0,
            offset: 0,
            _type: 1,
        },
        focus: wire::PointMsg {
            key: 0,
            offset: 0,
            _type: 1,
        },
        nodes: vec![],
        table: 0,
        dirty: false,
    };
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
            name: "group-b.equation".into(),
            json: serde_json::json!({"key":equation.index(),"equation":"y^2","inline":true})
                .to_string(),
            generation: equation.generation(),
            selection: selection.clone(),
            keyboard: false,
            key: String::new(),
            mods: 0,
            code: 0,
        },
    };
    let mut stale = envelope.clone();
    if let wire::EditorInputMsg::EditorApplication { generation, .. } = &mut stale.editor {
        *generation = generation.saturating_add(1);
    }
    assert!(matches!(
        machine.input(&bytes(&stale).expect("stale bytes"), 3.0, 1794052800003.0),
        Err(BoundaryError::Invalid("application command generation"))
    ));
    machine
        .input(
            &bytes(&envelope).expect("equation bytes"),
            4.0,
            1794052800004.0,
        )
        .expect("equation application");
    envelope.editor = wire::EditorInputMsg::EditorApplication {
        name: "group-b.user-display-names".into(),
        json: r#"{"names":{"literal|Identity":"Fresh"}}"#.into(),
        generation: mention.generation(),
        selection,
        keyboard: false,
        key: String::new(),
        mods: 0,
        code: 0,
    };
    machine
        .input(
            &bytes(&envelope).expect("names bytes"),
            5.0,
            1794052800005.0,
        )
        .expect("names application");
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor")
    };
    let view = session.surface().state().view();
    assert_eq!(
        view.get_or_err::<EquationNode>(equation)
            .expect("equation")
            .equation,
        Maybe::Value("y^2".into())
    );
    assert!(
        !view
            .get_or_err::<EquationNode>(equation)
            .expect("equation")
            .inline
    );
    let user = view
        .get_or_err::<UserMentionNode>(mention)
        .expect("mention");
    assert_eq!(user.display_name, "Fresh");
    assert_eq!(user.user_id, Maybe::Value("literal|Identity".into()));
    assert!(!session
        .last_output()
        .view
        .iter()
        .any(|effect| matches!(effect, ViewEffect::Error(_))));
}
