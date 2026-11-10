mod click;
mod decorator_actions;
mod focus_end;
mod mention_user;
mod paste_intent;
mod search;
mod session_bop;
#[cfg(test)]
mod table_selection_actions;
use super::*;
use doc_sync_core::*;
use document_session::*;
use lexical_model::*;
#[test]
fn macro_session_opens_persisted_task_lists_and_projects_typing() {
    use std::sync::Arc;
    let context = macro_document_model::DocumentContext {
        clock: macro_document_model::NodeClock(Arc::new(|| 1794052800000)),
        random: macro_document_model::NodeRandom(Arc::new({
            let next = std::sync::atomic::AtomicU8::new(7);
            move |size| vec![next.fetch_add(1, std::sync::atomic::Ordering::Relaxed); size]
        })),
        host: macro_document_model::NodeHost::default(),
        keys: KeySource::default(),
        editor_created: None,
    };
    let snapshot =
        macro_document_model::snapshot::markdown_to_loro_snapshot("- todo", &context).unwrap();
    let config = wire::SessionConfigMsg {
        doc: "macro-list-fixture".into(),
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
        &bytes(&config).unwrap(),
        0.0,
        1794052800000.0,
    )
    .unwrap();
    machine.sync(SyncInput::Start, 0.0, None).unwrap();
    machine
        .sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: snapshot.clone(),
            },
            1.0,
            None,
        )
        .unwrap();
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor")
    };
    assert!(
        session
            .last_output()
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Initialize(_))),
        "{:?}",
        session
            .last_output()
            .view
            .iter()
            .filter_map(|effect| if let ViewEffect::Error(error) = effect {
                Some(error.to_string())
            } else {
                None
            })
            .collect::<Vec<_>>()
    );
    assert!(!session
        .last_output()
        .view
        .iter()
        .any(|effect| matches!(effect, ViewEffect::Error(_))));
    assert_eq!(
        session.surface().state().root_text_content().as_ref(),
        "todo"
    );
    let key = session
        .surface()
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .unwrap();
    let selection = ViewSelection::Range {
        anchor: Point::text(key, Utf16Offset(5)),
        focus: Point::text(key, Utf16Offset(5)),
        resolution_dirty: false,
    };
    machine
        .editor(
            Input::TextFromView {
                key,
                text: "todo!".into(),
                anchor: Some(Utf16Offset(5)),
                focus: Some(Utf16Offset(5)),
                composition_end: false,
                composition_data: None,
                selection,
            },
            2.0,
        )
        .unwrap();
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor")
    };
    assert_eq!(
        session.surface().state().root_text_content().as_ref(),
        "todo!"
    );
}
#[test]
fn literal_session_abi_opens_types_and_coalesces_a_single_text_input() {
    let config = wire::SessionConfigMsg {
        doc: "fixture-document".into(),
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
    let encoded = bytes(&config).unwrap();
    assert!(matches!(
        machine::Machine::create(999, &encoded, 0.0, 0.0, true),
        Err(BoundaryError::AbiMismatch)
    ));
    let mut m = machine::Machine::create(generated::ABI_MAJOR, &encoded, 0.0, 0.0, true).unwrap();
    m.sync(SyncInput::Start, 0.0, Some(0.0)).unwrap();
    m.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        Some(1.0),
    )
    .unwrap();
    m.editor(
        Input::SetState { state:serde_json::from_value(serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"a","format":0,"detail":0,"mode":"normal","style":""}]}]}})).unwrap(), tags:TagSet::default() },
        2.0,
    )
    .unwrap();
    let machine::Session::Editor(s) = &m.session else {
        panic!("editor")
    };
    let key = s
        .surface()
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .unwrap();
    let flags = m
        .editor(
            Input::TextFromView {
                key,
                text: "a😀".into(),
                anchor: Some(Utf16Offset(3)),
                focus: Some(Utf16Offset(3)),
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(3)),
                    focus: Point::text(key, Utf16Offset(3)),
                    resolution_dirty: false,
                },
            },
            3.0,
        )
        .unwrap();
    assert_eq!(flags & 2, 0, "typing must not emit I/O");
    assert_eq!(m.wake, Some(Millis(26)));
    let machine::Session::Editor(s) = &m.session else {
        panic!("editor")
    };
    assert_eq!(&*s.surface().state().root_text_content(), "a😀");
    let flags = m
        .editor(
            Input::TextFromView {
                key: NodeKey::ROOT,
                text: "invalid element edit".into(),
                anchor: None,
                focus: None,
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::KeepModel,
            },
            4.0,
        )
        .unwrap();
    assert_ne!(flags & 1, 0);
    let word = |i: usize| u32::from_le_bytes(m.output[i * 4..i * 4 + 4].try_into().unwrap());
    assert_eq!(
        word(8),
        1,
        "non-text keys receive a full repair, never Remove"
    );
    let machine::Session::Editor(s) = &m.session else {
        panic!("editor")
    };
    assert_eq!(&*s.surface().state().root_text_content(), "a😀");
}
#[test]
fn rejected_dom_text_has_an_authoritative_patch_even_without_a_model_change() {
    let config = wire::SessionConfigMsg {
        doc: "dom-text-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![7, 8, 9],
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
    let mut m = machine::Machine::create(
        generated::ABI_MAJOR,
        &bytes(&config).unwrap(),
        0.0,
        0.0,
        true,
    )
    .unwrap();
    m.sync(SyncInput::Start, 0.0, Some(0.0)).unwrap();
    m.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        Some(1.0),
    )
    .unwrap();
    // The DOM supplied an edit after permission was lost. No commit is made,
    // but the view still needs a real correction rather than an acknowledgement.
    let key = editor_input::key(1, m.generation());
    let flags = m
        .editor(
            Input::TextFromView {
                key,
                text: "uncommitted".into(),
                anchor: None,
                focus: None,
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::KeepModel,
            },
            2.0,
        )
        .unwrap();
    assert_ne!(flags & 1, 0);
    let word = |i: usize| u32::from_le_bytes(m.output[i * 4..i * 4 + 4].try_into().unwrap());
    assert_eq!(
        word(8),
        1,
        "stale key requires an authoritative full repair"
    );
    assert_eq!(word(9), u32::MAX, "rejection never claims the DOM matches");
}

