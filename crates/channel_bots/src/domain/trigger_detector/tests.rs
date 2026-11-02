use super::super::test::*;
use super::*;
use messages::domain::{api::MockMessageServiceApi, models::SimpleMention};
use std::sync::Mutex;

struct Classifier {
    answer: Result<bool, &'static str>,
    calls: Mutex<Vec<Vec<TranscriptMessage>>>,
}
#[async_trait]
impl InferredTriggerClassifier for Classifier {
    async fn expects_response(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'static>,
        thread: &[TranscriptMessage],
    ) -> anyhow::Result<bool> {
        self.calls.lock().unwrap().push(thread.to_vec());
        self.answer.map_err(|error| anyhow::anyhow!(error))
    }
}
fn classifier(answer: Result<bool, &'static str>) -> Arc<Classifier> {
    Arc::new(Classifier {
        answer,
        calls: Mutex::new(vec![]),
    })
}
#[tokio::test]
async fn admission_failure_suppresses_inference_without_fallback() {
    for failure in admission_failures() {
        let mut root = message(1, None, "previous answer");
        root.sender_id = channel_sender::ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
        let trigger = message(2, Some(root.id), "continue");
        let mut api = MockMessageServiceApi::new();
        configure_reads(&mut api, &trigger, thread(root, vec![trigger.clone()]));
        let classifier = classifier(Ok(true));
        let admission = Admission::new(Err(failure));
        let detector = MentionOrInferredDetector::new(
            Arc::new(api),
            Arc::new(Access::default()),
            classifier.clone(),
        )
        .with_admission(admission.clone());
        assert!(detector.detect(&event(&trigger)).await.is_empty());
        assert!(classifier.calls.lock().unwrap().is_empty());
        assert_eq!(admission.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn document_mention_triggers_each_canonical_bot_once_without_classification() {
    let mut trigger = message(1, None, "@macro help");
    let mention = SimpleMention {
        entity_type: "user".into(),
        entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
    };
    trigger.mentions = vec![mention.clone(), mention];
    let classifier = classifier(Ok(false));
    let admission = Admission::new(Err(ai_billing::AiAdmissionError::Unavailable));
    let detector = MentionOrInferredDetector::new(
        Arc::new(MockMessageServiceApi::new()),
        Arc::new(Access::default()),
        classifier.clone(),
    )
    .with_admission(admission.clone());
    assert_eq!(
        detector.detect(&event(&trigger)).await,
        vec![BotInvocation {
            bot_id: bot_id::MACRO_AI_BOT_ID,
            trigger: BotTrigger::Mention
        }]
    );
    assert!(classifier.calls.lock().unwrap().is_empty());
    assert_eq!(admission.calls.load(std::sync::atomic::Ordering::SeqCst), 0);
}
#[tokio::test]
async fn unattributed_bot_messages_never_trigger_another_response() {
    let mut trigger = message(1, None, "@macro help");
    trigger.sender_id = channel_sender::ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
    trigger.mentions = vec![SimpleMention {
        entity_type: "bot".into(),
        entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
    }];
    let access = Arc::new(Access::default());
    access.revoke();
    let classifier = classifier(Ok(true));
    let detector = MentionOrInferredDetector::new(
        Arc::new(MockMessageServiceApi::new()),
        access,
        classifier.clone(),
    );
    assert!(detector.detect(&event(&trigger)).await.is_empty());
    assert!(classifier.calls.lock().unwrap().is_empty());
}
#[tokio::test]
async fn root_without_mention_is_never_inferred() {
    let classifier = classifier(Ok(true));
    let detector = MentionOrInferredDetector::new(
        Arc::new(MockMessageServiceApi::new()),
        Arc::new(Access::default()),
        classifier.clone(),
    );
    assert!(
        detector
            .detect(&event(&message(1, None, "hello")))
            .await
            .is_empty()
    );
    assert!(classifier.calls.lock().unwrap().is_empty());
}
#[tokio::test]
async fn inferred_document_follow_up_requires_prior_agent_participation_and_classifier_agreement() {
    for (prior_agent, answer, expected) in [
        (true, Ok(true), true),
        (false, Ok(true), false),
        (true, Ok(false), false),
        (true, Err("provider failed"), false),
    ] {
        let root = message(1, None, "question");
        let mut previous = message(2, Some(root.id), "previous answer");
        if prior_agent {
            previous.sender_id =
                channel_sender::ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
        }
        let trigger = message(3, Some(root.id), "can you expand on that?");
        let mut api = MockMessageServiceApi::new();
        configure_reads(
            &mut api,
            &trigger,
            thread(root, vec![previous, trigger.clone()]),
        );
        let classifier = classifier(answer);
        let detector = MentionOrInferredDetector::new(
            Arc::new(api),
            Arc::new(Access::default()),
            classifier.clone(),
        );
        let result = detector.detect(&event(&trigger)).await;
        assert_eq!(!result.is_empty(), expected);
        if expected {
            assert_eq!(result[0].trigger, BotTrigger::Inferred);
        }
        assert_eq!(!classifier.calls.lock().unwrap().is_empty(), prior_agent);
    }
}
#[tokio::test]
async fn access_revocation_suppresses_explicit_and_inferred_document_triggers() {
    let access = Arc::new(Access::default());
    access.revoke();
    let classifier = classifier(Ok(true));
    let detector = MentionOrInferredDetector::new(
        Arc::new(MockMessageServiceApi::new()),
        access,
        classifier.clone(),
    );
    let mut trigger = message(2, Some(Uuid::from_u128(1)), "please continue");
    assert!(detector.detect(&event(&trigger)).await.is_empty());
    trigger.mentions.push(SimpleMention {
        entity_type: "bot".into(),
        entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
    });
    assert!(detector.detect(&event(&trigger)).await.is_empty());
    assert!(classifier.calls.lock().unwrap().is_empty());
}
#[tokio::test]
async fn unavailable_history_cannot_be_replaced_by_an_unverified_event_transcript() {
    let mut api = MockMessageServiceApi::new();
    api.expect_get()
        .once()
        .returning(|_, _| Err(messages::domain::ports::MessageError::NotFound));
    let classifier = classifier(Ok(true));
    let detector = MentionOrInferredDetector::new(
        Arc::new(api),
        Arc::new(Access::default()),
        classifier.clone(),
    );
    assert!(
        detector
            .detect(&event(&message(2, Some(Uuid::from_u128(1)), "continue")))
            .await
            .is_empty()
    );
    assert!(classifier.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn attributed_bots_require_an_explicit_other_bot_mention_and_current_access() {
    for (source, mention, revoked, expected) in [
        (bot_id::CURSOR_BOT_ID, true, false, true),
        (bot_id::MACRO_AI_BOT_ID, true, false, false),
        (bot_id::CURSOR_BOT_ID, false, false, false),
        (bot_id::CURSOR_BOT_ID, true, true, false),
    ] {
        let mut trigger = message(2, Some(Uuid::from_u128(1)), "help");
        trigger.sender_id = channel_sender::ChannelSender::new_from_bot(source);
        trigger.triggered_by = Some(user().to_string());
        if mention {
            trigger.mentions = vec![SimpleMention {
                entity_type: "bot".into(),
                entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
            }];
        }
        let access = Arc::new(Access::default());
        if revoked {
            access.revoke();
        }
        let classifier = classifier(Ok(true));
        let mut api = MockMessageServiceApi::new();
        configure_reads(
            &mut api,
            &trigger,
            thread(message(1, None, "@cursor look"), vec![trigger.clone()]),
        );
        let detector = MentionOrInferredDetector::new(Arc::new(api), access, classifier.clone());
        assert_eq!(
            !detector.detect(&event(&trigger)).await.is_empty(),
            expected
        );
        assert!(classifier.calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn agents_handing_a_thread_back_and_forth_stop_at_the_hop_limit() {
    let by = |id: u128, bot: bot_id::BotId| {
        let mut reply = message(id, Some(Uuid::from_u128(1)), "over to you");
        reply.sender_id = channel_sender::ChannelSender::new_from_bot(bot);
        reply.triggered_by = Some(user().to_string());
        reply.mentions = vec![SimpleMention {
            entity_type: "bot".into(),
            entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
        }];
        reply
    };
    for (hop, expected) in [
        (messages::domain::agent_hops::MAX_AGENT_HOPS, true),
        (messages::domain::agent_hops::MAX_AGENT_HOPS + 1, false),
    ] {
        // Cursor posts hop `hop`; Macro and Cursor alternate before it.
        let mut replies: Vec<_> = (1..hop)
            .map(|n| {
                let bot = if (hop - n) % 2 == 0 {
                    bot_id::CURSOR_BOT_ID
                } else {
                    bot_id::MACRO_AI_BOT_ID
                };
                by(1 + n as u128, bot)
            })
            .collect();
        let trigger = by(10_000, bot_id::CURSOR_BOT_ID);
        replies.push(trigger.clone());
        let mut api = MockMessageServiceApi::new();
        configure_reads(
            &mut api,
            &trigger,
            thread(message(1, None, "@macro ask cursor"), replies),
        );
        let detector = MentionOrInferredDetector::new(
            Arc::new(api),
            Arc::new(Access::default()),
            classifier(Ok(true)),
        );
        assert_eq!(
            !detector.detect(&event(&trigger)).await.is_empty(),
            expected,
            "hop {hop}"
        );
    }
}

#[tokio::test]
async fn an_agents_follow_up_is_inferred_for_macro_and_labelled_by_its_name() {
    let root = message(1, None, "question");
    let mut answer = message(2, Some(root.id), "previous answer");
    answer.sender_id = channel_sender::ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
    let mut trigger = message(3, Some(root.id), "Macro, can you double-check this?");
    trigger.sender_id = channel_sender::ChannelSender::new_from_bot(bot_id::CURSOR_BOT_ID);
    trigger.triggered_by = Some(user().to_string());
    trigger.bot_profile = Some(messages::domain::models::BotSenderProfile {
        name: "Cursor".to_owned(),
        avatar_url: None,
    });
    let mut api = MockMessageServiceApi::new();
    configure_reads(
        &mut api,
        &trigger,
        thread(root, vec![answer, trigger.clone()]),
    );
    let classifier = classifier(Ok(true));
    let detector = MentionOrInferredDetector::new(
        Arc::new(api),
        Arc::new(Access::default()),
        classifier.clone(),
    );

    assert_eq!(
        detector.detect(&event(&trigger)).await,
        vec![BotInvocation {
            bot_id: bot_id::MACRO_AI_BOT_ID,
            trigger: BotTrigger::Inferred,
        }]
    );
    let calls = classifier.calls.lock().unwrap();
    let judged = calls[0].last().unwrap();
    assert_eq!(judged.sender, "Cursor");
    assert!(!judged.from_agent);
}

#[tokio::test]
async fn macro_never_infers_a_reply_to_its_own_message() {
    let root = message(1, None, "question");
    let mut answer = message(2, Some(root.id), "previous answer");
    answer.sender_id = channel_sender::ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
    let mut trigger = message(3, Some(root.id), "anything else?");
    trigger.sender_id = channel_sender::ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
    trigger.triggered_by = Some(user().to_string());
    let mut api = MockMessageServiceApi::new();
    configure_reads(
        &mut api,
        &trigger,
        thread(root, vec![answer, trigger.clone()]),
    );
    let classifier = classifier(Ok(true));
    let detector = MentionOrInferredDetector::new(
        Arc::new(api),
        Arc::new(Access::default()),
        classifier.clone(),
    );

    assert!(detector.detect(&event(&trigger)).await.is_empty());
    assert!(classifier.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unattributed_agent_follow_up_infers_nothing() {
    let mut trigger = message(3, Some(Uuid::from_u128(1)), "Macro, thoughts?");
    trigger.sender_id = channel_sender::ChannelSender::new_from_bot(bot_id::CURSOR_BOT_ID);
    let classifier = classifier(Ok(true));
    let detector = MentionOrInferredDetector::new(
        Arc::new(MockMessageServiceApi::new()),
        Arc::new(Access::default()),
        classifier.clone(),
    );

    assert!(detector.detect(&event(&trigger)).await.is_empty());
    assert!(classifier.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_inferred_agent_chain_stops_at_the_hop_limit_before_classifying() {
    let hop = messages::domain::agent_hops::MAX_AGENT_HOPS + 1;
    let by = |id: u128, bot: bot_id::BotId| {
        let mut reply = message(id, Some(Uuid::from_u128(1)), "your turn");
        reply.sender_id = channel_sender::ChannelSender::new_from_bot(bot);
        reply.triggered_by = Some(user().to_string());
        reply
    };
    // Cursor posts the hop past the limit; Macro and Cursor alternate before it.
    let mut replies: Vec<_> = (1..hop)
        .map(|n| {
            let bot = if (hop - n) % 2 == 0 {
                bot_id::CURSOR_BOT_ID
            } else {
                bot_id::MACRO_AI_BOT_ID
            };
            by(1 + n as u128, bot)
        })
        .collect();
    let trigger = by(10_000, bot_id::CURSOR_BOT_ID);
    replies.push(trigger.clone());
    let mut api = MockMessageServiceApi::new();
    configure_reads(
        &mut api,
        &trigger,
        thread(message(1, None, "work it out between you"), replies),
    );
    let classifier = classifier(Ok(true));
    let detector = MentionOrInferredDetector::new(
        Arc::new(api),
        Arc::new(Access::default()),
        classifier.clone(),
    );

    assert!(detector.detect(&event(&trigger)).await.is_empty());
    assert!(classifier.calls.lock().unwrap().is_empty());
}
