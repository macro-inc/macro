use super::*;

fn actual_machine(view_os: u8) -> Result<machine::Machine, BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "word-navigation-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![7, 8, 9],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: false,
        view_engine: 1,
        view_os,
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
    machine.take_output()?;
    machine.editor(Input::SetState { state: serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{
        "type":"paragraph","children":[
            {"type":"user-mention","userId":"person","email":"person@example.com","displayName":"Person"},
            {"type":"text","text":" after words"}
        ]
    }]}}))?, tags: TagSet::default() }, 2.0)?;
    machine.take_output()?;
    Ok(machine)
}
fn envelope(editor: wire::EditorInputMsg) -> wire::SessionInputMsg {
    wire::SessionInputMsg {
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
        editor,
    }
}

#[test]
fn actual_word_application_wire_keeps_default_policy_and_real_apple_core_fallback(
) -> Result<(), BoundaryError> {
    for apple in [false, true] {
        for start in [true, false] {
            for shift in [false, true] {
                let mut machine = actual_machine(u8::from(apple))?;
                let machine::Session::Editor(session) = &machine.session else {
                    panic!("editor");
                };
                let view = session.surface().state().view();
                let block = view.first_child(NodeKey::ROOT).expect("paragraph");
                let text = view.last_child(block).expect("text");
                let json_before = session.surface().state().to_json()?;
                let point = if start {
                    wire::PointMsg {
                        key: text.index(),
                        offset: 6,
                        _type: 0,
                    }
                } else {
                    wire::PointMsg {
                        key: block.index(),
                        offset: 0,
                        _type: 1,
                    }
                };
                let input = envelope(wire::EditorInputMsg::EditorApplication {
                    name: if start {
                        "group-b.move-to-start".into()
                    } else {
                        "group-b.move-to-end".into()
                    },
                    json: "null".into(),
                    generation: machine.generation(),
                    selection: wire::SelectionMsg {
                        kind: 2,
                        anchor: point,
                        focus: point,
                        nodes: vec![],
                        table: 0,
                        dirty: false,
                    },
                    keyboard: true,
                    key: if start {
                        "ArrowLeft".into()
                    } else {
                        "ArrowRight".into()
                    },
                    mods: (if apple { 8 } else { 4 }) | u32::from(shift),
                    code: if start { 37 } else { 39 },
                });
                let flags = machine.input(&bytes(&input)?, 3.0, 3.0)?;
                assert_ne!(flags & generated::FLAG_HANDLED, 0);
                let machine::Session::Editor(session) = &machine.session else {
                    panic!("editor");
                };
                let selection = session
                    .surface()
                    .state()
                    .selection()
                    .and_then(Selection::as_range)
                    .expect("actual word range");
                let initial = if start {
                    Point::text(text, Utf16Offset(6))
                } else {
                    Point::element(block, ChildIndex(0))
                };
                let edge = if start {
                    Point::element(block, ChildIndex(0))
                } else {
                    Point::text(text, Utf16Offset(12))
                };
                assert_eq!(selection.focus, if apple { edge } else { initial });
                assert_eq!(
                    selection.anchor,
                    if apple && !shift { edge } else { initial }
                );
                assert_eq!(session.surface().state().to_json()?, json_before);
                let output = machine.take_output()?;
                let mut prevention = false;
                if !output.is_empty() {
                    let word = |offset| {
                        u32::from_le_bytes(output[offset..offset + 4].try_into().expect("word"))
                    };
                    let mut at = 24 + word(12) as usize * 4;
                    at = (at + word(16) as usize + 3) & !3;
                    for _ in 0..word(20) {
                        let length = word(at + 12) as usize;
                        if word(at) == 16 {
                            let effect = wire::ViewEffectMsg::deserialize(
                                &output[at + 16..at + 16 + length],
                            )?;
                            prevention |= effect.kind == 6 && effect.code == 2;
                        }
                        at = (at + 16 + length + 3) & !3;
                    }
                }
                assert_eq!(prevention, apple);
                assert!(machine.take_output()?.is_empty());
            }
        }
    }
    Ok(())
}

#[test]
fn actual_word_stale_generation_rejects_before_payload_and_invalid_facts_never_mutate(
) -> Result<(), BoundaryError> {
    let mut machine = actual_machine(0)?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let before = session.surface().state().to_json()?;
    let mut input = envelope(wire::EditorInputMsg::EditorApplication {
        name: "group-b.move-to-start".into(),
        json: "malformed".into(),
        generation: machine.generation() + 1,
        selection: editor_input::empty_selection(),
        keyboard: true,
        key: "ArrowLeft".into(),
        mods: 4,
        code: 37,
    });
    assert!(matches!(
        machine.input(&bytes(&input)?, 3.0, 3.0),
        Err(BoundaryError::Invalid("application command generation"))
    ));
    if let wire::EditorInputMsg::EditorApplication {
        generation,
        json,
        keyboard,
        ..
    } = &mut input.editor
    {
        *generation = machine.generation();
        *json = "null".into();
        *keyboard = false;
    }
    assert!(machine.input(&bytes(&input)?, 4.0, 4.0).is_err());
    if let wire::EditorInputMsg::EditorApplication { keyboard, key, .. } = &mut input.editor {
        *keyboard = true;
        *key = "ArrowRight".into();
    }
    assert!(machine.input(&bytes(&input)?, 5.0, 5.0).is_err());
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    assert_eq!(session.surface().state().to_json()?, before);
    Ok(())
}
