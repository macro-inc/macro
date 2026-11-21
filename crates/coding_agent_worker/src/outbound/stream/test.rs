use super::*;
use crate::config::{HarnessCredentials, MacroApi};
use harness_id::HarnessId;
use webhook::domain::models::WebhookFilter;

fn test_client(storage_url: &str) -> EventStreamClient {
    EventStreamClient::new(
        &MacroApi {
            egress_url: None,
            api_url: "http://unused".to_owned(),
            storage_url: storage_url.to_owned(),
            web_url: "https://macro.com/app".to_owned(),
        },
        &HarnessCredentials {
            harness_id: HarnessId::TEST_A,
            token: "mhns_test".to_owned(),
            pairing_id: None,
        },
    )
}

const TEAM_HARNESS: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n\
     {\"allow_permission_bypass\":false,\"id\":\"00000000-0000-0000-0000-00000000000a\",\
      \"kind\":\"macrod\",\"name\":\"desk\",\
      \"owner\":{\"type\":\"user\",\"user_id\":\"macro|owner@example.com\"},\
      \"shared_team_ids\":[\"00000000-0000-0000-0000-000000000007\"],\
      \"created_by\":\"macro|owner@example.com\",\"created_at\":\"2026-11-01T00:00:00Z\",\
      \"updated_at\":\"2026-11-01T00:00:00Z\",\"connected\":true,\"last_connected_at\":null}";

#[derive(Debug, PartialEq, Eq, serde::Deserialize)]
struct Envelope {
    n: u8,
}

#[tokio::test]
async fn presence_check_tells_the_service_a_connection_is_held() {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let url = format!(
        "http://{}",
        listener.local_addr().expect("listener address")
    );
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut buf = vec![0u8; 4096];
        let read = socket.read(&mut buf).await.unwrap_or(0);
        let _ = socket.write_all(TEAM_HARNESS.as_bytes()).await;
        let _ = socket.shutdown().await;
        String::from_utf8_lossy(&buf[..read]).to_lowercase()
    });

    assert!(test_client(&url).service_reports_connected().await.unwrap());

    let request = server.await.unwrap();
    assert!(request.starts_with("get /harnesses/me "));
    assert!(request.contains("x-macro-harness-runtime-connected: true"));
}

#[tokio::test]
async fn connect_yields_typed_envelopes_and_skips_keep_alives_and_junk() {
    let (url, requests) = serve(vec![
        TEAM_HARNESS,
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n\
         : keep-alive\n\n\
         id: evt-1\n\
         event: agent_trigger.new\n\
         data: {\"n\":1}\n\n\
         data: not json\n\n\
         data: {\"other\":true}\n\n\
         data: {\"n\":\r\ndata: 2}\r\n\r\n",
    ])
    .await;
    let client = test_client(&url);
    let mut stream = client
        .connect::<Envelope>(
            &[WebhookFilter {
                events: vec!["agent_trigger.new".to_owned()],
                ids: None,
            }],
            None,
        )
        .await
        .expect("open the stream");

    assert_eq!(stream.last_event_id(), None);
    let first = stream.next_event().await.expect("read").expect("first");
    assert_eq!(first, StreamNext::Event(Envelope { n: 1 }));
    assert_eq!(stream.last_event_id(), Some("evt-1"));
    let second = stream.next_event().await.expect("read").expect("second");
    assert_eq!(second, StreamNext::Event(Envelope { n: 2 }));
    assert!(stream.next_event().await.expect("closed").is_none());

    // The owner comes from the server, so the stream is scoped to the team.
    let requests = requests.lock().unwrap();
    assert!(
        requests[0].starts_with("GET /harnesses/me "),
        "{requests:?}"
    );
    assert!(
        requests[1].starts_with("GET /webhook/events/stream?scope=team&"),
        "{requests:?}"
    );
}

#[tokio::test]
async fn connect_resumes_after_the_cursor_it_is_given() {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let url = format!(
        "http://{}",
        listener.local_addr().expect("listener address")
    );
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for response in [
            TEAM_HARNESS,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
        ] {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut buf = vec![0u8; 4096];
            let read = socket.read(&mut buf).await.unwrap_or(0);
            requests.push(String::from_utf8_lossy(&buf[..read]).to_lowercase());
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;
        }
        requests
    });

    let cursor = cursor_at(std::time::SystemTime::now());
    test_client(&url)
        .connect::<Envelope>(
            &[WebhookFilter {
                events: vec!["agent_trigger.new".to_owned()],
                ids: None,
            }],
            Some(&cursor),
        )
        .await
        .expect("open the stream");

    let requests = server.await.unwrap();
    assert!(
        requests[1].contains(&format!("last-event-id: {cursor}")),
        "{requests:?}"
    );
    // Replay is opt-in on the service; only a client that asks resumes.
    assert!(requests[1].contains("&resume=true"), "{requests:?}");
}

