use super::*;
use chrono::Utc;
use entity_access::domain::models::{AccessLevel, EntityAccessAuth};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct Repo {
    message: Message,
    state: ThreadState,
    deletes: Arc<Mutex<Vec<Uuid>>>,
}

impl MessageRepository for Repo {
    async fn replies(&self, _: &MessageParent, _: Uuid) -> Result<Vec<Message>, MessageError> {
        Ok(vec![])
    }
    async fn parent_exists(&self, _: &MessageParent) -> Result<bool, MessageError> {
        Ok(true)
    }
    async fn get(&self, parent: &MessageParent, id: Uuid) -> Result<Option<Message>, MessageError> {
        Ok((self.message.parent == *parent && self.message.id == id).then(|| self.message.clone()))
    }
    async fn thread(
        &self,
        parent: &MessageParent,
        root: Uuid,
    ) -> Result<Option<ThreadState>, MessageError> {
        Ok(
            (self.message.parent == *parent && self.state.root_id == root)
                .then(|| self.state.clone()),
        )
    }
    async fn list(
        &self,
        _: &MessageParent,
        _: Option<MessageCursor>,
        _: u16,
    ) -> Result<ThreadPage, MessageError> {
        unimplemented!()
    }
    async fn create(&self, _: CreateMessage) -> Result<Message, MessageError> {
        unimplemented!()
    }
    async fn edit(
        &self,
        _: &MessageParent,
        _: Uuid,
        _: EditMessage,
    ) -> Result<Message, MessageError> {
        unimplemented!()
    }
    async fn delete(&self, _: &MessageParent, id: Uuid) -> Result<Message, MessageError> {
        self.deletes.lock().unwrap().push(id);
        let mut message = self.message.clone();
        message.deleted_at = Some(Utc::now());
        message.content.clear();
        Ok(message)
    }
    async fn react(
        &self,
        _: &MessageParent,
        _: Uuid,
        _: &str,
        _: &str,
        _: bool,
    ) -> Result<Message, MessageError> {
        unimplemented!()
    }
    async fn resolve(
        &self,
        _: &MessageParent,
        _: Uuid,
        _: bool,
    ) -> Result<ThreadState, MessageError> {
        unimplemented!()
    }
    async fn delete_thread(&self, _: &MessageParent, _: Uuid) -> Result<ThreadState, MessageError> {
        panic!("single-message deletion must never delete the thread")
    }
    async fn resolve_legacy(
        &self,
        _: &MessageParent,
        _: i64,
        _: bool,
    ) -> Result<Option<Uuid>, MessageError> {
        unimplemented!()
    }
}

#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<MessageEvent>>>);
impl MessageEventPublisher for Events {
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}

fn fixture() -> Repo {
    let id = Uuid::from_u128(1);
    let user = "macro|author@example.com";
    Repo {
        message: Message {
            id,
            parent: MessageParent::parse("document", "doc").unwrap(),
            thread_id: None,
            sender_id: ChannelSender::try_from(user.to_owned()).unwrap(),
            imported_author: Some(ImportedAuthor {
                name: "External PDF author".into(),
            }),
            triggered_by: None,
            content: "root".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            edited_at: None,
            deleted_at: None,
            attachments: vec![],
            reactions: vec![],
        },
        state: ThreadState {
            root_id: id,
            user_id: user.into(),
            resolved: false,
            anchor: Some(ThreadAnchor::Markdown {
                mark_id: Uuid::from_u128(2),
            }),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        },
        deletes: Arc::default(),
    }
}

fn access(user: &str, document: &str, level: AccessLevel) -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(user.to_owned().try_into().unwrap()),
        entity_access::domain::models::Entity {
            entity_id: document.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn root_deletion_tombstones_only_the_message_and_emits_shared_update() {
    let repo = fixture();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let message = service
        .delete(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            Some("nonce".into()),
        )
        .await
        .unwrap();
    assert!(message.deleted_at.is_some());
    assert_eq!(*repo.deletes.lock().unwrap(), vec![repo.message.id]);
    assert!(repo.state.deleted_at.is_none());
    assert!(repo.state.anchor.is_some());
    let events = events.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].root_id, repo.message.id);
    assert_eq!(events[0].nonce.as_deref(), Some("nonce"));
    assert!(matches!(events[0].change, MessageChange::Updated { .. }));
}

