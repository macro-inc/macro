use std::sync::Mutex;

use chrono::Utc;
use jev::domain::{JevError, Probability};
use macro_uuid::Uuid;
use messages::domain::{events::MessageEventAttachment, models::MessageParent};

use super::*;

struct UnexpectedCaptioner;

#[async_trait::async_trait]
impl ImageCaptioner for UnexpectedCaptioner {
    async fn caption(&self, _file_id: &str, _ctx: UsageContext) -> Option<String> {
        panic!("a missing real caller must never reach image captioning");
    }
}

/// Answers with fixed probabilities and remembers what it was asked.
struct FakeClassifier {
    answer: std::result::Result<Vec<f32>, JevError>,
    asked: Mutex<Option<(Value, usize)>>,
}

impl FakeClassifier {
    fn answering(answer: std::result::Result<Vec<f32>, JevError>) -> Arc<Self> {
        Arc::new(Self {
            answer,
            asked: Mutex::new(None),
        })
    }
}

impl YesNoClassifier for FakeClassifier {
    async fn classify(
        &self,
        _usage: UsageContext,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> std::result::Result<Vec<Probability>, JevError> {
        *self.asked.lock().expect("fake lock") = Some((input.clone(), questions.len()));
        self.answer.clone().map(|answer| {
            answer
                .into_iter()
                .map(|value| Probability::new(value).expect("valid probability"))
                .collect()
        })
    }
}

fn posted(sender: channel_sender::ChannelSender<'static>) -> MessagePostedMetadata {
    MessagePostedMetadata {
        parent: MessageParent::Channel(Uuid::from_u128(1)),
        message_id: Uuid::from_u128(2),
        thread_id: Some(Uuid::from_u128(3)),
        root_id: Uuid::from_u128(3),
        sender,
        triggered_by: None,
        content: "can you also fix the tests".to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: Utc::now(),
    }
}

fn user_sender() -> channel_sender::ChannelSender<'static> {
    channel_sender::ChannelSender::new_from_user(
        macro_user_id::user_id::MacroUserIdStr::try_from_email("jev-judge-test@macro.com")
            .expect("valid user id"),
    )
}

#[tokio::test]
async fn a_non_user_sender_is_not_replaced_with_system_billing_identity() {
    let classifier = FakeClassifier::answering(Ok(vec![1.0]));
    let judge = JevTriggerJudge::new(classifier.clone(), UnexpectedCaptioner);
    let mut posted = posted(channel_sender::ChannelSender::new_from_bot(
        bot_id::MACRO_AI_BOT_ID,
    ));
    posted.attachments = vec![MessageEventAttachment {
        attachment_id: Uuid::from_u128(4),
        entity_type: "static_image".to_owned(),
        entity_id: "image-to-caption".to_owned(),
        created_at: Utc::now(),
    }];

    assert_eq!(
        judge
            .addressee_probabilities(&posted, "", 1)
            .await
            .expect("judge"),
        vec![0.0]
    );
    assert!(classifier.asked.lock().expect("fake lock").is_none());
}

#[tokio::test]
async fn asks_one_question_per_agent_about_the_thread_and_message() {
    let classifier = FakeClassifier::answering(Ok(vec![0.1, 0.9]));
    let judge = JevTriggerJudge::new(classifier.clone(), UnexpectedCaptioner);

    let probabilities = judge
        .addressee_probabilities(&posted(user_sender()), "[agent 2] on it\n", 2)
        .await
        .expect("judge");

    assert_eq!(probabilities, vec![0.1, 0.9]);
    let (input, questions) = classifier
        .asked
        .lock()
        .expect("fake lock")
        .clone()
        .expect("classifier was asked");
    assert_eq!(questions, 2);
    assert_eq!(input["thread"], "[agent 2] on it\n");
    assert_eq!(input["message"], "can you also fix the tests");
}

#[tokio::test]
async fn a_classifier_failure_is_an_error() {
    let classifier = FakeClassifier::answering(Err(JevError::Unavailable));
    let judge = JevTriggerJudge::new(classifier, UnexpectedCaptioner);

    assert!(
        judge
            .addressee_probabilities(&posted(user_sender()), "", 1)
            .await
            .is_err()
    );
}

#[test]
fn every_addressee_question_names_its_agent_and_fits_the_classifier() {
    let questions = addressee_questions(jev::domain::MAX_QUESTIONS).expect("valid questions");

    assert_eq!(questions.len(), jev::domain::MAX_QUESTIONS);
    assert!(questions[0].as_str().contains("agent 1"));
    assert!(questions[31].as_str().contains("agent 32"));
}

#[test]
fn the_judge_is_told_what_an_image_blurb_means() {
    assert!(SITUATION.contains("<this is an image of ...>"));
    assert!(SITUATION.contains("<this is an image>"));
}

#[test]
fn an_image_blurb_is_part_of_the_message_being_judged() {
    let input = judge_input("", "see this\n<this is an image of a frog>");

    assert_eq!(input["message"], "see this\n<this is an image of a frog>");
    assert_eq!(input["thread"], "");
}
