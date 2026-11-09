use crate::*;
use serde_json::json;

#[test]
fn native_application_surface_uses_shared_shortcuts_and_download_exports() {
    let session = NativeEditorSession::new(
        FfiSessionConfig {
            sync: SyncConfig {
                doc: "native-application-fixture".parse().unwrap(),
                session: serde_json::from_value(json!("00000000-0000-0000-0000-000000000003"))
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
            os: ViewOs::Android,
            headless: false,
            application: Some(FfiApplicationConfig {
                editor_type: FfiEditorType::MarkdownSync,
                hostname: Some("app.example.com".into()),
            }),
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
    session
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
    let out = session
        .handle(
            FfiNow {
                mono_ms: 2,
                wall_ms: 1_000_002,
            },
            FfiInput::SetState {
                root: serde_json::from_value(
                    json!({"type":"root","children":[{"type":"paragraph","children":[]}]}),
                )
                .unwrap(),
            },
        )
        .unwrap();
    let paragraph = out
        .view
        .iter()
        .find_map(|effect| match effect {
            FfiViewEffect::Diff { diff } => diff.ops.iter().find_map(|op| match op {
                DiffOp::CreateElement { key, .. } if *key != NodeKey::ROOT => Some(*key),
                _ => None,
            }),
            _ => None,
        })
        .unwrap();
    let mut selection = ViewSelection::Range {
        anchor: Point::element(paragraph, ChildIndex(0)),
        focus: Point::element(paragraph, ChildIndex(0)),
        resolution_dirty: false,
    };
    for (index, ch) in "# a".chars().enumerate() {
        let result = session
            .handle(
                FfiNow {
                    mono_ms: index as u64 + 3,
                    wall_ms: index as i64 + 1_000_003,
                },
                FfiInput::Command {
                    command: FfiCommand::InsertText {
                        text: ch.to_string(),
                    },
                    selection,
                },
            )
            .unwrap();
        assert!(
            !result
                .view
                .iter()
                .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
        );
        selection = ViewSelection::KeepModel;
    }
    let FfiQueryReply::State { root } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(root["children"][0]["type"], "heading");
    assert_eq!(root["children"][0]["tag"], "h1");
    assert_eq!(session.text_content().unwrap(), "a");
    assert_eq!(
        session.markdown(FfiMarkdownFlavor::Application).unwrap(),
        "# a"
    );
    let FfiQueryReply::Value { value } = session.query(FfiQuery::SavedState).unwrap() else {
        panic!("saved state")
    };
    assert_eq!(value["root"]["children"][0]["$"]["searchText"], "a");
    assert!(
        session
            .application_command(
                FfiNow {
                    mono_ms: 10,
                    wall_ms: 1_000_010
                },
                "unknown-command".into(),
                json!({}),
                0,
                ViewSelection::KeepModel
            )
            .is_err()
    );
    assert_eq!(session.text_content().unwrap(), "a");
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "text".into(),
        })
        .unwrap()
    else {
        panic!("text keys")
    };
    let key = keys[0];
    session
        .handle(
            FfiNow {
                mono_ms: 6,
                wall_ms: 1_000_006,
            },
            FfiInput::TextDeltaFromView {
                delta: ViewTextDelta {
                    key,
                    offset: Utf16Offset(1),
                    deleted: Utf16Offset(0),
                    inserted: "😀".into(),
                    anchor: Some(Utf16Offset(3)),
                    focus: Some(Utf16Offset(3)),
                    composition_end: false,
                    composition_data: None,
                    selection: ViewSelection::KeepModel,
                },
            },
        )
        .unwrap();
    assert_eq!(session.text_content().unwrap(), "a😀");
    let rejected = session
        .handle(
            FfiNow {
                mono_ms: 7,
                wall_ms: 1_000_007,
            },
            FfiInput::TextDeltaFromView {
                delta: ViewTextDelta {
                    key,
                    offset: Utf16Offset(2),
                    deleted: Utf16Offset(0),
                    inserted: "x".into(),
                    anchor: Some(Utf16Offset(0)),
                    focus: Some(Utf16Offset(0)),
                    composition_end: false,
                    composition_data: None,
                    selection: ViewSelection::KeepModel,
                },
            },
        )
        .unwrap();
    assert!(
        rejected
            .view
            .iter()
            .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
    );
    assert_eq!(session.text_content().unwrap(), "a😀");
}
