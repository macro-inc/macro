use super::*;
use doc_sync_core::*;
use lexical_model::*;
use loro::ExportMode;
use serde_json::json;

#[test]
fn literal_dom_first_keystroke_one_handle_zero_io_and_coalesced_wake() {
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut source = default_editor_builder(EditorMode::Headless, 10)
        .initial_state(serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[
            {"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"a","format":0,"detail":0,"mode":"normal","style":""}]}
        ]}})).unwrap()).build().unwrap();
    let doc = lexical_loro::new_doc(10).unwrap();
    lexical_loro::LoroProjection::initialize(&doc, source.state(), &lexical_loro::PlainPolicy, 0)
        .unwrap();
    let snapshot = doc.export(ExportMode::Snapshot).unwrap();
    let config = SessionConfig {
        sync: SyncConfig {
            doc: "session-document".parse().unwrap(),
            session: SessionId(uuid_value::Uuid::from_u128(1)),
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
                timeout: WallDuration(10000),
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
        peer_ids: vec![20, 21, 22, 23],
        peer_range: PeerRange::User,
        surface: SurfaceConfig::Editor(EditorConfig::default()),
    };
    let mut session = DocumentSession::<EditorSurface>::new(config, now).unwrap();
    let before = session.version();
    let out = session.handle(
        now,
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("rejected".into()),
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(matches!(
        out.view.as_slice(),
        [ViewEffect::Error(SessionError::NotReady)]
    ));
    assert_eq!(session.version(), before);
    session.handle(now, SessionInput::Sync(SyncInput::Start));
    let out = session.handle(
        now,
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    assert!(
        out.view
            .iter()
            .any(|v| matches!(v, ViewEffect::Initialize(InitialView::Editor { .. })))
    );
    assert!(!out.view.iter().any(|v| matches!(v, ViewEffect::Error(_))));
    #[cfg(feature = "conformance")]
    {
        let observed = session.conformance_drain_output();
        assert!(
            observed
                .sync_events
                .iter()
                .any(|event| matches!(event, SyncEvent::Seeded { .. }))
        );
        assert!(
            observed
                .view
                .iter()
                .any(|view| matches!(view, ViewEffect::Initialize(_)))
        );
        assert!(session.conformance_drain_output().view.is_empty());
        assert_eq!(session.conformance_sync().phase(), Phase::Running);
    }
    let state = session.surface().state().view();
    let p = state.first_child(NodeKey::ROOT).unwrap();
    let text = state.first_child(p).unwrap();
    let out = session.handle(
        Now {
            mono: Millis(1),
            wall: UnixMillis(1),
        },
        SessionInput::Editor(Input::TextFromView {
            key: text,
            text: "ab".into(),
            anchor: Some(Utf16Offset(2)),
            focus: Some(Utf16Offset(2)),
            composition_end: false,
            composition_data: None,
            selection: ViewSelection::Range {
                anchor: Point::text(text, Utf16Offset(2)),
                focus: Point::text(text, Utf16Offset(2)),
                resolution_dirty: false,
            },
        }),
    );
    assert!(out.io.is_empty(), "keystroke performs no I/O");
    assert!(
        !out.view
            .iter()
            .any(|v| matches!(v, ViewEffect::Diff(_) | ViewEffect::Error(_)))
    );
    assert_eq!(out.wake_at, Some(Millis(26)));
    assert_eq!(session.surface().state().view().text_content(text), "ab");
    assert!(session.surface().history().can_undo);
    #[cfg(feature = "conformance")]
    {
        let observed = session.conformance_drain_output();
        assert_eq!(observed.wake_at, Some(Millis(26)));
        assert_eq!(session.conformance_drain_output().wake_at, observed.wake_at);
        let focused = session.handle(
            Now {
                mono: Millis(1),
                wall: UnixMillis(1),
            },
            SessionInput::Focus(true),
        );
        assert_eq!(focused.wake_at, Some(Millis(26)));
        assert_eq!(
            session.conformance_reconstructed_state().unwrap(),
            lexical_loro::synced_json(session.surface().state(), &lexical_loro::PlainPolicy)
                .unwrap()
        );
    }
    let out = session.handle(
        Now {
            mono: Millis(2),
            wall: UnixMillis(2),
        },
        SessionInput::Editor(Input::TextFromView {
            key: text,
            text: "abc".into(),
            anchor: Some(Utf16Offset(3)),
            focus: Some(Utf16Offset(3)),
            composition_end: false,
            composition_data: None,
            selection: ViewSelection::Range {
                anchor: Point::text(text, Utf16Offset(3)),
                focus: Point::text(text, Utf16Offset(3)),
                resolution_dirty: false,
            },
        }),
    );
    assert!(out.io.is_empty());
    assert!(out.view.is_empty());
    assert_eq!(out.wake_at, Some(Millis(26)));
    let out = session.handle(
        Now {
            mono: Millis(3),
            wall: UnixMillis(3),
        },
        SessionInput::Sync(SyncInput::Flush(RequestId(1))),
    );
    assert!(out.view.iter().any(|v| matches!(
        v,
        ViewEffect::Reply {
            request: RequestId(1),
            reply: Reply::Flush(FlushReply::Drained)
        }
    )));
    let out = session.handle(
        Now {
            mono: Millis(500),
            wall: UnixMillis(500),
        },
        SessionInput::Editor(Input::Undo),
    );
    assert!(!out.view.iter().any(|v| matches!(v, ViewEffect::Error(_))));
    assert_eq!(session.surface().state().view().text_content(text), "a");
    assert!(session.surface().history().can_redo);
    session.handle(
        Now {
            mono: Millis(501),
            wall: UnixMillis(501),
        },
        SessionInput::Editor(Input::Redo),
    );
    assert_eq!(session.surface().state().view().text_content(text), "abc");
    // Source and session edits have distinct peer identities.
    source
        .update(|tx| {
            tx.select_end(NodeKey::ROOT)?;
            tx.insert_text("!")
        })
        .unwrap();
    assert_eq!(session.peer_id(), 20);
}

fn sync_config(access: Access, transport: TransportKind) -> SyncConfig {
    SyncConfig {
        doc: "session-test".parse().unwrap(),
        session: SessionId(uuid_value::Uuid::from_u128(2)),
        user: UserKey("fixture-user".into()),
        transport,
        persistence: Persistence::Memory,
        access,
        initial_token: Some(SyncToken::new("fixture-token".into())),
        traceparent: None,
        timeouts: Timeouts::default(),
        heartbeat: HeartbeatPolicy::default(),
        backoff: BackoffPolicy::default(),
        converge: ConvergePolicy::default(),
        wal: WalPolicy::default(),
        snapshot_interval: None,
        presence: PresencePolicy {
            timeout: WallDuration(10000),
            refresh: None,
            user: PresenceUser {
                user_id: None,
                color: PaletteColor::Blue,
            },
            key: PresenceKeyMode::Peer,
        },
        chatter: false,
        reset_budget: ResetBudget::default(),
    }
}
fn time(ms: u64) -> Now {
    Now {
        mono: Millis(ms),
        wall: UnixMillis(ms as i64),
    }
}

#[test]
fn generic_batches_create_containers_read_deep_values_and_reject_without_ops() {
    let root = ContainerPath {
        root: "form".into(),
        steps: vec![],
    };
    let text = ContainerPath {
        root: "form".into(),
        steps: vec![PathStep::Key("title".into())],
    };
    let mut session = DocumentSession::<GenericSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![31, 32, 33],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Generic(GenericConfig {
                roots: vec![root.clone()],
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        }),
    );
    let out = session.handle(
        time(1),
        SessionInput::Doc(vec![
            DocOp::MapSet {
                map: root.clone(),
                key: "title".into(),
                value: DocValue::NewContainer(ContainerKind::Text),
            },
            DocOp::TextSplice {
                text: text.clone(),
                index: Utf16Offset(0),
                delete: 0,
                insert: "a😀b".into(),
            },
        ]),
    );
    assert!(!out.view.iter().any(|v| matches!(v, ViewEffect::Error(_))));
    assert!(
        out.view
            .iter()
            .any(|v| matches!(v, ViewEffect::DocChanged(_)))
    );
    assert_eq!(
        session.read(&text).unwrap(),
        DocValue::String("a😀b".into())
    );
    let before = session.version();
    let out = session.handle(
        time(2),
        SessionInput::Doc(vec![
            DocOp::MapSet {
                map: root.clone(),
                key: "must-rollback".into(),
                value: DocValue::Bool(true),
            },
            DocOp::TextSplice {
                text: text.clone(),
                index: Utf16Offset(2),
                delete: 0,
                insert: "invalid".into(),
            },
        ]),
    );
    assert!(matches!(
        out.view.as_slice(),
        [ViewEffect::Error(SessionError::InvalidOp {
            index: 1,
            error: DocError::SurrogateBoundary
        })]
    ));
    assert_eq!(session.version(), before);
    assert_eq!(
        session.read(&root).unwrap(),
        DocValue::Map(std::collections::BTreeMap::from([(
            "title".into(),
            DocValue::String("a😀b".into())
        )]))
    );
}

fn editor_seed() -> (loro::LoroDoc, Vec<u8>) {
    let editor = default_editor_builder(EditorMode::Headless, 40)
        .initial_state(serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"a😀b","format":0,"detail":0,"mode":"normal","style":""}]}]}})).unwrap()).build().unwrap();
    let doc = lexical_loro::new_doc(40).unwrap();
    lexical_loro::LoroProjection::initialize(&doc, editor.state(), &lexical_loro::PlainPolicy, 0)
        .unwrap();
    let snapshot = doc.export(ExportMode::Snapshot).unwrap();
    (doc, snapshot)
}
fn session_editor(
    access: Access,
    transport: TransportKind,
    snapshot: Vec<u8>,
) -> DocumentSession<EditorSurface> {
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(access, transport),
            peer_ids: vec![50, 51, 52, 53, 54],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig::default()),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    let out = session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    for effect in &out.view {
        if let ViewEffect::Error(error) = effect {
            panic!("initialization: {error}");
        }
    }
    session
}
fn text_key(session: &DocumentSession<EditorSurface>) -> NodeKey {
    let state = session.surface().state().view();
    state
        .first_child(state.first_child(NodeKey::ROOT).unwrap())
        .unwrap()
}
fn wire<S: Surface>(
    session: &mut DocumentSession<S>,
    message: sync_protocol::FromRemote<'_>,
    ms: u64,
) {
    use bebop::Record;
    let mut bytes = vec![];
    message.serialize(&mut bytes).unwrap();
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        let out = session.handle(
            time(ms),
            SessionInput::Sync(SyncInput::Socket {
                conn: ConnId(1),
                event: SocketEvent::Frame(frame),
            }),
        );
        for effect in &out.view {
            if let ViewEffect::Error(error) = effect {
                panic!("wire import: {error}");
            }
        }
    }
}
fn connect<S: Surface>(session: &mut DocumentSession<S>) {
    session.handle(
        time(1),
        SessionInput::Sync(SyncInput::Socket {
            conn: ConnId(1),
            event: SocketEvent::Opened,
        }),
    );
    wire(
        session,
        sync_protocol::FromRemote::RemoteInitialSync {
            snapshot: bebop::SliceWrapper::from_cooked(&[]),
            awareness: bebop::SliceWrapper::from_cooked(&[]),
        },
        2,
    );
    let vv = session.version().encode();
    wire(
        session,
        sync_protocol::FromRemote::RemoteUpdateSince {
            vv: bebop::SliceWrapper::from_cooked(&vv),
            update: bebop::SliceWrapper::from_cooked(&[]),
        },
        3,
    );
}

