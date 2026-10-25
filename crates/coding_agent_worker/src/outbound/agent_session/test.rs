use super::*;
use agent_session::inbound::axum_router::CreateSessionThread;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

#[tokio::test]
async fn transient_create_retries_keep_identity_and_trigger_controls_keep_source_id() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let api = HarnessApi {
        http: reqwest::Client::new(),
        base: format!("http://{}", listener.local_addr().unwrap()),
        token: "test".into(),
    };
    let session = AgentSessionId::new();
    let source = macro_uuid::generate_uuid_v7();
    let server = tokio::spawn(async move {
        let mut received = Vec::new();
        let responses = [
            ("500 Internal Server Error", "{}".to_owned()),
            (
                "409 Conflict",
                serde_json::json!({"message":"already created", "sessionId":session}).to_string(),
            ),
            ("200 OK", "{}".to_owned()),
        ];
        for (status, body) in responses {
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = BufReader::new(stream);
            let mut line = String::new();
            stream.read_line(&mut line).await.unwrap();
            let mut length = 0;
            loop {
                line.clear();
                stream.read_line(&mut line).await.unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse::<usize>().unwrap();
                }
            }
            let mut data = vec![0; length];
            stream.read_exact(&mut data).await.unwrap();
            received.push(serde_json::from_slice::<serde_json::Value>(&data).unwrap());
            stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        }
        received
    });
    let sender = MacroUserIdStr::try_from_email("asker@example.com").unwrap();
    let request = CreateAgentSessionRequest {
        id: Some(session.as_uuid()),
        bot_id: Some(bot_id::BotId::TEST_A.as_uuid()),
        workspace: Some("/workspace".into()),
        prompt: None,
        repo_url: None,
        repo_branch: None,
        owner: Some(sender.to_string()),
        instructions: None,
        model: None,
        thread: Some(CreateSessionThread {
            reuse_origin_message: false,
            channel_id: None,
            parent: Some(messages::domain::models::MessageParent::Channel(
                macro_uuid::generate_uuid_v7(),
            )),
            thread_id: Some(source),
            message_id: source,
            content: "hello".into(),
        }),
    };
    assert!(
        matches!(api.create_session(&request, &sender).await, Err(ApiError::ThreadSessionExists { session: Some(existing) }) if existing == session)
    );
    api.prompt(session, &sender, "hello", source, None)
        .await
        .unwrap();
    let received = server.await.unwrap();
    assert_eq!(received.len(), 3);
    assert_eq!(received[0], received[1]);
    let control: ControlRequest = serde_json::from_value(received[2].clone()).unwrap();
    assert_eq!(control.action_id, Some(AgentActionId::from_uuid(source)));
}
