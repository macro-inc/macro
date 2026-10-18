use super::*;
use entity_access::domain::models::{BotReceiptScope, Entity, ParticipantRole};

#[tokio::test]
async fn provider_channels_deny_human_posts_edits_deletes_and_reactions_but_keep_internal_bots() {
    let mut repo = fixture();
    repo.provider_managed = true;
    let channel = Uuid::now_v7();
    repo.message.parent = MessageParent::Channel(channel);
    repo.message.sender_id =
        ChannelSender::try_from("macro|author@example.com".to_owned()).unwrap();
    let human = || {
        EntityAccessReceipt::try_new(
            EntityAccessAuth::Authenticated(
                "macro|author@example.com".to_owned().try_into().unwrap(),
            ),
            Entity {
                entity_id: channel.to_string(),
                entity_type: EntityType::Channel,
            },
            EntityPermission::ChannelRole {
                role: ParticipantRole::Owner,
            },
        )
        .unwrap()
    };
    let service = MessageService::new(repo.clone(), Events::default());
    assert!(matches!(
        service.post(human(), post_input()).await,
        Err(MessageError::Forbidden)
    ));
    assert!(matches!(
        service.delete(human(), repo.message.id, None).await,
        Err(MessageError::Forbidden)
    ));
    assert!(matches!(
        service
            .react(human(), repo.message.id, "👍".into(), true, None)
            .await,
        Err(MessageError::Forbidden)
    ));
    assert!(matches!(
        service
            .patch(
                human(),
                repo.message.id,
                MessagePatch {
                    content: Some("Not a remote edit".into()),
                    ..Default::default()
                }
            )
            .await,
        Err(MessageError::Forbidden)
    ));
    let bot = || {
        EntityAccessReceipt::try_new_bot(
            bot_id::MACRO_AI_BOT_ID.into_storage_id(),
            BotReceiptScope::User {
                acting_user: "macro|author@example.com".to_owned().try_into().unwrap(),
            },
            Entity {
                entity_id: channel.to_string(),
                entity_type: EntityType::Channel,
            },
            EntityPermission::ChannelRole {
                role: ParticipantRole::Member,
            },
        )
        .unwrap()
    };
    let posted = service.post(bot(), post_input()).await.unwrap();
    assert!(posted.sender_id.as_bot().is_some());
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
}
