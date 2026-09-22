use super::*;
use ai_tools::user_tool_review::ReviewForm;
use tokio::sync::mpsc;

fn channel() -> (
    Arc<VoiceReviewChannel>,
    mpsc::UnboundedReceiver<ToServerMessage>,
) {
    let (updates, receive) = mpsc::unbounded_channel();
    (
        Arc::new(VoiceReviewChannel {
            session_id: SessionId::new("canonical-session"),
            updates,
            pending: Mutex::new(HashMap::new()),
            lifetime: CancellationToken::new(),
        }),
        receive,
    )
}

fn response(id: &Value, result: Value) -> RawJsonRpcMessage {
    serde_json::from_value(json!({"jsonrpc":"2.0", "id":id, "result":result})).unwrap()
}

#[tokio::test]
async fn review_uses_canonical_tool_scope_and_requires_the_matching_answer() {
    let (channel, mut receive) = channel();
    let task = tokio::spawn({
        let channel = channel.clone();
        async move {
            channel
                .review(ReviewRequest {
                    tool_name: "SendEmail".to_owned(),
                    tool_call_id: "call-1".to_owned(),
                    message: "Send this email?".to_owned(),
                    draft: json!({"body":"draft"}),
                    form: ReviewForm::default(),
                })
                .await
        }
    });
    let ToServerMessage::Acp(AcpMessage(request)) = receive.recv().await.unwrap() else {
        panic!("expected ACP");
    };
    let request = serde_json::to_value(request).unwrap();
    assert_eq!(request["method"], "elicitation/create");
    assert_eq!(
        request["params"]["_meta"]["macro"]["userTool"]["name"],
        "SendEmail"
    );
    assert!(request["params"].to_string().contains("canonical-session"));
    assert!(request["params"].to_string().contains("call-1"));
    assert!(!channel.handle_response(&response(
        &json!("stale-review"),
        json!({"action":"accept"})
    )));
    assert!(!task.is_finished());
    assert!(channel.handle_response(&response(&request["id"], json!({"action":"decline"}))));
    assert_eq!(task.await.unwrap().unwrap(), ReviewOutcome::Declined);
    assert!(!channel.handle_response(&response(&request["id"], json!({"action":"accept"}))));
}

#[tokio::test]
async fn runtime_close_cancels_pending_review_without_an_approval() {
    let (channel, mut receive) = channel();
    let task = tokio::spawn({
        let channel = channel.clone();
        async move {
            channel
                .ask(UserInputRequest {
                    question: "Choose".to_owned(),
                    options: vec!["one".to_owned()],
                })
                .await
        }
    });
    receive.recv().await.unwrap();
    channel.lifetime.cancel();
    assert!(task.await.unwrap().is_err());
    assert!(channel.pending.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_choice_is_not_accepted_as_user_input() {
    let (channel, mut receive) = channel();
    let task = tokio::spawn({
        let channel = channel.clone();
        async move {
            channel
                .ask(UserInputRequest {
                    question: "Choose".to_owned(),
                    options: vec!["one".to_owned()],
                })
                .await
        }
    });
    let ToServerMessage::Acp(AcpMessage(request)) = receive.recv().await.unwrap() else {
        panic!("expected ACP");
    };
    let request = serde_json::to_value(request).unwrap();
    channel.handle_response(&response(
        &request["id"],
        json!({"action":"accept", "content":{"answer":"two"}}),
    ));
    assert!(matches!(
        task.await.unwrap(),
        Err(UserInputError::InvalidAnswer(_))
    ));
}
