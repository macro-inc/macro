use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::mpsc;

use super::*;

/// Records each body; answers from a script, then `Done`.
#[derive(Clone)]
struct FakePost {
    sent: mpsc::UnboundedSender<Vec<u8>>,
    answers: Arc<Mutex<VecDeque<Delivered>>>,
}

impl Post for FakePost {
    async fn post(&self, body: Vec<u8>) -> Delivered {
        let _ = self.sent.send(body);
        self.answers
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Delivered::Done)
    }
}

fn fake(answers: &[Delivered]) -> (FakePost, mpsc::UnboundedReceiver<Vec<u8>>) {
    let (sent, received) = mpsc::unbounded_channel();
    let post = FakePost {
        sent,
        answers: Arc::new(Mutex::new(answers.iter().copied().collect())),
    };
    (post, received)
}

fn sender(outbox: &Outbox) -> mpsc::Sender<Vec<u8>> {
    outbox.sender().unwrap()
}

#[tokio::test]
async fn before_macrod_knows_its_harness_spans_are_dropped_not_held() {
    let exporter = IngestExporter::new(Outbox::default());
    assert!(exporter.export(Vec::new()).await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn batches_go_one_per_interval_and_a_refused_one_is_sent_again() {
    let outbox = Outbox::default();
    let (post, mut received) = fake(&[Delivered::Retry]);
    let _ingest = Ingest::start(&outbox, post);
    let started = tokio::time::Instant::now();

    sender(&outbox).try_send(b"one".to_vec()).unwrap();
    sender(&outbox).try_send(b"two".to_vec()).unwrap();

    assert_eq!(received.recv().await.unwrap(), b"one");
    // The service was unreachable: the same batch again, an interval later.
    assert_eq!(received.recv().await.unwrap(), b"one");
    assert_eq!(started.elapsed(), MIN_INTERVAL);
    assert_eq!(received.recv().await.unwrap(), b"two");
    assert_eq!(started.elapsed(), MIN_INTERVAL * 2);
}

#[tokio::test(start_paused = true)]
async fn an_offline_machine_keeps_only_the_newest_batches() {
    let outbox = Outbox::default();
    let unreachable = vec![Delivered::Retry; 1000];
    let (post, mut received) = fake(&unreachable);
    let _ingest = Ingest::start(&outbox, post);

    sender(&outbox).try_send(b"first".to_vec()).unwrap();
    assert_eq!(received.recv().await.unwrap(), b"first");
    // The outbox takes at most MAX_PENDING while the sender sleeps; the
    // exporter's next ones are refused, never waited for.
    let mut accepted = 0;
    for batch in 0..100u32 {
        if sender(&outbox)
            .try_send(batch.to_be_bytes().to_vec())
            .is_ok()
        {
            accepted += 1;
        }
    }
    assert_eq!(accepted, MAX_PENDING);

    // The kept ones are bounded too: the oldest (the first) gave way.
    tokio::time::sleep(MIN_INTERVAL + Duration::from_millis(1)).await;
    assert_eq!(received.recv().await.unwrap(), 0u32.to_be_bytes().to_vec());
}

#[test]
fn a_batch_encodes_as_an_otlp_trace_request() {
    let body = encode(Vec::new(), &ResourceAttributesWithSchema::default());
    let decoded = ExportTraceServiceRequest::decode(body.as_slice()).unwrap();
    let spans: usize = decoded
        .resource_spans
        .iter()
        .flat_map(|resource| &resource.scope_spans)
        .map(|scope| scope.spans.len())
        .sum();
    assert_eq!(spans, 0);
}

#[tokio::test]
async fn the_post_carries_the_harness_credential_and_says_what_to_send_again() {
    use wiremock::matchers::{body_bytes, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    let post = HttpPost::new(IngestTarget {
        url: format!("{}/agent-harness/teammates/telemetry", server.uri()),
        token: "harness-token".to_owned(),
    })
    .unwrap();
    for (status, delivered) in [
        (200, Delivered::Done),
        (400, Delivered::Done),
        (429, Delivered::Retry),
        (503, Delivered::Retry),
    ] {
        let mock = Mock::given(method("POST"))
            .and(path("/agent-harness/teammates/telemetry"))
            .and(header("x-macro-harness-token", "harness-token"))
            .and(header("content-type", "application/x-protobuf"))
            .and(body_bytes(b"spans".to_vec()))
            .respond_with(ResponseTemplate::new(status))
            .expect(1)
            .mount_as_scoped(&server)
            .await;
        assert_eq!(post.post(b"spans".to_vec()).await, delivered, "{status}");
        drop(mock);
    }
    // Unreachable (a port nothing listens on): sent again later.
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let unreachable = HttpPost::new(IngestTarget {
        url: format!("http://127.0.0.1:{port}/teammates/telemetry"),
        token: "harness-token".to_owned(),
    })
    .unwrap();
    assert_eq!(unreachable.post(b"spans".to_vec()).await, Delivered::Retry);
}
