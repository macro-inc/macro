use super::*;
use chrono::Utc;
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use macro_uuid::Uuid;
use messages::domain::{
    api::MockMessageReader,
    models::{Message, MessageThread, ThreadState},
};

/// Live mark lookups, answering one fixed result for the test's document.
struct Marks(std::result::Result<Option<MarkedPassage>, &'static str>);
impl Marks {
    fn none() -> Self {
        Self(Ok(None))
    }
}
impl MarkReader for Marks {
    async fn resolve(
        &self,
        document_id: &str,
        _mark_id: &str,
    ) -> anyhow::Result<Option<MarkedPassage>> {
        assert_eq!(document_id, "doc");
        self.0.clone().map_err(|error| anyhow::anyhow!(error))
    }
}

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
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(source),
        Arc::new(Authorizer { allowed: true }),
        Arc::new(Marks::none()),
    );
    adapter.authorize_origin(&actor(), &origin()).await.unwrap();
}

#[tokio::test]
async fn revoked_access_never_reads_message_content() {
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(MockMessageReader::new()),
        Arc::new(Authorizer { allowed: false }),
        Arc::new(Marks::none()),
    );
    assert!(adapter.authorize_origin(&actor(), &origin()).await.is_err());
    assert!(
        adapter
            .conversation_context(&actor(), &origin())
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
            Arc::new(Marks::none()),
        );
        assert!(adapter.authorize_origin(&actor(), &origin()).await.is_err());
    }
}

fn thread(anchor: Option<ThreadAnchor>) -> MessageThread {
    MessageThread {
        state: ThreadState {
            root_id: origin().thread_id,
            user_id: actor().as_ref().to_owned(),
            resolved: false,
            anchor,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        },
        root: message(),
        replies: vec![],
    }
}

fn reader(anchor: Option<ThreadAnchor>) -> MockMessageReader {
    let mut source = MockMessageReader::new();
    source
        .expect_preceding()
        .once()
        .withf(|access, id, limit| {
            access.entity().entity_id == "doc" && *id == origin().message_id && *limit == 10
        })
        .return_once(|_, _, _| Ok(vec![message()]));
    source
        .expect_get_thread()
        .once()
        .withf(|access, root| access.entity().entity_id == "doc" && *root == origin().thread_id)
        .return_once(move |_, _| Ok(thread(anchor)));
    source
}

#[tokio::test]
async fn history_uses_the_shared_authorized_message_reader() {
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(reader(None)),
        Arc::new(Authorizer { allowed: true }),
        Arc::new(Marks::none()),
    );
    let context = adapter
        .conversation_context(&actor(), &origin())
        .await
        .unwrap();
    assert_eq!(context.messages.len(), 1);
    assert_eq!(context.messages[0].sender, actor().as_ref());
    assert_eq!(context.messages[0].content, message().content);
    // An unanchored discussion names no place in the document.
    assert_eq!(context.anchor, None);
}

#[tokio::test]
async fn a_marked_discussion_names_its_mark_and_the_text_it_covers() {
    let mark_id = Uuid::from_u128(7);
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(reader(Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: Some("the marked phrase".to_owned()),
        }))),
        Arc::new(Authorizer { allowed: true }),
        Arc::new(Marks::none()),
    );
    let context = adapter
        .conversation_context(&actor(), &origin())
        .await
        .unwrap();
    assert_eq!(
        context.anchor,
        Some(CommentAnchor {
            mark_id: mark_id.to_string(),
            marked_text: Some("the marked phrase".to_owned()),
            current: None,
        })
    );
}

#[tokio::test]
async fn a_discussion_anchored_before_snapshots_still_names_its_mark() {
    let mark_id = Uuid::from_u128(8);
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(reader(Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: None,
        }))),
        Arc::new(Authorizer { allowed: true }),
        Arc::new(Marks::none()),
    );
    let context = adapter
        .conversation_context(&actor(), &origin())
        .await
        .unwrap();
    assert_eq!(
        context.anchor,
        Some(CommentAnchor {
            mark_id: mark_id.to_string(),
            marked_text: None,
            current: None,
        })
    );
}

#[tokio::test]
async fn a_channel_prompt_never_reads_a_thread_for_an_anchor() {
    let mut source = MockMessageReader::new();
    source
        .expect_preceding()
        .once()
        .return_once(|_, _, _| Ok(vec![]));
    source.expect_get_thread().never();
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(source),
        Arc::new(Authorizer { allowed: true }),
        Arc::new(Marks::none()),
    );
    let channel = AnnounceOrigin {
        parent: MessageParent::Channel(Uuid::from_u128(3)),
        ..origin()
    };
    let context = adapter
        .conversation_context(&actor(), &channel)
        .await
        .unwrap();
    assert_eq!(context.anchor, None);
}

#[tokio::test]
async fn a_marked_discussion_reads_the_mark_as_the_document_has_it_now() {
    let mark_id = Uuid::from_u128(9);
    let current = MarkedPassage {
        marked_text: "the edited phrase".to_owned(),
        surrounding_text: "Before the edited phrase after.".to_owned(),
    };
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(reader(Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: Some("the original phrase".to_owned()),
        }))),
        Arc::new(Authorizer { allowed: true }),
        Arc::new(Marks(Ok(Some(current.clone())))),
    );
    let context = adapter
        .conversation_context(&actor(), &origin())
        .await
        .unwrap();
    assert_eq!(
        context.anchor,
        Some(CommentAnchor {
            mark_id: mark_id.to_string(),
            marked_text: Some("the original phrase".to_owned()),
            current: Some(current),
        })
    );
}

#[tokio::test]
async fn a_failed_live_lookup_falls_back_to_the_snapshot() {
    let mark_id = Uuid::from_u128(10);
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(reader(Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: Some("the original phrase".to_owned()),
        }))),
        Arc::new(Authorizer { allowed: true }),
        Arc::new(Marks(Err("lexical unavailable"))),
    );
    let context = adapter
        .conversation_context(&actor(), &origin())
        .await
        .unwrap();
    assert_eq!(
        context.anchor,
        Some(CommentAnchor {
            mark_id: mark_id.to_string(),
            marked_text: Some("the original phrase".to_owned()),
            current: None,
        })
    );
}
