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
    session
        .handle(
            FfiNow {
                mono_ms: 8,
                wall_ms: 1_000_008,
            },
            FfiInput::SetState {
                root: serde_json::from_value(
                    json!({"type":"root","children":[{"type":"paragraph","children":[
                        {"type":"user-mention","userId":"fixture-user","displayName":"Person 😀"},
                        {"type":"group-mention","groupAlias":"here"},
                        {"type":"text","text":"tail"}
                    ]}]}),
                )
                .unwrap(),
            },
        )
        .unwrap();
    let FfiQueryReply::Nodes { keys: people, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "user-mention".into(),
        })
        .unwrap()
    else {
        panic!("people")
    };
    let FfiQueryReply::Nodes { keys: groups, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "group-mention".into(),
        })
        .unwrap()
    else {
        panic!("groups")
    };
    let before = session.query(FfiQuery::State).unwrap();
    let FfiQueryReply::Decorators { nodes } = session
        .query(FfiQuery::Decorators {
            keys: vec![groups[0], people[0]],
        })
        .unwrap()
    else {
        panic!("decorators")
    };
    assert_eq!(nodes[0].key, groups[0]);
    assert_eq!(nodes[0].text, "@here");
    assert_eq!(nodes[1].key, people[0]);
    assert_eq!(nodes[1].text, "@Person 😀");
    assert!(
        nodes
            .iter()
            .all(|node| node.is_inline && node.is_keyboard_selectable)
    );
    let stale = NodeKey::from_parts(KeyParts {
        index: people[0].index(),
        generation: people[0].generation() + 1,
    });
    assert!(
        session
            .query(FfiQuery::Decorators { keys: vec![stale] })
            .is_err()
    );
    let FfiQueryReply::Nodes { keys: text, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "text".into(),
        })
        .unwrap()
    else {
        panic!("text")
    };
    assert!(session.query(FfiQuery::Decorators { keys: text }).is_err());
    let FfiQueryReply::State { root: before } = before else {
        panic!("before state")
    };
    let FfiQueryReply::State { root: after } = session.query(FfiQuery::State).unwrap() else {
        panic!("after state")
    };
    assert_eq!(after, before);
}