#[test]
fn opcode_numbers_match_every_model_variant() {
    assert_eq!(
        generated::DIFF_FORMAT_VERSION,
        lexical_model::DIFF_FORMAT_VERSION
    );
    for (a, b) in [
        (DiffOpcode::Remove, wire::DiffOpcode::Remove),
        (DiffOpcode::CreateElement, wire::DiffOpcode::CreateElement),
        (DiffOpcode::CreateText, wire::DiffOpcode::CreateText),
        (
            DiffOpcode::CreateDecorator,
            wire::DiffOpcode::CreateDecorator,
        ),
        (
            DiffOpcode::CreateLineBreak,
            wire::DiffOpcode::CreateLineBreak,
        ),
        (DiffOpcode::Children, wire::DiffOpcode::Children),
        (DiffOpcode::Text, wire::DiffOpcode::Text),
        (DiffOpcode::TextProps, wire::DiffOpcode::TextProps),
        (DiffOpcode::ElementProps, wire::DiffOpcode::ElementProps),
        (DiffOpcode::NodeProps, wire::DiffOpcode::NodeProps),
        (DiffOpcode::State, wire::DiffOpcode::State),
    ] {
        assert_eq!(a as u32, b as u32);
    }
}
#[test]
fn storage_payload_preserves_large_sequences_and_raw_bytes() {
    let op = StorageOp::WalAppend {
        doc: "fixture-document".parse().unwrap(),
        owner: codec::session("00000000-0000-0000-0000-000000000001").unwrap(),
        record: WalRecord {
            seq: WalSeq(9_007_199_254_740_993),
            created_at: UnixMillis(-2),
            user: UserKey("fixture-user".into()),
            foreign: true,
            quarantined: true,
            bytes: vec![0, 255, 1],
        },
        retry: true,
    };
    let wire = storage::encode(&op, true);
    let data = bytes(&wire).unwrap();
    assert_eq!(wire, wire::StorageOpMsg::deserialize(&data).unwrap());
    assert_eq!(
        storage::record(wire.record),
        match op {
            StorageOp::WalAppend { record, .. } => record,
            _ => panic!("append"),
        }
    );
}
#[test]
fn preorder_values_reject_partial_and_trailing_trees() {
    let value = DocValue::Map(
        [(
            "fixture".into(),
            DocValue::List(vec![
                DocValue::String("😀".into()),
                DocValue::Bytes(vec![255]),
                DocValue::Int(i64::MIN),
            ]),
        )]
        .into(),
    );
    let mut wire = vec![];
    generic::flatten(&value, String::new(), &mut wire);
    assert_eq!(generic::value(&wire).unwrap(), value);
    assert!(generic::value(&wire[..wire.len() - 1]).is_err());
    wire.push(wire[0].clone());
    assert!(generic::value(&wire).is_err());
}
#[test]
fn wall_origin_rebases_on_cold_calls_and_rejects_nonfinite_time() {
    assert!(codec::now(f64::NAN, 0.0).is_err());
    assert!(codec::now(-1.0, 0.0).is_err());
    assert!(codec::now(1.0, f64::INFINITY).is_err());
    assert_eq!(codec::now(2.0, -10.0).unwrap().wall, UnixMillis(-10));
}
#[test]
fn invalid_point_kinds_and_command_codes_are_rejected() {
    assert!(editor_input::point(
        &wire::PointMsg {
            key: 1,
            offset: 0,
            _type: 99
        },
        0
    )
    .is_err());
    assert!(editor_input::command(999, 0, 0, None).is_err());
    assert!(editor_input::command(1, 0, 0, None).is_err());
    assert!(editor_input::command(8, 999, 0, None).is_err());
}
#[test]
fn ordered_diff_chain_keeps_both_text_patches_and_nested_observation_paths() {
    let key = editor_input::key(1, 0);
    let output = SessionOutput {
        view: vec![
            ViewEffect::Diff(Diff {
                generation: 0,
                full_reconcile: false,
                view_text_matches: None,
                decorator_renders: vec![],
                ops: vec![DiffOp::Text {
                    key,
                    text: "first".into(),
                }],
            }),
            ViewEffect::Diff(Diff {
                generation: 0,
                full_reconcile: false,
                view_text_matches: None,
                decorator_renders: vec![],
                ops: vec![DiffOp::Text {
                    key,
                    text: "second".into(),
                }],
            }),
            ViewEffect::Initialize(InitialView::Generic(vec![(
                ContainerPath {
                    root: "fixture".into(),
                    steps: vec![PathStep::Key("nested".into())],
                },
                DocValue::Int(7),
            )])),
        ],
        ..SessionOutput::default()
    };
    let mut buffer = vec![];
    output::encode(&output, false, &mut buffer, None, None).unwrap();
    let word = |i: usize| u32::from_le_bytes(buffer[i * 4..i * 4 + 4].try_into().unwrap());
    assert_eq!(word(6 + 4), 2, "both patches survive in one flat diff");
    let end = 24 + word(3) as usize * 4 + word(4) as usize;
    let at = (end + 3) & !3;
    let payload_len = u32::from_le_bytes(buffer[at + 12..at + 16].try_into().unwrap()) as usize;
    let view = wire::ViewEffectMsg::deserialize(&buffer[at + 16..at + 16 + payload_len]).unwrap();
    assert_eq!(view.paths[0].root, "fixture");
    assert_eq!(view.paths[0].steps[0].key, "nested");
}
#[test]
fn bulk_queries_export_markup_and_selected_clipboard_from_the_native_model() {
    let config = wire::SessionConfigMsg {
        doc: "query-fixture".into(),
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
    let mut machine = machine::Machine::create(
        generated::ABI_MAJOR,
        &bytes(&config).unwrap(),
        0.0,
        0.0,
        true,
    )
    .unwrap();
    machine.sync(SyncInput::Start, 0.0, Some(0.0)).unwrap();
    machine
        .sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            Some(1.0),
        )
        .unwrap();
    machine.editor(Input::SetState{state:serde_json::from_value(serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"hello 😀","format":1,"detail":0,"mode":"normal","style":""}]}]}})).unwrap(),tags:TagSet::default()},2.0).unwrap();
    let session = EditorSession {
        #[cfg(feature = "compatibility")]
        compatibility: None,
        machine,
        hostname: None,
    };
    assert_eq!(
        query::markdown_for_session(&session, 0, false).unwrap(),
        "**hello 😀**"
    );
    let words = query::query(
        &session,
        wire::QueryMsg {
            kind: 3,
            key: 0,
            text: String::new(),
            flags: 0,
        },
    )
    .unwrap();
    assert_eq!(words.count, 2);
    let matches = query::query(
        &session,
        wire::QueryMsg {
            kind: 2,
            key: 0,
            text: "😀".into(),
            flags: 0,
        },
    )
    .unwrap();
    assert_eq!(matches.count, 1);
    assert_eq!({ matches.points[0].offset }, 6);
    assert_eq!({ matches.points[1].offset }, 8);
    let html = query::query(
        &session,
        wire::QueryMsg {
            kind: 0,
            key: 0,
            text: String::new(),
            flags: 0,
        },
    )
    .unwrap();
    assert!(html.text.contains("<b>"));
    assert!(html.text.contains("hello 😀"));
    let nodes = query::query(
        &session,
        wire::QueryMsg {
            kind: 4,
            key: 0,
            text: "text".into(),
            flags: 0,
        },
    )
    .unwrap();
    assert_eq!(nodes.keys.len(), 1);
    assert!(nodes.nodes[0].contains("hello 😀"));
}
#[test]
fn closed_and_unsaved_reasons_survive_the_view_boundary() {
    let output = SessionOutput {
        view: vec![ViewEffect::Status(SyncStatus {
            connection: ConnectionStatus::Closed(CloseReason::Unauthorized),
            save: SaveState::Unsaved(UnsavedReason::ReadOnly),
            pending_import: true,
        })],
        ..SessionOutput::default()
    };
    let mut buffer = vec![];
    output::encode(&output, false, &mut buffer, None, None).unwrap();
    let len = u32::from_le_bytes(buffer[36..40].try_into().unwrap()) as usize;
    let status = wire::ViewEffectMsg::deserialize(&buffer[40..40 + len]).unwrap();
    assert_eq!(status.closed_reason, wire::ClosedReason::Unauthorized);
    assert_eq!(status.save_reason, wire::SaveReason::ReadOnly);
    assert!(status.flag);
}

