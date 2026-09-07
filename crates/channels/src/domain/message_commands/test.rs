use super::*;
use crate::domain::models::{NewChannelAttachment, Sender, SimpleMention};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
fn sender(id: &str) -> Sender {
    id.to_string().try_into().unwrap()
}
fn macro_id(id: &str) -> MacroUserIdStr<'static> {
    id.to_string().try_into().unwrap()
}
fn shared_message_fixture() -> messages::domain::models::Message {
    messages::domain::models::Message {
        id: Uuid::from_u128(501),
        parent: messages::domain::models::MessageParent::Channel(Uuid::from_u128(500)),
        thread_id: None,
        sender_id: sender("macro|sender@test.com"),
        bot_profile: None,
        triggered_by: None,
        imported_author: None,
        content: "original".into(),
        mentions: vec![SimpleMention {
            entity_type: "document".into(),
            entity_id: "doc".into(),
        }],
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    }
}

fn message_capability() -> EntityAccessReceipt<messages::domain::service::MessageWrite> {
    EntityAccessReceipt::try_new_authenticated_user(
        macro_id("macro|sender@test.com"),
        entity_access::domain::models::Entity {
            entity_type: EntityType::Channel,
            entity_id: Uuid::from_u128(500).to_string(),
        },
        entity_access::domain::models::EntityPermission::ChannelRole {
            role: entity_access::domain::models::ParticipantRole::Member,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn channel_posts_use_common_service_with_verified_identity_and_notification_policy() {
    let mut messages = messages::domain::api::MockMessageServiceApi::new();
    messages.expect_post().once().returning(|access, input| {
        assert_eq!(
            access.get_authenticated_user().unwrap().as_ref(),
            "macro|sender@test.com"
        );
        assert_eq!(access.entity().entity_id, Uuid::from_u128(500).to_string());
        assert_eq!(input.thread_id, Some(Uuid::from_u128(502)));
        assert_eq!(input.content, "reply");
        assert_eq!(
            input.notification_policy,
            crate::domain::models::PostMessageNotificationPolicy::MentionsOnly
        );
        assert_eq!(input.nonce.as_deref(), Some("client-nonce"));
        assert!(input.anchor.is_none());
        Ok(shared_message_fixture())
    });
    let service = ChannelMessageAdapter::new(Arc::new(messages));
    let response = service
        .post_message(
            message_capability(),
            PostMessageRequest {
                content: "reply".into(),
                mentions: vec![],
                attachments: vec![],
                thread_id: Some(Uuid::from_u128(502)),
                nonce: Some("client-nonce".into()),
                notification_policy:
                    crate::domain::models::PostMessageNotificationPolicy::MentionsOnly,
                triggered_by: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(response.id, Uuid::from_u128(501).to_string());
    assert_eq!(response.nonce.as_deref(), Some("client-nonce"));
}

#[tokio::test]
async fn channel_attachment_delta_preserves_unreplaced_content_mentions_and_attachments() {
    let mut messages = messages::domain::api::MockMessageServiceApi::new();
    messages.expect_patch().once().returning(|_, id, input| {
        assert_eq!(id, Uuid::from_u128(501));
        assert!(input.content.is_none());
        assert!(input.mentions.is_none());
        let AttachmentChange::Delta { remove, add } = input.attachments else {
            panic!("expected typed delta")
        };
        assert_eq!(remove, vec![Uuid::from_u128(601)]);
        assert_eq!(add[0].entity_id, "new");
        Ok(shared_message_fixture())
    });
    let service = ChannelMessageAdapter::new(Arc::new(messages));
    service
        .patch_message(
            message_capability(),
            Uuid::from_u128(501),
            PatchMessageRequest {
                content: None,
                mentions: None,
                attachment_ids_to_delete: Some(vec![Uuid::from_u128(601).to_string()]),
                attachments_to_add: Some(vec![NewChannelAttachment {
                    entity_type: "document".into(),
                    entity_id: "new".into(),
                    width: None,
                    height: None,
                }]),
                nonce: None,
                notification_policy: Default::default(),
            },
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn channel_delete_and_reaction_forward_common_authorship_and_parent_errors() {
    let mut messages = messages::domain::api::MockMessageServiceApi::new();
    messages
        .expect_delete()
        .once()
        .returning(|_, _, _| Err(messages::domain::ports::MessageError::Forbidden));
    messages
        .expect_react()
        .once()
        .returning(|_, _, _, _, _| Err(messages::domain::ports::MessageError::NotFound));
    let service = ChannelMessageAdapter::new(Arc::new(messages));
    assert!(matches!(
        service
            .delete_message(
                message_capability(),
                Uuid::from_u128(501),
                DeleteMessageQuery::default()
            )
            .await,
        Err(ChannelMutationErr::Unauthorized(_))
    ));
    assert!(matches!(
        service
            .post_reaction(
                message_capability(),
                PostReactionRequest {
                    message_id: Uuid::from_u128(501).to_string(),
                    emoji: "👍".into(),
                    action: ReactionAction::Add,
                    nonce: None
                }
            )
            .await,
        Err(ChannelMutationErr::NotFound(_))
    ));
}

#[tokio::test]
async fn channel_adapter_cannot_use_a_document_capability() {
    let messages = messages::domain::api::MockMessageServiceApi::new();
    let service = ChannelMessageAdapter::new(Arc::new(messages));
    let access = EntityAccessReceipt::try_new_authenticated_user(
        macro_id("macro|sender@test.com"),
        entity_access::domain::models::Entity {
            entity_type: EntityType::Document,
            entity_id: "doc".into(),
        },
        entity_access::domain::models::EntityPermission::AccessLevel {
            access_level: entity_access::domain::models::AccessLevel::Owner,
        },
    )
    .unwrap();
    assert!(matches!(
        service
            .delete_message(access, Uuid::from_u128(501), DeleteMessageQuery::default())
            .await,
        Err(ChannelMutationErr::BadRequest(_))
    ));
}
