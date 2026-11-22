use super::*;

#[test]
fn late_stop_acknowledges_revocation_before_or_during_start_for_every_access() {
    for persistence in [Persistence::Memory, Persistence::Durable] {
        for access in [Access::Edit, Access::Read, Access::CommentOnly] {
            for started in [false, true] {
                let mut cfg = config(TransportKind::Direct, persistence);
                cfg.access = access;
                cfg.initial_token = None;
                let mut h = Harness {
                    core: SyncCore::new(cfg, now(0)).unwrap(),
                    doc: Doc::new(1),
                    out: SyncOutput::default(),
                    time: 0,
                };
                if started {
                    h.start();
                }
                h.send(SyncInput::Authorization(AuthorizationState {
                    current: false,
                    can_write: false,
                    can_comment: false,
                }));
                assert_eq!(h.core.phase(), Phase::Stopped);
                h.send(SyncInput::Stop(RequestId(u32::MAX)));
                assert!(
                    h.out.events.iter().any(|event| matches!(
                        event,
                        SyncEvent::Reply {
                            request: RequestId(u32::MAX),
                            reply: Reply::Stopped
                        }
                    )),
                    "{persistence:?}/{access:?}/{started}"
                );
                assert!(h.out.io.is_empty());
                h.send(SyncInput::Start);
                assert_eq!(h.core.phase(), Phase::Stopped);
                assert!(h.out.io.is_empty());
                h.send(SyncInput::Stop(RequestId(u32::MAX)));
                assert!(h.out.events.iter().any(|event| matches!(
                    event,
                    SyncEvent::Reply {
                        request: RequestId(u32::MAX),
                        reply: Reply::Stopped
                    }
                )));
            }
        }
    }
}

#[test]
fn late_stop_requests_share_the_original_terminal_append_barrier() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.settle();
    h.edit();
    let expected = h.doc.oplog_vv();
    h.send(SyncInput::Authorization(AuthorizationState {
        current: false,
        can_write: false,
        can_comment: false,
    }));
    let append = h
        .out
        .io
        .iter()
        .find_map(|effect| match effect {
            IoEffect::Storage {
                id,
                op: StorageOp::WalAppend { record, .. },
            } => Some((*id, record.bytes.clone())),
            _ => None,
        })
        .expect("terminal append");
    for request in [u32::MAX, 17, u32::MAX] {
        h.send(SyncInput::Stop(RequestId(request)));
        assert!(h.out.events.iter().all(|event| !matches!(
            event,
            SyncEvent::Reply {
                reply: Reply::Stopped,
                ..
            }
        )));
        assert!(
            h.out.io.is_empty(),
            "late stop must not issue another append or close"
        );
    }
    h.done(append.0);
    let replies = h
        .out
        .events
        .iter()
        .filter_map(|event| match event {
            SyncEvent::Reply {
                request,
                reply: Reply::Stopped,
            } => Some(request.0),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(replies, vec![u32::MAX, 17]);
    assert_eq!(h.core.wal.entries.len(), 1);
    assert_eq!(h.core.wal.entries[0].bytes.as_ref(), append.1.as_slice());
    let cold = Doc::new(3);
    cold.loro.import(&append.1).unwrap();
    assert_eq!(cold.oplog_vv(), expected);
}

#[test]
fn stop_before_start_acknowledges_without_starting_for_every_access() {
    for persistence in [Persistence::Memory, Persistence::Durable] {
        for access in [Access::Edit, Access::Read, Access::CommentOnly] {
            let mut cfg = config(TransportKind::Direct, persistence);
            cfg.access = access;
            cfg.initial_token = None;
            let mut h = Harness {
                core: SyncCore::new(cfg, now(0)).unwrap(),
                doc: Doc::new(1),
                out: SyncOutput::default(),
                time: 0,
            };
            for _ in 0..2 {
                h.send(SyncInput::Stop(RequestId(u32::MAX)));
                assert_eq!(h.core.phase(), Phase::Stopped);
                assert!(h.out.events.iter().any(|event| matches!(
                    event,
                    SyncEvent::Reply {
                        request: RequestId(u32::MAX),
                        reply: Reply::Stopped
                    }
                )));
                assert!(h.out.io.iter().all(|effect| !matches!(
                    effect,
                    IoEffect::Storage { .. } | IoEffect::SocketConnect { .. }
                )));
            }
            h.send(SyncInput::Start);
            assert_eq!(h.core.phase(), Phase::Stopped);
            assert!(h.out.io.is_empty());
        }
    }
}
