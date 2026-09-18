use super::*;
use crate::domain::{
    model::{Event, SessionId},
    ports::Events,
};
use futures::StreamExt;

#[derive(Clone, Default)]
struct FakeCloud {
    submitted: Arc<tokio::sync::Mutex<Vec<Value>>>,
    history: Arc<tokio::sync::Mutex<Vec<Event>>>,
}
impl Cloud for FakeCloud {
    async fn models(&self) -> Result<Vec<crate::domain::models::ModelOption>> {
        Ok(Vec::new())
    }
    async fn send_batch(&self, session: &SessionId, payloads: Vec<Value>) -> Result<()> {
        assert_eq!(
            payloads[payloads.len() - 2]["request"]["subtype"],
            "set_model"
        );
        if payloads.len() == 3 {
            assert_eq!(payloads[0]["request"]["subtype"], "initialize");
        }
        self.send(session, payloads.last().unwrap().clone()).await
    }
    async fn send(&self, _: &SessionId, payload: Value) -> Result<()> {
        self.submitted.lock().await.push(payload);
        Ok(())
    }
    async fn history(&self, _: &SessionId) -> Result<Vec<Event>> {
        Ok(self.history.lock().await.clone())
    }
    async fn stream(&self, _: &SessionId, _: Option<u64>) -> Result<Events> {
        let submitted = self.submitted.clone();
        let before = submitted.lock().await.len();
        Ok(futures::stream::once(async move {
            let payload = loop {
                if let Some(value) = submitted.lock().await.get(before).cloned() { break value; }
                tokio::task::yield_now().await;
            };
            if payload["type"] == "control_request" {
                return Ok(Event {kind:"client_event".into(), sequence:Some(1), data:json!({"payload":{
                    "type":"control_response", "response":{"subtype":"success","request_id":payload["request_id"]}
                }})});
            }
            Ok(Event {kind:"client_event".into(), sequence:Some(1), data:json!({"payload":{
                "type":"result", "uuid":"result1", "subtype":"success", "is_error":false,
                "user_message_uuid":payload["uuid"], "usage":{"input_tokens":1,"output_tokens":2}
            }})})
        }).boxed())
    }
}

#[tokio::test]
async fn model_catalog_and_submitted_preference_roundtrip() {
    let cloud = FakeCloud::default();
    *cloud.history.lock().await = vec![Event {
        kind: "client_event".into(),
        sequence: Some(0),
        data: json!({"payload":{"type":"control_response","response":{"subtype":"success","response":{"models":[
    {"value":"default","displayName":"Provider Default"},
    {"value":"sonnet","displayName":"Provider Sonnet"},
    {"value":"new-model-2030","displayName":"New model","description":"New from provider"}]}}}}),
    }];
    let session = Session::new(cloud.clone(), SessionId::parse("cse_test").unwrap());
    let mut channel = attach(session.clone());
    channel
        .tx
        .send(frame(
            json!({"jsonrpc":"2.0","id":1,"method":"session/new","params":{}}),
        ))
        .unwrap();
    let response = read(&mut channel).await;
    let config = &response["result"]["configOptions"][0];
    assert_eq!(config["currentValue"], "claude-default");
    assert_eq!(config["options"].as_array().unwrap().len(), 3);
    for (id, value) in [(2, "sonnet"), (3, "new-model-2030"), (4, "claude-default")] {
        channel.tx.send(frame(json!({"jsonrpc":"2.0","id":id,"method":"session/set_config_option","params":{"sessionId":"cse_test","configId":"model","value":value}}))).unwrap();
        let response = read(&mut channel).await;
        assert_eq!(response["id"], id);
        assert_eq!(
            response["result"]["configOptions"][0]["currentValue"],
            value
        );
        assert_eq!(session.model().await.id(), value);
    }
    channel.tx.send(frame(json!({"jsonrpc":"2.0","id":5,"method":"session/set_config_option","params":{"sessionId":"cse_test","configId":"model","value":"made-up"}}))).unwrap();
    assert!(read(&mut channel).await.get("error").is_some());
    let submitted = cloud.submitted.lock().await;
    assert_eq!(submitted.len(), 3);
    assert!(submitted.iter().all(|p| p["type"] == "control_request"));
    assert!(submitted[2]["request"]["model"].is_null());
}
fn frame(value: Value) -> ToRuntimeMessage {
    ToRuntimeMessage::Acp(AcpMessage(serde_json::from_value(value).unwrap()))
}

