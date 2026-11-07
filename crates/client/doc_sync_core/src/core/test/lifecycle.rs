use super::*;

#[test]
fn s7_001_start_is_idempotent_and_ready_requires_seed() {
    let mut h = Harness::new(TransportKind::None, Persistence::Memory);
    h.start();
    h.send(SyncInput::Ready);
    assert_eq!(h.core.phase(), Phase::Loading);
    h.start();
    assert!(h.out.io.is_empty());
    h.seed();
    assert_eq!(h.core.phase(), Phase::Running);
}
#[test]
fn s7_005_register_peer_on_sync() {
    let h = Harness::running(TransportKind::Direct, Persistence::Memory);
    assert_eq!(h.core.registered_peers, vec![1]);
    assert!(wire(&h.out).iter().any(|b| matches!(
        sync_protocol::FromPeer::deserialize(b),
        Ok(sync_protocol::FromPeer::PeerRegisterId { peerid: 1 })
    )));
}
#[test]
fn s7_007_start_convergence() {
    let h = Harness::running(TransportKind::Direct, Persistence::Memory);
    assert_eq!(h.core.convergence.as_ref().unwrap().attempt, 1);
    assert_eq!(h.core.since.len(), 1);
}
#[test]
fn s7_008_stop_is_terminal() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::Stop(RequestId(1)));
    assert_eq!(h.core.phase(), Phase::Stopped);
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            reply: Reply::Stopped,
            ..
        }
    )));
    h.send(SyncInput::Start);
    assert_eq!(h.core.phase(), Phase::Stopped);
}
#[test]
fn s7_015_stale_and_stopped_packets_are_ignored() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::Socket {
        conn: ConnId(0),
        event: SocketEvent::Frame(vec![9]),
    });
    assert!(h.doc.calls.borrow().imports.is_empty());
    h.send(SyncInput::Stop(RequestId(1)));
    h.send(SyncInput::Socket {
        conn: ConnId(1),
        event: SocketEvent::Frame(vec![9]),
    });
    assert!(h.doc.calls.borrow().imports.is_empty());
}
#[test]
fn s7_018_reconnect_converges_again() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.close(1006);
    h.at(500, SyncInput::Tick);
    token(&mut h);
    h.open();
    assert!(h.core.convergence.is_some());
}
#[test]
fn s7_019_convergence_coalesces_and_reruns() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.request_since(1, now(0), &h.doc, &mut h.out);
    assert_eq!(h.core.since.len(), 1);
    assert!(h.core.convergence.as_ref().unwrap().rerun);
    h.settle();
    assert_eq!(h.core.since.len(), 1);
    assert!(!h.core.convergence.as_ref().unwrap().rerun);
}
#[test]
fn s7_020_convergence_retries_three_times_with_delay() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    for (timeout, retry, attempt) in [(10000, 12000, 2), (22000, 24000, 3)] {
        h.at(timeout, SyncInput::Tick);
        assert_eq!(h.core.convergence_retry, Some((attempt, Millis(retry))));
        h.at(retry, SyncInput::Tick);
        assert_eq!(h.core.convergence.as_ref().unwrap().attempt, attempt);
    }
    h.at(34000, SyncInput::Tick);
    assert!(h.core.convergence_retry.is_none());
}
#[test]
fn s7_021_empty_catchup_does_not_import_or_retry() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    assert!(h.doc.calls.borrow().imports.is_empty());
    assert!(h.core.convergence.is_none());
    assert!(h.core.convergence_retry.is_none());
}
#[test]
fn s7_022_pending_reply_schedules_bounded_retry() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.doc.faults.push_back(Ok(Imported {
        changed: false,
        new_ops: false,
        pending: true,
    }));
    let vv = h.core.since.back().unwrap().vv.clone();
    h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&[1]),
    });
    assert_eq!(h.core.convergence_retry, Some((2, Millis(2000))));
}
#[test]
fn s7_049_protocol_timeouts_are_preserved() {
    let t = Timeouts::default();
    assert_eq!(
        (t.initial_sync, t.ack, t.snapshot, t.request_since),
        (Millis(10000), Millis(5000), Millis(10000), Millis(10000))
    );
}
#[test]
fn s7_050_heartbeat_starts_after_handshake() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.start();
    h.send(SyncInput::Socket {
        conn: ConnId(1),
        event: SocketEvent::Opened,
    });
    assert!(matches!(
        h.core.connection(),
        Connection::AwaitingInitialSync {
            heartbeat: None,
            ..
        }
    ));
    h.remote(sync_protocol::FromRemote::RemoteInitialSync {
        snapshot: SliceWrapper::from_cooked(&[]),
        awareness: SliceWrapper::from_cooked(&[]),
    });
    assert!(matches!(h.core.connection(), Connection::Synced { .. }));
}
#[test]
fn s7_051_late_initial_sync_seeds_loading_session() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.start();
    h.send(SyncInput::Socket {
        conn: ConnId(1),
        event: SocketEvent::Opened,
    });
    h.at(10000, SyncInput::Tick);
    h.remote(sync_protocol::FromRemote::RemoteInitialSync {
        snapshot: SliceWrapper::from_cooked(&[]),
        awareness: SliceWrapper::from_cooked(&[]),
    });
    assert!(h.core.seeded);
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Seeded {
            kind: SeedKind::Remote,
            ..
        }
    )));
}
#[test]
fn s7_052_no_push_before_initial_sync() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.start();
    h.seed();
    h.append();
    assert!(h.core.push.is_none());
    assert_eq!(h.core.wal.entries.len(), 1);
}
#[test]
fn s7_053_ack_must_match_inflight_id() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    h.remote(sync_protocol::FromRemote::RemoteUpdateAck { id: "unknown" });
    assert!(h.core.push.is_some());
    h.ack();
    assert!(h.core.push.is_none());
    assert!(h.core.is_delivered(WalSeq(1)));
}
#[test]
fn s7_054_disconnect_releases_push() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    h.close(1006);
    assert!(h.core.push.is_none());
    assert!(!h.core.is_delivered(WalSeq(1)));
}
#[test]
fn s7_057_reconnect_registers_every_used_peer() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.registered_peers.push(2);
    h.close(1006);
    h.at(500, SyncInput::Tick);
    token(&mut h);
    h.open();
    let count = wire(&h.out)
        .iter()
        .filter(|b| {
            matches!(
                sync_protocol::FromPeer::deserialize(b),
                Ok(sync_protocol::FromPeer::PeerRegisterId { .. })
            )
        })
        .count();
    assert_eq!(count, 2);
}
#[test]
fn s7_058_snapshot_request_times_out() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::RequestSnapshot(RequestId(9)));
    h.at(10000, SyncInput::Tick);
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            request: RequestId(9),
            reply: Reply::Snapshot(Err(RequestFailure::Timeout))
        }
    )));
}
#[test]
fn s7_059_since_reply_uses_exact_vector_bytes() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&[255]),
        update: SliceWrapper::from_cooked(&[]),
    });
    assert!(h.core.convergence.is_some());
    h.settle();
    assert!(h.core.convergence.is_none());
}
#[test]
fn s7_060_online_does_not_reconnect_live_socket() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::Host(HostSignal::Online));
    assert!(!h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::SocketConnect { .. } | IoEffect::FetchToken { .. }
    )));
}
#[test]
fn s7_061_loading_drops_updates_and_later_converges() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.start();
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&[1]),
    });
    assert!(h.doc.calls.borrow().imports.is_empty());
    h.seed();
    h.open();
    assert!(h.core.convergence.is_some());
}
#[test]
fn s7_062_close_leaves_synced_state() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.close(1006);
    assert!(!h.core.connection.synced());
    assert!(matches!(h.core.connection(), Connection::Backoff { .. }));
}
#[test]
fn s7_064_stale_token_callback_cannot_open_socket() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.core.config.initial_token = None; // Connection settings still owns its initial token; force a fresh request.
    h.core.connection.start(now(0), true, &mut h.out.io);
    h.send(SyncInput::Token(TokenEvent::Fetched {
        attempt: 999,
        token: SyncToken::new("test-only-token".into()),
        access: WriteAccess::Full,
    }));
    assert!(matches!(
        h.core.connection(),
        Connection::Authorizing { .. }
    ));
}
#[test]
fn s7_065_backoff_is_exponential_and_resets_on_open() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.close(1006);
    assert!(matches!(
        h.core.connection(),
        Connection::Backoff {
            attempt: 1,
            retry_at: Millis(500)
        }
    ));
    h.at(500, SyncInput::Tick);
    token(&mut h);
    h.open();
    h.close(1006);
    assert!(matches!(
        h.core.connection(),
        Connection::Backoff {
            attempt: 1,
            retry_at: Millis(1000)
        }
    ));
}
#[test]
fn s7_066_edit_revives_gave_up() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.connection.state = Connection::GaveUp { attempts: 20 };
    h.edit();
    assert!(matches!(
        h.core.connection(),
        Connection::Authorizing { .. }
    ));
}
#[test]
fn s7_067_duplicate_handshake_reconverges_without_reseed() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.doc.edit("local");
    let vv = h.doc.oplog_vv();
    h.remote(sync_protocol::FromRemote::RemoteInitialSync {
        snapshot: SliceWrapper::from_cooked(&[255]),
        awareness: SliceWrapper::from_cooked(&[]),
    });
    assert_eq!(h.doc.oplog_vv(), vv);
    assert!(h.core.convergence.is_some());
}
#[test]
fn s7_068_reconnect_rederives_pending_wal_intent() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    let old = h.core.push.as_ref().unwrap().id.clone();
    h.close(1006);
    h.at(525, SyncInput::Tick);
    token(&mut h);
    h.open();
    assert_ne!(h.core.push.as_ref().unwrap().id, old);
}
#[test]
fn s7_069_third_missed_pong_closes_connection() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    for t in [10000, 15000, 20000, 25000, 30000, 35000] {
        h.at(t, SyncInput::Tick);
    }
    assert!(matches!(h.core.connection(), Connection::Backoff { .. }));
    assert!(
        h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::SocketClose { code: 1000, .. }))
    );
}
#[test]
fn s7_070_pong_resets_missed_count() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.at(10000, SyncInput::Tick);
    h.at(15000, SyncInput::Tick);
    h.send(SyncInput::Socket {
        conn: ConnId(1),
        event: SocketEvent::Text("pong".into()),
    });
    assert!(matches!(
        h.core.connection(),
        Connection::Synced {
            heartbeat: Heartbeat::Waiting {
                missed: 0,
                next_ping_at: Millis(20000)
            },
            ..
        }
    ));
}
#[test]
fn s7_072_online_while_connecting_is_noop() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.start();
    h.send(SyncInput::Host(HostSignal::Online));
    assert!(h.out.io.is_empty());
    assert!(matches!(
        h.core.connection(),
        Connection::Connecting {
            conn: ConnId(1),
            ..
        }
    ));
}
#[test]
fn s7_074_token_failure_backs_off() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.core.connection.start(now(0), true, &mut h.out.io);
    let Connection::Authorizing { attempt, .. } = *h.core.connection() else {
        panic!()
    };
    h.send(SyncInput::Token(TokenEvent::Failed { attempt }));
    assert!(matches!(h.core.connection(), Connection::Backoff { .. }));
}
#[test]
fn s7_075_connect_has_deadline() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.start();
    h.at(15000, SyncInput::Tick);
    assert!(matches!(h.core.connection(), Connection::Backoff { .. }));
}
#[test]
fn s7_076_framing_preserves_large_messages() {
    let bytes = vec![17; 1_800_001];
    let frames = sync_protocol::framing::into_frames(&bytes, 900000);
    assert_eq!(frames.len(), 3);
    let mut r = sync_protocol::framing::Reassembler::default();
    let mut result = None;
    for f in frames {
        result = r.push(&f).unwrap();
    }
    assert_eq!(result.unwrap(), bytes);
}
#[test]
fn s7_078_initial_token_only_first_connect() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.start();
    assert!(
        h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::SocketConnect { .. }))
    );
    h.close(1006);
    h.at(500, SyncInput::Tick);
    assert!(
        h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::FetchToken { .. }))
    );
}
#[test]
fn s7_079_traceparent_is_forwarded() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.start();
    assert!(
        h.out.io.iter().any(
            |e| matches!(e,IoEffect::SocketConnect{traceparent:Some(t),..} if t=="trace-test")
        )
    );
}
#[test]
fn s7_080_revoked_authorization_is_terminal() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::Authorization(AuthorizationState {
        current: false,
        can_write: true,
        can_comment: true,
    }));
    assert!(matches!(
        h.core.connection(),
        Connection::Closed(CloseReason::Unauthorized)
    ));
}
#[test]
fn s7_081_edit_keeps_backoff_schedule() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.close(1006);
    h.edit();
    assert!(matches!(
        h.core.connection(),
        Connection::Backoff {
            retry_at: Millis(500),
            ..
        }
    ));
}
#[test]
fn s7_082_readonly_blocks_push_and_parks_rows() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::Authorization(AuthorizationState {
        current: true,
        can_write: false,
        can_comment: false,
    }));
    h.doc.edit("already committed");
    h.core.append_local(now(0), &mut h.doc, &mut h.out);
    assert!(h.core.push.is_none());
    assert_eq!(h.core.parked(), vec![(WalSeq(1), ParkReason::ReadOnly)]);
}
#[test]
fn s7_108_memory_no_transport_flushes_without_io() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    h.edit();
    h.send(SyncInput::Flush(RequestId(1)));
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            reply: Reply::Flush(FlushReply::Drained),
            ..
        }
    )));
    assert!(h.out.io.is_empty());
}
#[test]
fn s7_111_retry_reads_fresh_vector() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    let old = h.core.since.back().unwrap().vv.clone();
    h.at(10000, SyncInput::Tick);
    h.doc.edit("new");
    h.at(12000, SyncInput::Tick);
    assert_ne!(h.core.since.back().unwrap().vv, old);
}
#[test]
fn s7_112_reconnect_catchup_uses_connect_parent() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.close(1006);
    h.at(500, SyncInput::Tick);
    token(&mut h);
    h.open();
    let parent = h.core.connect_span.unwrap().0;
    assert!(h.out.io.iter().any(|e|matches!(e,IoEffect::Telemetry(TelemetryRecord{kind:TelemetryKind::Start{name:"doc.sync.catchup"},attrs,..}) if attrs.iter().any(|(k,v)|*k=="parent_span" && matches!(v,AttrValue::U64(n) if *n==parent)))));
}
#[test]
fn s7_117_repeated_unauthorized_close_is_terminal() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.close(1008);
    token(&mut h);
    h.open();
    h.close(1008);
    assert!(matches!(
        h.core.connection(),
        Connection::Closed(CloseReason::Unauthorized)
    ));
}
#[test]
fn s7_118_nonzero_final_flag_and_empty_frame() {
    let mut r = sync_protocol::framing::Reassembler::default();
    assert_eq!(r.push(&[7, 1, 2]).unwrap(), Some(vec![1, 2]));
    assert!(r.push(&[]).is_err());
}
#[test]
fn s7_119_reset_before_ready_is_deferred() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    h.start();
    h.send(SyncInput::Reset);
    assert!(h.core.reset_requested);
    assert!(h.core.reset.is_none());
    h.seed();
    assert!(h.core.reset.is_some());
}
fn token(h: &mut Harness) {
    let Connection::Authorizing { attempt, .. } = *h.core.connection() else {
        panic!("expected authorization")
    };
    h.send(SyncInput::Token(TokenEvent::Fetched {
        attempt,
        token: SyncToken::new("fresh-test-token".into()),
        access: WriteAccess::Full,
    }));
}
fn wire(out: &SyncOutput) -> Vec<Vec<u8>> {
    let mut r = sync_protocol::framing::Reassembler::default();
    out.io
        .iter()
        .filter_map(|e| {
            if let IoEffect::SocketSend { frame, .. } = e {
                r.push(frame).unwrap()
            } else {
                None
            }
        })
        .collect()
}

#[test]
fn s7_003_read_session_ignores_local_change_notification() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    h.core.config.access = Access::Read;
    h.core.effective_access = Access::Read;
    h.doc.edit("unexpected host mutation");
    h.send(SyncInput::LocalChanged);
    h.at(25, SyncInput::Tick);
    assert!(h.core.wal.entries.is_empty());
}
#[test]
fn s7_063_host_hidden_flushes_pending_edit_immediately() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    h.edit();
    h.send(SyncInput::Host(HostSignal::Hidden));
    assert_eq!(h.core.wal.entries.len(), 1);
    assert!(h.core.wal.append_due.is_none());
}
#[test]
fn routed_sessions_do_not_schedule_physical_heartbeats() {
    let mut h = Harness::running(TransportKind::Routed, Persistence::Memory);
    h.core.connection.establish(ConnId(1), now(0));
    h.core.snapshot_due = None;
    h.at(10000, SyncInput::Tick);
    assert_eq!(h.out.wake_at, None);
}