#[test]
fn remote_through_handle_emits_diff_and_restores_preimport_utf16_cursor() {
    use bebop::Record;
    for access in [Access::Edit, Access::Read, Access::CommentOnly] {
        for focused in [true, false] {
            let (base, snapshot) = editor_seed();
            let mut session = session_editor(access, TransportKind::Direct, snapshot);
            connect(&mut session);
            let key = text_key(&session);
            session.handle(
                time(4),
                SessionInput::Editor(Input::SelectionFromView {
                    selection: ViewSelection::Range {
                        anchor: Point::text(key, Utf16Offset(3)),
                        focus: Point::text(key, Utf16Offset(3)),
                        resolution_dirty: false,
                    },
                    change: None,
                }),
            );
            session.handle(time(4), SessionInput::Focus(focused));
            let remote = lexical_loro::fork_doc(&base, 60).unwrap();
            let root = remote.get_map("root");
            let loro::ValueOrContainer::Container(loro::Container::MovableList(children)) =
                root.get("children").unwrap()
            else {
                panic!("children");
            };
            let loro::ValueOrContainer::Container(loro::Container::Map(p)) =
                children.get(0).unwrap()
            else {
                panic!("paragraph");
            };
            let loro::ValueOrContainer::Container(loro::Container::MovableList(children)) =
                p.get("children").unwrap()
            else {
                panic!("children");
            };
            let loro::ValueOrContainer::Container(loro::Container::Map(t)) =
                children.get(0).unwrap()
            else {
                panic!("text map");
            };
            let loro::ValueOrContainer::Container(loro::Container::Text(text)) =
                t.get("text").unwrap()
            else {
                panic!("text");
            };
            text.insert(0, "é").unwrap();
            remote.commit_with(loro::CommitOptions::new().timestamp(1));
            let update = remote
                .export(ExportMode::updates(&base.oplog_vv()))
                .unwrap();
            let message = sync_protocol::FromRemote::RemoteUpdate {
                update: bebop::SliceWrapper::from_cooked(&update),
            };
            let mut bytes = vec![];
            message.serialize(&mut bytes).unwrap();
            let frames = sync_protocol::framing::into_frames(&bytes, 900000);
            assert_eq!(frames.len(), 1);
            let out = session.handle(
                time(5),
                SessionInput::Sync(SyncInput::Socket {
                    conn: ConnId(1),
                    event: SocketEvent::Frame(frames.into_iter().next().unwrap()),
                }),
            );
            assert!(
                out.view
                    .iter()
                    .any(|v| matches!(v, ViewEffect::Diff(diff) if !diff.ops.is_empty()))
            );
            assert!(!out.view.iter().any(|v| matches!(v, ViewEffect::Error(_))));
            let final_selection = out.view.iter().rev().find_map(|effect| {
                if let ViewEffect::Editor(Effect::SetViewSelection { selection, .. }) = effect {
                    Some(selection)
                } else {
                    None
                }
            });
            if focused {
                let final_selection = final_selection.expect("restored host selection");
                assert!(
                    matches!(final_selection, ViewSelection::Range { anchor, focus, .. } if *anchor == Point::text(key, Utf16Offset(4)) && *focus == Point::text(key, Utf16Offset(4)))
                );
            } else {
                assert!(final_selection.is_none());
            }
            assert_eq!(session.surface().state().view().text_content(key), "éa😀b");
            let range = session
                .surface()
                .state()
                .selection()
                .unwrap()
                .as_range()
                .unwrap();
            assert_eq!(range.anchor, Point::text(key, Utf16Offset(4)));
            assert_eq!(range.focus, Point::text(key, Utf16Offset(4)));
            assert!(!session.surface().history().can_undo);
        }
    }
}