#[tokio::test]
async fn polled_catalog_updates_the_picker_without_resetting_the_saved_model() {
    let cloud = FakeCloud::default();
    let mut channel = attach(Session::with_model(
        cloud.clone(),
        SessionId::parse("cse_test").unwrap(),
        Model::parse("saved-model").unwrap(),
    ));
    channel
        .tx
        .send(frame(
            json!({"jsonrpc":"2.0","id":1,"method":"session/new","params":{}}),
        ))
        .unwrap();
    let initial = read(&mut channel).await;
    assert_eq!(
        initial["result"]["configOptions"][0]["options"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    *cloud.history.lock().await = vec![Event {
        kind: "client_event".into(),
        sequence: Some(1),
        data: json!({"payload":{"type":"control_response","response":{"subtype":"success","response":{"models":[{"value":"future-model","displayName":"Future model","description":"Fresh catalog"}]}}}}),
    }];
    let update = read(&mut channel).await;
    assert_eq!(
        update["params"]["update"]["sessionUpdate"],
        "config_option_update"
    );
    let config = &update["params"]["update"]["configOptions"][0];
    assert_eq!(config["currentValue"], "saved-model");
    assert_eq!(config["options"][0]["value"], "future-model");
    assert_eq!(config["options"][0]["description"], "Fresh catalog");
    assert!(cloud.submitted.lock().await.is_empty());
}
async fn read(channel: &mut ServerChannel) -> Value {
    loop {
        if let ToServerMessage::Acp(AcpMessage(raw)) =
            tokio::time::timeout(std::time::Duration::from_secs(5), channel.rx.recv())
                .await
                .unwrap()
                .unwrap()
        {
            return serde_json::to_value(raw).unwrap();
        }
    }
}

#[tokio::test]
async fn handshake_prompt_completion_and_usage_roundtrip() {
    let cloud = FakeCloud::default();
    let mut channel = attach(Session::new(
        cloud.clone(),
        SessionId::parse("cse_test").unwrap(),
    ));
    channel
        .tx
        .send(frame(
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
        ))
        .unwrap();
    assert_eq!(
        read(&mut channel).await["result"]["agentCapabilities"]["loadSession"],
        true
    );
    channel.tx.send(frame(json!({"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/","mcpServers":[]}}))).unwrap();
    assert_eq!(read(&mut channel).await["result"]["sessionId"], "cse_test");
    channel.tx.send(frame(json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"cse_test","prompt":[{"type":"text","text":"hello"}]}}))).unwrap();
    let response = read(&mut channel).await;
    assert_eq!(response["result"]["stopReason"], "end_turn");
    assert_eq!(response["result"]["usage"]["inputTokens"], 1);
    assert_eq!(cloud.submitted.lock().await.len(), 1);
}

#[tokio::test]
async fn cannot_address_another_users_cloud_session() {
    let cloud = FakeCloud::default();
    let mut channel = attach(Session::new(
        cloud.clone(),
        SessionId::parse("cse_test").unwrap(),
    ));
    channel.tx.send(frame(json!({"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"cse_other","prompt":[{"type":"text","text":"hello"}]}}))).unwrap();
    assert!(read(&mut channel).await.get("error").is_some());
    assert!(cloud.submitted.lock().await.is_empty());
}

#[tokio::test]
async fn idle_cloud_turn_is_polled_into_acp_and_completed_without_a_macro_prompt() {
    let cloud = FakeCloud::default();
    let mut channel = attach(Session::new(
        cloud.clone(),
        SessionId::parse("cse_test").unwrap(),
    ));
    channel.tx.send(frame(json!({"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/","mcpServers":[]}}))).unwrap();
    assert!(read(&mut channel).await.get("result").is_some());
    *cloud.history.lock().await = vec![
        Event {
            kind: "client_event".into(),
            sequence: Some(1),
            data: json!({"payload":{"type":"user","uuid":"u","message":{"content":"web prompt"}}}),
        },
        Event {
            kind: "client_event".into(),
            sequence: Some(2),
            data: json!({"payload":{"type":"assistant","uuid":"a","message":{"id":"msg","content":[{"type":"text","text":"web answer"}]}}}),
        },
        Event {
            kind: "client_event".into(),
            sequence: Some(3),
            data: json!({"payload":{"type":"result","uuid":"r","subtype":"success","user_message_uuid":"u","usage":{}}}),
        },
    ];
    assert_eq!(
        read(&mut channel).await["params"]["update"]["sessionUpdate"],
        "user_message_chunk"
    );
    assert_eq!(
        read(&mut channel).await["params"]["update"]["content"]["text"],
        "web answer"
    );
    let completed = read(&mut channel).await;
    assert_eq!(completed["method"], "_session/turn_complete");
    assert_eq!(completed["params"]["outcome"]["kind"], "finished");
    assert!(cloud.submitted.lock().await.is_empty());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(2200), channel.rx.recv())
            .await
            .is_err()
    );
}

mod mcp;
