use super::*;
use serde_json::json;
#[test]
fn literal_native_editor_uses_structured_diff_and_one_dom_first_call_without_io() {
    let session = NativeEditorSession::new(
        FfiSessionConfig {
            sync: SyncConfig {
                doc: "ffi-fixture".parse().unwrap(),
                session: serde_json::from_value(json!("00000000-0000-0000-0000-000000000001"))
                    .unwrap(),
                user: UserKey("fixture-user".into()),
                transport: TransportKind::None,
                persistence: Persistence::Memory,
                access: Access::Edit,
                initial_token: None,
                traceparent: None,
                timeouts: Timeouts::default(),
                heartbeat: HeartbeatPolicy::default(),
                backoff: BackoffPolicy::default(),
                converge: ConvergePolicy::default(),
                wal: WalPolicy::default(),
                snapshot_interval: None,
                presence: PresencePolicy {
                    timeout: WallDuration(10_000),
                    refresh: None,
                    user: PresenceUser {
                        user_id: None,
                        color: PaletteColor::Blue,
                    },
                    key: PresenceKeyMode::Peer,
                },
                chatter: false,
                reset_budget: ResetBudget::default(),
            },
            peers: vec![7, 8, 9, 10],
            peer_range: PeerRange::User,
            os: ViewOs::Ios,
            headless: false,
            application: None,
            observed: vec![],
        },
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 0,
                wall_ms: 1_000_000,
            },
            FfiInput::Start,
        )
        .unwrap();
    let seed = session
        .handle(
            FfiNow {
                mono_ms: 1,
                wall_ms: 1_000_001,
            },
            FfiInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
        )
        .unwrap();
    assert!(
        seed.view.iter().any(
            |effect| matches!(effect,FfiViewEffect::Initialize{diff,..} if diff.full_reconcile)
        )
    );
    let mut state_status = uniffi::RustCallStatus::default();
    let raw_state = session::uniffi_document_session_ffi_fn_method_nativeeditorsession_handle(
        <Arc<NativeEditorSession> as uniffi::Lower<UniFfiTag>>::lower(session.clone()),
        <FfiNow as uniffi::Lower<UniFfiTag>>::lower(FfiNow { mono_ms: 2, wall_ms: 1_000_002 }),
        <FfiInput as uniffi::Lower<UniFfiTag>>::lower(FfiInput::SetState {
            root: json!({"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"a","format":0,"detail":0,"mode":"normal","style":""}]}]}).as_object().unwrap().clone(),
        }),
        &mut state_status,
    );
    assert_eq!(state_status.code, uniffi::RustCallStatusCode::Success);
    let state = <FfiOutput as uniffi::Lift<UniFfiTag>>::try_lift(raw_state).unwrap();
    assert!(state.view.iter().any(|effect|matches!(effect,FfiViewEffect::Diff{diff} if diff.ops.iter().any(|op|matches!(op,DiffOp::CreateText{text,..} if text=="a")))));
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "text".into(),
        })
        .unwrap()
    else {
        panic!("nodes")
    };
    let key = keys[0];
    let mut abi_status = uniffi::RustCallStatus::default();
    let abi_handle = <Arc<NativeEditorSession> as uniffi::Lower<UniFfiTag>>::lower(session.clone());
    let raw = session::uniffi_document_session_ffi_fn_method_nativeeditorsession_handle(
        abi_handle,
        <FfiNow as uniffi::Lower<UniFfiTag>>::lower(FfiNow {
            mono_ms: 3,
            wall_ms: 1_000_003,
        }),
        <FfiInput as uniffi::Lower<UniFfiTag>>::lower(FfiInput::TextFromView {
            key,
            text: "a😀".into(),
            anchor: Some(Utf16Offset(3)),
            focus: Some(Utf16Offset(3)),
            composition_end: false,
            composition_data: None,
            selection: ViewSelection::KeepModel,
        }),
        &mut abi_status,
    );
    assert_eq!(abi_status.code, uniffi::RustCallStatusCode::Success);
    let changed = <FfiOutput as uniffi::Lift<UniFfiTag>>::try_lift(raw).unwrap();
    assert!(changed.io.is_empty());
    assert_eq!(changed.wake_at_ms, Some(26));
    assert_eq!(session.text_content().unwrap(), "a😀");
    assert_eq!(
        session.markdown(FfiMarkdownFlavor::Upstream).unwrap(),
        "a😀"
    );
    let FfiQueryReply::Matches { points } = session
        .query(FfiQuery::Find {
            pattern: "😀".into(),
            ignore_case: false,
        })
        .unwrap()
    else {
        panic!("matches")
    };
    assert_eq!(
        points,
        vec![
            Point::text(key, Utf16Offset(1)),
            Point::text(key, Utf16Offset(3))
        ]
    );
    for (deleted, inserted, expected) in [(0, "x", "a😀x"), (1, "", "a😀")] {
        let input = FfiInput::TextDeltaFromView {
            delta: ViewTextDelta {
                key,
                offset: Utf16Offset(3),
                deleted: Utf16Offset(deleted),
                inserted: inserted.into(),
                anchor: None,
                focus: None,
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::KeepModel,
            },
        };
        let lifted = <FfiInput as uniffi::Lift<UniFfiTag>>::try_lift(<FfiInput as uniffi::Lower<
            UniFfiTag,
        >>::lower(input))
        .unwrap();
        session
            .handle(
                FfiNow {
                    mono_ms: 3,
                    wall_ms: 1_000_003,
                },
                lifted,
            )
            .unwrap();
        assert_eq!(session.text_content().unwrap(), expected);
    }
    // Reattaching a native surface must keep the live node identities and text.
    let FfiQueryReply::ViewDiff { diff, .. } = session.query(FfiQuery::ViewDiff).unwrap() else {
        panic!("cold repaint")
    };
    assert!(diff.full_reconcile);
    assert!(diff.ops.iter().any(|op| matches!(
        op, DiffOp::CreateText { key: painted, text, .. } if *painted == key && text == "a😀"
    )));
    assert_eq!(session.text_content().unwrap(), "a😀");
    let copy = session.clone();
    assert_eq!(
        std::thread::spawn(move || copy.text_content().unwrap())
            .join()
            .unwrap(),
        "a😀"
    );
    assert!(
        session
            .handle(
                FfiNow {
                    mono_ms: 2,
                    wall_ms: 1_000_004
                },
                FfiInput::Tick
            )
            .is_err()
    );
    assert_eq!(session.text_content().unwrap(), "a😀");
    let required = session
        .handle(
            FfiNow {
                mono_ms: 4,
                wall_ms: 1_000_004,
            },
            FfiInput::Command {
                command: FfiCommand::DeleteCharacter {
                    direction: EditDirection::Backward,
                    target: ModifyTarget::RequireView,
                },
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(3)),
                    focus: Point::text(key, Utf16Offset(3)),
                    resolution_dirty: false,
                },
            },
        )
        .unwrap();
    assert!(
        required
            .view
            .iter()
            .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
    );
    assert_eq!(session.text_content().unwrap(), "a😀");
    let target = <ModifyTarget as uniffi::FfiConverter<UniFfiTag>>::try_lift(
        <ModifyTarget as uniffi::FfiConverter<UniFfiTag>>::lower(ModifyTarget::ModelSegmentation),
    )
    .expect("explicit model segmentation target");
    let deleted = session
        .handle(
            FfiNow {
                mono_ms: 5,
                wall_ms: 1_000_005,
            },
            FfiInput::Command {
                command: FfiCommand::DeleteCharacter {
                    direction: EditDirection::Backward,
                    target,
                },
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(3)),
                    focus: Point::text(key, Utf16Offset(3)),
                    resolution_dirty: false,
                },
            },
        )
        .unwrap();
    assert!(
        !deleted
            .view
            .iter()
            .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
    );
    assert_eq!(session.text_content().unwrap(), "a");
    let stopped = session
        .handle(
            FfiNow {
                mono_ms: 6,
                wall_ms: 1_000_006,
            },
            FfiInput::Stop {
                request: RequestId(7),
            },
        )
        .unwrap();
    assert!(stopped.view.iter().any(
        |e| matches!(e,FfiViewEffect::Reply{request,reply:FfiReply::Stopped} if request.0==7)
    ));
}
#[test]
fn typed_values_preserve_large_integers_bytes_and_order_without_a_wire_codec() {
    use uniffi::{Lift, Lower};
    let value = FfiValue::Map {
        entries: vec![
            FfiValueEntry {
                key: "large".into(),
                value: FfiValue::Unsigned { value: u64::MAX },
            },
            FfiValueEntry {
                key: "bytes".into(),
                value: FfiValue::Bytes {
                    value: vec![0, 255],
                },
            },
        ],
    };
    let buffer = <FfiValue as Lower<UniFfiTag>>::lower(value);
    let FfiValue::Map { entries } = <FfiValue as Lift<UniFfiTag>>::try_lift(buffer).unwrap() else {
        panic!("map")
    };
    assert_eq!(entries[0].key, "large");
    assert!(matches!(
        entries[0].value,
        FfiValue::Unsigned { value: u64::MAX }
    ));
    assert!(matches!(&entries[1].value,FfiValue::Bytes{value} if value==&vec![0,255]));
    assert!(DocValue::try_from(FfiValue::Number { value: f64::NAN }).is_err());
    assert!(
        JsonValue::try_from(FfiValue::Map {
            entries: vec![
                FfiValueEntry {
                    key: "duplicate".into(),
                    value: FfiValue::Null
                },
                FfiValueEntry {
                    key: "duplicate".into(),
                    value: FfiValue::Null
                }
            ]
        })
        .is_err()
    );
}
#[test]
fn native_generic_storage_completion_gates_stop_and_batches_are_atomic() {
    let session = NativeDocSession::new(
        FfiSessionConfig {
            sync: SyncConfig {
                doc: "ffi-generic".parse().unwrap(),
                session: serde_json::from_value(json!("00000000-0000-0000-0000-000000000002"))
                    .unwrap(),
                user: UserKey("fixture-user".into()),
                transport: TransportKind::None,
                persistence: Persistence::Durable,
                access: Access::Edit,
                initial_token: None,
                traceparent: None,
                timeouts: Timeouts::default(),
                heartbeat: HeartbeatPolicy::default(),
                backoff: BackoffPolicy::default(),
                converge: ConvergePolicy::default(),
                wal: WalPolicy::default(),
                snapshot_interval: None,
                presence: PresencePolicy {
                    timeout: WallDuration(10_000),
                    refresh: None,
                    user: PresenceUser {
                        user_id: None,
                        color: PaletteColor::Blue,
                    },
                    key: PresenceKeyMode::Peer,
                },
                chatter: false,
                reset_budget: ResetBudget::default(),
            },
            peers: vec![17, 18, 19, 20],
            peer_range: PeerRange::User,
            os: ViewOs::Android,
            headless: true,
            application: None,
            observed: vec![ContainerPath {
                root: "fixture".into(),
                steps: vec![],
            }],
        },
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    let start = session
        .handle(
            FfiNow {
                mono_ms: 0,
                wall_ms: 1_000_000,
            },
            FfiInput::Start,
        )
        .unwrap();
    let load = start
        .io
        .iter()
        .find_map(|e| match e {
            FfiIoEffect::Storage {
                op,
                op_body: StorageOp::Load { .. },
            } => Some(*op),
            _ => None,
        })
        .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 1,
                wall_ms: 1_000_001,
            },
            FfiInput::Storage {
                op: load,
                result: FfiStorageResult::Loaded {
                    state: LocalState {
                        snapshot: None,
                        orphans: vec![],
                        assist: vec![],
                    },
                },
            },
        )
        .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 2,
                wall_ms: 1_000_002,
            },
            FfiInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
        )
        .unwrap();
    let changed = session
        .handle(
            FfiNow {
                mono_ms: 3,
                wall_ms: 1_000_003,
            },
            FfiInput::Doc {
                operations: vec![
                    DocOp::MapSet {
                        map: ContainerPath {
                            root: "fixture".into(),
                            steps: vec![],
                        },
                        key: "large".into(),
                        value: DocValue::Int(9_007_199_254_740_993),
                    },
                    DocOp::MapSet {
                        map: ContainerPath {
                            root: "fixture".into(),
                            steps: vec![],
                        },
                        key: "text".into(),
                        value: DocValue::NewContainer(ContainerKind::Text),
                    },
                    DocOp::TextSplice {
                        text: ContainerPath {
                            root: "fixture".into(),
                            steps: vec![PathStep::Key("text".into())],
                        },
                        index: Utf16Offset(0),
                        delete: 0,
                        insert: "😀".into(),
                    },
                ],
            },
        )
        .unwrap();
    assert!(changed.io.is_empty());
    assert!(
        changed
            .view
            .iter()
            .any(|e| matches!(e, FfiViewEffect::DocChanged { .. }))
    );
    assert_eq!(
        session
            .read(ContainerPath {
                root: "fixture".into(),
                steps: vec![]
            })
            .unwrap(),
        DocValue::Map(BTreeMap::from([
            ("large".into(), DocValue::Int(9_007_199_254_740_993)),
            ("text".into(), DocValue::String("😀".into()))
        ]))
    );
    let rejected = session
        .handle(
            FfiNow {
                mono_ms: 4,
                wall_ms: 1_000_004,
            },
            FfiInput::Doc {
                operations: vec![
                    DocOp::MapSet {
                        map: ContainerPath {
                            root: "fixture".into(),
                            steps: vec![],
                        },
                        key: "must-not-commit".into(),
                        value: DocValue::Bool(true),
                    },
                    DocOp::TextSplice {
                        text: ContainerPath {
                            root: "fixture".into(),
                            steps: vec![PathStep::Key("text".into())],
                        },
                        index: Utf16Offset(1),
                        delete: 0,
                        insert: "x".into(),
                    },
                ],
            },
        )
        .unwrap();
    assert!(
        rejected
            .view
            .iter()
            .any(|e| matches!(e, FfiViewEffect::Error { .. }))
    );
    let DocValue::Map(value) = session
        .read(ContainerPath {
            root: "fixture".into(),
            steps: vec![],
        })
        .unwrap()
    else {
        panic!("map")
    };
    assert!(!value.contains_key("must-not-commit"));
    let stopped = session
        .handle(
            FfiNow {
                mono_ms: 5,
                wall_ms: 1_000_005,
            },
            FfiInput::Stop {
                request: RequestId(9),
            },
        )
        .unwrap();
    assert!(!stopped.view.iter().any(|e| matches!(
        e,
        FfiViewEffect::Reply {
            reply: FfiReply::Stopped,
            ..
        }
    )));
    let append = stopped
        .io
        .iter()
        .find_map(|e| match e {
            FfiIoEffect::Storage {
                op,
                op_body: StorageOp::WalAppend { record, .. },
            } => {
                assert!(!record.bytes.is_empty());
                Some(*op)
            }
            _ => None,
        })
        .unwrap();
    let durable = session
        .handle(
            FfiNow {
                mono_ms: 6,
                wall_ms: 1_000_006,
            },
            FfiInput::Storage {
                op: append,
                result: FfiStorageResult::Done,
            },
        )
        .unwrap();
    assert!(durable.view.iter().any(
        |e| matches!(e,FfiViewEffect::Reply{request,reply:FfiReply::Stopped} if request.0==9)
    ));
}

