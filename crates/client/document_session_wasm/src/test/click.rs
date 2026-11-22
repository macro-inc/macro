use super::*;

#[test]
fn actual_macro_click_clears_selected_keys_and_keeps_a_resolved_text_range(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "click-fixture".into(),
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
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    machine.editor(Input::SetState {
        state: serde_json::from_value(serde_json::json!({"root":{"type":"root","version":1,"children":[
            {"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"click target"}]}
        ]}})).expect("actual serialized state"),
        tags: TagSet::default(),
    }, 2.0)?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let paragraph = session
        .surface()
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let text = session
        .surface()
        .state()
        .view()
        .first_child(paragraph)
        .expect("text");
    machine.editor(
        Input::SelectionFromView {
            selection: ViewSelection::Node(vec![paragraph]),
            change: None,
        },
        3.0,
    )?;
    let click = editor_input::command(wire::CommandCode::Click as u32, 0, 0, None)?;
    let flags = machine.editor(
        Input::Command {
            command: click,
            selection: ViewSelection::KeepModel,
        },
        4.0,
    )?;
    assert_ne!(
        flags & generated::FLAG_HANDLED,
        0,
        "the normal rich-text Click listener handled NodeSelection"
    );
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let selected = session.surface().state().selection();
    assert!(!selected.is_some_and(
        |selection| matches!(selection, Selection::Node(nodes) if nodes.has(paragraph))
    ));
    assert!(session.surface().state().view().contains(paragraph));
    assert_eq!(
        session.surface().state().text_content(NodeKey::ROOT),
        "click target"
    );
    let range = ViewSelection::Range {
        anchor: Point::text(text, Utf16Offset(3)),
        focus: Point::text(text, Utf16Offset(3)),
        resolution_dirty: false,
    };
    machine.editor(
        Input::SelectionFromView {
            selection: range,
            change: None,
        },
        5.0,
    )?;
    let click = editor_input::command(18, 0, 0, None)?;
    let flags = machine.editor(
        Input::Command {
            command: click,
            selection: ViewSelection::KeepModel,
        },
        6.0,
    )?;
    assert_eq!(
        flags & generated::FLAG_HANDLED,
        0,
        "range Click does not consume component listeners"
    );
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let range = session
        .surface()
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range preserved");
    assert_eq!(range.anchor, Point::text(text, Utf16Offset(3)));
    assert_eq!(range.focus, range.anchor);
    Ok(())
}

#[test]
fn read_only_click_changes_only_local_selection_and_still_refuses_document_edits(
) -> Result<(), BoundaryError> {
    let context = macro_document_model::DocumentContext {
        clock: macro_document_model::NodeClock(std::sync::Arc::new(|| 0)),
        random: macro_document_model::NodeRandom(std::sync::Arc::new({
            let next = std::sync::atomic::AtomicU8::new(1);
            move |size| vec![next.fetch_add(1, std::sync::atomic::Ordering::Relaxed); size]
        })),
        host: macro_document_model::NodeHost::default(),
        keys: KeySource::default(),
        editor_created: None,
    };
    let snapshot = macro_document_model::snapshot::markdown_to_loro_snapshot("read only", &context)
        .expect("real persisted document");
    let config = wire::SessionConfigMsg {
        doc: "readonly-click-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![81, 82, 83],
        access: wire::Access::Read,
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
            snapshot,
        },
        1.0,
        None,
    )?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let before = session.surface().state().to_json()?;
    let version = session.version();
    let paragraph = session
        .surface()
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    machine.editor(
        Input::SelectionFromView {
            selection: ViewSelection::Node(vec![paragraph]),
            change: None,
        },
        2.0,
    )?;
    machine.editor(
        Input::Command {
            command: editor_input::command(18, 0, 0, None)?,
            selection: ViewSelection::KeepModel,
        },
        3.0,
    )?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    assert!(
        !session
            .last_output()
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_))),
        "read-only Click is a local selection operation"
    );
    assert!(session.last_output().io.is_empty());
    assert_eq!(session.version(), version);
    assert_eq!(session.surface().state().to_json()?, before);
    assert!(!session.surface().state().selection().is_some_and(
        |selection| matches!(selection, Selection::Node(nodes) if nodes.has(paragraph))
    ));
    // Read-only cores suppress DOM-writing selection effects. The ABI must
    // still report the real result so the host's cached node highlight clears.
    let mut at = 24;
    let mut cleared = false;
    while at < machine.output.len() {
        let tag = u32::from_le_bytes(machine.output[at..at + 4].try_into().expect("tag"));
        let length =
            u32::from_le_bytes(machine.output[at + 12..at + 16].try_into().expect("length"))
                as usize;
        if tag == 16 {
            let effect =
                wire::ViewEffectMsg::deserialize(&machine.output[at + 16..at + 16 + length])?;
            if effect.kind == 6 && effect.code == 0 {
                cleared = effect.selection.kind == 1
                    || (effect.selection.kind == 3 && effect.selection.nodes.is_empty());
            }
        }
        at += 16 + length.next_multiple_of(4);
    }
    assert!(
        cleared,
        "actual Click result must reach the native view cache"
    );
    machine.editor(
        Input::Command {
            command: Command::InsertText("forbidden".into()),
            selection: ViewSelection::KeepModel,
        },
        4.0,
    )?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    assert!(session
        .last_output()
        .view
        .iter()
        .any(|effect| matches!(effect, ViewEffect::Error(SessionError::ReadOnly))));
    assert_eq!(session.version(), version);
    assert_eq!(session.surface().state().to_json()?, before);
    Ok(())
}
