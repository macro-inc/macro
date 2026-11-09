use crate::*;
use serde_json::json;

#[test]
fn native_application_surface_uses_shared_shortcuts_and_download_exports() {
    let session = NativeEditorSession::new(
        application_config(),
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

fn application_config() -> FfiSessionConfig {
    FfiSessionConfig {
        sync: SyncConfig {
            doc: "native-application-fixture".parse().unwrap(),
            session: serde_json::from_value(json!("00000000-0000-0000-0000-000000000003")).unwrap(),
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
    }
}

#[test]
fn typed_snippet_resolution_reuses_application_services_and_real_history() {
    let session = NativeEditorSession::new(
        application_config(),
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
    session.handle(FfiNow { mono_ms: 2, wall_ms: 1_000_002 }, FfiInput::SetState { root: serde_json::from_value(json!({"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"😀 ;s"}]}]})).unwrap() }).unwrap();
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "text".into(),
        })
        .unwrap()
    else {
        panic!("text")
    };
    let key = keys[0];
    session
        .handle(
            FfiNow {
                mono_ms: 2,
                wall_ms: 1_000_002,
            },
            FfiInput::Focus { focused: true },
        )
        .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 3,
                wall_ms: 1_000_003,
            },
            FfiInput::SelectionFromView {
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(5)),
                    focus: Point::text(key, Utf16Offset(5)),
                    resolution_dirty: false,
                },
                change: None,
            },
        )
        .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 3,
                wall_ms: 1_000_003,
            },
            FfiInput::Command {
                command: FfiCommand::ClearHistory,
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(5)),
                    focus: Point::text(key, Utf16Offset(5)),
                    resolution_dirty: false,
                },
            },
        )
        .unwrap();
    let pending = session.application_command(FfiNow { mono_ms: 4, wall_ms: 1_000_004 }, "group-a.menu-select".into(), json!({
        "key":key.index(),"offset":3,"expected":";s","choice":{"kind":"snippet-start","payload":{"documentId":"snippet-fixture","sourceDocumentId":"target-fixture"}}
    }), key.generation(), ViewSelection::KeepModel).unwrap();
    let request = pending
        .view
        .iter()
        .find_map(|effect| match effect {
            FfiViewEffect::PluginEvent {
                name,
                payload: Some(payload),
            } if name == "group-a.snippet-request" => Some(payload.clone()),
            _ => None,
        })
        .expect("structured host request");
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "await".into(),
        })
        .unwrap()
    else {
        panic!("pending")
    };
    let placeholder = keys[0];
    assert_eq!(request["key"], placeholder.index());
    assert_eq!(request["generation"], placeholder.generation());
    let await_id = request["awaitId"].as_str().unwrap().to_owned();
    let resolved = session.resolve_snippet(FfiNow { mono_ms: 5, wall_ms: 1_000_005 }, placeholder, await_id.clone(), Some(json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"bold","format":1,"$":{"id":"source-text"}}]}]}}))).unwrap();
    assert!(
        !resolved
            .view
            .iter()
            .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
    );
    assert_eq!(session.text_content().unwrap(), "😀 bold");
    assert_eq!(
        session.markdown(FfiMarkdownFlavor::Application).unwrap(),
        "😀 **bold**"
    );
    let FfiQueryReply::State { root: expected } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert!(
        !serde_json::to_string(&expected)
            .unwrap()
            .contains("source-text")
    );
    let FfiQueryReply::ViewDiff {
        selection: ViewSelection::Range { anchor, focus, .. },
        ..
    } = session.query(FfiQuery::ViewDiff).unwrap()
    else {
        panic!("caret")
    };
    assert_eq!(anchor, focus);
    assert!(matches!(
        anchor,
        Point::Text {
            offset: Utf16Offset(4),
            ..
        }
    ));
    session
        .handle(
            FfiNow {
                mono_ms: 6,
                wall_ms: 1_000_006,
            },
            FfiInput::Undo,
        )
        .unwrap();
    assert_eq!(session.text_content().unwrap(), "😀 ;s");
    session
        .handle(
            FfiNow {
                mono_ms: 7,
                wall_ms: 1_000_007,
            },
            FfiInput::Redo,
        )
        .unwrap();
    let FfiQueryReply::State { root } = session.query(FfiQuery::State).unwrap() else {
        panic!("redo")
    };
    assert_eq!(root, expected);
    let FfiQueryReply::ViewDiff {
        selection:
            ViewSelection::Range {
                anchor: after,
                focus: after_focus,
                ..
            },
        ..
    } = session.query(FfiQuery::ViewDiff).unwrap()
    else {
        panic!("redo caret")
    };
    assert_eq!(after, after_focus);
    assert!(matches!(
        after,
        Point::Text {
            offset: Utf16Offset(4),
            ..
        }
    ));
    session
        .resolve_snippet(
            FfiNow {
                mono_ms: 8,
                wall_ms: 1_000_008,
            },
            placeholder,
            await_id,
            None,
        )
        .unwrap();
    let FfiQueryReply::State { root } = session.query(FfiQuery::State).unwrap() else {
        panic!("late")
    };
    assert_eq!(root, expected);
}

