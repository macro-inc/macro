use super::*;
use chrono::Utc;
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use macro_uuid::Uuid;
use messages::domain::{api::MockMessageReader, models::Message};

struct Authorizer {
    allowed: bool,
}
impl ContextAuthorizer for Authorizer {
    async fn capability(
        &self,
        actor: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>> {
        if !self.allowed {
            return Err(HarnessError::PromptContext(rootcause::report!(
                "access revoked"
            )));
        }
        Ok(EntityAccessReceipt::try_new_authenticated_user(
            actor.clone(),
            Entity {
                entity_type: match parent {
                    MessageParent::Document(_) => EntityType::Document,
                    MessageParent::Channel(_) => EntityType::Channel,
                },
                entity_id: parent.entity_id(),
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Comment,
            },
        )
        .unwrap())
    }
}

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("actor@example.com").unwrap()
}
fn origin() -> AnnounceOrigin {
    AnnounceOrigin {
        parent: MessageParent::parse("document", "doc").unwrap(),
        thread_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(2),
    }
}
fn message() -> Message {
    Message {
        id: origin().message_id,
        parent: origin().parent,
        thread_id: Some(origin().thread_id),
        sender_id: channel_sender::ChannelSender::new_from_user(actor()),
        triggered_by: None,
        bot_profile: None,
        mentions: vec![],
        imported_author: None,
        content: "@agent explain this paragraph".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    }
}

#[tokio::test]
async fn document_origin_checks_its_parent_capability_and_root() {
    let mut source = MockMessageReader::new();
    source
        .expect_get()
        .once()
        .withf(|access, id| {
            access.entity().entity_type == EntityType::Document
                && access.entity().entity_id == "doc"
                && *id == origin().message_id
        })
        .return_once(|_, _| Ok(message()));
    let adapter =
        MessagePromptContextAdapter::new(Arc::new(source), Arc::new(Authorizer { allowed: true }));
    adapter.authorize_origin(&actor(), &origin()).await.unwrap();
}

#[tokio::test]
async fn revoked_access_never_reads_message_content() {
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(MockMessageReader::new()),
        Arc::new(Authorizer { allowed: false }),
    );
    assert!(adapter.authorize_origin(&actor(), &origin()).await.is_err());
    assert!(
        adapter
            .preceding_messages(&actor(), &origin())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn a_claimed_root_or_parent_cannot_link_an_unrelated_session() {
    for (wrong_parent, deleted) in [(false, false), (true, false), (false, true)] {
        let mut source = MockMessageReader::new();
        source.expect_get().once().return_once(move |_, _| {
            let mut message = message();
            if wrong_parent {
                message.parent = MessageParent::parse("document", "other-document").unwrap();
            } else if deleted {
                message.deleted_at = Some(Utc::now());
            } else {
                message.thread_id = Some(Uuid::from_u128(99));
            }
            Ok(message)
        });
        let adapter = MessagePromptContextAdapter::new(
            Arc::new(source),
            Arc::new(Authorizer { allowed: true }),
        );
        assert!(adapter.authorize_origin(&actor(), &origin()).await.is_err());
    }
}

#[tokio::test]
async fn history_uses_the_shared_authorized_message_reader() {
    let mut source = MockMessageReader::new();
    source
        .expect_preceding()
        .once()
        .withf(|access, id, limit| {
            access.entity().entity_id == "doc" && *id == origin().message_id && *limit == 10
        })
        .return_once(|_, _, _| Ok(vec![message()]));
    let adapter =
        MessagePromptContextAdapter::new(Arc::new(source), Arc::new(Authorizer { allowed: true }));
    let history = adapter
        .preceding_messages(&actor(), &origin())
        .await
        .unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].sender, actor().as_ref());
    assert_eq!(history[0].content, message().content);
}
