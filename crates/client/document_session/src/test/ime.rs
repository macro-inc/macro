use super::*;

fn native_text(doc: &loro::LoroDoc, paragraph: usize) -> loro::LoroText {
    let loro::ValueOrContainer::Container(loro::Container::MovableList(children)) =
        doc.get_map("root").get("children").unwrap()
    else {
        panic!("root children")
    };
    let loro::ValueOrContainer::Container(loro::Container::Map(p)) =
        children.get(paragraph).unwrap()
    else {
        panic!("paragraph")
    };
    let loro::ValueOrContainer::Container(loro::Container::MovableList(children)) =
        p.get("children").unwrap()
    else {
        panic!("paragraph children")
    };
    let loro::ValueOrContainer::Container(loro::Container::Map(t)) = children.get(0).unwrap()
    else {
        panic!("text map")
    };
    let loro::ValueOrContainer::Container(loro::Container::Text(t)) = t.get("text").unwrap() else {
        panic!("text")
    };
    t
}

fn start_composition(session: &mut DocumentSession<EditorSurface>, key: NodeKey) {
    let out = session.handle(
        time(4),
        SessionInput::Editor(Input::Composition {
            event: CompositionEvent::Start {
                data: String::new(),
            },
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
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    assert!(out.view.iter().any(|effect| matches!(effect, ViewEffect::CommitTags(tags) if tags.iter().any(|tag| tag == "composition-start"))));
}

fn composing_text(
    session: &mut DocumentSession<EditorSurface>,
    key: NodeKey,
    text: &str,
    ms: u64,
    end: bool,
) {
    let offset = Utf16Offset(text.encode_utf16().count() as u32);
    let selection = ViewSelection::Range {
        anchor: Point::text(key, offset),
        focus: Point::text(key, offset),
        resolution_dirty: false,
    };
    let input = if end {
        Input::Composition {
            event: CompositionEvent::End {
                key,
                text: text.into(),
                anchor: Some(offset),
                focus: Some(offset),
                data: String::new(),
            },
            selection,
        }
    } else {
        Input::TextFromView {
            key,
            text: text.into(),
            anchor: Some(offset),
            focus: Some(offset),
            composition_end: end,
            composition_data: end.then(String::new),
            selection: ViewSelection::Range {
                anchor: Point::text(key, offset),
                focus: Point::text(key, offset),
                resolution_dirty: false,
            },
        }
    };
    let out = session.handle(time(ms), SessionInput::Editor(input));
    assert!(
        !out.view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
}

#[test]
fn long_cjk_composition_keeps_sync_live_and_converges_on_time_cap() {
    let (base, snapshot) = editor_seed();
    let mut local = session_editor(Access::Edit, TransportKind::Direct, snapshot.clone());
    connect(&mut local);
    let key = text_key(&local);
    start_composition(&mut local, key);
    composing_text(&mut local, key, "a😀b漢", 5, false);
    let mut other = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::Direct),
            peer_ids: vec![60, 61, 62, 63],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig::default()),
        },
        time(0),
    )
    .unwrap();
    other.handle(time(0), SessionInput::Sync(SyncInput::Start));
    other.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    connect(&mut other);
    let other_key = text_key(&other);
    other.handle(
        time(6),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("遠".into()),
            selection: ViewSelection::Range {
                anchor: Point::text(other_key, Utf16Offset(0)),
                focus: Point::text(other_key, Utf16Offset(0)),
                resolution_dirty: false,
            },
        }),
    );
    let remote = lexical_loro::new_doc(70).unwrap();
    remote.import(&other.test_snapshot()).unwrap();
    let update = remote
        .export(ExportMode::updates(&base.oplog_vv()))
        .unwrap();
    wire(
        &mut local,
        sync_protocol::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::from_cooked(&update),
        },
        10,
    );
    assert_eq!(local.surface().state().view().text_content(key), "a😀b漢");
    assert!(
        local.version().get(&60).is_some(),
        "sync imports the remote frame during IME"
    );
    composing_text(&mut local, key, "a😀b漢字入力", 2000, false);
    let out = local.handle(
        time(2001),
        SessionInput::Sync(SyncInput::Flush(RequestId(501))),
    );
    assert!(
        !out.io.is_empty(),
        "outgoing local WAL publication is not held"
    );
    assert!(out.wake_at.is_some_and(|wake| wake <= Millis(3010)));
    let out = local.handle(time(3010), SessionInput::Sync(SyncInput::Tick));
    assert!(
        out.view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::EndComposition))
    );
    assert!(
        !out.view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    assert_eq!(local.surface().core.composition(), Composition::Idle);
    assert_eq!(
        local.surface().state().view().text_content(key),
        "遠a😀b漢字入力"
    );
    local.assert_projection_consistent();
    let remote = lexical_loro::new_doc(70).unwrap();
    remote.import(&local.test_snapshot()).unwrap();
    let update = remote
        .export(ExportMode::updates(&other.version()))
        .unwrap();
    wire(
        &mut other,
        sync_protocol::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::from_cooked(&update),
        },
        3011,
    );
    assert_eq!(
        other.surface().state().view().text_content(other_key),
        "遠a😀b漢字入力"
    );
    assert_eq!(other.version(), local.version());
    other.assert_projection_consistent();
}

