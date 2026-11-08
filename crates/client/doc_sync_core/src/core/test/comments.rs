use super::*;

#[test]
fn prepare_comment_imports_a_fresh_server_reply_before_releasing_the_fork() {
    let time = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let config = SyncConfig {
        doc: "comment-document".parse().unwrap(),
        session: SessionId(uuid_value::Uuid::from_u128(10)),
        user: UserKey("fixture-user".into()),
        transport: TransportKind::Direct,
        persistence: Persistence::Memory,
        access: Access::CommentOnly,
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
    };
    let mut core = SyncCore::new(config, time).unwrap();
    let mut doc = Doc::new(7);
    let mut out = SyncOutput::default();
    core.handle(time, &mut doc, SyncInput::Start, &mut out);
    core.handle(
        time,
        &mut doc,
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        &mut out,
    );
    core.handle(time, &mut doc, SyncInput::Ready, &mut out);
    let Connection::Connecting { conn, .. } = *core.connection() else {
        panic!("connecting");
    };
    core.handle(
        time,
        &mut doc,
        SyncInput::Socket {
            conn,
            event: SocketEvent::Opened,
        },
        &mut out,
    );
    let mut bytes = vec![];
    sync_protocol::FromRemote::RemoteInitialSync {
        snapshot: SliceWrapper::from_cooked(&[]),
        awareness: SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)
    .unwrap();
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        core.handle(
            time,
            &mut doc,
            SyncInput::Socket {
                conn,
                event: SocketEvent::Frame(frame),
            },
            &mut out,
        );
    }
    let vv = doc.oplog_vv().encode();
    bytes.clear();
    sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)
    .unwrap();
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        core.handle(
            time,
            &mut doc,
            SyncInput::Socket {
                conn,
                event: SocketEvent::Frame(frame),
            },
            &mut out,
        );
    }
    core.handle(
        time,
        &mut doc,
        SyncInput::PrepareComment(RequestId(5)),
        &mut out,
    );
    assert!(
        out.io
            .iter()
            .any(|effect| matches!(effect, IoEffect::SocketSend { .. }))
    );
    assert!(
        !out.events
            .iter()
            .any(|event| matches!(event, SyncEvent::CommentReady { .. }))
    );
    let server = loro::LoroDoc::new();
    server.set_peer_id(8).unwrap();
    server.set_record_timestamp(false);
    server.get_text("text").insert(0, "server-current").unwrap();
    server.commit_with(loro::CommitOptions::default().timestamp(0));
    let update = server
        .export(loro::ExportMode::updates(&doc.oplog_vv()))
        .unwrap();
    bytes.clear();
    sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&update),
    }
    .serialize(&mut bytes)
    .unwrap();
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        core.handle(
            time,
            &mut doc,
            SyncInput::Socket {
                conn,
                event: SocketEvent::Frame(frame),
            },
            &mut out,
        );
    }
    assert_eq!(doc.loro.get_text("text").to_string(), "server-current");
    assert!(out.events.iter().any(|event| matches!(
        event,
        SyncEvent::CommentReady {
            request: RequestId(5)
        }
    )));
    assert!(
        doc.calls
            .borrow()
            .imports
            .iter()
            .all(|origin| *origin == ImportOrigin::Catchup)
    );
    assert!(core.wal().entries.is_empty());
}

#[test]
fn staging_during_an_inflight_catchup_waits_for_the_next_round() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::PrepareComment(RequestId(1)));
    h.settle();
    assert!(
        !h.out
            .events
            .iter()
            .any(|event| matches!(event, SyncEvent::CommentReady { .. }))
    );
    h.settle();
    assert!(h.out.events.iter().any(|event| matches!(
        event,
        SyncEvent::CommentReady {
            request: RequestId(1)
        }
    )));
    h.send(SyncInput::Tick);
    assert!(
        !h.out
            .events
            .iter()
            .any(|event| matches!(event, SyncEvent::CommentReady { .. }))
    );
}

#[test]
fn staging_forces_the_window_but_refuses_a_writing_local_row() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.settle();
    h.edit();
    let peers_before = h.core.registered_peers.clone();
    h.send(SyncInput::PrepareComment(RequestId(2)));
    h.settle();
    assert!(h.out.io.iter().any(|effect| matches!(
        effect,
        IoEffect::Storage {
            op: StorageOp::WalAppend { .. },
            ..
        }
    )));
    assert!(h.out.events.iter().any(|event| matches!(
        event,
        SyncEvent::Reply {
            request: RequestId(2),
            reply: Reply::Comment(CommentReply::Refused(CommentRefusal::LocalChangesPending))
        }
    )));
    assert_eq!(h.core.registered_peers, peers_before);
}

#[test]
fn comment_stage_times_out_and_does_not_revive_on_a_late_reply() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.send(SyncInput::PrepareComment(RequestId(3)));
    h.at(10000, SyncInput::Tick);
    assert!(h.out.events.iter().any(|event| matches!(
        event,
        SyncEvent::Reply {
            request: RequestId(3),
            reply: Reply::Comment(CommentReply::Refused(CommentRefusal::CatchupFailed))
        }
    )));
    h.settle();
    assert!(
        !h.out
            .events
            .iter()
            .any(|event| matches!(event, SyncEvent::CommentReady { .. }))
    );
    assert!(h.core.staged_comments.is_empty());
}

#[test]
fn reset_and_stop_cancel_staging_exactly_once() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.send(SyncInput::PrepareComment(RequestId(4)));
    h.send(SyncInput::Reset);
    assert!(h.out.events.iter().any(|event| matches!(
        event,
        SyncEvent::Reply {
            request: RequestId(4),
            reply: Reply::Comment(CommentReply::Refused(CommentRefusal::CatchupFailed))
        }
    )));
    assert!(h.core.staged_comments.is_empty());
    h.send(SyncInput::Stop(RequestId(6)));
    assert!(!h.out.events.iter().any(|event| matches!(
        event,
        SyncEvent::Reply {
            request: RequestId(4),
            ..
        }
    )));
}

#[test]
fn successful_projection_resyncs_charge_the_shared_budget_without_network_fetch() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    for _ in 0..3 {
        h.send(SyncInput::ProjectionResynced);
        assert_eq!(h.core.phase(), Phase::Running);
        assert!(!h.out.io.iter().any(|io| matches!(
            io,
            IoEffect::SocketSend { .. } | IoEffect::SocketConnect { .. }
        )));
    }
    h.send(SyncInput::ProjectionResynced);
    assert_eq!(h.core.phase(), Phase::Stopped);
}
