use super::*;
use crate::domain::{model::Event, ports::Events};
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Clone, Default)]
struct ReconnectingCloud {
    sends: Arc<Mutex<Vec<serde_json::Value>>>,
    cursors: Arc<Mutex<Vec<Option<u64>>>>,
    streams: Arc<AtomicUsize>,
    history: Arc<Mutex<Vec<Event>>>,
}
impl Cloud for ReconnectingCloud {
    async fn recent_sessions(&self) -> Result<Vec<SessionId>> {
        Ok(Vec::new())
    }
    async fn send_batch(
        &self,
        session: &SessionId,
        payloads: Vec<serde_json::Value>,
    ) -> Result<()> {
        assert_eq!(
            payloads[payloads.len() - 2]["request"]["subtype"],
            "set_model"
        );
        if payloads.len() == 3 {
            assert_eq!(payloads[0]["request"]["subtype"], "initialize");
        }
        self.send(session, payloads.last().unwrap().clone()).await
    }
    async fn send(&self, _: &SessionId, payload: serde_json::Value) -> Result<()> {
        self.sends.lock().await.push(payload);
        Ok(())
    }
    async fn history(&self, _: &SessionId) -> Result<Vec<Event>> {
        Ok(self.history.lock().await.clone())
    }
    async fn stream(&self, _: &SessionId, cursor: Option<u64>) -> Result<Events> {
        self.cursors.lock().await.push(cursor);
        let attempt = self.streams.fetch_add(1, Ordering::SeqCst);
        let sends = self.sends.clone();
        Ok(futures::stream::once(async move {
            let sent = loop {
                if let Some(sent) = sends.lock().await.first().cloned() { break sent; }
                tokio::task::yield_now().await;
            };
            let durable = Event { kind:"client_event".into(), sequence:Some(1), data:json!({"payload":{
                "type":"assistant", "uuid":"a1", "message":{"id":"msg1","content":[{"type":"text","text":"hello"}]}
            }}) };
            if attempt == 0 { vec![Ok(durable), Err(Error::Network)] }
            else { vec![Ok(durable), Ok(Event {kind:"client_event".into(), sequence:Some(2), data:json!({"payload":{
                "type":"result","uuid":"r1","subtype":"success","is_error":false,"user_message_uuid":sent["uuid"],"usage":{}
            }})})] }
        }).flat_map(futures::stream::iter).boxed())
    }
}

#[tokio::test]
async fn stream_reconnect_resumes_after_delivery_without_resending_prompt() {
    let cloud = ReconnectingCloud::default();
    let session = Session::new(cloud.clone(), SessionId::parse("cse_test").unwrap());
    let output = std::sync::Mutex::new(Vec::new());
    session
        .prompt("hello".into(), |update| {
            output.lock().unwrap().push(update);
            Ok(())
        })
        .await
        .unwrap();
    assert_eq!(cloud.sends.lock().await.len(), 1);
    assert_eq!(*cloud.cursors.lock().await, vec![None, Some(1)]);
    assert_eq!(
        output
            .lock()
            .unwrap()
            .iter()
            .filter(|u| matches!(u, Update::Text(_)))
            .count(),
        1
    );
}

#[tokio::test]
async fn cancel_sends_a_cloud_interrupt_not_just_a_local_disconnect() {
    let cloud = ReconnectingCloud::default();
    let session = Session::new(cloud.clone(), SessionId::parse("cse_test").unwrap());
    session.cancel().await.unwrap();
    assert_eq!(
        cloud.sends.lock().await[0]["request"]["subtype"],
        "interrupt"
    );
}

fn foreign_turn() -> Vec<Event> {
    vec![
        Event {
            kind: "client_event".into(),
            sequence: Some(1),
            data: json!({"payload":{"type":"user","uuid":"foreign-user","message":{"content":"sent in Claude"}}}),
        },
        Event {
            kind: "client_event".into(),
            sequence: Some(2),
            data: json!({"payload":{"type":"assistant","uuid":"foreign-answer","message":{"id":"foreign-msg","content":[{"type":"text","text":"cloud reply"}]}}}),
        },
        Event {
            kind: "client_event".into(),
            sequence: Some(3),
            data: json!({"payload":{"type":"result","uuid":"foreign-result","subtype":"success","user_message_uuid":"foreign-user","usage":{}}}),
        },
    ]
}