#[test]
fn read_and_comment_only_reject_mutations_before_any_model_or_loro_change() {
    for access in [Access::Read, Access::CommentOnly] {
        let (_, snapshot) = editor_seed();
        let mut session = session_editor(access, TransportKind::None, snapshot);
        let before = session.version();
        let state = session.surface().state().to_json().unwrap();
        for input in [
            Input::Command {
                command: Command::InsertText("bad".into()),
                selection: ViewSelection::KeepModel,
            },
            Input::Undo,
            Input::SetState {
                state: serde_json::from_value(
                    json!({"root":{"type":"root","version":1,"children":[]}}),
                )
                .unwrap(),
                tags: TagSet::default(),
            },
        ] {
            let out = session.handle(time(1), SessionInput::Editor(input));
            assert!(matches!(
                out.view.as_slice(),
                [ViewEffect::Error(SessionError::ReadOnly)]
            ));
            assert!(out.io.is_empty());
            assert_eq!(session.version(), before);
            assert_eq!(session.surface().state().to_json().unwrap(), state);
        }
        let out = session.handle(
            time(2),
            SessionInput::Editor(Input::ApplyRemote {
                changes: vec![],
                options: UpdateOptions::default(),
            }),
        );
        assert!(matches!(
            out.view.as_slice(),
            [ViewEffect::Error(SessionError::WrongSurface)]
        ));
    }
}

#[test]
fn invalid_inputs_and_peer_refills_preserve_the_existing_deadline() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::None, snapshot);
    let key = text_key(&session);
    let selection = ViewSelection::Range {
        anchor: Point::text(key, Utf16Offset(4)),
        focus: Point::text(key, Utf16Offset(4)),
        resolution_dirty: false,
    };
    let out = session.handle(
        time(5),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("x".into()),
            selection,
        }),
    );
    let wake = out.wake_at;
    assert_eq!(wake, Some(Millis(30)));
    let out = session.handle(time(6), SessionInput::Doc(vec![]));
    assert!(matches!(
        out.view.as_slice(),
        [ViewEffect::Error(SessionError::WrongSurface)]
    ));
    assert_eq!(out.wake_at, wake);
    let out = session.handle(time(7), SessionInput::AddPeerIds(vec![90, 91]));
    assert!(out.view.is_empty());
    assert_eq!(out.wake_at, wake);
    let out = session.handle(time(8), SessionInput::AddPeerIds(vec![90]));
    assert!(matches!(
        out.view.as_slice(),
        [ViewEffect::Error(SessionError::Sync(SyncError::PeerReused))]
    ));
    assert_eq!(out.wake_at, wake);
}

fn comment_request(
    session: &mut DocumentSession<EditorSurface>,
    request: u32,
    text: &str,
) -> CommentMarkRequest {
    let key = text_key(session);
    session.handle(
        time(4),
        SessionInput::Editor(Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(0)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
            change: None,
        }),
    );
    // The durable cursor codec is the same value used for local awareness.
    let cursors = session
        .surface()
        .selection_cursors()
        .expect("selection cursors");
    CommentMarkRequest {
        request: RequestId(request),
        mark_id: "annotation-one".into(),
        action: CommentAction::Add {
            anchor: cursors.anchor,
            focus: cursors.focus,
            text: text.into(),
        },
    }
}
fn server_current(session: &mut DocumentSession<EditorSurface>, ms: u64) -> Vec<(String, Vec<u8>)> {
    use bebop::{Record, SliceWrapper};
    let vv = session.version().encode();
    let message = sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&[]),
    };
    let mut bytes = vec![];
    message.serialize(&mut bytes).unwrap();
    let mut comments = vec![];
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        let out = session.handle(
            time(ms),
            SessionInput::Sync(SyncInput::Socket {
                conn: ConnId(1),
                event: SocketEvent::Frame(frame),
            }),
        );
        for io in &out.io {
            if let IoEffect::SocketSend { frame, .. } = io
                && let Ok(sync_protocol::FromPeer::PeerCommentUpdate { id, updates }) =
                    sync_protocol::FromPeer::deserialize(&frame[1..])
            {
                comments.push((id.to_owned(), updates[0].iter().collect()));
            }
            assert!(
                !matches!(
                    io,
                    IoEffect::Storage {
                        op: StorageOp::WalAppend { .. },
                        ..
                    }
                ),
                "comment must never enter WAL"
            );
        }
    }
    comments
}
#[test]
fn comment_only_publication_uses_fresh_peer_and_waits_for_ack_before_live_import() {
    let (base, snapshot) = editor_seed();
    let mut session = session_editor(Access::CommentOnly, TransportKind::Direct, snapshot);
    connect(&mut session);
    let request = comment_request(&mut session, 71, "a😀b");
    let original = session.surface().state().to_json().unwrap();
    let out = session.handle(time(5), SessionInput::Comment(request));
    assert!(!out.io.iter().any(|io| matches!(
        io,
        IoEffect::Storage {
            op: StorageOp::WalAppend { .. },
            ..
        }
    )));
    let comments = server_current(&mut session, 6);
    assert_eq!(
        comments.len(),
        1,
        "fresh catch-up must release exactly one staged update"
    );
    assert_eq!(session.surface().state().to_json().unwrap(), original);
    let (id, bytes) = &comments[0];
    let server = lexical_loro::fork_doc(&base, 99).unwrap();
    server.import(bytes).unwrap();
    assert!(
        server.oplog_vv().get(&51).copied().unwrap_or(0) > 0,
        "fork uses the next supplied peer"
    );
    assert_eq!(server.oplog_vv().get(&50).copied().unwrap_or(0), 0);
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteUpdateAck { id },
        7,
    );
    let state = session.surface().state().to_json().unwrap();
    assert_eq!(
        state.root["children"][0]["children"][0]["type"],
        json!("mark")
    );
    assert_eq!(
        state.root["children"][0]["children"][0]["ids"],
        json!(["annotation-one"])
    );
    assert_eq!(session.peer_id(), 50);
    assert!(!session.surface().history().can_undo);
}
#[test]
fn changed_comment_selection_is_refused_and_never_mutates_live_document() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::CommentOnly, TransportKind::Direct, snapshot);
    connect(&mut session);
    let request = comment_request(&mut session, 72, "different text");
    let before = session.version();
    session.handle(time(5), SessionInput::Comment(request));
    let comments = server_current(&mut session, 6);
    assert!(comments.is_empty());
    assert_eq!(session.version(), before);
}
#[test]
fn unacknowledged_comment_times_out_without_live_or_wal_changes() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::CommentOnly, TransportKind::Direct, snapshot);
    connect(&mut session);
    let request = comment_request(&mut session, 73, "a😀b");
    let before = session.version();
    session.handle(time(5), SessionInput::Comment(request));
    assert_eq!(server_current(&mut session, 6).len(), 1);
    let out = session.handle(time(5007), SessionInput::Sync(SyncInput::Tick));
    assert!(out.view.iter().any(|effect| matches!(
        effect,
        ViewEffect::Reply {
            request: RequestId(73),
            reply: Reply::Comment(CommentReply::NotAcked)
        }
    )));
    assert_eq!(session.version(), before);
}

