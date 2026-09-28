use super::*;
use serde_json::json;

fn selection(id: i64, model: &str) -> Message {
    Message::ToRuntime(
        AgentAction::set_model(model)
            .to_runtime(&"runtime-session".into(), RequestId::Number(id))
            .unwrap(),
    )
}

fn response(id: i64, model: &str) -> Message {
    Message::ToServer(ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::response(
            RequestId::Number(id),
            Ok(json!({
                "sessionId": "runtime-session",
                "configOptions": [{
                    "id": "model", "name": "Model", "type": "select",
                    "currentValue": model, "options": []
                }]
            })),
        ),
    )))
}

#[tokio::test]
async fn only_the_startup_selection_reply_releases_model_projection() {
    let fx = fixture();
    fx.repo.set_model(fx.session, "saved-model").await.unwrap();
    let mut logs = connection(fx.repo.clone()).with_initial_model(Some("saved-model".into()));
    let open = Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(
        RawJsonRpcMessage::request(
            "session/new".into(),
            json!({"cwd": "/workspace", "mcpServers": []}),
            RequestId::Number(1),
        )
        .unwrap(),
    )));

    // Even if the runtime's default already matches, the opening reply and
    // other config replies cannot confirm the pending startup selection.
    for content in [
        open,
        response(1, "saved-model"),
        selection(2, "saved-model"),
        selection(99, "saved-model"),
        response(99, "saved-model"),
        response(2, "wrong-model"),
    ] {
        logs.append(AgentSessionLog {
            agent_session_id: fx.session,
            user_id: None,
            content,
        })
        .await
        .unwrap();
        assert_eq!(fx.repo.get(fx.session).await.unwrap().model, "saved-model");
    }

    // Reattaching must not trust the previous connection's logged responses.
    let mut logs = connection(fx.repo.clone()).with_initial_model(Some("saved-model".into()));
    for (content, expected) in [
        (selection(3, "saved-model"), "saved-model"),
        (response(3, "saved-model"), "saved-model"),
        (selection(4, "next-model"), "saved-model"),
        (response(4, "next-model"), "next-model"),
    ] {
        logs.append(AgentSessionLog {
            agent_session_id: fx.session,
            user_id: None,
            content,
        })
        .await
        .unwrap();
        assert_eq!(fx.repo.get(fx.session).await.unwrap().model, expected);
    }
}