#[test]
fn natural_composition_end_merges_remote_instead_of_overwriting_it() {
    let (base, snapshot) = editor_seed();
    let mut local = session_editor(Access::Edit, TransportKind::Direct, snapshot);
    connect(&mut local);
    let key = text_key(&local);
    start_composition(&mut local, key);
    let remote = lexical_loro::fork_doc(&base, 60).unwrap();
    native_text(&remote, 0).insert(0, "遠").unwrap();
    remote.commit();
    let update = remote
        .export(ExportMode::updates(&base.oplog_vv()))
        .unwrap();
    wire(
        &mut local,
        sync_protocol::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::from_cooked(&update),
        },
        10,
    );
    composing_text(&mut local, key, "a😀b漢字", 20, true);
    assert_eq!(
        local.surface().state().view().text_content(key),
        "遠a😀b漢字"
    );
    assert!(
        !local
            .last_output()
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::EndComposition))
    );
    local.assert_projection_consistent();
}

#[test]
fn frame_cap_ends_composition_before_the_timer() {
    let (base, snapshot) = editor_seed();
    let mut local = session_editor(Access::Edit, TransportKind::Direct, snapshot);
    connect(&mut local);
    let key = text_key(&local);
    start_composition(&mut local, key);
    composing_text(&mut local, key, "a😀b漢字", 5, false);
    let remote = lexical_loro::fork_doc(&base, 60).unwrap();
    let text = native_text(&remote, 0);
    for count in 1..=64 {
        let before = remote.oplog_vv();
        text.insert(0, "遠").unwrap();
        remote.commit();
        let update = remote.export(ExportMode::updates(&before)).unwrap();
        wire(
            &mut local,
            sync_protocol::FromRemote::RemoteUpdate {
                update: bebop::SliceWrapper::from_cooked(&update),
            },
            10 + count,
        );
        if count < 64 {
            assert_eq!(local.surface().state().view().text_content(key), "a😀b漢字");
        }
    }
    assert!(
        local
            .last_output()
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::EndComposition))
    );
    assert_eq!(
        local.surface().state().view().text_content(key),
        format!("{}a😀b漢字", "遠".repeat(64))
    );
    local.assert_projection_consistent();
}

