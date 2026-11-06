use super::*;
use crate::domain::ports::{MockDownstreamFactory, MockEdgeSink};
use bebop::{Record, SliceWrapper};
use sync_service_bebop_schema::ToRouter;

fn conn(gateway: &str, id: &str) -> ConnectionId {
    ConnectionId {
        gateway: gateway.into(),
        conn: id.into(),
    }
}

fn frame_event(c: &ConnectionId, inner: ToRouter<'_>) -> Event {
    let mut payload = Vec::new();
    inner.serialize(&mut payload).unwrap();
    Event::Edge(EdgeEvent::Frame {
        conn: c.clone(),
        payload,
    })
}

fn subscribe(c: &ConnectionId, doc: &str) -> Event {
    frame_event(
        c,
        ToRouter::RouterSubscribe {
            doc_id: doc,
            token: "tok",
        },
    )
}

fn doc_frame(c: &ConnectionId, doc: &str, bytes: &[u8]) -> Event {
    frame_event(
        c,
        ToRouter::RouterFrame {
            doc_id: doc,
            payload: SliceWrapper::Raw(bytes),
        },
    )
}

/// A factory that hands out channels and records what it opened.
fn recording_factory(
    capacity: usize,
) -> (
    MockDownstreamFactory,
    std::sync::Arc<std::sync::Mutex<Vec<(DocId, mpsc::Receiver<Vec<u8>>)>>>,
) {
    let opened = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let record = std::sync::Arc::clone(&opened);
    let mut factory = MockDownstreamFactory::new();
    factory
        .expect_open()
        .returning(move |_conn, doc, _token, _epoch| {
            let (tx, rx) = mpsc::channel(capacity);
            record.lock().unwrap().push((doc, rx));
            tx
        });
    (factory, opened)
}

#[tokio::test]
async fn frames_buffer_into_the_downstream_channel_before_dial_completes() {
    let (factory, opened) = recording_factory(8);
    let mut router = Router::new(std::sync::Arc::new(MockEdgeSink::new()), factory);

    let c = conn("g1", "c1");
    router.handle(subscribe(&c, "doc-a")).await;
    router.handle(doc_frame(&c, "doc-a", b"first")).await;
    router.handle(doc_frame(&c, "doc-a", b"second")).await;

    let mut opened = opened.lock().unwrap();
    let (doc, rx) = &mut opened[0];
    assert_eq!(doc.as_str(), "doc-a");
    assert_eq!(rx.try_recv().unwrap(), b"first");
    assert_eq!(rx.try_recv().unwrap(), b"second");
}

#[tokio::test]
async fn resubscribe_is_idempotent_and_reacks() {
    let (factory, opened) = recording_factory(8);
    let mut sink = MockEdgeSink::new();
    // Exactly one re-ack for the duplicate subscribe.
    sink.expect_deliver()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let mut router = Router::new(std::sync::Arc::new(sink), factory);

    let c = conn("g1", "c1");
    router.handle(subscribe(&c, "doc-a")).await;
    router.handle(subscribe(&c, "doc-a")).await;

    assert_eq!(opened.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn disconnect_tears_down_every_route_for_the_connection() {
    let (factory, opened) = recording_factory(8);
    let mut router = Router::new(std::sync::Arc::new(MockEdgeSink::new()), factory);

    let c = conn("g1", "c1");
    router.handle(subscribe(&c, "doc-a")).await;
    router.handle(subscribe(&c, "doc-b")).await;
    router
        .handle(Event::Edge(EdgeEvent::Disconnected { conn: c.clone() }))
        .await;

    // Dropped senders close the channels — the downstream pumps see hangup.
    let mut opened = opened.lock().unwrap();
    for (_, rx) in opened.iter_mut() {
        assert!(matches!(
            rx.try_recv(),
            Err(mpsc::error::TryRecvError::Disconnected)
        ));
    }
    // And frames after disconnect are dropped, not routed.
    router.handle(doc_frame(&c, "doc-a", b"late")).await;
}

#[tokio::test]
async fn gateway_lost_drops_only_that_gateways_connections() {
    let (factory, opened) = recording_factory(8);
    let mut router = Router::new(std::sync::Arc::new(MockEdgeSink::new()), factory);

    let dead = conn("g1", "c1");
    let alive = conn("g2", "c2");
    router.handle(subscribe(&dead, "doc-a")).await;
    router.handle(subscribe(&alive, "doc-b")).await;
    router
        .handle(Event::Edge(EdgeEvent::GatewayLost {
            gateway: "g1".into(),
        }))
        .await;

    let mut opened = opened.lock().unwrap();
    let (_, dead_rx) = &mut opened[0];
    assert!(matches!(
        dead_rx.try_recv(),
        Err(mpsc::error::TryRecvError::Disconnected)
    ));
    let (_, alive_rx) = &mut opened[1];
    assert!(matches!(
        alive_rx.try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn unknown_doc_frames_and_garbage_are_dropped_without_panic() {
    let (factory, _opened) = recording_factory(8);
    let mut router = Router::new(std::sync::Arc::new(MockEdgeSink::new()), factory);

    let c = conn("g1", "c1");
    router.handle(doc_frame(&c, "never-subscribed", b"x")).await;
    router
        .handle(Event::Edge(EdgeEvent::Frame {
            conn: c,
            payload: vec![0xde, 0xad],
        }))
        .await;
}

#[tokio::test]
async fn downstream_closed_forgets_the_route_so_resubscribe_reopens() {
    let (factory, opened) = recording_factory(8);
    let mut sink = MockEdgeSink::new();
    sink.expect_deliver()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let mut router = Router::new(std::sync::Arc::new(sink), factory);

    let c = conn("g1", "c1");
    router.handle(subscribe(&c, "doc-a")).await;
    router
        .handle(Event::DownstreamClosed {
            conn: c.clone(),
            doc: DocId("doc-a".into()),
            epoch: 1,
        })
        .await;
    router.handle(subscribe(&c, "doc-a")).await;

    assert_eq!(opened.lock().unwrap().len(), 2);
}