#[tokio::test]
async fn foreign_updates_are_ordered_deduplicated_and_resume_after_load() {
    let cloud = ReconnectingCloud::default();
    let session = Session::new(cloud.clone(), SessionId::parse("cse_test").unwrap());
    let output = std::sync::Mutex::new(Vec::new());
    let emit = |update| {
        output.lock().unwrap().push(update);
        Ok(())
    };
    *cloud.history.lock().await = foreign_turn();
    session.sync_foreign(emit).await.unwrap();
    session.sync_foreign(emit).await.unwrap();
    assert_eq!(output.lock().unwrap().len(), 3);
    assert_eq!(
        output.lock().unwrap()[0],
        Update::User("sent in Claude".into())
    );
    assert_eq!(
        output.lock().unwrap()[1],
        Update::Text("cloud reply".into())
    );
    assert!(matches!(output.lock().unwrap()[2], Update::Finished { .. }));
    assert!(cloud.sends.lock().await.is_empty());
    session.load().await.unwrap();
    output.lock().unwrap().clear();
    session.sync_foreign(emit).await.unwrap();
    assert!(output.lock().unwrap().is_empty());
    // A fresh attachment hydrates once, then its poll does not replay history.
    let resumed = Session::new(cloud, SessionId::parse("cse_test").unwrap());
    assert_eq!(resumed.load().await.unwrap().len(), 3);
    resumed.sync_foreign(emit).await.unwrap();
    assert!(output.lock().unwrap().is_empty());
}

#[tokio::test]
async fn poll_skips_active_macro_turn_without_contacting_provider() {
    let cloud = ReconnectingCloud::default();
    *cloud.history.lock().await = foreign_turn();
    let session = Session::new(cloud, SessionId::parse("cse_test").unwrap());
    let _active = session.turn.lock().await;
    session
        .sync_foreign(|_| panic!("must not interleave"))
        .await
        .unwrap();
    assert!(session.cursor.lock().await.is_none());
}

#[test]
fn session_link_is_fixed_origin_and_rejects_path_injection() {
    assert_eq!(
        SessionId::parse("cse_test").unwrap().web_url(),
        "https://claude.ai/code/cse_test"
    );
    assert!(SessionId::parse("cse_x/../../other").is_err());
}

#[derive(Clone, Default)]
struct ModelCloud {
    sends: Arc<Mutex<Vec<serde_json::Value>>>,
    reject: Arc<std::sync::atomic::AtomicBool>,
    reject_model: Arc<std::sync::atomic::AtomicBool>,
}
impl Cloud for ModelCloud {
    async fn recent_sessions(&self) -> Result<Vec<SessionId>> {
        Ok(Vec::new())
    }
    async fn send(&self, _: &SessionId, payload: serde_json::Value) -> Result<()> {
        if self.reject.load(Ordering::SeqCst) {
            return Err(Error::Network);
        }
        self.sends.lock().await.push(payload);
        Ok(())
    }
    async fn send_batch(&self, _: &SessionId, payloads: Vec<serde_json::Value>) -> Result<()> {
        assert_eq!(payloads.len(), 2);
        assert_eq!(payloads[0]["request"]["subtype"], "set_model");
        assert_eq!(payloads[1]["type"], "user");
        self.sends.lock().await.extend(payloads);
        Ok(())
    }
    async fn history(&self, _: &SessionId) -> Result<Vec<Event>> {
        Ok(vec![Event {
            kind: "client_event".into(),
            sequence: Some(0),
            data: json!({"payload":{"type":"control_response","response":{"subtype":"success","response":{"models":[
    {"value":"default","displayName":"Default"},
    {"value":"opus","displayName":"Opus"},
    {"value":"sonnet","displayName":"Sonnet"},
    {"value":"haiku","displayName":"Haiku"}]}}}}),
        }])
    }
    async fn stream(&self, _: &SessionId, _: Option<u64>) -> Result<Events> {
        let before = self.sends.lock().await.len();
        let cloud = self.clone();
        Ok(futures::stream::once(async move {
            let sent = loop {
                let sends = cloud.sends.lock().await;
                if sends.len() >= before + 2 { break sends[before..].to_vec(); }
                drop(sends);
                tokio::task::yield_now().await;
            };
            vec![
                Ok(Event { kind:"client_event".into(), sequence:Some(1), data:json!({"payload":{"type":"control_response","response":{"subtype":"error","request_id":"unrelated"}}}) }),
                Ok(Event { kind:"client_event".into(), sequence:Some(2), data:json!({"payload":{"type":"control_response","response":{"subtype":if cloud.reject_model.load(Ordering::SeqCst) { "error" } else { "success" },"request_id":sent[0]["request_id"]}}}) }),
                Ok(Event { kind:"client_event".into(), sequence:Some(3), data:json!({"payload":{"type":"result","uuid":"result","subtype":"success","user_message_uuid":sent[1]["uuid"],"usage":{}}}) }),
            ]
        }).flat_map(futures::stream::iter).boxed())
    }
}

