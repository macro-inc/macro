use super::*;

struct UnexpectedCaptioner;

#[async_trait::async_trait]
impl ImageCaptioner for UnexpectedCaptioner {
    async fn caption(&self, _file_id: &str, _ctx: UsageContext) -> Option<String> {
        panic!("a missing real caller must never reach image captioning");
    }
}

#[tokio::test]
async fn a_non_user_sender_is_not_replaced_with_system_billing_identity() {
    use chrono::Utc;
    use macro_uuid::Uuid;
    use messages::domain::{events::MessageEventAttachment, models::MessageParent};

    let judge =
        FastModelTriggerJudge::new(Arc::new(ai_usage::NoOpUsageRecorder), UnexpectedCaptioner);
    let posted = MessagePostedMetadata {
        parent: MessageParent::Channel(Uuid::from_u128(1)),
        message_id: Uuid::from_u128(2),
        thread_id: Some(Uuid::from_u128(3)),
        root_id: Uuid::from_u128(3),
        sender: channel_sender::ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID),
        triggered_by: None,
        content: "describe this".to_owned(),
        mentions: vec![],
        attachments: vec![MessageEventAttachment {
            attachment_id: Uuid::from_u128(4),
            entity_type: "static_image".to_owned(),
            entity_id: "image-to-caption".to_owned(),
            created_at: Utc::now(),
        }],
        created_at: Utc::now(),
    };
    assert!(!judge.is_addressed_to_agent(&posted, "").await.unwrap());
}

#[test]
fn the_judge_is_told_what_an_image_blurb_means() {
    assert!(SYSTEM_PROMPT.contains("<this is an image of ...>"));
    assert!(SYSTEM_PROMPT.contains("<this is an image>"));
}

#[test]
fn an_image_blurb_is_part_of_the_message_being_judged() {
    let content = "see this\n<this is an image of a frog>";
    assert_eq!(
        judge_user_prompt("", content),
        "The message to judge:\nsee this\n<this is an image of a frog>"
    );
    assert_eq!(
        judge_user_prompt("[agent] on it\n", "see this"),
        "The thread so far:\n[agent] on it\n\nThe message to judge:\nsee this"
    );
}