#[test]
fn generic_literal_all_container_operations_and_plain_composites() {
    let root = ContainerPath {
        root: "data".into(),
        steps: vec![],
    };
    let list = ContainerPath {
        root: "data".into(),
        steps: vec![PathStep::Key("list".into())],
    };
    let movable = ContainerPath {
        root: "data".into(),
        steps: vec![PathStep::Key("movable".into())],
    };
    let child = ContainerPath {
        root: "data".into(),
        steps: vec![PathStep::Key("list".into()), PathStep::Index(0)],
    };
    let mut session = DocumentSession::<GenericSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![81, 82, 83],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Generic(GenericConfig {
                roots: vec![root.clone()],
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        }),
    );
    let out = session.handle(
        time(1),
        SessionInput::Doc(vec![
            DocOp::MapSet {
                map: root.clone(),
                key: "list".into(),
                value: DocValue::NewContainer(ContainerKind::List),
            },
            DocOp::ListInsert {
                list: list.clone(),
                index: 0,
                value: DocValue::NewContainer(ContainerKind::Map),
            },
            DocOp::MapSet {
                map: child,
                key: "plain".into(),
                value: DocValue::List(vec![
                    DocValue::Null,
                    DocValue::Bool(true),
                    DocValue::Number(1.5),
                    DocValue::Bytes(vec![1, 2]),
                ]),
            },
            DocOp::ListInsert {
                list: list.clone(),
                index: 1,
                value: DocValue::String("delete".into()),
            },
            DocOp::ListDelete {
                list: list.clone(),
                index: 1,
                len: 1,
            },
            DocOp::MapSet {
                map: root.clone(),
                key: "movable".into(),
                value: DocValue::NewContainer(ContainerKind::MovableList),
            },
            DocOp::ListInsert {
                list: movable.clone(),
                index: 0,
                value: DocValue::Int(1),
            },
            DocOp::ListInsert {
                list: movable.clone(),
                index: 1,
                value: DocValue::Int(2),
            },
            DocOp::MovableListMove {
                list: movable.clone(),
                from: 0,
                to: 1,
            },
            DocOp::MovableListSet {
                list: movable.clone(),
                index: 0,
                value: DocValue::Int(3),
            },
            DocOp::MapSet {
                map: root.clone(),
                key: "removed".into(),
                value: DocValue::Null,
            },
            DocOp::MapDelete {
                map: root.clone(),
                key: "removed".into(),
            },
        ]),
    );
    for effect in &out.view {
        if let ViewEffect::Error(error) = effect {
            panic!("generic: {error}");
        }
    }
    assert_eq!(
        session.read(&movable).unwrap(),
        DocValue::List(vec![DocValue::Int(3), DocValue::Int(1)])
    );
    let value = session.read(&list).unwrap();
    assert_eq!(
        value,
        DocValue::List(vec![DocValue::Map(std::collections::BTreeMap::from([(
            "plain".into(),
            DocValue::List(vec![
                DocValue::Null,
                DocValue::Bool(true),
                DocValue::Number(1.5),
                DocValue::Bytes(vec![1, 2])
            ])
        )]))])
    );
}

#[test]
fn empty_read_and_comment_only_seeds_create_no_native_operations() {
    for access in [Access::Read, Access::CommentOnly] {
        let mut session = session_editor(access, TransportKind::None, vec![]);
        assert_eq!(session.version(), loro::VersionVector::default());
        let out = session.handle(time(1), SessionInput::Sync(SyncInput::Flush(RequestId(90))));
        assert!(out.view.iter().any(|v| matches!(
            v,
            ViewEffect::Reply {
                request: RequestId(90),
                reply: Reply::Flush(FlushReply::ReadOnly)
            }
        )));
        assert_eq!(session.version(), loro::VersionVector::default());
    }
}
#[test]
fn observed_nested_container_creation_replacement_and_deletion_are_forwarded() {
    let root = ContainerPath {
        root: "form".into(),
        steps: vec![],
    };
    let observed = ContainerPath {
        root: "form".into(),
        steps: vec![PathStep::Key("title".into())],
    };
    let mut session = DocumentSession::<GenericSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![81, 82, 83],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Generic(GenericConfig {
                roots: vec![observed],
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        }),
    );
    for value in [
        DocValue::NewContainer(ContainerKind::Text),
        DocValue::NewContainer(ContainerKind::Map),
    ] {
        let out = session.handle(
            time(1),
            SessionInput::Doc(vec![DocOp::MapSet {
                map: root.clone(),
                key: "title".into(),
                value,
            }]),
        );
        assert!(
            out.view
                .iter()
                .any(|view| matches!(view, ViewEffect::DocChanged(events) if !events.is_empty()))
        );
    }
    let out = session.handle(
        time(2),
        SessionInput::Doc(vec![DocOp::MapDelete {
            map: root.clone(),
            key: "title".into(),
        }]),
    );
    assert!(
        out.view
            .iter()
            .any(|view| matches!(view, ViewEffect::DocChanged(events) if !events.is_empty()))
    );
    let out = session.handle(
        time(3),
        SessionInput::Doc(vec![DocOp::MapSet {
            map: root,
            key: "unobserved".into(),
            value: DocValue::Bool(true),
        }]),
    );
    assert!(
        !out.view
            .iter()
            .any(|view| matches!(view, ViewEffect::DocChanged(_)))
    );
}
#[test]
fn stopped_session_rejects_editor_input_without_creating_operations() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::None, snapshot);
    session.handle(time(1), SessionInput::Sync(SyncInput::Stop(RequestId(91))));
    let before = session.version();
    let out = session.handle(
        time(2),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("bad".into()),
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(matches!(
        out.view.as_slice(),
        [ViewEffect::Error(SessionError::NotReady)]
    ));
    assert_eq!(session.version(), before);
}
#[test]
fn duplicate_peer_configuration_and_short_supply_are_rejected_atomically() {
    for peers in [
        vec![1, 2],
        vec![1, 1, 2],
        vec![1, 2, 2],
        vec![1, 2, AI_PEER_BASE],
    ] {
        assert!(
            DocumentSession::<EditorSurface>::new(
                SessionConfig {
                    sync: sync_config(Access::Edit, TransportKind::None),
                    peer_ids: peers,
                    peer_range: PeerRange::User,
                    surface: SurfaceConfig::Editor(EditorConfig::default())
                },
                time(0)
            )
            .is_err()
        );
    }
}
#[test]
fn duplicate_live_node_ids_are_repaired_during_initial_output_projection() {
    let source = Editor::builder(EditorMode::Headless)
        .initial_state(serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[
            {"type":"paragraph","version":1,"$":{"id":"duplicate"},"children":[{"type":"text","version":1,"text":"one","$":{"id":"first"}}]},
            {"type":"paragraph","version":1,"$":{"id":"duplicate"},"children":[{"type":"text","version":1,"text":"two","$":{"id":"second"}}]}
        ]}})).unwrap()).build().unwrap();
    let doc = lexical_loro::new_doc(71).unwrap();
    lexical_loro::LoroProjection::initialize(&doc, source.state(), &lexical_loro::PlainPolicy, 0)
        .unwrap();
    let session = session_editor(
        Access::Edit,
        TransportKind::None,
        doc.export(ExportMode::Snapshot).unwrap(),
    );
    let json = session.surface().state().to_json().unwrap();
    let first = json.root["children"][0]["$"]["id"].as_str().unwrap();
    let second = json.root["children"][1]["$"]["id"].as_str().unwrap();
    assert_ne!(first, second);
    assert!(
        session.version().get(&50).copied().unwrap_or(0) > 0,
        "initial hook repairs are projected before input"
    );
    assert!(
        !session.surface().history().can_undo,
        "initial repairs never enter history"
    );
}