#[test]
fn unrelated_paragraph_imports_immediately_but_mixed_frame_waits_whole() {
    let source = default_editor_builder(EditorMode::Headless, 40)
        .initial_state(serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[
            {"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"a😀b"}]},
            {"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"other"}]}
        ]}})).unwrap()).build().unwrap();
    let base = lexical_loro::new_doc(40).unwrap();
    lexical_loro::LoroProjection::initialize(&base, source.state(), &lexical_loro::PlainPolicy, 0)
        .unwrap();
    let mut local = session_editor(
        Access::Edit,
        TransportKind::Direct,
        base.export(ExportMode::Snapshot).unwrap(),
    );
    connect(&mut local);
    let key = text_key(&local);
    start_composition(&mut local, key);
    let remote = lexical_loro::fork_doc(&base, 60).unwrap();
    native_text(&remote, 1).insert(0, "先").unwrap();
    remote.commit();
    let update = remote
        .export(ExportMode::updates(&base.oplog_vv()))
        .unwrap();
    wire(
        &mut local,
        sync_protocol::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::from_cooked(&update),
        },
        10,
    );
    assert!(
        local
            .surface()
            .state()
            .view()
            .text_content(NodeKey::ROOT)
            .contains("先other")
    );
    let before = remote.oplog_vv();
    native_text(&remote, 0).insert(0, "遠").unwrap();
    native_text(&remote, 1).insert(0, "後").unwrap();
    remote.commit();
    let update = remote.export(ExportMode::updates(&before)).unwrap();
    wire(
        &mut local,
        sync_protocol::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::from_cooked(&update),
        },
        11,
    );
    assert_eq!(local.surface().state().view().text_content(key), "a😀b");
    assert!(
        !local
            .surface()
            .state()
            .view()
            .text_content(NodeKey::ROOT)
            .contains('後')
    );
    composing_text(&mut local, key, "a😀b漢", 12, true);
    assert_eq!(local.surface().state().view().text_content(key), "遠a😀b漢");
    assert!(
        local
            .surface()
            .state()
            .view()
            .text_content(NodeKey::ROOT)
            .contains("後先other")
    );
    local.assert_projection_consistent();
    local.handle(time(13), SessionInput::Editor(Input::Undo));
    assert_eq!(local.surface().state().view().text_content(key), "遠a😀b");
    local.assert_projection_consistent();
    local.handle(time(14), SessionInput::Editor(Input::Redo));
    assert_eq!(local.surface().state().view().text_content(key), "遠a😀b漢");
    local.assert_projection_consistent();
}

#[test]
fn held_import_survives_bad_updates_and_ends_before_access_downgrade() {
    let (base, snapshot) = editor_seed();
    let mut local = session_editor(Access::Edit, TransportKind::Direct, snapshot);
    connect(&mut local);
    let key = text_key(&local);
    start_composition(&mut local, key);
    composing_text(&mut local, key, "a😀b漢", 5, false);
    let remote = lexical_loro::fork_doc(&base, 60).unwrap();
    native_text(&remote, 0).insert(0, "遠").unwrap();
    remote.commit();
    let update = remote
        .export(ExportMode::updates(&base.oplog_vv()))
        .unwrap();
    wire(
        &mut local,
        sync_protocol::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::from_cooked(&update),
        },
        10,
    );
    wire(
        &mut local,
        sync_protocol::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::from_cooked(&[1, 2, 3]),
        },
        11,
    );
    assert_eq!(local.surface().state().view().text_content(key), "a😀b漢");
    let out = local.handle(
        time(12),
        SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: false,
        })),
    );
    assert!(
        out.view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::EndComposition))
    );
    assert_eq!(local.surface().state().view().text_content(key), "遠a😀b漢");
    local.assert_projection_consistent();
}

