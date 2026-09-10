use super::super::test::*;
use super::*;
use messages::domain::api::MockMessageServiceApi;
use std::sync::Mutex;

struct Responder {
    prompts: Mutex<Vec<String>>,
    revoke: Option<Arc<Access>>,
    result: &'static str,
}
#[async_trait::async_trait]
impl AgentResponder for Responder {
    async fn respond(&self, user_id: &str, prompt: String) -> anyhow::Result<String> {
        assert_eq!(user_id, user().as_ref());
        self.prompts.lock().unwrap().push(prompt);
        if let Some(access) = &self.revoke {
            access.revoke();
        }
        if self.result == "error" {
            anyhow::bail!("model error");
        }
        Ok(self.result.into())
    }
}
fn invocation(trigger: &messages::domain::models::Message) -> BotEvent {
    BotEvent {
        trigger: BotTrigger::Mention,
        message: event(trigger),
        reply_thread_id: trigger.root_id(),
        requesting_user: user(),
    }
}
fn expect_placeholder(api: &mut MockMessageServiceApi) {
    api.expect_post().once().returning(|access, input| {
        assert_eq!(
            access.get_authenticated_bot_auth().unwrap().bot_id(),
            bot_id::MACRO_AI_BOT_ID
        );
        assert_eq!(access.acting_user_id(), Some(&user()));
        assert_eq!(input.thread_id, Some(Uuid::from_u128(1)));
        assert_eq!(
            input.notification_policy,
            PostMessageNotificationPolicy::Silent
        );
        assert_eq!(input.content, THINKING_MESSAGE);
        Ok(message(3, input.thread_id, &input.content))
    });
}
#[tokio::test]
async fn document_invocation_reads_its_thread_and_delivers_a_bot_reply_with_comment_policy() {
    let root = message(1, None, "Selected paragraph discussion");
    let trigger = message(2, Some(root.id), "@macro explain this");
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(root, vec![trigger.clone()]));
    expect_placeholder(&mut api);
    api.expect_patch().once().returning(|access, id, input| {
        assert_eq!(access.entity().entity_id, parent().entity_id());
        assert_eq!(id, Uuid::from_u128(3));
        assert_eq!(input.content.as_deref(), Some("the answer"));
        assert_eq!(
            input.notification_policy,
            PatchMessageNotificationPolicy::NotifyAsPostedMessage
        );
        Ok(message(
            3,
            Some(Uuid::from_u128(1)),
            input.content.as_deref().unwrap(),
        ))
    });
    let responder = Arc::new(Responder {
        prompts: Mutex::new(vec![]),
        revoke: None,
        result: "the answer",
    });
    let handler = MacroAiHandler::new(
        Arc::new(api),
        Arc::new(Access::default()),
        responder.clone(),
    );
    handler.handle(&invocation(&trigger)).await.unwrap();
    let prompts = responder.prompts.lock().unwrap();
    assert!(prompts[0].contains("discussion-document"));
    assert!(prompts[0].contains("Selected paragraph discussion"));
    assert!(prompts[0].contains(MENTION_TRIGGER_MARKER));
    assert!(!prompts[0].contains("<channel_background>"));
}
#[tokio::test]
async fn root_comment_is_valid_agent_context_before_any_replies_exist() {
    let trigger = message(1, None, "@macro help with this document");
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(trigger.clone(), vec![]));
    let responder = Arc::new(Responder {
        prompts: Mutex::new(vec![]),
        revoke: None,
        result: "reply",
    });
    let handler = MacroAiHandler::new(Arc::new(api), Arc::new(Access::default()), responder);
    let prompt = handler.build_prompt(&invocation(&trigger)).await.unwrap();
    assert_eq!(prompt.matches("@macro help with this document").count(), 1);
    assert!(prompt.contains("<thread>"));
}
#[tokio::test]
async fn revoked_document_access_prevents_context_reads_and_agent_work() {
    let trigger = message(1, None, "@macro help");
    let access = Arc::new(Access::default());
    access.revoke();
    let responder = Arc::new(Responder {
        prompts: Mutex::new(vec![]),
        revoke: None,
        result: "reply",
    });
    let handler = MacroAiHandler::new(
        Arc::new(MockMessageServiceApi::new()),
        access,
        responder.clone(),
    );
    assert!(handler.handle(&invocation(&trigger)).await.is_err());
    assert!(responder.prompts.lock().unwrap().is_empty());
}
#[tokio::test]
async fn revocation_while_model_runs_prevents_answer_delivery() {
    let trigger = message(1, None, "@macro help");
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(trigger.clone(), vec![]));
    expect_placeholder(&mut api);
    let access = Arc::new(Access::default());
    let responder = Arc::new(Responder {
        prompts: Mutex::new(vec![]),
        revoke: Some(access.clone()),
        result: "private answer",
    });
    let handler = MacroAiHandler::new(Arc::new(api), access, responder);
    assert!(handler.handle(&invocation(&trigger)).await.is_err());
}
#[tokio::test]
async fn deleted_placeholder_does_not_recreate_a_response() {
    let trigger = message(1, None, "@macro help");
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(trigger.clone(), vec![]));
    expect_placeholder(&mut api);
    api.expect_patch()
        .once()
        .returning(|_, _, _| Err(MessageError::NotFound));
    let responder = Arc::new(Responder {
        prompts: Mutex::new(vec![]),
        revoke: None,
        result: "answer",
    });
    MacroAiHandler::new(Arc::new(api), Arc::new(Access::default()), responder)
        .handle(&invocation(&trigger))
        .await
        .unwrap();
}
#[tokio::test]
async fn inference_prompt_describes_a_follow_up_without_claiming_a_mention() {
    let root = message(1, None, "initial question");
    let trigger = message(2, Some(root.id), "what about tomorrow?");
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(root, vec![trigger.clone()]));
    let mut event = invocation(&trigger);
    event.trigger = BotTrigger::Inferred;
    let responder = Arc::new(Responder {
        prompts: Mutex::new(vec![]),
        revoke: None,
        result: "reply",
    });
    let prompt = MacroAiHandler::new(Arc::new(api), Arc::new(Access::default()), responder)
        .build_prompt(&event)
        .await
        .unwrap();
    assert!(prompt.contains(INFERRED_TRIGGER_MARKER));
    assert!(!prompt.contains(MENTION_TRIGGER_MARKER));
}
#[tokio::test]
async fn channel_context_keeps_other_threads_as_background() {
    let parent = MessageParent::Channel(Uuid::from_u128(900));
    let mut root = message(1, None, "thread subject");
    root.parent = parent.clone();
    let mut trigger = message(2, Some(root.id), "@macro explain this");
    trigger.parent = parent.clone();
    let mut nearby = message(4, None, "unrelated channel background");
    nearby.parent = parent;
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(root, vec![trigger.clone()]));
    api.expect_preceding()
        .once()
        .returning(move |_, _, _| Ok(vec![nearby.clone()]));
    let responder = Arc::new(Responder {
        prompts: Mutex::new(vec![]),
        revoke: None,
        result: "reply",
    });
    let prompt = MacroAiHandler::new(Arc::new(api), Arc::new(Access::default()), responder)
        .build_prompt(&invocation(&trigger))
        .await
        .unwrap();
    assert!(
        prompt.find("thread subject").unwrap()
            < prompt.find("unrelated channel background").unwrap()
    );
    assert!(prompt.contains("<channel_background>"));
}
#[tokio::test]
async fn unavailable_context_blocks_instead_of_prompting_from_an_unverified_event() {
    let trigger = message(1, None, "@macro help");
    let mut api = MockMessageServiceApi::new();
    api.expect_get()
        .once()
        .returning(|_, _| Err(MessageError::NotFound));
    let responder = Arc::new(Responder {
        prompts: Mutex::new(vec![]),
        revoke: None,
        result: "reply",
    });
    let handler = MacroAiHandler::new(
        Arc::new(api),
        Arc::new(Access::default()),
        responder.clone(),
    );
    assert!(handler.handle(&invocation(&trigger)).await.is_err());
    assert!(responder.prompts.lock().unwrap().is_empty());
}