#[test]
fn batched_history_controls_are_explicitly_rejected_without_partial_edits() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::None, snapshot);
    let before = session.version();
    for command in [
        Command::Undo,
        Command::Redo,
        Command::ClearHistory,
        Command::ClearEditor,
    ] {
        let out = session.handle(
            time(1),
            SessionInput::Editor(Input::Batch(vec![Input::Command {
                command,
                selection: ViewSelection::KeepModel,
            }])),
        );
        assert!(matches!(
            out.view.as_slice(),
            [ViewEffect::Error(SessionError::Model(
                Error::InputNotBatchable
            ))]
        ));
        assert_eq!(session.version(), before);
    }
}

#[test]
fn durable_flush_waits_for_writing_rows_and_then_replies_drained() {
    let (_, snapshot) = editor_seed();
    let mut config = sync_config(Access::Edit, TransportKind::None);
    config.persistence = Persistence::Durable;
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: config,
            peer_ids: vec![50, 51, 52],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig::default()),
        },
        time(0),
    )
    .unwrap();
    let out = session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    let load = out
        .io
        .iter()
        .find_map(|io| {
            if let IoEffect::Storage {
                id,
                op: StorageOp::Load { .. },
            } = io
            {
                Some(*id)
            } else {
                None
            }
        })
        .unwrap();
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Storage(StorageEvent::Loaded {
            id: load,
            result: Ok(LocalState {
                snapshot: None,
                orphans: vec![],
                assist: vec![],
            }),
        })),
    );
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    let key = text_key(&session);
    session.handle(
        time(1),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("x".into()),
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(4)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
        }),
    );
    let out = session.handle(
        time(2),
        SessionInput::Sync(SyncInput::Flush(RequestId(101))),
    );
    assert!(!out.view.iter().any(|view| matches!(
        view,
        ViewEffect::Reply {
            request: RequestId(101),
            ..
        }
    )));
    let append = out
        .io
        .iter()
        .find_map(|io| {
            if let IoEffect::Storage {
                id,
                op: StorageOp::WalAppend { record, .. },
            } = io
            {
                assert!(!record.bytes.is_empty());
                Some(*id)
            } else {
                None
            }
        })
        .unwrap();
    let out = session.handle(
        time(3),
        SessionInput::Sync(SyncInput::Storage(StorageEvent::Done {
            id: append,
            result: Ok(()),
        })),
    );
    assert!(out.view.iter().any(|view| matches!(
        view,
        ViewEffect::Reply {
            request: RequestId(101),
            reply: Reply::Flush(FlushReply::Drained)
        }
    )));
}
#[test]
fn remote_generic_text_delta_has_its_native_path_and_updates_read_in_same_call() {
    let server = lexical_loro::new_doc(100).unwrap();
    let text = server
        .get_map("form")
        .insert_container("title", loro::LoroText::new())
        .unwrap();
    text.insert(0, "a😀").unwrap();
    server.commit_with(loro::CommitOptions::new().timestamp(0));
    let path = ContainerPath {
        root: "form".into(),
        steps: vec![PathStep::Key("title".into())],
    };
    let mut session = DocumentSession::<GenericSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Read, TransportKind::Direct),
            peer_ids: vec![81, 82, 83],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Generic(GenericConfig {
                roots: vec![path.clone()],
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: server.export(ExportMode::Snapshot).unwrap(),
        }),
    );
    connect(&mut session);
    let baseline = server.oplog_vv();
    text.insert(2, "é").unwrap();
    server.commit_with(loro::CommitOptions::new().timestamp(1));
    let update = server.export(ExportMode::updates(&baseline)).unwrap();
    use bebop::{Record, SliceWrapper};
    let mut bytes = vec![];
    sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&update),
    }
    .serialize(&mut bytes)
    .unwrap();
    let frame = sync_protocol::framing::into_frames(&bytes, 900000).remove(0);
    let out = session.handle(
        time(4),
        SessionInput::Sync(SyncInput::Socket {
            conn: ConnId(1),
            event: SocketEvent::Frame(frame),
        }),
    );
    assert!(out.view.iter().any(|view|matches!(view,ViewEffect::DocChanged(events) if events.iter().any(|event|matches!(event,DocEvent::Text{path:actual,delta} if actual==&path&&!delta.is_empty())))));
    assert_eq!(
        session.read(&path).unwrap(),
        DocValue::String("a😀é".into())
    );
}
#[test]
fn stable_container_id_paths_survive_movable_list_reordering() {
    use loro::ContainerTrait;
    let source = lexical_loro::new_doc(100).unwrap();
    let list = source.get_movable_list("rows");
    let first = list.insert_container(0, loro::LoroMap::new()).unwrap();
    first.insert("value", 1_i64).unwrap();
    list.insert_container(1, loro::LoroMap::new()).unwrap();
    source.commit_with(loro::CommitOptions::new().timestamp(0));
    let root = ContainerPath {
        root: "rows".into(),
        steps: vec![],
    };
    let stable = ContainerPath {
        root: "rows".into(),
        steps: vec![PathStep::Id(first.id())],
    };
    let mut session = DocumentSession::<GenericSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![81, 82, 83],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Generic(GenericConfig {
                roots: vec![root.clone()],
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: source.export(ExportMode::Snapshot).unwrap(),
        }),
    );
    let out = session.handle(
        time(1),
        SessionInput::Doc(vec![
            DocOp::MovableListMove {
                list: root,
                from: 0,
                to: 1,
            },
            DocOp::MapSet {
                map: stable.clone(),
                key: "value".into(),
                value: DocValue::Int(7),
            },
        ]),
    );
    assert!(
        !out.view
            .iter()
            .any(|view| matches!(view, ViewEffect::Error(_)))
    );
    assert_eq!(
        session.read(&stable).unwrap(),
        DocValue::Map(std::collections::BTreeMap::from([(
            "value".into(),
            DocValue::Int(7)
        )]))
    );
}
#[test]
fn clear_history_removes_both_stacks_and_new_edits_start_a_fresh_item() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::None, snapshot);
    let key = text_key(&session);
    let select = ViewSelection::Range {
        anchor: Point::text(key, Utf16Offset(4)),
        focus: Point::text(key, Utf16Offset(4)),
        resolution_dirty: false,
    };
    session.handle(
        time(1),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("x".into()),
            selection: select,
        }),
    );
    session.handle(time(2), SessionInput::Editor(Input::Undo));
    assert!(session.surface().history().can_redo);
    session.handle(
        time(3),
        SessionInput::Editor(Input::Command {
            command: Command::ClearHistory,
            selection: ViewSelection::KeepModel,
        }),
    );
    assert_eq!(session.surface().history(), HistoryAvailability::default());
    session.handle(
        time(4),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("y".into()),
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(session.surface().history().can_undo);
    assert!(!session.surface().history().can_redo);
}