#[test]
fn targeted_key_input_preserves_consuming_model_listener_precedence() {
    struct Keys;
    impl Plugin for Keys {
        fn name(&self) -> &'static str {
            "keys"
        }
        fn commands(&self) -> &[CommandRegistration] {
            &[
                CommandRegistration {
                    command: CommandKind::KeyDown,
                    priority: CommandPriority::Critical,
                    placement: Placement::Before,
                },
                CommandRegistration {
                    command: CommandKind::FormatText,
                    priority: CommandPriority::Editor,
                    placement: Placement::After,
                },
                CommandRegistration {
                    command: CommandKind::DeleteCharacter,
                    priority: CommandPriority::Editor,
                    placement: Placement::After,
                },
            ]
        }
        fn handle(
            &self,
            tx: &mut Transaction<'_>,
            command: &Command,
        ) -> Result<Handled, lexical_model::Error> {
            match command {
                Command::KeyDown(_) => Ok(Handled::Yes),
                Command::FormatText(format) => {
                    tx.format_text(*format, None)?;
                    Ok(Handled::Yes)
                }
                Command::DeleteCharacter { direction, target } => {
                    tx.delete_character(*direction, target.clone())?;
                    Ok(Handled::Yes)
                }
                _ => Ok(Handled::No),
            }
        }
    }
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .plugin(Keys)
        .build()
        .unwrap();
    let (key, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("abc")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            tx.select_end(t)?;
            Ok(t.key())
        })
        .unwrap();
    let point = |offset| wire::PointMsg {
        key: key.index(),
        offset,
        _type: 0,
    };
    let input = wire::EditorInputMsg::EditorKeyDown {
        code: 8,
        mods: 4,
        key: "Backspace".into(),
        command: wire::CommandCode::DeleteCharacter,
        argument: 0,
        selection: wire::SelectionMsg {
            kind: 2,
            anchor: point(3),
            focus: point(3),
            nodes: vec![],
            table: 0,
            dirty: false,
        },
        target: wire::ModifyTargetMsg {
            kind: 1,
            anchor: point(3),
            focus: point(2),
            dirty: false,
            backward: true,
        },
        character_target: wire::ModifyTargetMsg {
            kind: 0,
            anchor: point(3),
            focus: point(3),
            dirty: false,
            backward: true,
        },
    };
    let mut formatting = input.clone();
    if let wire::EditorInputMsg::EditorKeyDown {
        command,
        argument,
        key,
        code,
        ..
    } = &mut formatting
    {
        *command = wire::CommandCode::FormatText;
        *argument = 3;
        *key = "u".into();
        *code = 85;
    }
    let input = editor_input::input(input, key.generation()).unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.apply(input, HistoryTime(1)).unwrap();
    assert_eq!(core.state().view().text_content(key), "abc");
    core.apply(
        editor_input::input(formatting, key.generation()).unwrap(),
        HistoryTime(2),
    )
    .unwrap();
    assert_eq!(
        core.state()
            .selection()
            .and_then(Selection::as_range)
            .unwrap()
            .format,
        TextFormat::empty()
    );
}

