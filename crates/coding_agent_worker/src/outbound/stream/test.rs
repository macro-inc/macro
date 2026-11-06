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
        },
    )
}

const TEAM_HARNESS: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n\
     {\"allow_permission_bypass\":false,\"id\":\"00000000-0000-0000-0000-00000000000a\",\
      \"kind\":\"macrod\",\"name\":\"desk\",\
      \"owner\":{\"type\":\"team\",\"team_id\":\"00000000-0000-0000-0000-000000000007\"},\
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
        .connect::<Envelope>(&[WebhookFilter {
            events: vec!["agent_trigger.new".to_owned()],
            ids: None,
        }])
        .await
        .expect("open the stream");

    let first = stream.next_event().await.expect("read").expect("first");
    assert_eq!(first, Envelope { n: 1 });
    let second = stream.next_event().await.expect("read").expect("second");
    assert_eq!(second, Envelope { n: 2 });
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
async fn connect_refuses_a_non_2xx_answer() {
    let (url, _) = serve(vec![
        TEAM_HARNESS,
        "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"message\":\"nope\"}",
    ])
    .await;
    let client = test_client(&url);

    let error = client
        .connect::<Envelope>(&[])
        .await
        .err()
        .expect("a 403 is refused");
    assert!(format!("{error:?}").contains("403"));
}

#[tokio::test]
async fn bound_bot_ids_are_sorted_and_unique() {
    let (url, _) = serve(vec![
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n\
         [{\"bot_id\":\"00000000-0000-0000-0000-000000000002\",\"name\":\"b\",\"handle\":\"b\"},\
          {\"bot_id\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"a\",\"handle\":\"a\"},\
          {\"bot_id\":\"00000000-0000-0000-0000-000000000002\",\"name\":\"b2\",\"handle\":\"b2\"}]",
    ])
    .await;
    let client = test_client(&url);
    let ids = client.bound_bot_ids().await.expect("list agents");
    assert_eq!(
        ids,
        vec![
            "00000000-0000-0000-0000-000000000001".to_owned(),
            "00000000-0000-0000-0000-000000000002".to_owned()
        ]
    );
}

/// Answer one connection per response, in order, recording each request line.
async fn serve(
    responses: Vec<&'static str>,
) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
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
    });
    (format!("http://{addr}"), requests)
}