#[tokio::test]
async fn other_commenter_cannot_delete_but_parent_owner_can_moderate() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default());
    let denied = service
        .delete(
            access("macro|other@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            None,
        )
        .await;
    assert!(matches!(denied, Err(MessageError::Forbidden)));
    assert!(repo.deletes.lock().unwrap().is_empty());
    service
        .delete(
            access("macro|owner@example.com", "doc", AccessLevel::Owner),
            repo.message.id,
            None,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn receipt_for_another_parent_cannot_authorize_a_message() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default());
    let denied = service
        .delete(
            access("macro|author@example.com", "different", AccessLevel::Owner),
            repo.message.id,
            None,
        )
        .await;
    assert!(matches!(denied, Err(MessageError::NotFound)));
    assert!(repo.deletes.lock().unwrap().is_empty());
}

#[test]
fn view_access_cannot_mint_a_write_receipt() {
    assert!(!MessageWrite::is_satisfied_by(
        &EntityPermission::AccessLevel {
            access_level: AccessLevel::View
        }
    ));
    assert!(!MessageWrite::is_satisfied_by(
        &EntityPermission::ChannelViewOnly
    ));
    assert!(MessageView::is_satisfied_by(
        &EntityPermission::ChannelViewOnly
    ));
}

#[test]
fn only_root_document_messages_can_have_anchors() {
    let mut input = PostMessage {
        content: "test".into(),
        thread_id: None,
        anchor: Some(NewThreadAnchor::Markdown {
            mark_id: Uuid::from_u128(1),
        }),
        mentions: vec![],
        attachments: vec![],
        nonce: None,
    };
    assert!(validate_post(&MessageParent::EmailThread(Uuid::from_u128(2)), &input).is_err());
    assert!(validate_post(&MessageParent::Channel(Uuid::from_u128(2)), &input).is_err());
    let doc = MessageParent::parse("document", "doc").unwrap();
    assert!(validate_post(&doc, &input).is_ok());
    input.thread_id = Some(Uuid::from_u128(3));
    assert!(validate_post(&doc, &input).is_err());
}

#[tokio::test]
async fn inaccessible_references_are_rejected_before_persistence() {
    let service = MessageService::new(fixture(), Events::default());
    let attachment = NewAttachment {
        entity_type: "document".into(),
        entity_id: "private-document".into(),
        width: None,
        height: None,
    };
    let input = PostMessage {
        content: "Look here".into(),
        thread_id: None,
        anchor: None,
        mentions: vec![],
        attachments: vec![attachment.clone()],
        nonce: None,
    };
    // Repo::create is deliberately unimplemented: a rejected request must never reach it.
    assert!(matches!(
        service
            .post(
                access("macro|author@example.com", "doc", AccessLevel::Comment),
                input
            )
            .await,
        Err(MessageError::Forbidden)
    ));
    let edit = EditMessage {
        content: "replacement".into(),
        mentions: vec![],
        attachments: Some(vec![attachment]),
        nonce: None,
    };
    assert!(matches!(
        service
            .edit(
                access("macro|author@example.com", "doc", AccessLevel::Comment),
                Uuid::from_u128(1),
                edit
            )
            .await,
        Err(MessageError::Forbidden)
    ));
}

#[tokio::test]
async fn user_mentions_do_not_require_or_grant_parent_sharing() {
    let service = MessageService::new(fixture(), Events::default());
    let mentions = [SimpleMention {
        entity_type: "user".into(),
        entity_id: "macro|unshared@example.com".into(),
    }];
    // Mention identity validation is separate from delivery authorization. The
    // delivery tests prove this recipient is excluded without parent access.
    service
        .validate_references(
            &access("macro|author@example.com", "doc", AccessLevel::Comment),
            &mentions,
            &[],
        )
        .await
        .unwrap();
    let invalid = [SimpleMention {
        entity_type: "user".into(),
        entity_id: "arbitrary-string".into(),
    }];
    assert!(matches!(
        service
            .validate_references(
                &access("macro|author@example.com", "doc", AccessLevel::Comment),
                &invalid,
                &[]
            )
            .await,
        Err(MessageError::Invalid(_))
    ));
}