#[test]
fn native_selection_context_and_ordered_maps_cross_the_typed_boundary() {
    use uniffi::{Lift, Lower};
    let input = FfiInput::SelectionFromView {
        selection: ViewSelection::KeepModel,
        change: Some(SelectionChangeContext {
            dom_range_same_node: true,
            marked: Some(MarkedSelectionFormat {
                format: TextFormat::BOLD,
                style: "color: red".into(),
                key: NodeKey::ROOT,
                offset: 3,
            }),
            dom_anchor_offset: 3,
            dom_focus_offset: 4,
            post_delete_restore: Some(RangeSelection::at_root()),
            triple_click: true,
        }),
    };
    let lifted =
        <FfiInput as Lift<UniFfiTag>>::try_lift(<FfiInput as Lower<UniFfiTag>>::lower(input))
            .unwrap();
    let SessionInput::Editor(Input::SelectionFromView {
        change: Some(context),
        ..
    }) = lifted.native()
    else {
        panic!("selection context")
    };
    assert!(context.triple_click && context.dom_range_same_node);
    assert_eq!(context.dom_focus_offset, 4);
    assert_eq!(context.marked.unwrap().format, TextFormat::BOLD);
    assert!(context.post_delete_restore.unwrap().is_collapsed());
    let value = NativeValue::Map(
        HashMap::from([
            ("z".into(), NativeValue::I64(1)),
            ("a".into(), NativeValue::I64(2)),
        ])
        .into(),
    );
    let FfiValue::Map { entries } = FfiValue::from(value) else {
        panic!("map")
    };
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.key.as_str())
            .collect::<Vec<_>>(),
        vec!["a", "z"]
    );
}