#[test]
fn durable_wal_and_ack_complete_while_remote_editor_import_is_held() {
    use bebop::Record;
    let (base, snapshot) = editor_seed();
    let mut config = sync_config(Access::Edit, TransportKind::Direct);
    config.persistence = Persistence::Durable;
    let mut local = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: config,
            peer_ids: vec![50, 51, 52],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig::default()),
        },
        time(0),
    )
    .unwrap();
    let out = local.handle(time(0), SessionInput::Sync(SyncInput::Start));
    let load = out
        .io
        .iter()
        .find_map(|io| match io {
            IoEffect::Storage {
                id,
                op: StorageOp::Load { .. },
            } => Some(*id),
            _ => None,
        })
        .unwrap();
    local.handle(
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
    local.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    connect(&mut local);
    let key = text_key(&local);
    start_composition(&mut local, key);
    let remote = lexical_loro::fork_doc(&base, 60).unwrap();
    native_text(&remote, 0).insert(0, "遠").unwrap();
    remote.commit();
    let update = remote
        .export(ExportMode::updates(&base.oplog_vv()))
        .unwrap();
    wire(
        &mut local,
        sync_protocol::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::from_cooked(&update),
        },
        10,
    );
    composing_text(&mut local, key, "a😀b漢字", 11, false);
    let out = local.handle(
        time(12),
        SessionInput::Sync(SyncInput::Flush(RequestId(501))),
    );
    let append = out
        .io
        .iter()
        .find_map(|io| match io {
            IoEffect::Storage {
                id,
                op: StorageOp::WalAppend { record, .. },
            } => {
                assert!(!record.bytes.is_empty());
                Some(*id)
            }
            _ => None,
        })
        .unwrap();
    let out = local.handle(
        time(13),
        SessionInput::Sync(SyncInput::Storage(StorageEvent::Done {
            id: append,
            result: Ok(()),
        })),
    );
    let update_id = out
        .io
        .iter()
        .find_map(|io| match io {
            IoEffect::SocketSend { frame, .. } => {
                match sync_protocol::FromPeer::deserialize(&frame[1..]) {
                    Ok(sync_protocol::FromPeer::PeerUpdate { id, .. }) => Some(id.to_owned()),
                    _ => None,
                }
            }
            _ => None,
        })
        .expect("persisted local composition is published before the hold ends");
    wire(
        &mut local,
        sync_protocol::FromRemote::RemoteUpdateAck { id: &update_id },
        14,
    );
    assert_eq!(local.surface().state().view().text_content(key), "a😀b漢字");
    assert_eq!(
        local.surface().core.composition(),
        Composition::Composing { key }
    );
    let out = local.handle(
        time(15),
        SessionInput::Sync(SyncInput::Flush(RequestId(502))),
    );
    assert!(out.view.iter().any(|effect| matches!(
        effect,
        ViewEffect::Reply {
            request: RequestId(502),
            reply: Reply::Flush(FlushReply::Drained)
        }
    )));
    composing_text(&mut local, key, "a😀b漢字", 16, true);
    assert_eq!(
        local.surface().state().view().text_content(key),
        "遠a😀b漢字"
    );
    local.assert_projection_consistent();
}

#[test]
fn overdue_timer_admits_current_dom_text_before_merging_remote_edits() {
    let (base, snapshot) = editor_seed();
    let mut local = session_editor(Access::Edit, TransportKind::Direct, snapshot);
    connect(&mut local);
    let key = text_key(&local);
    start_composition(&mut local, key);
    let remote = lexical_loro::fork_doc(&base, 60).unwrap();
    native_text(&remote, 0).insert(0, "遠").unwrap();
    remote.commit();
    let update = remote
        .export(ExportMode::updates(&base.oplog_vv()))
        .unwrap();
    wire(
        &mut local,
        sync_protocol::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::from_cooked(&update),
        },
        10,
    );
    // No Tick arrives while the browser is throttled. Its next composition
    // input contains pre-merge DOM text and still must preserve the peer edit.
    composing_text(&mut local, key, "a😀b漢字入力", 4000, false);
    assert!(
        local
            .last_output()
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::EndComposition))
    );
    assert_eq!(
        local.surface().state().view().text_content(key),
        "遠a😀b漢字入力"
    );
    local.assert_projection_consistent();
}