#[test]
fn a_time_cursor_is_the_first_uuidv7_of_its_millisecond() {
    let time = std::time::UNIX_EPOCH + std::time::Duration::from_millis(1_700_000_000_123);
    let cursor = macro_uuid::Uuid::parse_str(&cursor_at(time)).unwrap();
    assert_eq!(cursor.get_version_num(), 7);
    assert_eq!(
        cursor.get_timestamp().map(|timestamp| timestamp.to_unix()),
        Some((1_700_000_000, 123_000_000))
    );
    assert!(cursor_at(time) < cursor_at(time + std::time::Duration::from_millis(1)));
}

#[tokio::test]
async fn connect_refuses_a_non_2xx_answer() {
    let (url, _) = serve(vec![
        TEAM_HARNESS,
        "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"message\":\"nope\"}",
    ])
    .await;
    let client = test_client(&url);

    let error = client
        .connect::<Envelope>(&[], None)
        .await
        .err()
        .expect("a 403 is refused");
    assert!(format!("{error:?}").contains("403"));
}

#[tokio::test]
async fn bound_agents_are_sorted_unique_and_dated_by_the_service() {
    let (url, _) = serve(vec![
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\
         Date: Tue, 17 Nov 2026 22:00:05 GMT\r\n\r\n\
         [{\"bot_id\":\"00000000-0000-0000-0000-000000000002\",\"name\":\"b\",\"handle\":\"b\"},\
          {\"bot_id\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"a\",\"handle\":\"a\"},\
          {\"bot_id\":\"00000000-0000-0000-0000-000000000002\",\"name\":\"b2\",\"handle\":\"b2\"}]",
    ])
    .await;
    let client = test_client(&url);
    let agents = client.bound_agents().await.expect("list agents");
    assert_eq!(
        agents.bot_ids,
        vec![
            "00000000-0000-0000-0000-000000000001".to_owned(),
            "00000000-0000-0000-0000-000000000002".to_owned()
        ]
    );
    // A second before the service's `Date`, which has whole seconds.
    let date = chrono::DateTime::parse_from_rfc2822("Tue, 17 Nov 2026 22:00:04 GMT").unwrap();
    assert_eq!(agents.read_by, Some(std::time::SystemTime::from(date)));
}

/// An SSE body that sends `chunks`, then stays open and silent.
fn body(
    chunks: &'static [&'static str],
) -> impl Stream<Item = Result<&'static str, reqwest::Error>> + Send + 'static {
    futures::stream::iter(chunks.iter().copied().map(Ok)).chain(futures::stream::pending())
}

const HEARTBEAT: &str = "event: heartbeat\ndata: {}\n\n";
const KEEP_ALIVE: &str = ": keep-alive\n\n";

#[test]
fn the_heartbeat_interval_comes_from_the_header_only() {
    let mut headers = reqwest::header::HeaderMap::new();
    assert_eq!(heartbeat_interval(&headers), None);
    headers.insert(STREAM_HEARTBEAT_HEADER, "20".parse().unwrap());
    assert_eq!(heartbeat_interval(&headers), Some(Duration::from_secs(20)));
    for unusable in ["0", "soon", "-5"] {
        headers.insert(STREAM_HEARTBEAT_HEADER, unusable.parse().unwrap());
        assert_eq!(heartbeat_interval(&headers), None, "{unusable}");
    }
}

/// A heartbeating service whose stream carries only keep-alive comments has a
/// dead event source: the stream ends half an interval after the third missed
/// heartbeat came due.
#[tokio::test(start_paused = true)]
async fn a_heartbeating_stream_that_goes_silent_stalls_after_three_missed_heartbeats() {
    let interval = Duration::from_secs(20);
    let mut stream = EventStream::<Envelope>::new(
        body(&[KEEP_ALIVE, KEEP_ALIVE, KEEP_ALIVE, KEEP_ALIVE]),
        Some(interval),
    );
    let started = tokio::time::Instant::now();

    let error = stream.next_event().await.expect_err("a stall");

    assert!(format!("{error}").contains("stalled"), "{error}");
    assert_eq!(started.elapsed(), Duration::from_secs(70));
}

/// Old server, new macrod: without the header nothing says the event source
/// is alive, so a silent stream stays open as before.
#[tokio::test(start_paused = true)]
async fn a_stream_without_the_header_never_stalls() {
    let mut stream = EventStream::<Envelope>::new(body(&[KEEP_ALIVE]), None);

    assert!(
        tokio::time::timeout(Duration::from_secs(3600), stream.next_event())
            .await
            .is_err(),
        "a service that does not heartbeat must not be reconnected to"
    );
}

/// The heartbeat after two missed ones arrives exactly three intervals after
/// the last: it keeps the stream open rather than racing its deadline.
#[tokio::test(start_paused = true)]
async fn two_missed_heartbeats_do_not_stall_the_stream() {
    let interval = Duration::from_secs(20);
    let (sender, receiver) = futures::channel::mpsc::unbounded();
    let mut stream = EventStream::<Envelope>::new(receiver, Some(interval));

    tokio::time::advance(interval * 3).await;
    sender.unbounded_send(Ok(HEARTBEAT)).unwrap();

    assert_eq!(
        stream.next_event().await.unwrap(),
        Some(StreamNext::Heartbeat)
    );
}

#[tokio::test(start_paused = true)]
async fn heartbeats_keep_a_quiet_stream_open_and_never_move_the_cursor() {
    let interval = Duration::from_secs(20);
    let (sender, receiver) = futures::channel::mpsc::unbounded();
    let mut stream = EventStream::<Envelope>::new(receiver, Some(interval));

    sender
        .unbounded_send(Ok("id: evt-1\ndata: {\"n\":1}\n\n"))
        .unwrap();
    assert_eq!(
        stream.next_event().await.unwrap(),
        Some(StreamNext::Event(Envelope { n: 1 }))
    );
    for _ in 0..10 {
        tokio::time::advance(interval).await;
        sender.unbounded_send(Ok(HEARTBEAT)).unwrap();
        assert_eq!(
            stream.next_event().await.unwrap(),
            Some(StreamNext::Heartbeat)
        );
    }
    assert_eq!(stream.last_event_id(), Some("evt-1"));
}

/// A caller busy past the deadline still reads what arrived meanwhile.
#[tokio::test(start_paused = true)]
async fn a_heartbeat_that_arrived_while_the_caller_was_busy_is_not_a_stall() {
    let interval = Duration::from_secs(20);
    let mut stream = EventStream::<Envelope>::new(body(&[HEARTBEAT]), Some(interval));

    tokio::time::advance(interval * (STALL_AFTER_MISSED_HEARTBEATS + 1)).await;

    assert_eq!(
        stream.next_event().await.unwrap(),
        Some(StreamNext::Heartbeat)
    );
}

/// New server, old macrod: the heartbeat's `{}` data does not decode as a
/// trigger envelope, which older macrod skips with a debug log.
#[test]
fn a_heartbeat_is_not_a_trigger_envelope() {
    assert!(serde_json::from_str::<crate::trigger::TriggerEvent>("{}").is_err());
}

#[tokio::test(start_paused = true)]
async fn lookups_give_up_on_a_service_that_never_answers() {
    let (url, _) = serve_then_stall(vec![]).await;
    let client = test_client(&url);

    let started = tokio::time::Instant::now();
    let error = client.bound_agents().await.expect_err("bound agents");
    assert!(
        format!("{error:?}").contains("list this harness's agents"),
        "{error:?}"
    );
    assert_eq!(started.elapsed(), ANSWER_TIMEOUT);

    let started = tokio::time::Instant::now();
    let error = client
        .connect::<Envelope>(&[], None)
        .await
        .err()
        .expect("owner lookup");
    assert!(
        format!("{error:?}").contains("read this harness's owner"),
        "{error:?}"
    );
    assert_eq!(started.elapsed(), ANSWER_TIMEOUT);

    let started = tokio::time::Instant::now();
    client
        .service_reports_connected()
        .await
        .expect_err("presence check");
    assert_eq!(started.elapsed(), ANSWER_TIMEOUT);
}

#[tokio::test(start_paused = true)]
async fn connect_gives_up_on_a_stream_that_never_starts() {
    let (url, requests) = serve_then_stall(vec![TEAM_HARNESS]).await;
    let client = test_client(&url);

    let started = tokio::time::Instant::now();
    let error = client
        .connect::<Envelope>(&[], None)
        .await
        .err()
        .expect("stream open");

    assert!(format!("{error:?}").contains("in time"), "{error:?}");
    assert_eq!(started.elapsed(), ANSWER_TIMEOUT);
    assert!(
        requests.lock().unwrap()[0].starts_with("GET /harnesses/me "),
        "the owner lookup was answered first"
    );
}

/// Answer one connection per response, in order, recording each request line.
async fn serve(responses: Vec<&'static str>) -> (String, Requests) {
    serve_with(responses, false).await
}

/// Like [`serve`], then accept every later connection and never answer it.
async fn serve_then_stall(responses: Vec<&'static str>) -> (String, Requests) {
    serve_with(responses, true).await
}

type Requests = std::sync::Arc<std::sync::Mutex<Vec<String>>>;

async fn serve_with(responses: Vec<&'static str>, then_stall: bool) -> (String, Requests) {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let addr = listener.local_addr().expect("listener address");
    let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorded = requests.clone();
    tokio::spawn(async move {
        for response in responses {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut buf = vec![0u8; 4096];
            let read = socket.read(&mut buf).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..read]);
            recorded
                .lock()
                .unwrap()
                .push(request.lines().next().unwrap_or_default().to_owned());
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;
        }
        if !then_stall {
            return;
        }
        let mut held = Vec::new();
        while let Ok((socket, _)) = listener.accept().await {
            held.push(socket);
        }
    });
    (format!("http://{addr}"), requests)
}
