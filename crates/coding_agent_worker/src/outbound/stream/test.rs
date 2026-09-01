use super::*;

#[test]
fn stream_scope_accepts_user_and_team() {
    assert_eq!(stream_scope("user").expect("user"), WebhookScope::User);
    assert_eq!(stream_scope("team").expect("team"), WebhookScope::Team);
    assert!(stream_scope("workspace").is_err());
}

#[test]
fn sse_parser_yields_data_and_skips_comments() {
    let mut parser = SseParser::default();
    let frames = parser.push(
        ": keep-alive\n\n\
         id: evt-1\n\
         event: agent_trigger.new\n\
         data: {\"ok\":true}\n\n\
         data: still-incomplete",
    );
    assert_eq!(frames, vec![r#"{"ok":true}"#]);
    assert_eq!(parser.push("\n\n"), vec!["still-incomplete"]);
}

#[test]
fn sse_parser_joins_multiline_data_and_accepts_crlf() {
    let mut parser = SseParser::default();
    let frames = parser.push("data: {\"a\":1}\r\ndata: extra\r\n\r\n");
    assert_eq!(frames, vec!["{\"a\":1}\nextra"]);
}

#[test]
fn sse_parser_ignores_empty_and_comment_only_frames() {
    let mut parser = SseParser::default();
    assert!(parser.push(": keep-alive\n\n\n\n").is_empty());
}

#[tokio::test]
async fn identify_bot_reads_the_id_from_bots_me() {
    let url = serve_once(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"id\":\"00000000-0000-0000-0000-000000000001\"}",
    )
    .await;
    let client = test_client(&url);

    let bot = client.identify_bot().await.expect("identify the bot");
    assert_eq!(bot.to_string(), "00000000-0000-0000-0000-000000000001");
}

#[tokio::test]
async fn connect_reads_one_sse_envelope_then_closes() {
    let url = serve_once(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n\
         event: agent_trigger.new\n\
         data: {\"hello\":\"stream\"}\n\n",
    )
    .await;
    let client = test_client(&url);
    let mut stream = client
        .connect(
            WebhookScope::User,
            &[WebhookFilter {
                events: vec!["agent_trigger.new".to_owned()],
                ids: None,
            }],
        )
        .await
        .expect("open the stream");

    let envelope = stream
        .next_envelope()
        .await
        .expect("read")
        .expect("one envelope");
    assert_eq!(envelope, serde_json::json!({"hello": "stream"}));
    assert!(stream.next_envelope().await.expect("closed").is_none());
}

fn test_client(storage_url: &str) -> EventStreamClient {
    EventStreamClient::new(
        storage_url,
        "mbot_test",
        "user",
        "macro|owner@example.com",
    )
}

async fn serve_once(response: &'static str) -> String {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let addr = listener.local_addr().expect("listener address");
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut buf = vec![0u8; 4096];
        let _ = socket.read(&mut buf).await;
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });
    format!("http://{addr}")
}
