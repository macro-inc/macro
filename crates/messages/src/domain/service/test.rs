use super::*;
use chrono::Utc;
use entity_access::domain::models::{AccessLevel, EntityAccessAuth};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct Repo {
    message: Message,
    state: ThreadState,
    deletes: Arc<Mutex<Vec<Uuid>>>,
    creates: Arc<Mutex<Vec<CreateMessage>>>,
    edits: Arc<Mutex<Vec<EditMessage>>>,
    references: Vec<ReferencedThreadCandidate>,
}

impl MessageRepository for Repo {
    async fn referenced_threads(
        &self,
        _: &str,
        cursor: Option<MessageCursor>,
        limit: u16,
    ) -> Result<Vec<ReferencedThreadCandidate>, MessageError> {
        Ok(self
            .references
            .iter()
            .filter(|r| {
                cursor
                    .as_ref()
                    .is_none_or(|c| (r.created_at, r.root_id) > (c.created_at, c.id))
            })
            .take(usize::from(limit))
            .cloned()
            .collect())
    }
    async fn preceding(
        &self,
        _: &MessageParent,
        _: Uuid,
        _: u16,
    ) -> Result<Vec<Message>, MessageError> {
        unimplemented!()
    }
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
    async fn timeline(
        &self,
        parent: &MessageParent,
        query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError> {
        let included = self.message.parent == *parent
            && (query.ids.is_empty() || query.ids.contains(&self.message.id));
        Ok(MessagePage {
            items: if included {
                vec![MessageListItem {
                    message: self.message.clone(),
                    state: self.state.clone(),
                    thread: MessageThreadPreview {
                        reply_count: 0,
                        latest_reply_at: None,
                        preview: vec![],
                    },
                }]
            } else {
                vec![]
            },
            next_cursor: None,
            previous_cursor: None,
        })
    }
    async fn create(&self, command: CreateMessage) -> Result<Message, MessageError> {
        let mut message = self.message.clone();
        message.parent = command.parent.clone();
        message.sender_id = command.actor.clone();
        message.content = command.input.content.clone();
        message.mentions = command.input.mentions.clone();
        message.triggered_by = command.triggered_by.clone();
        message.thread_id = command.input.thread_id;
        self.creates.lock().unwrap().push(command);
        Ok(message)
    }
    async fn edit(
        &self,
        _: &MessageParent,
        _: Uuid,
        command: EditMessage,
    ) -> Result<Message, MessageError> {
        let mut message = self.message.clone();
        message.content = command.content.clone();
        message.mentions = command.mentions.clone();
        self.edits.lock().unwrap().push(command);
        Ok(message)
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
    async fn patch_thread(
        &self,
        _: &MessageParent,
        _: Uuid,
        patch: ThreadPatch,
    ) -> Result<ThreadState, MessageError> {
        let mut state = self.state.clone();
        if let Some(resolved) = patch.resolved {
            state.resolved = resolved;
        }
        if patch.detach_anchor {
            state.anchor = None;
        }
        Ok(state)
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
            bot_profile: None,
            mentions: vec![],
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
        creates: Arc::default(),
        edits: Arc::default(),
        references: vec![],
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
async fn document_editor_can_detach_another_authors_mark_without_deleting_the_thread() {
    let repo = fixture();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let state = service
        .patch_thread(
            access("macro|editor@example.com", "doc", AccessLevel::Edit),
            repo.state.root_id,
            ThreadPatch {
                detach_anchor: true,
                nonce: Some("removed-mark".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(state.anchor.is_none());
    assert!(state.deleted_at.is_none());
    assert_eq!(state.user_id, repo.state.user_id);
    assert!(repo.deletes.lock().unwrap().is_empty());
    let events = events.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].nonce.as_deref(), Some("removed-mark"));
    assert!(
        matches!(&events[0].change, MessageChange::ThreadUpdated { state } if state.anchor.is_none() && state.deleted_at.is_none())
    );
}

#[tokio::test]
async fn commenters_can_resolve_but_cannot_detach_document_text() {
    let repo = fixture();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let result = service
        .patch_thread(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.state.root_id,
            ThreadPatch {
                detach_anchor: true,
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(MessageError::Forbidden)));
    assert!(events.0.lock().unwrap().is_empty());
    let state = service
        .patch_thread(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.state.root_id,
            ThreadPatch {
                resolved: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(state.resolved);
    assert_eq!(state.anchor, repo.state.anchor);
}

#[tokio::test]
async fn thread_patch_cannot_detach_pdf_annotations() {
    let mut repo = fixture();
    repo.state.anchor = Some(ThreadAnchor::PdfHighlight {
        anchor_id: Uuid::from_u128(3),
    });
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let result = service
        .patch_thread(
            access("macro|editor@example.com", "doc", AccessLevel::Edit),
            repo.state.root_id,
            ThreadPatch {
                detach_anchor: true,
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(MessageError::Invalid(_))));
    assert!(events.0.lock().unwrap().is_empty());
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
    assert!(
        matches!(&events[0].change, MessageChange::MessageDeleted { message } if message.root_id() == repo.message.id)
    );
    assert_eq!(events[0].nonce.as_deref(), Some("nonce"));
    assert!(matches!(
        events[0].change,
        MessageChange::MessageDeleted { .. }
    ));
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
fn email_access_cannot_authorize_message_operations() {
    let receipt = EntityAccessReceipt::<MessageWrite>::try_new(
        EntityAccessAuth::Authenticated("macro|author@example.com".to_owned().try_into().unwrap()),
        entity_access::domain::models::Entity {
            entity_id: Uuid::from_u128(1).to_string(),
            entity_type: EntityType::EmailThread,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();
    assert!(matches!(
        parent_from_receipt(&receipt),
        Err(MessageError::Forbidden)
    ));
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
        attribution: Default::default(),
        notification_policy: Default::default(),
        content: "test".into(),
        thread_id: None,
        anchor: Some(NewThreadAnchor::Markdown {
            mark_id: Uuid::from_u128(1),
        }),
        mentions: vec![],
        attachments: vec![],
        nonce: None,
    };
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
        attribution: Default::default(),
        notification_policy: Default::default(),
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
    let edit = MessagePatch {
        content: Some("replacement".into()),
        attachments: AttachmentChange::Replace(vec![attachment]),
        ..Default::default()
    };
    assert!(matches!(
        service
            .patch(
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

#[derive(Clone)]
struct SourceAccess(Arc<Mutex<std::collections::HashSet<String>>>);
impl MessageReferenceAccess for SourceAccess {
    fn can_view<'a>(
        &'a self,
        _: &'a EntityAccessAuth,
        kind: EntityType,
        id: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<bool, MessageError>> + Send + 'a>> {
        assert_eq!(kind, EntityType::Channel);
        Box::pin(async move { Ok(self.0.lock().unwrap().contains(id)) })
    }
}

#[tokio::test]
async fn source_mentions_never_grant_channel_access_and_revocation_removes_the_thread() {
    let mut repo = fixture();
    let channel = Uuid::from_u128(20);
    let private = Uuid::from_u128(21);
    repo.message.parent = MessageParent::Channel(channel);
    repo.state.anchor = None;
    repo.references = vec![
        ReferencedThreadCandidate {
            channel_id: private,
            root_id: Uuid::from_u128(0),
            channel_name: Some("private name".into()),
            created_at: repo.message.created_at,
        },
        ReferencedThreadCandidate {
            channel_id: channel,
            root_id: repo.message.id,
            channel_name: Some("visible".into()),
            created_at: repo.message.created_at,
        },
    ];
    let grants = SourceAccess(Arc::new(Mutex::new(
        [channel.to_string()].into_iter().collect(),
    )));
    let service = MessageService::new(repo, Events::default()).with_references(grants.clone());
    let doc_access = || {
        access("macro|author@example.com", "doc", AccessLevel::Comment)
            .try_into_requirement()
            .unwrap()
    };
    let page = service
        .referenced_threads(doc_access(), None, 1)
        .await
        .unwrap();
    assert_eq!(page.threads.len(), 1);
    assert_eq!(page.threads[0].channel_name.as_deref(), Some("visible"));
    assert_eq!(page.threads[0].parent, MessageParent::Channel(channel));
    assert_eq!(page.threads[0].root_id, Uuid::from_u128(1));
    assert!(!page.threads[0].can_reply);
    assert!(page.next_cursor.is_none());
    grants.0.lock().unwrap().clear();
    assert!(
        service
            .referenced_threads(doc_access(), None, 1)
            .await
            .unwrap()
            .threads
            .is_empty()
    );
}

#[tokio::test]
async fn reference_discovery_pages_authorized_identities_without_reading_message_content() {
    let mut repo = fixture();
    let visible = Uuid::from_u128(20);
    let private = Uuid::from_u128(21);
    // The message reader fixture contains only an unrelated document root.
    // Discovery must use the source facts, leaving hydration to the common reader.
    repo.references = (1..=205)
        .map(|id| ReferencedThreadCandidate {
            channel_id: if id % 100 == 0 { visible } else { private },
            root_id: Uuid::from_u128(id),
            channel_name: Some(if id % 100 == 0 { "visible" } else { "private" }.into()),
            created_at: repo.message.created_at,
        })
        .collect();
    let grants = SourceAccess(Arc::new(Mutex::new(
        [visible.to_string()].into_iter().collect(),
    )));
    let service = MessageService::new(repo, Events::default()).with_references(grants);
    let receipt = || {
        access("macro|author@example.com", "doc", AccessLevel::Comment)
            .try_into_requirement()
            .unwrap()
    };
    let first = service
        .referenced_threads(receipt(), None, 1)
        .await
        .unwrap();
    assert_eq!(first.threads.len(), 1);
    assert_eq!(first.threads[0].root_id, Uuid::from_u128(100));
    assert_eq!(first.threads[0].parent, MessageParent::Channel(visible));
    assert_eq!(first.next_cursor.as_ref().unwrap().id, Uuid::from_u128(100));

    let second = service
        .referenced_threads(receipt(), first.next_cursor, 1)
        .await
        .unwrap();
    assert_eq!(second.threads.len(), 1);
    assert_eq!(second.threads[0].root_id, Uuid::from_u128(200));
    assert!(second.next_cursor.is_none());
}

fn post_input() -> PostMessage {
    PostMessage {
        attribution: Default::default(),
        notification_policy: Default::default(),
        content: "@agent please help".into(),
        thread_id: None,
        anchor: None,
        mentions: vec![],
        attachments: vec![],
        nonce: Some("client-nonce".into()),
    }
}

fn channel_access() -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new_authenticated_user(
        "macro|author@example.com".to_string().try_into().unwrap(),
        entity_access::domain::models::Entity {
            entity_type: EntityType::Channel,
            entity_id: Uuid::from_u128(20).to_string(),
        },
        EntityPermission::ChannelRole {
            role: entity_access::domain::models::ParticipantRole::Member,
        },
    )
    .unwrap()
}

#[derive(Clone)]
struct ReferenceAccess {
    allowed: bool,
    checked: Arc<Mutex<Vec<(EntityType, String)>>>,
}
impl MessageReferenceAccess for ReferenceAccess {
    fn can_view<'a>(
        &'a self,
        _: &'a EntityAccessAuth,
        kind: EntityType,
        id: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<bool, MessageError>> + Send + 'a>> {
        Box::pin(async move {
            self.checked.lock().unwrap().push((kind, id.into()));
            Ok(self.allowed)
        })
    }
}

#[tokio::test]
async fn editor_reference_tags_are_authorized_for_posts_and_edits() {
    for (tag, entity_type) in [
        ("thread", EntityType::EmailThread),
        ("email", EntityType::EmailThread),
        ("email_thread", EntityType::EmailThread),
        ("call", EntityType::Call),
        ("calendar_event", EntityType::CalendarEvent),
    ] {
        for allowed in [true, false] {
            let mut repo = fixture();
            repo.message.parent = MessageParent::Channel(Uuid::from_u128(20));
            let references = ReferenceAccess {
                allowed,
                checked: Arc::default(),
            };
            let service = MessageService::new(repo.clone(), Events::default())
                .with_references(references.clone());
            let mut input = post_input();
            input.mentions = vec![SimpleMention {
                entity_type: tag.into(),
                entity_id: Uuid::from_u128(30).to_string(),
            }];
            let posted = service.post(channel_access(), input.clone()).await;
            let edited = service
                .patch(
                    channel_access(),
                    repo.message.id,
                    MessagePatch {
                        content: Some(input.content),
                        mentions: Some(input.mentions.clone()),
                        ..Default::default()
                    },
                )
                .await;
            for result in [posted, edited] {
                if allowed {
                    let message = result.unwrap();
                    assert_eq!(message.mentions[0].entity_type, tag);
                } else {
                    assert!(
                        matches!(result, Err(MessageError::Forbidden)),
                        "{tag}: {result:?}"
                    );
                }
            }
            assert_eq!(repo.creates.lock().unwrap().len(), usize::from(allowed));
            assert_eq!(repo.edits.lock().unwrap().len(), usize::from(allowed));
            assert_eq!(
                *references.checked.lock().unwrap(),
                vec![(entity_type, Uuid::from_u128(30).to_string()); 2]
            );
        }
    }
}

struct GroupMembers;
#[async_trait::async_trait]
impl MessageGroupRecipients for GroupMembers {
    async fn channel_members(
        &self,
        channel: Uuid,
    ) -> Result<Vec<macro_user_id::user_id::MacroUserIdStr<'static>>, MessageError> {
        assert_eq!(channel, Uuid::from_u128(20));
        Ok((0..300)
            .map(|i| {
                macro_user_id::user_id::MacroUserIdStr::try_from_email(&format!(
                    "participant-{i}@example.com"
                ))
                .unwrap()
            })
            .collect())
    }
}

#[tokio::test]
async fn a_group_remains_one_authored_reference_and_resolves_current_recipients_on_post_and_edit() {
    let mut repo = fixture();
    repo.message.parent = MessageParent::Channel(Uuid::from_u128(20));
    let events = Events::default();
    let service =
        MessageService::new(repo.clone(), events.clone()).with_group_recipients(GroupMembers);
    let mut input = post_input();
    input.mentions = vec![
        SimpleMention {
            entity_type: "group".into(),
            entity_id: "here".into(),
        },
        SimpleMention {
            entity_type: "user".into(),
            entity_id: "macro|participant-0@example.com".into(),
        },
    ];
    let posted = service.post(channel_access(), input.clone()).await.unwrap();
    assert_eq!(posted.mentions, input.mentions);
    service
        .patch(
            channel_access(),
            repo.message.id,
            MessagePatch {
                content: Some(input.content.clone()),
                mentions: Some(input.mentions.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    for event in events.0.lock().unwrap().iter() {
        let mentions = match &event.change {
            MessageChange::Posted { mentions, .. } | MessageChange::Edited { mentions, .. } => {
                mentions
            }
            _ => panic!("expected post or edit"),
        };
        assert_eq!(mentions.len(), 300);
        assert!(mentions.iter().all(|mention| mention.entity_type == "user"));
    }
    assert_eq!(repo.edits.lock().unwrap()[0].mentions, input.mentions);
    input.mentions[1].entity_id = "not-a-user".into();
    assert!(matches!(
        service.post(channel_access(), input.clone()).await,
        Err(MessageError::Invalid("invalid mentioned user"))
    ));
    input.mentions[1] = SimpleMention {
        entity_type: "document".into(),
        entity_id: "private".into(),
    };
    assert!(matches!(
        service.post(channel_access(), input.clone()).await,
        Err(MessageError::Forbidden)
    ));
    input.mentions = vec![
        SimpleMention {
            entity_type: "user".into(),
            entity_id: "macro|person@example.com".into()
        };
        101
    ];
    assert!(matches!(
        service.post(channel_access(), input).await,
        Err(MessageError::Invalid("too many message references"))
    ));
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn document_and_unknown_group_mentions_are_rejected_before_persistence() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default());
    let mut input = post_input();
    input.mentions = vec![SimpleMention {
        entity_type: "group".into(),
        entity_id: "here".into(),
    }];
    assert!(
        service
            .post(
                access("macro|author@example.com", "doc", AccessLevel::Comment),
                input.clone()
            )
            .await
            .is_err()
    );
    input.mentions[0].entity_id = "everyone".into();
    assert!(service.post(channel_access(), input).await.is_err());
    assert!(repo.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn partial_attachment_changes_preserve_unreplaced_body_mentions_and_attachment_metadata() {
    let mut repo = fixture();
    repo.message.mentions = vec![SimpleMention {
        entity_type: "document".into(),
        entity_id: "mentioned".into(),
    }];
    repo.message.attachments = [601, 602]
        .map(|id| MessageAttachment {
            id: Uuid::from_u128(id),
            entity_type: "document".into(),
            entity_id: id.to_string(),
            width: Some(20),
            height: Some(30),
            created_at: Utc::now(),
        })
        .to_vec();
    let service =
        MessageService::new(repo.clone(), Events::default()).with_references(ReferenceAccess {
            allowed: true,
            checked: Arc::default(),
        });
    service
        .patch(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            MessagePatch {
                attachments: AttachmentChange::Delta {
                    remove: vec![Uuid::from_u128(601)],
                    add: vec![NewAttachment {
                        entity_type: "document".into(),
                        entity_id: "new".into(),
                        width: None,
                        height: None,
                    }],
                },
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let edits = repo.edits.lock().unwrap();
    assert_eq!(edits[0].content, repo.message.content);
    assert_eq!(edits[0].mentions, repo.message.mentions);
    let attachments = edits[0].attachments.as_ref().unwrap();
    assert_eq!(
        attachments
            .iter()
            .map(|a| a.entity_id.as_str())
            .collect::<Vec<_>>(),
        ["602", "new"]
    );
    assert_eq!(attachments[0].width, Some(20));
    assert_eq!(attachments[0].height, Some(30));
}

#[tokio::test]
async fn human_can_post_canonical_agent_mentions_on_documents_and_channels() {
    use entity_access::domain::models::{Entity, ParticipantRole};
    for parent in [
        MessageParent::parse("document", "doc").unwrap(),
        MessageParent::Channel(Uuid::from_u128(20)),
    ] {
        let repo = fixture();
        let events = Events::default();
        let service = MessageService::new(repo.clone(), events.clone());
        let (entity_type, permission) = match parent {
            MessageParent::Document(_) => (
                EntityType::Document,
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::Comment,
                },
            ),
            MessageParent::Channel(_) => (
                EntityType::Channel,
                EntityPermission::ChannelRole {
                    role: ParticipantRole::Member,
                },
            ),
        };
        let receipt = || {
            EntityAccessReceipt::try_new_authenticated_user(
                "macro|author@example.com".to_string().try_into().unwrap(),
                Entity {
                    entity_type,
                    entity_id: parent.entity_id(),
                },
                permission.clone(),
            )
            .unwrap()
        };
        let mut input = post_input();
        input.mentions = vec![
            SimpleMention {
                entity_type: "bot".into(),
                entity_id: bot_id::MACRO_NEW_BOT_ID.into_storage_id().to_string(),
            },
            SimpleMention {
                entity_type: "user".into(),
                entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
            },
        ];
        let message = service.post(receipt(), input.clone()).await.unwrap();
        assert_eq!(message.parent, parent);
        assert_eq!(message.mentions.len(), 2);
        assert!(message.triggered_by.is_none());
        assert_eq!(
            events.0.lock().unwrap()[0].nonce.as_deref(),
            Some("client-nonce")
        );
        input.mentions[0].entity_id = bot_id::MACRO_NEW_BOT_ID.to_string();
        assert!(matches!(
            service.post(receipt(), input).await,
            Err(MessageError::Invalid(_))
        ));
        assert_eq!(repo.creates.lock().unwrap().len(), 1);
    }
}

struct RawBotMentions;
impl MessageMentionExtractor for RawBotMentions {
    fn extract<'a>(
        &'a self,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Vec<SimpleMention>, MessageError>> + Send + 'a>>
    {
        Box::pin(async {
            Ok(vec![SimpleMention {
                entity_type: "user".into(),
                entity_id: "macro|mentioned@example.com".into(),
            }])
        })
    }
}

#[tokio::test]
async fn bot_posts_and_edits_extract_mentions_and_preserve_trusted_attribution_and_policy() {
    use entity_access::domain::models::BotReceiptScope;
    let receipt = || {
        EntityAccessReceipt::try_new_bot(
            bot_id::MACRO_AI_BOT_ID.into_storage_id(),
            BotReceiptScope::User {
                acting_user: "macro|author@example.com".to_string().try_into().unwrap(),
            },
            access("macro|author@example.com", "doc", AccessLevel::Comment)
                .entity()
                .clone(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Comment,
            },
        )
        .unwrap()
    };
    let mut repo = fixture();
    repo.message.sender_id = ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
    let events = Events::default();
    let service =
        MessageService::new(repo.clone(), events.clone()).with_mention_extractor(RawBotMentions);
    let mut input = post_input();
    input.notification_policy = PostMessageNotificationPolicy::Silent;
    let posted = service.post(receipt(), input.clone()).await.unwrap();
    assert_eq!(
        posted.triggered_by.as_deref(),
        Some("macro|author@example.com")
    );
    assert_eq!(posted.mentions.len(), 1);
    input.attribution = MessageAttribution::Unprompted;
    assert!(
        service
            .post(receipt(), input)
            .await
            .unwrap()
            .triggered_by
            .is_none()
    );
    service
        .patch(
            receipt(),
            posted.id,
            MessagePatch {
                notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
                content: Some("final @mention".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(repo.edits.lock().unwrap()[0].mentions.len(), 1);
    let events = events.0.lock().unwrap();
    assert!(matches!(
        events[0].change,
        MessageChange::Posted {
            notification_policy: PostMessageNotificationPolicy::Silent,
            ..
        }
    ));
    assert!(matches!(
        events[2].change,
        MessageChange::Edited {
            notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
            ..
        }
    ));
}