#[test]
fn adoption_boundary_preserves_the_exact_loaded_selection() {
    let expected = StoredWalRecord {
        delivered: true,
        record: WalRecord {
            seq: WalSeq(9_007_199_254_740_993),
            created_at: UnixMillis(-17),
            user: UserKey("fixture-user".into()),
            foreign: true,
            quarantined: true,
            bytes: vec![0, 255, 1],
        },
    };
    let op = StorageOp::WalAdopt {
        doc: "fixture-document".parse().unwrap(),
        from: WalOwner::Legacy,
        to: codec::session("00000000-0000-0000-0000-000000000001").unwrap(),
        first_seq: WalSeq(11),
        covers: WalSeq(7),
        expected: vec![expected],
    };
    let encoded = storage::encode(&op, false);
    let decoded = wire::StorageOpMsg::deserialize(&bytes(&encoded).unwrap()).unwrap();
    assert_eq!(decoded.kind, 5);
    assert_eq!(decoded.seq, 11);
    assert_eq!(decoded.through, 7);
    assert_eq!(decoded.expected.len(), 1);
    let row = &decoded.expected[0];
    assert_eq!(row.seq, 9_007_199_254_740_993);
    assert_eq!(row.created_at, -17);
    assert_eq!(row.user, "fixture-user");
    assert!(row.delivered && row.foreign && row.quarantined);
    assert_eq!(row.bytes, [0, 255, 1]);
}

