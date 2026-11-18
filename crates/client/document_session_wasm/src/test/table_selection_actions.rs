use super::*;
use lexical_rich_nodes::table::TableCellNode;

#[test]
fn table_selection_actions_use_actual_generation_and_current_authorization(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "table-selection-fixture".into(),
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
            state: serde_json::from_str(include_str!(
                "../../../lexical/macro_document_model/src/plugins_group_b/table/actions/fixtures/before.json"
            ))?,
            tags: TagSet::default(),
        },
        2.0,
    )?;
    let (table, anchor, focus, before) = {
        let machine::Session::Editor(session) = &machine.session else {
            panic!("actual editor session");
        };
        let state = session.surface().state();
        let view = state.view();
        let table = view.first_child(NodeKey::ROOT).expect("table");
        let row = view.first_child(table).expect("first row");
        let cells = view.children_keys(row)?;
        (table, cells[0], cells[1], state.to_json()?)
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
            name: "group-b.table".into(),
            json: r#"{"action":"selection-merge"}"#.into(),
            generation: table.generation(),
            selection: editor_input::view_selection(&ViewSelection::Table {
                table,
                anchor_cell: anchor,
                focus_cell: focus,
            }),
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
    {
        let machine::Session::Editor(session) = &machine.session else {
            panic!("actual editor session");
        };
        assert_eq!(session.surface().state().to_json()?, before);
    }
    let flags = machine.input(&bytes(&envelope)?, 4.0, 4.0)?;
    assert_ne!(flags & generated::FLAG_HANDLED, 0);
    let merged = {
        let machine::Session::Editor(session) = &machine.session else {
            panic!("actual editor session");
        };
        let state = session.surface().state();
        let cell = state.get::<TableCellNode>(anchor).expect("merged cell");
        assert_eq!((cell.row_span, cell.col_span), (1, 2));
        assert_eq!(state.view().children_keys(anchor)?.len(), 2);
        assert!(state.selection().is_none());
        state.to_json()?
    };
    if let wire::EditorInputMsg::EditorApplication {
        json, selection, ..
    } = &mut envelope.editor
    {
        *json = r#"{"action":"selection-split"}"#.into();
        *selection = editor_input::view_selection(&ViewSelection::Table {
            table,
            anchor_cell: anchor,
            focus_cell: anchor,
        });
    }
    stale = envelope.clone();
    if let wire::EditorInputMsg::EditorApplication { generation, .. } = &mut stale.editor {
        *generation += 1;
    }
    assert!(matches!(
        machine.input(&bytes(&stale)?, 5.0, 5.0),
        Err(BoundaryError::Invalid("application command generation"))
    ));
    machine.sync(
        SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: false,
        }),
        6.0,
        Some(6.0),
    )?;
    for (now, action) in [(7.0, "selection-merge"), (8.0, "selection-split")] {
        if let wire::EditorInputMsg::EditorApplication { json, .. } = &mut envelope.editor {
            *json = serde_json::json!({"action": action}).to_string();
        }
        machine.input(&bytes(&envelope)?, now, now)?;
        let machine::Session::Editor(session) = &machine.session else {
            panic!("actual editor session");
        };
        assert_eq!(session.surface().state().to_json()?, merged);
        assert!(session.surface().state().selection().is_none());
        assert!(session.last_output().io.is_empty());
        assert!(session.last_output().view.iter().any(|effect| matches!(
            effect,
            ViewEffect::Error(document_session::SessionError::ReadOnly)
        )));
    }
    machine.sync(
        SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: true,
            can_comment: true,
        }),
        9.0,
        Some(9.0),
    )?;
    let flags = machine.input(&bytes(&envelope)?, 10.0, 10.0)?;
    assert_ne!(flags & generated::FLAG_HANDLED, 0);
    let machine::Session::Editor(session) = &machine.session else {
        panic!("actual editor session");
    };
    let state = session.surface().state();
    let cell = state.get::<TableCellNode>(anchor).expect("split cell");
    assert_eq!((cell.row_span, cell.col_span), (1, 1));
    assert_eq!(state.view().children_keys(anchor)?.len(), 2);
    let row = state.view().first_child(table).expect("row");
    assert_eq!(state.view().children_keys(row)?.len(), 3);
    assert!(state.selection().is_none());
    Ok(())
}
