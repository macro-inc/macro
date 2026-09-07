use super::ports::ConversationAccess;
use async_trait::async_trait;
use entity_access::domain::models::{
    AccessLevel, BotReceiptScope, EntityAccessReceipt, EntityPermission, EntityType,
    ParticipantRole,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MockMessageServiceApi,
    events::MessagePostedMetadata,
    models::{Message, MessageParent, MessageThread, ThreadState},
    service::MessageWrite,
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use uuid::Uuid;

pub(super) fn user() -> MacroUserIdStr<'static> {
    "macro|person@example.com".to_string().try_into().unwrap()
}
pub(super) fn parent() -> MessageParent {
    MessageParent::parse("document", "discussion-document").unwrap()
}
pub(crate) fn message(id: u128, thread: Option<Uuid>, body: &str) -> Message {
    Message {
        id: Uuid::from_u128(id),
        parent: parent(),
        thread_id: thread,
        sender_id: channel_sender::ChannelSender::new_from_user(user()),
        bot_profile: None,
        mentions: vec![],
        imported_author: None,
        triggered_by: None,
        content: body.into(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    }
}
pub(super) fn event(message: &Message) -> MessagePostedMetadata {
    MessagePostedMetadata::from_message(message, message.mentions.clone())
}
pub(super) fn thread(root: Message, replies: Vec<Message>) -> MessageThread {
    MessageThread {
        state: ThreadState {
            root_id: root.id,
            user_id: user().to_string(),
            anchor: None,
            resolved: false,
            created_at: root.created_at,
            updated_at: root.updated_at,
            deleted_at: None,
        },
        root,
        replies,
    }
}
pub(super) fn configure_reads(
    api: &mut MockMessageServiceApi,
    trigger: &Message,
    history: MessageThread,
) {
    let current = trigger.clone();
    api.expect_get().returning(move |receipt, id| {
        assert_eq!(receipt.entity().entity_id, current.parent.entity_id());
        assert_eq!(id, current.id);
        Ok(current.clone())
    });
    api.expect_get_thread().returning(move |receipt, id| {
        assert_eq!(receipt.entity().entity_id, history.root.parent.entity_id());
        assert_eq!(id, history.root.id);
        Ok(history.clone())
    });
}
#[derive(Default)]
pub(super) struct Access {
    pub revoked: Arc<AtomicBool>,
}
impl Access {
    pub fn revoke(&self) {
        self.revoked.store(true, Ordering::SeqCst);
    }
    fn permission(
        &self,
        parent: &MessageParent,
    ) -> Result<(entity_access::domain::models::Entity, EntityPermission), rootcause::Report> {
        if self.revoked.load(Ordering::SeqCst) {
            return Err(rootcause::report!("document access revoked"));
        }
        Ok(match parent {
            MessageParent::Document(_) => (
                entity_access::domain::models::Entity {
                    entity_type: EntityType::Document,
                    entity_id: parent.entity_id(),
                },
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::Comment,
                },
            ),
            MessageParent::Channel(_) => (
                entity_access::domain::models::Entity {
                    entity_type: EntityType::Channel,
                    entity_id: parent.entity_id(),
                },
                EntityPermission::ChannelRole {
                    role: ParticipantRole::Member,
                },
            ),
        })
    }
}
#[async_trait]
impl ConversationAccess for Access {
    async fn user_write(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>, rootcause::Report> {
        let (entity, permission) = self.permission(parent)?;
        Ok(EntityAccessReceipt::try_new_authenticated_user(
            user.clone(),
            entity,
            permission,
        )?)
    }
    async fn bot_write(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>, rootcause::Report> {
        let (entity, permission) = self.permission(parent)?;
        Ok(EntityAccessReceipt::try_new_bot(
            bot_id::MACRO_AI_BOT_ID.into_storage_id(),
            BotReceiptScope::User {
                acting_user: user.clone(),
            },
            entity,
            permission,
        )?)
    }
}
