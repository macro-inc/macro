use super::*;
use crate::domain::ports::{MockDownstreamFactory, MockEdgeSink};
use bebop::{Record, SliceWrapper};
use sync_service_bebop_schema::ToRouter;

fn conn(gateway: &str, id: &str) -> ConnectionId {
    ConnectionId(format!("{gateway}:{id}"))
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
    std::sync::Arc<
        std::sync::Mutex<Vec<(DocId, mpsc::Receiver<crate::domain::ports::QueuedFrame>)>>,
    >,
) {
    let opened = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let record = std::sync::Arc::clone(&opened);
    let mut factory = MockDownstreamFactory::new();
    factory
        .expect_open()
        .returning(move |_conn, doc, _token, _epoch| {
            let (tx, rx) = mpsc::channel(capacity);
            record.lock().unwrap().push((doc, rx));
            Downstream::new(
                tx,
                CancellationToken::new(),
                Arc::new(tokio::sync::Semaphore::new(1024)),
            )
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
    assert_eq!(rx.try_recv().unwrap().bytes, b"first");
    assert_eq!(rx.try_recv().unwrap().bytes, b"second");
}

#[tokio::test]
async fn duplicate_subscribe_does_not_ack_before_authorization() {
    let (factory, opened) = recording_factory(8);
    let mut sink = MockEdgeSink::new();
    // Only the downstream can acknowledge a validated subscription.
    sink.expect_deliver()
        .times(0)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let mut router = Router::new(std::sync::Arc::new(sink), factory);

    let c = conn("g1", "c1");
    router.handle(subscribe(&c, "doc-a")).await;
    router.handle(subscribe(&c, "doc-a")).await;

    assert_eq!(opened.lock().unwrap().len(), 2);
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
            failure: DownstreamFailure::DialFailed,
        })
        .await;
    router.handle(subscribe(&c, "doc-a")).await;

    assert_eq!(opened.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn full_downstream_queue_closes_the_route_instead_of_corrupting_chunk_framing() {
    let (factory, opened) = recording_factory(1);
    let mut sink = MockEdgeSink::new();
    sink.expect_deliver().times(1).returning(|_, bytes| {
        assert_eq!(
            bytes,
            envelope::doc_closed("doc-a", "downstream queue unavailable")
        );
        Box::pin(async { Ok(()) })
    });
    let mut router = Router::new(std::sync::Arc::new(sink), factory);
    let c = conn("g1", "c1");
    router.handle(subscribe(&c, "doc-a")).await;
    router.handle(doc_frame(&c, "doc-a", &[0, 1])).await;
    router.handle(doc_frame(&c, "doc-a", &[1, 2])).await;
    assert!(
        !router
            .routes
            .contains_key(&(c.clone(), DocId("doc-a".into())))
    );
    router.handle(subscribe(&c, "doc-a")).await;
    assert_eq!(opened.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn stale_failure_cannot_notify_or_remove_a_replacement_subscription() {
    let (factory, opened) = recording_factory(8);
    let mut sink = MockEdgeSink::new();
    sink.expect_deliver().times(0);
    let mut router = Router::new(Arc::new(sink), factory);
    let c = conn("host", "socket");
    router.handle(subscribe(&c, "doc-a")).await;
    router.handle(subscribe(&c, "doc-a")).await;
    router
        .handle(Event::DownstreamClosed {
            conn: c.clone(),
            doc: DocId("doc-a".into()),
            epoch: 1,
            failure: DownstreamFailure::DialFailed,
        })
        .await;
    router.handle(doc_frame(&c, "doc-a", b"new-route")).await;
    let mut opened = opened.lock().unwrap();
    assert!(matches!(
        opened[0].1.try_recv(),
        Err(mpsc::error::TryRecvError::Disconnected)
    ));
    assert_eq!(opened[1].1.try_recv().unwrap().bytes, b"new-route");
}