pub(crate) fn application_config() -> FfiSessionConfig {
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

#[test]
fn native_clipboard_namespace_matches_its_application_and_portable_paste_profiles() {
    let config = application_config();
    let source = NativeEditorSession::new(
        config.clone(),
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    for (step, input) in [
        FfiInput::Start,
        FfiInput::Seed { kind: SeedKind::Optimistic, snapshot: vec![] },
        FfiInput::SetState { root: serde_json::from_value(json!({"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"rich","format":1}]}]})).unwrap() },
        FfiInput::Command { command: FfiCommand::SelectAll, selection: ViewSelection::KeepModel },
    ].into_iter().enumerate() {
        let output = source.handle(FfiNow { mono_ms: step as u64, wall_ms: 1_000_000 + step as i64 }, input).unwrap();
        assert!(!output.view.iter().any(|effect| matches!(effect, FfiViewEffect::Error { .. })));
    }
    let FfiQueryReply::Clipboard { entries } = source.query(FfiQuery::Clipboard).unwrap() else {
        panic!("clipboard")
    };
    let internal = entries
        .into_iter()
        .find(|entry| entry.mime == "application/x-lexical-editor")
        .unwrap()
        .text;
    let payload: serde_json::Value = serde_json::from_str(&internal).unwrap();
    assert_eq!(payload["namespace"], "block-md-main");
    let mut portable = config.clone();
    portable.application = None;
    for (target_config, namespace, expected, format) in [
        (config, "block-md-main", "rich", 1),
        (portable, "document-session", "fallback", 0),
    ] {
        let target = NativeEditorSession::new(
            target_config,
            None,
            FfiNow {
                mono_ms: 0,
                wall_ms: 1_000_000,
            },
        )
        .unwrap();
        for (step, input) in [
            FfiInput::Start,
            FfiInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
            FfiInput::SetState {
                root: serde_json::from_value(
                    json!({"type":"root","children":[{"type":"paragraph","children":[]}]}),
                )
                .unwrap(),
            },
        ]
        .into_iter()
        .enumerate()
        {
            let output = target
                .handle(
                    FfiNow {
                        mono_ms: step as u64,
                        wall_ms: 1_000_000 + step as i64,
                    },
                    input,
                )
                .unwrap();
            assert!(
                !output
                    .view
                    .iter()
                    .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
            );
        }
        let FfiQueryReply::Nodes { keys, .. } = target
            .query(FfiQuery::NodesOfType {
                name: "paragraph".into(),
            })
            .unwrap()
        else {
            panic!("paragraph")
        };
        let point = Point::element(keys[0], ChildIndex(0));
        let output = target
            .handle(
                FfiNow {
                    mono_ms: 3,
                    wall_ms: 1_000_003,
                },
                FfiInput::Paste {
                    payload: FfiClipboardPayload {
                        data: vec![
                            FfiClipboardEntry {
                                mime: "application/x-lexical-editor".into(),
                                text: internal.clone(),
                            },
                            FfiClipboardEntry {
                                mime: "text/plain".into(),
                                text: "fallback".into(),
                            },
                        ],
                        has_files: false,
                        html_nodes: None,
                        intent: PasteIntent::default(),
                    },
                    selection: ViewSelection::Range {
                        anchor: point,
                        focus: point,
                        resolution_dirty: false,
                    },
                },
            )
            .unwrap();
        assert!(
            !output
                .view
                .iter()
                .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
        );
        assert_eq!(target.text_content().unwrap(), expected, "{namespace}");
        let FfiQueryReply::State { root } = target.query(FfiQuery::State).unwrap() else {
            panic!("state")
        };
        assert_eq!(
            root["children"][0]["children"][0]["format"], format,
            "{namespace}"
        );
        target
            .handle(
                FfiNow {
                    mono_ms: 4,
                    wall_ms: 1_000_004,
                },
                FfiInput::Command {
                    command: FfiCommand::SelectAll,
                    selection: ViewSelection::KeepModel,
                },
            )
            .unwrap();
        let FfiQueryReply::Clipboard { entries } = target.query(FfiQuery::Clipboard).unwrap()
        else {
            panic!("clipboard")
        };
        let internal = entries
            .into_iter()
            .find(|entry| entry.mime == "application/x-lexical-editor")
            .unwrap()
            .text;
        let payload: serde_json::Value = serde_json::from_str(&internal).unwrap();
        assert_eq!(payload["namespace"], namespace);
    }
}

#[test]
fn native_list_markers_use_shared_numbering_nesting_and_checked_state() {
    let session = NativeEditorSession::new(
        application_config(),
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    let root = json!({"type":"root","children":[
        {"type":"list","listType":"number","start":4,"children":[
            {"type":"listitem","value":4,"$":{"id":"fixture-number-first"},"children":[{"type":"text","text":"😀 first"}]},
            {"type":"listitem","value":5,"$":{"id":"fixture-nested-wrapper"},"children":[
                {"type":"list","listType":"check","start":1,"children":[
                    {"type":"listitem","value":1,"checked":true,"$":{"id":"fixture-check"},"children":[{"type":"text","text":"nested"}]}
                ]}
            ]},
            {"type":"listitem","value":5,"$":{"id":"fixture-number-last"},"children":[{"type":"text","text":"last"}]}
        ]},
        {"type":"list","listType":"bullet","start":1,"children":[
            {"type":"listitem","value":1,"$":{"id":"fixture-bullet"},"children":[{"type":"text","text":"bullet"}]}
        ]}
    ]});
    for (step, input) in [
        FfiInput::Start,
        FfiInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        FfiInput::SetState {
            root: serde_json::from_value(root).unwrap(),
        },
    ]
    .into_iter()
    .enumerate()
    {
        let output = session
            .handle(
                FfiNow {
                    mono_ms: step as u64,
                    wall_ms: 1_000_000 + step as i64,
                },
                input,
            )
            .unwrap();
        assert!(
            !output
                .view
                .iter()
                .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
        );
    }
    let mut keys = Vec::new();
    for id in [
        "fixture-bullet",
        "fixture-check",
        "fixture-number-first",
        "fixture-nested-wrapper",
        "fixture-number-last",
    ] {
        let FfiQueryReply::Nodes { keys: found, .. } =
            session.query(FfiQuery::NodeById { id: id.into() }).unwrap()
        else {
            panic!("node identity")
        };
        assert_eq!(found.len(), 1, "{id}");
        keys.push(found[0]);
    }
    let FfiQueryReply::State { root: before } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    let FfiQueryReply::ListMarkers { markers } = session
        .query(FfiQuery::ListMarkers { keys: keys.clone() })
        .unwrap()
    else {
        panic!("markers")
    };
    assert_eq!(
        markers.iter().map(|marker| marker.key).collect::<Vec<_>>(),
        keys
    );
    assert!(matches!(markers[0].kind, FfiListMarkerKind::Bullet));
    assert_eq!(markers[0].depth, 1);
    assert!(matches!(
        markers[1].kind,
        FfiListMarkerKind::Check { checked: true }
    ));
    assert_eq!(markers[1].depth, 2);
    assert!(matches!(
        markers[2].kind,
        FfiListMarkerKind::Number { value: 4 }
    ));
    assert_eq!(markers[2].depth, 1);
    assert!(matches!(markers[3].kind, FfiListMarkerKind::Nested));
    assert_eq!(markers[3].depth, 1);
    assert!(matches!(
        markers[4].kind,
        FfiListMarkerKind::Number { value: 5 }
    ));
    let FfiQueryReply::State { root: after } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(before, after);
    let output = session
        .application_command(
            FfiNow {
                mono_ms: 3,
                wall_ms: 1_000_003,
            },
            "group-b.checklist".into(),
            json!({"action":"toggle","key":keys[1].index()}),
            keys[1].generation(),
            ViewSelection::KeepModel,
        )
        .unwrap();
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
    );
    let FfiQueryReply::ListMarkers { markers } = session
        .query(FfiQuery::ListMarkers {
            keys: vec![keys[1]],
        })
        .unwrap()
    else {
        panic!("markers")
    };
    assert!(matches!(
        markers[0].kind,
        FfiListMarkerKind::Check { checked: false }
    ));
    assert!(
        session
            .query(FfiQuery::ListMarkers {
                keys: vec![NodeKey::ROOT]
            })
            .is_err()
    );
    let FfiQueryReply::ListMarkers { markers } = session
        .query(FfiQuery::ListMarkers { keys: vec![] })
        .unwrap()
    else {
        panic!("empty markers")
    };
    assert!(markers.is_empty());
    session
        .handle(
            FfiNow {
                mono_ms: 4,
                wall_ms: 1_000_004,
            },
            FfiInput::SetState {
                root: serde_json::from_value(
                    json!({"type":"root","children":[{"type":"paragraph","children":[]}]}),
                )
                .unwrap(),
            },
        )
        .unwrap();
    assert!(session.query(FfiQuery::ListMarkers { keys }).is_err());
}
