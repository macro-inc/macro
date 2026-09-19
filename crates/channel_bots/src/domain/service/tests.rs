use super::super::test::*;
use super::*;
use async_trait::async_trait;
use chrono::{TimeZone as _, Utc};
use messages::domain::api::MockMessageServiceApi;
use std::sync::Mutex;

struct Responder {
    prompts: Mutex<Vec<String>>,
    revoke: Option<Arc<Access>>,
    result: &'static str,
}

#[async_trait]
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

fn responder(result: &'static str) -> Arc<Responder> {
    Arc::new(Responder {
        prompts: Mutex::new(vec![]),
        revoke: None,
        result,
    })
}

struct FixedTimeZones(Option<&'static str>);

#[async_trait]
impl UserTimeZones for FixedTimeZones {
    async fn primary_time_zone(&self, _user_id: &str) -> Option<String> {
        self.0.map(str::to_string)
    }
}

fn eastern_time_zones() -> Arc<FixedTimeZones> {
    Arc::new(FixedTimeZones(Some("America/New_York")))
}

fn handler(
    api: MockMessageServiceApi,
    access: Arc<Access>,
    responder: Arc<Responder>,
) -> MacroAiHandler<Responder, FixedTimeZones> {
    MacroAiHandler::new(Arc::new(api), access, responder, eastern_time_zones())
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
        assert_eq!(input.attribution, MessageAttribution::ActingUser);
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
    let responder = responder("the answer");
    handler(api, Arc::new(Access::default()), responder.clone())
        .handle(&invocation(&trigger))
        .await
        .unwrap();
    let prompts = responder.prompts.lock().unwrap();
    assert!(prompts[0].contains("discussion-document"));
    assert!(prompts[0].contains("mentioned you (@macro) in a document discussion."));
    assert!(prompts[0].contains("Selected paragraph discussion"));
    assert!(prompts[0].contains(MENTION_TRIGGER_MARKER));
    assert!(!prompts[0].contains("<channel_background>"));
    assert!(prompts[0].ends_with("Reply to person."));
}

#[tokio::test]
async fn root_comment_is_valid_agent_context_before_any_replies_exist() {
    let trigger = message(1, None, "@macro help with this document");
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(trigger.clone(), vec![]));
    let prompt = handler(api, Arc::new(Access::default()), responder("reply"))
        .build_prompt(&invocation(&trigger))
        .await
        .unwrap();
    assert_eq!(prompt.matches("@macro help with this document").count(), 1);
    assert!(prompt.contains("<thread>"));
}

#[tokio::test]
async fn revoked_document_access_prevents_context_reads_and_agent_work() {
    let trigger = message(1, None, "@macro help");
    let access = Arc::new(Access::default());
    access.revoke();
    let responder = responder("reply");
    let handler = handler(MockMessageServiceApi::new(), access, responder.clone());
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
    assert!(
        handler(api, access, responder)
            .handle(&invocation(&trigger))
            .await
            .is_err()
    );
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
    handler(api, Arc::new(Access::default()), responder("answer"))
        .handle(&invocation(&trigger))
        .await
        .unwrap();
}

#[tokio::test]
async fn responder_failure_still_replaces_the_placeholder_with_a_fallback() {
    let trigger = message(1, None, "@macro help");
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(trigger.clone(), vec![]));
    expect_placeholder(&mut api);
    api.expect_patch().once().returning(|_, id, input| {
        assert_eq!(input.content.as_deref(), Some(ERROR_FALLBACK));
        Ok(message(
            3,
            Some(Uuid::from_u128(1)),
            &input.content.unwrap(),
        ))
        .map(|mut m| {
            m.id = id;
            m
        })
    });
    handler(api, Arc::new(Access::default()), responder("error"))
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
    let prompt = handler(api, Arc::new(Access::default()), responder("reply"))
        .build_prompt(&event)
        .await
        .unwrap();
    assert!(prompt.contains("replied in a document discussion you are part of."));
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
    let prompt = handler(api, Arc::new(Access::default()), responder("reply"))
        .build_prompt(&invocation(&trigger))
        .await
        .unwrap();
    assert!(prompt.contains("mentioned you (@macro) in a channel thread."));
    assert!(
        prompt.find("thread subject").unwrap()
            < prompt.find("unrelated channel background").unwrap()
    );
    assert!(prompt.contains("<channel_background>"));
}