#[tokio::test]
async fn idle_model_preference_does_not_wait_for_worker_and_failed_sends_preserve_it() {
    let cloud = ModelCloud::default();
    let session = Session::new(cloud.clone(), SessionId::parse("cse_test").unwrap());
    session
        .set_model(Model::parse("opus").unwrap())
        .await
        .unwrap();
    assert_eq!(session.model().await, Model::parse("opus").unwrap());
    assert_eq!(cloud.sends.lock().await[0]["request"]["model"], "opus");
    assert!(session.cursor.lock().await.is_none());
    cloud.reject.store(true, Ordering::SeqCst);
    assert!(matches!(
        session.set_model(Model::parse("haiku").unwrap()).await,
        Err(Error::Network)
    ));
    assert_eq!(session.model().await, Model::parse("opus").unwrap());
    cloud.reject.store(false, Ordering::SeqCst);
    session.set_model(Model::default()).await.unwrap();
    assert!(cloud.sends.lock().await.last().unwrap()["request"]["model"].is_null());
}

#[tokio::test]
async fn provider_rejection_of_own_model_request_interrupts_and_fails_the_turn() {
    let cloud = ModelCloud::default();
    cloud.reject_model.store(true, Ordering::SeqCst);
    let session = Session::with_model(
        cloud.clone(),
        SessionId::parse("cse_test").unwrap(),
        Model::parse("opus").unwrap(),
    );
    assert!(matches!(
        session.prompt("hello".into(), |_| Ok(())).await,
        Err(Error::ModelUnavailable)
    ));
    assert_eq!(
        cloud.sends.lock().await.last().unwrap()["request"]["subtype"],
        "interrupt"
    );
}

#[tokio::test]
async fn restored_model_is_batched_before_next_prompt_and_busy_changes_are_rejected() {
    let cloud = ModelCloud::default();
    let session = Session::with_model(
        cloud.clone(),
        SessionId::parse("cse_test").unwrap(),
        Model::parse("haiku").unwrap(),
    );
    let admitted = session.prompt_admission.lock().await;
    assert!(matches!(
        session.set_model(Model::parse("opus").unwrap()).await,
        Err(Error::Busy)
    ));
    drop(admitted);
    session.prompt("hello".into(), |_| Ok(())).await.unwrap();
    assert_eq!(cloud.sends.lock().await[0]["request"]["model"], "haiku");
    assert_eq!(cloud.sends.lock().await[1]["type"], "user");
}

#[tokio::test]
async fn default_is_also_reset_in_the_prompt_batch() {
    let cloud = ModelCloud::default();
    let session = Session::new(cloud.clone(), SessionId::parse("cse_test").unwrap());
    session.prompt("hello".into(), |_| Ok(())).await.unwrap();
    assert!(cloud.sends.lock().await[0]["request"]["model"].is_null());
}

#[tokio::test]
async fn malformed_foreign_record_is_not_silently_skipped_on_retry() {
    let cloud = ReconnectingCloud::default();
    *cloud.history.lock().await = vec![Event {
        kind: "client_event".into(),
        sequence: Some(1),
        data: json!({"payload":{"type":"assistant","uuid":"invalid","message":{}}}),
    }];
    let session = Session::new(cloud, SessionId::parse("cse_test").unwrap());
    for _ in 0..2 {
        assert!(
            session
                .sync_foreign(|_| panic!("invalid record"))
                .await
                .is_err()
        );
        assert!(session.cursor.lock().await.is_none());
    }
}
