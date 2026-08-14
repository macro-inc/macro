use super::*;
use crate::domain::models::{ConnId as RouterConnId, GatewayId};
use crate::native::store::PgSyncStore;
use bebop::Record;
use std::sync::Mutex;
use std::time::Duration;
use sync_service_bebop_schema::owned;

const SECRET: &str = "test-secret";

/// Captures everything delivered to the client.
struct CaptureSink {
    frames: Mutex<Vec<Vec<u8>>>,
}

impl CaptureSink {
    fn new() -> Self {
        Self {
            frames: Mutex::new(Vec::new()),
        }
    }

    fn decoded(&self) -> Vec<owned::FromRouter> {
        self.frames
            .lock()
            .unwrap()
            .iter()
            .map(|bytes| owned::FromRouter::deserialize(bytes).unwrap())
            .collect()
    }
}

impl EdgeSink for CaptureSink {
    type Err = anyhow::Error;

    async fn deliver(&self, _conn: &ConnectionId, frame: Vec<u8>) -> Result<(), Self::Err> {
        self.frames.lock().unwrap().push(frame);
        Ok(())
    }
}

fn connection() -> ConnectionId {
    ConnectionId {
        gateway: GatewayId("gw-1".to_string()),
        conn: RouterConnId("conn-7".to_string()),
    }
}

fn token(document_id: &str, access_level: &str) -> String {
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 3600;
    macro_sync_service_jwt::encode(
        &serde_json::json!({
            "user_id": "macro|user-1@test.com",
            "document_id": document_id,
            "access_level": access_level,
            "exp": exp,
        }),
        SECRET,
    )
    .unwrap()
    .into_inner()
}

/// A factory over a host whose store points at nothing (lazy pool, never
/// connected) — fine for auth-path tests that never reach a Load completion.
fn factory() -> (
    NativeDownstreamFactory<CaptureSink>,
    Arc<CaptureSink>,
    mpsc::Receiver<Event>,
) {
    let sink = Arc::new(CaptureSink::new());
    let (events_tx, events_rx) = mpsc::channel(16);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://nobody@localhost:1/nothing")
        .unwrap();
    let store = PgSyncStore::new(pool);
    // Endpoints point at nothing; these tests never produce a lifecycle event.
    let reporter = crate::native::lifecycle::LifecycleReporter::new(
        "http://localhost:1".to_string(),
        "unused".to_string(),
        "http://localhost:1".to_string(),
        "unused".to_string(),
        store.clone(),
    );
    let host = MachineHost::spawn(store, reporter, Arc::clone(&sink), events_tx.clone());
    (
        NativeDownstreamFactory::new(host, SECRET.to_string(), Arc::clone(&sink), events_tx),
        sink,
        events_rx,
    )
}

#[tokio::test]
async fn invalid_token_refuses_and_reports_closed() {
    let (factory, sink, mut events) = factory();
    let _sender = factory.open(connection(), DocId("doc-1".into()), "garbage".into(), 3);

    let event = tokio::time::timeout(Duration::from_secs(1), events.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(event, Event::DownstreamClosed { epoch: 3, .. }));
    assert!(matches!(
        sink.decoded().as_slice(),
        [owned::FromRouter::RouterSubscribeFailed { doc_id, .. }] if doc_id == "doc-1"
    ));
}

#[tokio::test]
async fn token_for_other_document_is_refused() {
    let (factory, sink, mut events) = factory();
    let _sender = factory.open(
        connection(),
        DocId("doc-1".into()),
        token("doc-2", "edit"),
        4,
    );

    let event = tokio::time::timeout(Duration::from_secs(1), events.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(event, Event::DownstreamClosed { epoch: 4, .. }));
    assert!(matches!(
        sink.decoded().as_slice(),
        [owned::FromRouter::RouterSubscribeFailed { .. }]
    ));
}

#[tokio::test]
async fn valid_token_subscribes() {
    let (factory, sink, _events) = factory();
    let _sender = factory.open(
        connection(),
        DocId("doc-1".into()),
        token("doc-1", "edit"),
        5,
    );

    // Poll until the spawned attach task delivers the subscription frame.
    for _ in 0..100 {
        if !sink.decoded().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(matches!(
        sink.decoded().first(),
        Some(owned::FromRouter::RouterSubscribed { doc_id }) if doc_id == "doc-1"
    ));
}
