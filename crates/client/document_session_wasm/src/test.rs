mod session_bop;
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
                ops: vec![DiffOp::Text {
                    key,
                    text: "first".into(),
                }],
            }),
            ViewEffect::Diff(Diff {
                generation: 0,
                full_reconcile: false,
                view_text_matches: None,
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
    output::encode(&output, false, &mut buffer, None).unwrap();
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
    let session = EditorSession { machine };
    assert_eq!(
        query::markdown(session.surface().state(), 0, false).unwrap(),
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
    output::encode(&output, false, &mut buffer, None).unwrap();
    let len = u32::from_le_bytes(buffer[36..40].try_into().unwrap()) as usize;
    let status = wire::ViewEffectMsg::deserialize(&buffer[40..40 + len]).unwrap();
    assert_eq!(status.closed_reason, wire::ClosedReason::Unauthorized);
    assert_eq!(status.save_reason, wire::SaveReason::ReadOnly);
    assert!(status.flag);
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