#[test]
fn existing_comment_retry_accepts_stale_cursors_without_allocating_another_peer() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::CommentOnly, TransportKind::Direct, snapshot);
    connect(&mut session);
    let mut request = comment_request(&mut session, 110, "a😀b");
    session.handle(time(5), SessionInput::Comment(request.clone()));
    let comments = server_current(&mut session, 6);
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteUpdateAck { id: &comments[0].0 },
        7,
    );
    let before = session.version();
    request.request = RequestId(111);
    if let CommentAction::Add {
        anchor,
        focus,
        text,
    } = &mut request.action
    {
        anchor.node_id = "deleted-anchor".into();
        focus.node_id = "deleted-focus".into();
        *text = "stale text".into();
    }
    session.handle(time(8), SessionInput::Comment(request));
    assert!(
        server_current(&mut session, 9).is_empty(),
        "existing mark needs no fork or publication"
    );
    assert_eq!(session.version(), before);
}
#[test]
fn removing_a_comment_is_staged_and_imported_only_after_ack() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::CommentOnly, TransportKind::Direct, snapshot);
    connect(&mut session);
    let request = comment_request(&mut session, 112, "a😀b");
    session.handle(time(5), SessionInput::Comment(request));
    let comments = server_current(&mut session, 6);
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteUpdateAck { id: &comments[0].0 },
        7,
    );
    let before = session.surface().state().to_json().unwrap();
    session.handle(
        time(8),
        SessionInput::Comment(CommentMarkRequest {
            request: RequestId(113),
            mark_id: "annotation-one".into(),
            action: CommentAction::Remove,
        }),
    );
    let comments = server_current(&mut session, 9);
    assert_eq!(comments.len(), 1);
    assert_eq!(session.surface().state().to_json().unwrap(), before);
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteUpdateAck { id: &comments[0].0 },
        10,
    );
    let after = session.surface().state().to_json().unwrap();
    assert_eq!(
        after.root["children"][0]["children"][0]["type"],
        json!("text")
    );
    assert_eq!(
        after.root["children"][0]["children"][0]["text"],
        json!("a😀b")
    );
}
#[test]
fn local_projection_resync_preserves_peer_and_undo_and_needs_no_server_snapshot() {
    let (server, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::Direct, snapshot);
    connect(&mut session);
    let key = text_key(&session);
    session.handle(
        time(4),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("x".into()),
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(4)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
        }),
    );
    let baseline = server.oplog_vv();
    let loro::ValueOrContainer::Container(loro::Container::MovableList(children)) =
        server.get_map("root").get("children").unwrap()
    else {
        panic!("root children")
    };
    let loro::ValueOrContainer::Container(loro::Container::Map(p)) = children.get(0).unwrap()
    else {
        panic!("paragraph")
    };
    let loro::ValueOrContainer::Container(loro::Container::MovableList(children)) =
        p.get("children").unwrap()
    else {
        panic!("text children")
    };
    let loro::ValueOrContainer::Container(loro::Container::Map(t)) = children.get(0).unwrap()
    else {
        panic!("text map")
    };
    let loro::ValueOrContainer::Container(loro::Container::Text(text)) = t.get("text").unwrap()
    else {
        panic!("text")
    };
    text.insert(0, "remote-").unwrap();
    server.commit_with(loro::CommitOptions::new().timestamp(1));
    let update = server.export(ExportMode::updates(&baseline)).unwrap();
    use bebop::{Record, SliceWrapper};
    let mut bytes = vec![];
    sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&update),
    }
    .serialize(&mut bytes)
    .unwrap();
    session.fail_next_projection();
    let out = session.handle(
        time(5),
        SessionInput::Sync(SyncInput::Socket {
            conn: ConnId(1),
            event: SocketEvent::Frame(
                sync_protocol::framing::into_frames(&bytes, 900000).remove(0),
            ),
        }),
    );
    assert!(
        out.view
            .iter()
            .any(|view| matches!(view, ViewEffect::Initialize(_)))
    );
    for io in &out.io {
        if let IoEffect::SocketSend { frame, .. } = io {
            assert!(!matches!(
                sync_protocol::FromPeer::deserialize(&frame[1..]),
                Ok(sync_protocol::FromPeer::PeerRequestSnapshot { .. })
            ));
        }
    }
    assert_eq!(session.peer_id(), 50);
    session.assert_projection_consistent();
    assert!(session.surface().history().can_undo);
    session.handle(time(6), SessionInput::Editor(Input::Undo));
    session.assert_projection_consistent();
    assert_eq!(
        &*session.surface().state().root_text_content(),
        "remote-a😀b"
    );
}
#[test]
fn apply_error_still_projects_and_renders_early_commits() {
    struct Early;
    static KEY: CommandKey<()> = CommandKey::new("fixture-early");
    impl Plugin for Early {
        fn name(&self) -> &'static str {
            "fixture-early"
        }
        fn commands(&self) -> &[CommandRegistration] {
            static REG: [CommandRegistration; 1] = [CommandRegistration {
                command: CommandKind::Extension(&KEY),
                priority: CommandPriority::Critical,
                placement: Placement::After,
            }];
            &REG
        }
        fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            let saved = tx.committed_state().clone();
            let text = tx
                .first_descendant(NodeKey::ROOT)
                .ok_or(Error::Invariant("text"))?;
            tx.text(text)?.set_text_content("early publication")?;
            tx.set_editor_state(saved, TagSet::default())?;
            Err(Error::Invariant("after early commit"))
        }
    }
    let (_, snapshot) = editor_seed();
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![50, 51, 52],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig {
                builder: std::sync::Arc::new(|mode, peer| {
                    default_editor_builder(mode, peer).plugin(Early)
                }),
                ..EditorConfig::default()
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    let before = session.version();
    let out = session.handle(
        time(1),
        SessionInput::Editor(Input::Command {
            command: Command::Extension(ExtensionCommand::new(&KEY, ())),
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(out.view.iter().any(|view| matches!(
        view,
        ViewEffect::Error(SessionError::Model(Error::Invariant("after early commit")))
    )));
    assert!(
        out.view
            .iter()
            .any(|view| matches!(view,ViewEffect::Diff(diff)if !diff.ops.is_empty()))
    );
    assert_ne!(session.version(), before);
    assert_eq!(
        &*session.surface().state().root_text_content(),
        "early publication"
    );
    session.assert_projection_consistent();
}

proptest::proptest! {
    #[test]
    fn generic_rejected_batch_keeps_every_valid_prefix_out_of_the_oplog(values in proptest::collection::vec(proptest::num::i64::ANY,0..40)) {
        let source=lexical_loro::new_doc(100).unwrap();source.get_map("data").insert("base",true).unwrap();source.commit_with(loro::CommitOptions::new().timestamp(0));
        let path=ContainerPath{root:"data".into(),steps:vec![]};
        let mut session=DocumentSession::<GenericSurface>::new(SessionConfig{sync:sync_config(Access::Edit,TransportKind::None),peer_ids:vec![81,82,83],peer_range:PeerRange::User,surface:SurfaceConfig::Generic(GenericConfig{roots:vec![path.clone()]})},time(0)).unwrap();
        session.handle(time(0),SessionInput::Sync(SyncInput::Start));session.handle(time(0),SessionInput::Sync(SyncInput::Seed{kind:SeedKind::Optimistic,snapshot:source.export(ExportMode::Snapshot).unwrap()}));
        let before=session.version();let original=session.read(&path).unwrap();
        let mut ops=values.iter().enumerate().map(|(index,value)|DocOp::MapSet{map:path.clone(),key:index.to_string(),value:DocValue::Int(*value)}).collect::<Vec<_>>();
        ops.push(DocOp::TextSplice{text:path.clone(),index:Utf16Offset(0),delete:0,insert:"invalid".into()});
        let out=session.handle(time(1),SessionInput::Doc(ops));
        proptest::prop_assert!(matches!(out.view.as_slice(),[ViewEffect::Error(SessionError::InvalidOp{index,error:DocError::WrongKind})]if *index==values.len()), "batch fails at invalid suffix");
        proptest::prop_assert_eq!(session.version(),before);proptest::prop_assert_eq!(session.read(&path).unwrap(),original);
    }
}

#[test]
fn paste_inserts_plain_text_paragraphs_and_projects_the_complete_output() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::None, snapshot);
    let key = text_key(&session);
    let mut payload = ClipboardPayload::default();
    payload
        .data
        .insert("text/plain".into(), "paste\nnext".into());
    let out = session.handle(
        time(1),
        SessionInput::Editor(Input::Command {
            command: Command::Paste(payload),
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(4)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
        }),
    );
    assert!(
        !out.view
            .iter()
            .any(|view| matches!(view, ViewEffect::Error(_)))
    );
    assert_eq!(
        &*session.surface().state().root_text_content(),
        "a😀bpaste\n\nnext"
    );
    session.assert_projection_consistent();
}

#[test]
fn refilling_before_start_cannot_reserve_the_initial_peer_twice() {
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![50, 51, 52],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig::default()),
        },
        time(0),
    )
    .unwrap();
    let out = session.handle(time(0), SessionInput::AddPeerIds(vec![50, 60]));
    assert!(matches!(
        out.view.as_slice(),
        [ViewEffect::Error(SessionError::Sync(SyncError::PeerReused))]
    ));
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    let out = session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        }),
    );
    assert!(
        out.view
            .iter()
            .any(|view| matches!(view, ViewEffect::Initialize(_)))
    );
    assert!(
        !out.view
            .iter()
            .any(|view| matches!(view, ViewEffect::Error(_)))
    );
}