#[test]
fn typed_snippet_sequence_keeps_the_confirmed_source_extractor_behavior() {
    let mut tick = 0u64;
    let mut now = || {
        tick += 1;
        FfiNow {
            mono_ms: tick,
            wall_ms: 1_000_000 + i64::try_from(tick).unwrap(),
        }
    };
    let session = NativeEditorSession::new(application_config(), None, now()).unwrap();
    session.handle(now(), FfiInput::Start).unwrap();
    session
        .handle(
            now(),
            FfiInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
        )
        .unwrap();
    session
        .handle(now(), FfiInput::Focus { focused: true })
        .unwrap();
    let mut tokens = std::collections::BTreeSet::new();
    for (index, source) in [
        json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"First snippet","format":1}]}]}}),
        json!({"root":{"type":"root","children":[]}}),
        json!({"root":{"type":"root","children":[{"type":"fixture-unknown-snippet-node","version":1}]}}),
        json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"Second snippet","format":1}]}]}}),
    ].into_iter().enumerate() {
        session.handle(now(), FfiInput::SetState { root: serde_json::from_value(json!({"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":";s"}]}]})).unwrap() }).unwrap();
        let FfiQueryReply::Nodes { keys, .. } = session.query(FfiQuery::NodesOfType { name: "text".into() }).unwrap() else { panic!("text") };
        let key = keys[0];
        session.handle(now(), FfiInput::SelectionFromView {
            selection: ViewSelection::Range { anchor: Point::text(key, Utf16Offset(2)), focus: Point::text(key, Utf16Offset(2)), resolution_dirty: false }, change: None,
        }).unwrap();
        let started = session.application_command(now(), "group-a.menu-select".into(), json!({"key":key.index(),"offset":0,"expected":";s","choice":{"kind":"snippet-start","payload":{"documentId":format!("snippet-{index}")}}}), key.generation(), ViewSelection::KeepModel).unwrap();
        let request = started.view.iter().find_map(|effect| match effect {
            FfiViewEffect::PluginEvent { name, payload: Some(payload) } if name == "group-a.snippet-request" => Some(payload), _ => None,
        }).expect("request");
        let FfiQueryReply::Nodes { keys, .. } = session.query(FfiQuery::NodesOfType { name: "await".into() }).unwrap() else { panic!("pending") };
        let identity = request["awaitId"].as_str().unwrap().to_owned();
        assert!(tokens.insert(identity.clone()));
        let output = session.resolve_snippet(now(), keys[0], identity, Some(source)).unwrap();
        assert!(!output.view.iter().any(|effect| matches!(effect, FfiViewEffect::Error { .. })));
        assert_eq!(output.view.iter().filter(|effect| matches!(effect, FfiViewEffect::PluginEvent { name, .. } if name == "group-a.snippet-source-error")).count(), usize::from(index == 2));
        let expected = if index < 3 { "First snippet" } else { "Second snippet" };
        assert_eq!(session.text_content().unwrap(), expected);
        assert_eq!(session.markdown(FfiMarkdownFlavor::Application).unwrap(), format!("**{expected}**"));
        let FfiQueryReply::State { root } = session.query(FfiQuery::State).unwrap() else { panic!("state") };
        assert_eq!(root["children"][0]["children"][0]["text"], expected);
        assert_eq!(root["children"][0]["children"][0]["format"], 1);
        let FfiQueryReply::Nodes { keys, .. } = session.query(FfiQuery::NodesOfType { name: "await".into() }).unwrap() else { panic!("pending") };
        assert!(keys.is_empty());
    }
}