mod application;

#[test]
fn raw_alignment_uses_the_source_empty_native_name_without_mutating_model_bits() {
    let raw = ElementFormat::from_bits(99);
    assert_eq!(raw.bits(), 99);
    assert_eq!(raw.as_str(), "");
    assert_eq!(
        model_types::FfiElementFormat::from(raw),
        model_types::FfiElementFormat::Unset
    );
    assert_eq!(raw.bits(), 99);
    let native = <ElementFormat as uniffi::FfiConverter<UniFfiTag>>::lower(raw);
    let lifted = <ElementFormat as uniffi::FfiConverter<UniFfiTag>>::try_lift(native)
        .expect("native alignment");
    assert_eq!(lifted, ElementFormat::Unset);
    assert_eq!(lifted.as_str(), "");
    let named = <ElementFormat as uniffi::FfiConverter<UniFfiTag>>::lower(ElementFormat::Center);
    assert_eq!(
        <ElementFormat as uniffi::FfiConverter<UniFfiTag>>::try_lift(named)
            .expect("named alignment"),
        ElementFormat::Center
    );
}

#[test]
fn every_native_modify_target_round_trips_with_an_exhaustive_feature_stable_shape() {
    let key = NodeKey::from_parts(KeyParts {
        index: 1,
        generation: 0,
    });
    for target in [
        ModifyTarget::RequireView,
        ModifyTarget::NoView,
        ModifyTarget::View {
            anchor: Point::text(key, Utf16Offset(1)),
            focus: Point::text(key, Utf16Offset(3)),
            resolution_dirty: true,
            is_backward_in_dom: true,
        },
        ModifyTarget::ModelSegmentation,
    ] {
        let lifted = <ModifyTarget as uniffi::FfiConverter<UniFfiTag>>::try_lift(
            <ModifyTarget as uniffi::FfiConverter<UniFfiTag>>::lower(target.clone()),
        )
        .expect("native modify target");
        assert_eq!(lifted, target);
    }
}

mod effective_access;

mod diff_projection;

mod paste_intent;

mod search_query;