#[test]
fn application_command_admission_rejects_stale_generations_and_applies_typed_policy() {
    let mut editor = macro_document_model::surface::preset_builder_with_mode(
        macro_document_model::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .build()
    .expect("surface");
    let (key, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("typed")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(text)?;
            Ok(text.key())
        })
        .expect("seed");
    let point = wire::PointMsg {
        key: key.index(),
        offset: 5,
        _type: 0,
    };
    let envelope = wire::EditorInputMsg::EditorApplication {
        name: "group-b.node-transform".into(),
        json: "\"heading1\"".into(),
        generation: key.generation(),
        selection: wire::SelectionMsg {
            kind: 2,
            anchor: point,
            focus: point,
            nodes: vec![],
            table: 0,
            dirty: false,
        },
        keyboard: false,
        key: "".into(),
        mods: 0,
        code: 0,
    };
    let mut stale = envelope.clone();
    if let wire::EditorInputMsg::EditorApplication { generation, .. } = &mut stale {
        *generation = generation.saturating_add(1);
    }
    assert!(matches!(
        editor_input::input(stale, key.generation()),
        Err(BoundaryError::Invalid("application command generation"))
    ));
    assert_eq!(editor.state().view().text_content(NodeKey::ROOT), "typed");
    let input = editor_input::input(envelope, key.generation()).expect("typed input");
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.apply(input, HistoryTime(1))
        .expect("application admission");
    let first = core
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("block");
    assert!(core
        .state()
        .view()
        .is::<lexical_rich_nodes::heading::HeadingNode>(first));
    assert_eq!(core.state().view().text_content(NodeKey::ROOT), "typed");
}

