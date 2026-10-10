use super::*;
use chrono::{DateTime, Utc};
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
                entity_type: parent.access_entity_type(),
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
        reuse_origin_message: false,
        parent: MessageParent::parse("document", "doc").unwrap(),
        thread_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(2),
    }
}
fn at(minute: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_758_800_000 + minute * 60, 0).unwrap()
}

/// A live message by `email` on `parent`, posted `minute` minutes in.
fn posted(
    parent: &MessageParent,
    id: u128,
    thread: Option<u128>,
    email: &str,
    content: &str,
    minute: i64,
) -> Message {
    Message {
        id: Uuid::from_u128(id),
        parent: parent.clone(),
        thread_id: thread.map(Uuid::from_u128),
        sender_id: channel_sender::ChannelSender::new_from_user(
            MacroUserIdStr::try_from_email(email).unwrap(),
        ),
        triggered_by: None,
        bot_profile: None,
        mentions: vec![],
        imported_author: None,
        content: content.into(),
        created_at: at(minute),
        updated_at: at(minute),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    }
}
fn message() -> Message {
    posted(
        &origin().parent,
        2,
        Some(1),
        "actor@example.com",
        "@agent explain this paragraph",
        5,
    )
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
async fn initiative_origin_mints_parent_capability_and_rechecks_revocation() {
    let parent = MessageParent::Initiative(Uuid::from_u128(901));
    let origin = AnnounceOrigin {
        parent: parent.clone(),
        ..origin()
    };
    let mut source = MockMessageReader::new();
    let expected_parent = parent.clone();
    source
        .expect_get()
        .once()
        .withf(move |access, _| {
            access.entity().entity_type == EntityType::Initiative
                && access.entity().entity_id == expected_parent.entity_id()
        })
        .return_once(move |_, _| {
            Ok(Message {
                parent,
                ..message()
            })
        });
    let adapter =
        MessagePromptContextAdapter::new(Arc::new(source), Arc::new(Authorizer { allowed: true }));
    adapter.authorize_origin(&actor(), &origin).await.unwrap();
    let revoked = MessagePromptContextAdapter::new(
        Arc::new(MockMessageReader::new()),
        Arc::new(Authorizer { allowed: false }),
    );
    assert!(revoked.authorize_origin(&actor(), &origin).await.is_err());
}

#[tokio::test]
async fn revoked_access_never_reads_message_content() {
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(MockMessageReader::new()),
        Arc::new(Authorizer { allowed: false }),
    );
    assert!(adapter.authorize_origin(&actor(), &origin()).await.is_err());
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
