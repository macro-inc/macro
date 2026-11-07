use super::*;
fn now(ms: u64) -> Now {
    Now {
        mono: Millis(ms),
        wall: UnixMillis(i64::try_from(ms).unwrap()),
    }
}
fn setup() -> (RouterCore, RouterOutput) {
    let mut r = RouterCore::new(RouterConfig::default(), now(0));
    let mut o = RouterOutput::default();
    r.attach(doc(), Some(SyncToken::new("test-token".into())), &mut o);
    r.handle(
        now(0),
        RouterInput::Socket {
            conn: ConnId(1),
            event: SocketEvent::Opened,
        },
        &mut o,
    );
    (r, o)
}
fn doc() -> SyncDocId {
    "document-test".parse().unwrap()
}
fn incoming(r: &mut RouterCore, o: &mut RouterOutput, m: sync_protocol::FromRouter<'_>) {
    let mut bytes = vec![];
    m.serialize(&mut bytes).unwrap();
    let conn = r.connection.conn().unwrap();
    r.handle(
        now(0),
        RouterInput::Socket {
            conn,
            event: SocketEvent::Frame(bytes),
        },
        o,
    )
}
fn subscribed(r: &mut RouterCore, o: &mut RouterOutput) {
    incoming(
        r,
        o,
        sync_protocol::FromRouter::RouterSubscribed {
            doc_id: "document-test",
        },
    );
}
#[test]
fn s7_083_routes_share_socket_and_have_independent_tokens() {
    let (mut r, mut o) = setup();
    r.attach("second-document".parse().unwrap(), None, &mut o);
    assert!(
        o.io.iter()
            .any(|e| matches!(e,IoEffect::FetchToken{doc,..} if doc.as_str()=="second-document"))
    );
    assert!(
        !o.io
            .iter()
            .any(|e| matches!(e, IoEffect::RouterConnect { .. }))
    );
    assert_eq!(r.routes.len(), 2);
}
#[test]
fn s7_084_holds_frames_until_subscribed() {
    let (mut r, mut o) = setup();
    r.handle(
        now(0),
        RouterInput::Send {
            doc: doc(),
            frame: vec![1, 8],
        },
        &mut o,
    );
    assert!(o.io.is_empty());
    assert_eq!(r.routes[&doc()].pending.len(), 1);
    subscribed(&mut r, &mut o);
    assert_eq!(r.routes[&doc()].pending.len(), 0);
    assert!(o.io.iter().any(|e|matches!(e,IoEffect::SocketSend{frame,..} if matches!(sync_protocol::ToRouter::deserialize(frame),Ok(sync_protocol::ToRouter::RouterFrame{..})))));
}
#[test]
fn s7_085_route_retry_exponent_caps_at_eight_seconds() {
    let (mut r, mut o) = setup();
    for i in 0..8 {
        r.now = now(i * 10000);
        r.drop_route(&doc(), 4401, &mut o);
        let RouteState::Dropped { at } = r.routes[&doc()].state else {
            panic!()
        };
        assert_eq!(at.0 - i * 10000, (500u64 << i.min(4)).min(8000));
    }
}
#[test]
fn s7_086_new_owner_resubscribes_existing_open_route() {
    let (mut r, mut o) = setup();
    subscribed(&mut r, &mut o);
    r.attach(doc(), None, &mut o);
    assert_eq!(r.routes[&doc()].owners, 2);
    assert!(
        o.to_sessions
            .iter()
            .any(|(_, e)| matches!(e, RouteEvent::Closed { .. }))
    );
    assert!(
        o.io.iter()
            .any(|e| matches!(e, IoEffect::FetchToken { .. }))
    );
}
#[test]
fn s7_087_route_failure_close_codes_are_preserved() {
    let (mut r, mut o) = setup();
    incoming(
        &mut r,
        &mut o,
        sync_protocol::FromRouter::RouterSubscribeFailed {
            doc_id: "document-test",
            reason: "denied",
        },
    );
    assert!(
        o.to_sessions
            .iter()
            .any(|(_, e)| matches!(e, RouteEvent::Closed { code: 4401, .. }))
    );
    incoming(
        &mut r,
        &mut o,
        sync_protocol::FromRouter::RouterDocClosed {
            doc_id: "document-test",
            reason: "gone",
        },
    );
    assert!(
        o.to_sessions
            .iter()
            .any(|(_, e)| matches!(e, RouteEvent::Closed { code: 4000, .. }))
    );
}
#[test]
fn s7_088_reconnect_resubscribes_all_routes() {
    let (mut r, mut o) = setup();
    subscribed(&mut r, &mut o);
    r.attach("second-document".parse().unwrap(), None, &mut o);
    r.handle(
        now(0),
        RouterInput::Socket {
            conn: ConnId(1),
            event: SocketEvent::Closed {
                code: 1006,
                clean: false,
            },
        },
        &mut o,
    );
    r.handle(now(500), RouterInput::Tick, &mut o);
    r.handle(
        now(500),
        RouterInput::Socket {
            conn: ConnId(2),
            event: SocketEvent::Opened,
        },
        &mut o,
    );
    assert_eq!(
        o.io.iter()
            .filter(|e| matches!(e, IoEffect::FetchToken { .. }))
            .count(),
        2
    );
    assert!(r.connection.synced());
}
#[test]
fn s7_089_reassembly_is_cleared_on_resubscribe() {
    let (mut r, mut o) = setup();
    subscribed(&mut r, &mut o);
    incoming(
        &mut r,
        &mut o,
        sync_protocol::FromRouter::RouterDocFrame {
            doc_id: "document-test",
            payload: SliceWrapper::from_cooked(&[0, 8]),
        },
    );
    assert!(o.to_sessions.is_empty());
    r.attach(doc(), Some(SyncToken::new("test-token".into())), &mut o);
    subscribed(&mut r, &mut o);
    incoming(
        &mut r,
        &mut o,
        sync_protocol::FromRouter::RouterDocFrame {
            doc_id: "document-test",
            payload: SliceWrapper::from_cooked(&[1, 9]),
        },
    );
    assert!(
        o.to_sessions
            .iter()
            .any(|(_, e)| matches!(e,RouteEvent::Frame{frame,..} if frame==&vec![1,9]))
    );
}
#[test]
fn detach_keeps_shared_socket_until_last_owner() {
    let (mut r, mut o) = setup();
    r.attach(doc(), None, &mut o);
    r.detach(&doc(), &mut o);
    assert!(
        !o.io
            .iter()
            .any(|e| matches!(e, IoEffect::SocketClose { .. }))
    );
    r.detach(&doc(), &mut o);
    assert!(
        o.io.iter()
            .any(|e| matches!(e, IoEffect::SocketClose { .. }))
    );
}