#[test]
fn application_enter_clears_empty_typing_style_without_a_generic_keydown_listener() {
    let builder = macro_document_model::surface::preset_builder_with_mode(
        macro_document_model::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    );
    let mut editor = document_session::with_session_plugins(builder, 1)
        .build()
        .expect("surface");
    assert!(editor
        .listener_table()
        .levels(CommandKind::KeyDown)
        .is_none());
    let (key, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("bold")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(4)));
            range.format = TextFormat::BOLD;
            range.style = "color: red".into();
            tx.set_selection(Some(Selection::Range(range)))?;
            Ok(text.key())
        })
        .expect("seed");
    let input = editor_input::input(
        wire::EditorInputMsg::EditorApplication {
            name: "group-b.key".into(),
            json: "null".into(),
            generation: key.generation(),
            selection: wire::SelectionMsg {
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
            },
            keyboard: true,
            key: "Enter".into(),
            mods: 0,
            code: 13,
        },
        key.generation(),
    )
    .expect("key envelope");
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.apply(input, HistoryTime(1)).expect("enter");
    let blocks = core
        .state()
        .view()
        .children_keys(NodeKey::ROOT)
        .expect("blocks");
    assert_eq!(blocks.len(), 2);
    assert_eq!(core.state().view().text_content(blocks[0]), "bold");
    assert_eq!(core.state().view().text_content(blocks[1]), "");
    let range = core
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.format, TextFormat::empty());
    assert_eq!(range.style.as_ref(), "");
}

#[test]
fn application_host_request_keeps_its_typed_payload_in_the_existing_effect_envelope() {
    let mut editor = macro_document_model::surface::preset_builder_with_mode(
        macro_document_model::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .build()
    .expect("surface");
    let mut payload = ClipboardPayload {
        has_files: true,
        ..ClipboardPayload::default()
    };
    payload.data.insert("application/x-macro-paste-facts".into(), serde_json::json!({"request":37,"plainOnly":false,"hasFileEntries":true,"mobileImageRecovery":false}).to_string());
    let (_, commit) = editor
        .dispatch(&Command::Paste(payload))
        .expect("file request");
    let event = commit.events.first().expect("event").clone();
    let output = SessionOutput {
        view: vec![ViewEffect::Editor(Effect::PluginEvent(event))],
        ..SessionOutput::default()
    };
    let mut buffer = vec![];
    output::encode(&output, false, &mut buffer, None, None).expect("effect bytes");
    let len = u32::from_le_bytes(buffer[36..40].try_into().expect("length")) as usize;
    let effect = wire::ViewEffectMsg::deserialize(&buffer[40..40 + len]).expect("effect");
    assert_eq!(effect.kind, 6);
    assert_eq!(effect.code, 9);
    assert_eq!(effect.text, "group-b.file-paste");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&effect.style).expect("payload"),
        serde_json::json!({"request":37})
    );
}

mod code_persistence;
mod effective_access;

mod checklist_plan;

mod table_facts;