#[tokio::test]
async fn top_level_channel_mention_marks_the_trigger_inline_in_channel_context() {
    let parent = MessageParent::Channel(Uuid::from_u128(900));
    let mut trigger = message(2, None, "@macro help");
    trigger.parent = parent.clone();
    let mut before = message(1, None, "before");
    before.parent = parent;
    before.sender_id = channel_sender::ChannelSender::new_from_user(
        "macro|alice@example.com".to_string().try_into().unwrap(),
    );
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(trigger.clone(), vec![]));
    api.expect_preceding()
        .once()
        .returning(move |_, id, limit| {
            assert_eq!(id, Uuid::from_u128(2));
            assert_eq!(limit, CONTEXT_MESSAGES_BEFORE);
            Ok(vec![before.clone()])
        });
    let prompt = handler(api, Arc::new(Access::default()), responder("reply"))
        .build_prompt(&invocation(&trigger))
        .await
        .unwrap();

    assert!(prompt.contains("mentioned you (@macro) in a channel."));
    assert!(prompt.contains("<channel_context>"));
    assert!(prompt.contains("alice: before"));
    assert!(prompt.contains("person [this message mentioned you]: @macro help"));
    // The trigger appears once, inline, not repeated at the end.
    assert_eq!(prompt.matches("@macro help").count(), 1);
    assert!(!prompt.contains("<thread>"));
    assert!(prompt.ends_with("Reply to person."));
}

#[tokio::test]
async fn unavailable_context_blocks_instead_of_prompting_from_an_unverified_event() {
    let trigger = message(1, None, "@macro help");
    let mut api = MockMessageServiceApi::new();
    api.expect_get()
        .once()
        .returning(|_, _| Err(MessageError::NotFound));
    let responder = responder("reply");
    let handler = handler(api, Arc::new(Access::default()), responder.clone());
    assert!(handler.handle(&invocation(&trigger)).await.is_err());
    assert!(responder.prompts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_trigger_that_moved_threads_or_changed_author_is_not_prompted() {
    let trigger = message(1, None, "@macro help");
    let mut relocated = trigger.clone();
    relocated.sender_id = channel_sender::ChannelSender::new_from_user(
        "macro|someone-else@example.com"
            .to_string()
            .try_into()
            .unwrap(),
    );
    let mut api = MockMessageServiceApi::new();
    api.expect_get()
        .once()
        .returning(move |_, _| Ok(relocated.clone()));
    let responder = responder("reply");
    let handler = handler(api, Arc::new(Access::default()), responder.clone());
    assert!(handler.handle(&invocation(&trigger)).await.is_err());
    assert!(responder.prompts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn prompt_carries_the_current_time_in_the_users_zone() {
    let trigger = message(1, None, "@macro help");
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(trigger.clone(), vec![]));
    let prompt = handler(api, Arc::new(Access::default()), responder("reply"))
        .build_prompt(&invocation(&trigger))
        .await
        .unwrap();

    assert!(prompt.contains("<current_time>"));
    assert!(prompt.contains("America/New_York, the time zone of the user's primary calendar"));
    assert!(prompt.ends_with("Reply to person."));
}

#[tokio::test]
async fn prompt_says_the_time_zone_is_unknown_without_a_calendar() {
    let trigger = message(1, None, "@macro help");
    let mut api = MockMessageServiceApi::new();
    configure_reads(&mut api, &trigger, thread(trigger.clone(), vec![]));
    let prompt = MacroAiHandler::new(
        Arc::new(api),
        Arc::new(Access::default()),
        responder("reply"),
        Arc::new(FixedTimeZones(None)),
    )
    .build_prompt(&invocation(&trigger))
    .await
    .unwrap();

    assert!(prompt.contains("UTC; the user's own time zone is unknown"));
}

#[test]
fn current_time_block_renders_the_users_zone() {
    let now = Utc.with_ymd_and_hms(2026, 1, 6, 18, 23, 0).unwrap();
    assert_eq!(
        current_time_block(now, Some("America/New_York")),
        "\n<current_time>\nTuesday, January 6, 2026, 1:23 PM — America/New_York, the time zone \
         of the user's primary calendar\n</current_time>\n"
    );
}

#[test]
fn current_time_block_falls_back_to_utc_for_missing_or_bad_zones() {
    let now = Utc.with_ymd_and_hms(2026, 1, 6, 18, 23, 0).unwrap();
    assert_eq!(
        current_time_block(now, None),
        "\n<current_time>\nTuesday, January 6, 2026, 6:23 PM — UTC; the user's own \
         time zone is unknown (no connected calendar)\n</current_time>\n"
    );
    // An unparseable zone still means a calendar is connected, so the line
    // must not claim otherwise.
    assert_eq!(
        current_time_block(now, Some("Not/AZone")),
        "\n<current_time>\nTuesday, January 6, 2026, 6:23 PM — UTC; the user's own \
         time zone is unknown (their calendar's time zone could not be \
         interpreted)\n</current_time>\n"
    );
}
