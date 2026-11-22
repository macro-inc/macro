use super::*;

#[test]
fn user_mention_uses_current_envelope_selection_generation_and_admission(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "user-mention-fixture".into(),
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
            {"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"body"}]}
        ]}}))?, tags: TagSet::default(),
    }, 2.0)?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor")
    };
    let view = session.surface().state().view();
    let key = view
        .first_child(view.first_child(NodeKey::ROOT).expect("p"))
        .expect("text");
    // The actual application envelope supplies the later caret, not an earlier
    // range captured while opening the picker or awaiting tracking I/O.
    let mut selection = editor_input::empty_selection();
    selection.kind = 2;
    selection.anchor = wire::PointMsg {
        key: key.index(),
        offset: 4,
        _type: 0,
    };
    selection.focus = selection.anchor;
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
            name: "group-a.insert-user-mention".into(),
            json: r#"{"userId":"fixture-user","email":"person@example.com","displayName":null,"mentionUuid":null}"#.into(),
            generation,
            selection,
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
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let view = session.surface().state().view();
    let children = view.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 1);
    assert_eq!(
        session.surface().state().root_text_content().as_ref(),
        "body@person"
    );
    let mention = view
        .children_keys(children[0])?
        .into_iter()
        .find_map(|key| view.get::<macro_document_model::nodes::UserMentionNode>(key))
        .expect("real mention");
    assert_eq!(mention.user_id.as_deref(), Some("fixture-user"));
    assert_eq!(mention.display_name, "person");
    assert_eq!(
        mention.mention_uuid,
        macro_document_model::nodes::Maybe::Null
    );
    // Current read-only admission refuses another insertion without restoring selection.
    machine.editor(
        Input::Command {
            command: Command::InsertText(" tail".into()),
            selection: ViewSelection::KeepModel,
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
        selection,
        ..
    } = &mut envelope.editor
    {
        *selection = editor_input::empty_selection();
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
    Ok(())
}