#[test]
fn authorization_downgrade_gates_the_very_next_input_and_restores_on_upgrade() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::None, snapshot);
    let key = text_key(&session);
    session.handle(
        time(1),
        SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: true,
        })),
    );
    let before = session.version();
    let state = session.surface().state().to_json().unwrap();
    let out = session.handle(
        time(2),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("blocked".into()),
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(matches!(
        out.view.as_slice(),
        [ViewEffect::Error(SessionError::ReadOnly)]
    ));
    assert_eq!(session.version(), before);
    assert_eq!(session.surface().state().to_json().unwrap(), state);
    session.handle(
        time(3),
        SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: true,
            can_comment: true,
        })),
    );
    let out = session.handle(
        time(4),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("allowed".into()),
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(4)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
        }),
    );
    assert!(
        !out.view
            .iter()
            .any(|view| matches!(view, ViewEffect::Error(_)))
    );
    assert_eq!(
        session.surface().state().view().text_content(key),
        "a😀ballowed"
    );
}
#[test]
fn exhausted_comment_peers_reply_correlatively_and_refill_allows_retry() {
    let (_, snapshot) = editor_seed();
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::CommentOnly, TransportKind::Direct),
            peer_ids: vec![50, 51, 52],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig::default()),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    connect(&mut session);
    let request = comment_request(&mut session, 120, "a😀b");
    session.handle(time(5), SessionInput::Comment(request.clone()));
    assert_eq!(server_current(&mut session, 6).len(), 1);
    let mut next = request.clone();
    next.request = RequestId(121);
    session.handle(time(7), SessionInput::Comment(next));
    assert_eq!(server_current(&mut session, 8).len(), 1);
    next = request.clone();
    next.request = RequestId(122);
    let out = session.handle(time(9), SessionInput::Comment(next.clone()));
    assert!(out.need_peer_ids);
    use bebop::{Record, SliceWrapper};
    let vv = session.version().encode();
    let mut bytes = vec![];
    sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)
    .unwrap();
    let out = session.handle(
        time(10),
        SessionInput::Sync(SyncInput::Socket {
            conn: ConnId(1),
            event: SocketEvent::Frame(
                sync_protocol::framing::into_frames(&bytes, 900000).remove(0),
            ),
        }),
    );
    assert!(out.view.iter().any(|view| matches!(
        view,
        ViewEffect::Reply {
            request: RequestId(122),
            reply: Reply::Comment(CommentReply::Refused(CommentRefusal::StagingFailed))
        }
    )));
    let out = session.handle(time(11), SessionInput::AddPeerIds(vec![60, 61]));
    assert!(!out.need_peer_ids);
    next.request = RequestId(123);
    session.handle(time(12), SessionInput::Comment(next));
    assert_eq!(server_current(&mut session, 13).len(), 1);
}
#[test]
fn generic_nonfinite_nested_creation_and_wrong_kind_batches_are_atomic() {
    let root = ContainerPath {
        root: "form".into(),
        steps: vec![],
    };
    let source = lexical_loro::new_doc(100).unwrap();
    source.get_map("form").insert("base", 1).unwrap();
    source.commit_with(loro::CommitOptions::new().timestamp(0));
    let mut session = DocumentSession::<GenericSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![81, 82, 83],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Generic(GenericConfig {
                roots: vec![root.clone()],
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: source.export(ExportMode::Snapshot).unwrap(),
        }),
    );
    for (bad, expected) in [
        (
            DocOp::MapSet {
                map: root.clone(),
                key: "bad".into(),
                value: DocValue::Number(f64::NAN),
            },
            DocError::NonFinite,
        ),
        (
            DocOp::MapSet {
                map: root.clone(),
                key: "bad".into(),
                value: DocValue::List(vec![DocValue::NewContainer(ContainerKind::Text)]),
            },
            DocError::NestedContainer,
        ),
        (
            DocOp::ListDelete {
                list: root.clone(),
                index: 0,
                len: 1,
            },
            DocError::WrongKind,
        ),
    ] {
        let before = session.version();
        let original = session.read(&root).unwrap();
        let out = session.handle(
            time(1),
            SessionInput::Doc(vec![
                DocOp::MapSet {
                    map: root.clone(),
                    key: "prefix".into(),
                    value: DocValue::Bool(true),
                },
                bad,
            ]),
        );
        assert!(
            matches!(out.view.as_slice(),[ViewEffect::Error(SessionError::InvalidOp{index:1,error})]if *error==expected)
        );
        assert_eq!(session.version(), before);
        assert_eq!(session.read(&root).unwrap(), original);
    }
}

