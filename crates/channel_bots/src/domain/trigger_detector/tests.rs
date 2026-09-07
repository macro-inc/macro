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
async fn document_mention_triggers_each_canonical_bot_once_without_classification() {
    let mut trigger = message(1, None, "@macro help");
    let mention = SimpleMention {
        entity_type: "user".into(),
        entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
    };
    trigger.mentions = vec![mention.clone(), mention];
    let classifier = classifier(Ok(false));
    let detector = MentionOrInferredDetector::new(
        Arc::new(MockMessageServiceApi::new()),
        Arc::new(Access::default()),
        classifier.clone(),
    );
    assert_eq!(
        detector.detect(&event(&trigger)).await,
        vec![BotInvocation {
            bot_id: bot_id::MACRO_AI_BOT_ID,
            trigger: BotTrigger::Mention
        }]
    );
    assert!(classifier.calls.lock().unwrap().is_empty());
}
#[tokio::test]
async fn bot_authored_messages_never_trigger_another_response() {
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
