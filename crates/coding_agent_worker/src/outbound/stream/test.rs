use super::*;

#[test]
fn stream_scope_accepts_user_and_team() {
    assert_eq!(stream_scope("user").expect("user"), WebhookScope::User);
    assert_eq!(stream_scope("team").expect("team"), WebhookScope::Team);
    assert!(stream_scope("workspace").is_err());
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

#[derive(Debug, PartialEq, Eq, Deserialize)]
struct Envelope {
    n: u8,
}

#[tokio::test]
async fn connect_yields_typed_envelopes_and_skips_keep_alives_and_junk() {
    // A keep-alive comment, an envelope, a non-JSON data frame, a JSON frame
    // of the wrong shape, a CRLF multi-line envelope, then close.
    let url = serve_once(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n\
         : keep-alive\n\n\
         id: evt-1\n\
         event: agent_trigger.new\n\
         data: {\"n\":1}\n\n\
         data: not json\n\n\
         data: {\"other\":true}\n\n\
         data: {\"n\":\r\ndata: 2}\r\n\r\n",
    )
    .await;
    let client = test_client(&url);
    let mut stream = client
        .connect::<Envelope>(
            WebhookScope::User,
            &[WebhookFilter {
                events: vec!["agent_trigger.new".to_owned()],
                ids: None,
            }],
        )
        .await
        .expect("open the stream");

    let first = stream.next_event().await.expect("read").expect("first");
    assert_eq!(first, Envelope { n: 1 });
    let second = stream.next_event().await.expect("read").expect("second");
    assert_eq!(second, Envelope { n: 2 });
    assert!(stream.next_event().await.expect("closed").is_none());
}

#[tokio::test]
async fn connect_refuses_a_non_2xx_answer() {
    let url = serve_once(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"message\":\"nope\"}",
    )
    .await;
    let client = test_client(&url);

    let error = client
        .connect::<Envelope>(WebhookScope::User, &[])
        .await
        .err()
        .expect("a 403 is refused");
    assert!(format!("{error:?}").contains("403"));
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