#[test]
fn reset_rebuilds_bindings_and_undo_on_a_fresh_peer_and_freezes_mutations_until_replaced() {
    use bebop::{Record, SliceWrapper};
    let (server, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::Direct, snapshot);
    connect(&mut session);
    let key = text_key(&session);
    session.handle(
        time(4),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("x".into()),
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(4)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
        }),
    );
    let out = session.handle(
        time(5),
        SessionInput::Sync(SyncInput::Flush(RequestId(130))),
    );
    let mut pushed = None;
    for io in &out.io {
        if let IoEffect::SocketSend { frame, .. } = io
            && let Ok(sync_protocol::FromPeer::PeerUpdate { id, updates }) =
                sync_protocol::FromPeer::deserialize(&frame[1..])
        {
            for update in updates {
                server.import(&update.iter().collect::<Vec<_>>()).unwrap();
            }
            pushed = Some(id.to_owned());
        }
    }
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteUpdateAck {
            id: pushed.as_deref().unwrap(),
        },
        6,
    );
    assert!(session.surface().history().can_undo);
    session.handle(time(7), SessionInput::Sync(SyncInput::Reset));
    let before = session.version();
    let out = session.handle(
        time(8),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("blocked".into()),
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(matches!(
        out.view.as_slice(),
        [ViewEffect::Error(SessionError::NotReady)]
    ));
    assert_eq!(session.version(), before);
    let snapshot = server.export(ExportMode::Snapshot).unwrap();
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteSnapshot {
            snapshot: SliceWrapper::from_cooked(&snapshot),
        },
        9,
    );
    assert_eq!(session.peer_id(), 51);
    assert_eq!(session.surface().history(), HistoryAvailability::default());
    session.assert_projection_consistent();
    assert_eq!(&*session.surface().state().root_text_content(), "a😀bx");
}
#[test]
fn presence_is_coalesced_and_delivered_with_the_same_cursor_codec() {
    use bebop::{Record, SliceWrapper};
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::Direct, snapshot);
    connect(&mut session);
    let key = text_key(&session);
    let out = session.handle(
        time(4),
        SessionInput::Editor(Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(3)),
                focus: Point::text(key, Utf16Offset(3)),
                resolution_dirty: false,
            },
            change: None,
        }),
    );
    assert!(out.io.is_empty());
    let out = session.handle(time(29), SessionInput::Sync(SyncInput::Tick));
    let mut store = ProtocolPresence::new(WallDuration(10000));
    let mut found = false;
    for io in &out.io {
        if let IoEffect::SocketSend { frame, .. } = io
            && let Ok(sync_protocol::FromPeer::PeerAwareness { awareness }) =
                sync_protocol::FromPeer::deserialize(&frame[1..])
        {
            store
                .apply(&awareness.iter().collect::<Vec<_>>(), UnixMillis(29))
                .unwrap();
            found = true;
        }
    }
    assert!(found);
    let peers = store.peers("");
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].key, "50");
    let loro::LoroValue::Map(value) = &peers[0].value else {
        panic!("presence payload")
    };
    assert!(lexical_loro::decode_selection(&value["selection"]).is_some());
    let bytes = store.encode("50", UnixMillis(29)).unwrap();
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteAwareness {
            awareness: SliceWrapper::from_cooked(&bytes),
        },
        30,
    );
}

#[test]
fn generic_comment_and_mismatched_surface_configs_fail_without_io() {
    let bad = DocumentSession::<GenericSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![81, 82, 83],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig::default()),
        },
        time(0),
    );
    assert!(matches!(bad, Err(SessionError::WrongSurface)));
    let mut session = DocumentSession::<GenericSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![81, 82, 83],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Generic(GenericConfig::default()),
        },
        time(0),
    )
    .unwrap();
    let out = session.handle(
        time(0),
        SessionInput::Comment(CommentMarkRequest {
            request: RequestId(140),
            mark_id: "not-an-editor".into(),
            action: CommentAction::Remove,
        }),
    );
    assert!(out.io.is_empty());
    assert!(matches!(
        out.view.as_slice(),
        [ViewEffect::Error(SessionError::WrongSurface)]
    ));
}

#[test]
fn stopped_comment_has_a_correlated_terminal_reply() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::CommentOnly, TransportKind::None, snapshot);
    session.handle(time(1), SessionInput::Sync(SyncInput::Stop(RequestId(200))));
    for at in [2, 3] {
        let out = session.handle(
            time(at),
            SessionInput::Comment(CommentMarkRequest {
                request: RequestId(201),
                mark_id: "fixture-mark".into(),
                action: CommentAction::Remove,
            }),
        );
        assert!(out.io.is_empty());
        assert!(out.view.iter().any(|v| matches!(
            v,
            ViewEffect::Reply {
                request: RequestId(201),
                reply: Reply::Comment(CommentReply::Refused(_))
            }
        )));
        assert!(
            out.view
                .iter()
                .any(|v| matches!(v, ViewEffect::Error(SessionError::NotReady)))
        );
    }
}

#[test]
fn event_only_commits_preserve_the_typing_history_group() {
    struct Events;
    static KEY: CommandKey<()> = CommandKey::new("fixture-event");
    static EVENT: EventKey<()> = EventKey::new("fixture-event");
    impl Plugin for Events {
        fn name(&self) -> &'static str {
            "fixture-event"
        }
        fn commands(&self) -> &[CommandRegistration] {
            static REG: [CommandRegistration; 1] = [CommandRegistration {
                command: CommandKind::Extension(&KEY),
                priority: CommandPriority::Critical,
                placement: Placement::After,
            }];
            &REG
        }
        fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            tx.emit(&EVENT, ());
            Ok(Handled::Yes)
        }
    }
    let (_, snapshot) = editor_seed();
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![50, 51, 52],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig {
                builder: std::sync::Arc::new(|mode, peer| {
                    default_editor_builder(mode, peer).plugin(Events)
                }),
                ..EditorConfig::default()
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    let key = text_key(&session);
    session.handle(
        time(0),
        SessionInput::Editor(Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(4)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
            change: None,
        }),
    );
    for at in [10, 310, 460] {
        if at == 460 {
            let out = session.handle(
                time(360),
                SessionInput::Editor(Input::Command {
                    command: Command::Extension(ExtensionCommand::new(&KEY, ())),
                    selection: ViewSelection::KeepModel,
                }),
            );
            assert!(
                out.view
                    .iter()
                    .any(|v| matches!(v, ViewEffect::Editor(Effect::PluginEvent(_))))
            );
        }
        session.handle(
            time(at),
            SessionInput::Editor(Input::Command {
                command: Command::InsertText("x".into()),
                selection: ViewSelection::KeepModel,
            }),
        );
    }
    session.handle(time(470), SessionInput::Editor(Input::Undo));
    assert_eq!(session.surface().state().view().text_content(key), "a😀b");
    assert!(!session.surface().history().can_undo);
}

mod comment_factory;
mod ime;

mod close;
mod presence;
mod seed_adoption;

mod decorator_render;
