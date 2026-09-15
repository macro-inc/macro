use super::*;
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use messages::domain::{
    api::MockMessageReader,
    models::{Message, MessageThread, ThreadState},
};

struct Authorizer {
    allowed: bool,
}
impl InvocationAuthorizer for Authorizer {
    async fn capability(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> std::result::Result<EntityAccessReceipt<MessageWrite>, AccessError> {
        if !self.allowed {
            return Err(AccessError::Unauthorized);
        }
        EntityAccessReceipt::try_new_authenticated_user(
            user.clone(),
            Entity {
                entity_type: EntityType::Document,
                entity_id: parent.entity_id(),
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Comment,
            },
        )
    }
}
fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("history@example.com").unwrap()
}
fn parent() -> MessageParent {
    MessageParent::parse("document", "origin").unwrap()
}
fn root() -> Uuid {
    Uuid::from_u128(1)
}
fn message(id: Uuid, deleted: bool) -> Message {
    let now = chrono::Utc::now();
    Message {
        id,
        parent: parent(),
        thread_id: (id != root()).then_some(root()),
        sender_id: channel_sender::ChannelSender::new_from_user(user()),
        triggered_by: None,
        bot_profile: None,
        mentions: vec![],
        imported_author: None,
        content: "history".into(),
        created_at: now,
        updated_at: now,
        edited_at: None,
        deleted_at: deleted.then_some(now),
        attachments: vec![],
        reactions: vec![],
    }
}

#[tokio::test]
async fn reads_the_bound_actor_parent_and_root_and_omits_tombstones() {
    let mut reader = MockMessageReader::new();
    reader
        .expect_get_thread()
        .once()
        .withf(|access, id| {
            access.entity().entity_id == parent().entity_id()
                && access.entity().entity_type == EntityType::Document
                && access.get_authenticated_user().unwrap() == &user()
                && *id == root()
        })
        .return_once(|_, _| {
            Ok(MessageThread {
                state: ThreadState {
                    root_id: root(),
                    user_id: user().to_string(),
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                    resolved: false,
                    deleted_at: None,
                    anchor: None,
                },
                root: message(root(), true),
                replies: vec![
                    message(Uuid::from_u128(2), false),
                    message(Uuid::from_u128(3), true),
                ],
            })
        });
    let history = MessageThreadHistory::new(Arc::new(reader), Authorizer { allowed: true });
    let invocation = history
        .authorize_invocation(&user(), &parent(), root())
        .await
        .unwrap()
        .unwrap();
    let messages = history.thread_messages(&invocation).await.unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id, Uuid::from_u128(2));
}

#[tokio::test]
async fn revoked_write_permission_yields_no_invocation_or_read() {
    let history = MessageThreadHistory::new(
        Arc::new(MockMessageReader::new()),
        Authorizer { allowed: false },
    );
    assert!(
        history
            .authorize_invocation(&user(), &parent(), root())
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn deleted_thread_uses_the_application_lifecycle_rule() {
    let mut reader = MockMessageReader::new();
    reader
        .expect_get_thread()
        .once()
        .return_once(|_, _| Err(MessageError::NotFound));
    let history = MessageThreadHistory::new(Arc::new(reader), Authorizer { allowed: true });
    let invocation = history
        .authorize_invocation(&user(), &parent(), root())
        .await
        .unwrap()
        .unwrap();
    assert!(
        history
            .thread_messages(&invocation)
            .await
            .unwrap()
            .is_empty()
    );
}
