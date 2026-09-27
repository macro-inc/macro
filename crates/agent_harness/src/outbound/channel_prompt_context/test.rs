use super::*;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use macro_uuid::Uuid;
use messages::domain::{
    api::MockMessageReader,
    models::{Message, MessageThread, ThreadState},
};

/// The lexical service's lookups, each answering one fixed result.
struct Lexical {
    mark: std::result::Result<Option<MarkedPassage>, &'static str>,
    quote: std::result::Result<Option<ExtractedExplicitReply>, &'static str>,
}
impl Lexical {
    fn none() -> Self {
        Self {
            mark: Ok(None),
            quote: Ok(None),
        }
    }
    fn mark(mark: std::result::Result<Option<MarkedPassage>, &'static str>) -> Self {
        Self {
            mark,
            ..Self::none()
        }
    }
}
impl MarkReader for Lexical {
    async fn resolve(
        &self,
        document_id: &str,
        _mark_id: &str,
    ) -> anyhow::Result<Option<MarkedPassage>> {
        assert_eq!(document_id, "doc");
        self.mark.clone().map_err(|error| anyhow::anyhow!(error))
    }
}
impl QuoteReader for Lexical {
    async fn quoted(&self, _markdown: &str) -> anyhow::Result<Option<ExtractedExplicitReply>> {
        self.quote.clone().map_err(|error| anyhow::anyhow!(error))
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
fn channel() -> MessageParent {
    MessageParent::Channel(Uuid::from_u128(3))
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
fn context_of(message: &Message) -> ContextMessage {
    context_message(message).unwrap()
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
        Arc::new(Lexical::none()),
    );
    adapter.authorize_origin(&actor(), &origin()).await.unwrap();
}

#[tokio::test]
async fn revoked_access_never_reads_message_content() {
    let adapter = MessagePromptContextAdapter::new(
        Arc::new(MockMessageReader::new()),
        Arc::new(Authorizer { allowed: false }),
        Arc::new(Lexical::none()),
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
            Arc::new(Lexical::none()),
        );
        assert!(adapter.authorize_origin(&actor(), &origin()).await.is_err());
    }
}

fn discussion(root: Message, replies: Vec<Message>, anchor: Option<ThreadAnchor>) -> MessageThread {
    MessageThread {
        state: ThreadState {
            root_id: root.id,
            user_id: actor().as_ref().to_owned(),
            resolved: false,
            anchor,
            created_at: root.created_at,
            updated_at: root.created_at,
            deleted_at: None,
        },
        root,
        replies,
    }
}

/// A document comment thread: the root and the prompting reply.
fn reader(anchor: Option<ThreadAnchor>) -> MockMessageReader {
    let root = posted(
        &origin().parent,
        1,
        None,
        "alice@example.com",
        "is this right?",
        0,
    );
    let mut source = MockMessageReader::new();
    source
        .expect_get()
        .withf(|_, id| *id == origin().message_id)
        .returning(|_, _| Ok(message()));
    // A document discussion is its own thread; nothing outside it is read.
    source.expect_preceding().never();
    source
        .expect_get_thread()
        .once()
        .withf(|access, root| access.entity().entity_id == "doc" && *root == origin().thread_id)
        .return_once(move |_, _| Ok(discussion(root, vec![message()], anchor)));
    source
}

async fn context_from(
    source: MockMessageReader,
    lexical: Lexical,
    origin: &AnnounceOrigin,
) -> ConversationContext {
    MessagePromptContextAdapter::new(
        Arc::new(source),
        Arc::new(Authorizer { allowed: true }),
        Arc::new(lexical),
    )
    .conversation_context(&actor(), origin)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_document_comment_carries_its_whole_thread_through_the_prompt() {
    let context = context_from(reader(None), Lexical::none(), &origin()).await;
    let thread = context.thread.unwrap();
    assert_eq!(thread.root_id, origin().thread_id);
    assert_eq!(
        thread
            .messages
            .iter()
            .map(|message| (message.author.as_str(), message.content.as_str()))
            .collect::<Vec<_>>(),
        [
            ("alice@example.com", "is this right?"),
            ("actor@example.com", "@agent explain this paragraph"),
        ]
    );
    assert!(!thread.messages_omitted);
    assert_eq!(context.prompt_message_id, Some(origin().message_id));
    assert_eq!(
        context.reply_target,
        Some(ReplyTarget::Thread {
            root_id: origin().thread_id
        })
    );
    assert!(context.channel.is_empty());
    // An unanchored discussion names no place in the document.
    assert_eq!(context.anchor, None);
}

/// The reported failure: "please fix" in thread A, posted while another
/// thread was busier. The agent must get thread A whole and be told the rest
/// is background, not a flat list whose last entry is someone else's bug.
#[tokio::test]
async fn a_channel_thread_reply_is_about_its_thread_not_the_latest_message() {
    let parent = channel();
    let calendar = posted(
        &parent,
        10,
        None,
        "julia@example.com",
        "calendar popover scrolls the page",
        0,
    );
    let spinner = posted(
        &parent,
        20,
        None,
        "teo@example.com",
        "sidebar spinner never stops",
        5,
    );
    let repro = posted(
        &parent,
        11,
        Some(10),
        "wolf@example.com",
        "repro: open it and scroll",
        6,
    );
    let lunch = posted(&parent, 30, None, "jacob@example.com", "lunch?", 10);
    let mobile = posted(
        &parent,
        21,
        Some(20),
        "julia@example.com",
        "same on mobile",
        12,
    );
    let prompt = posted(
        &parent,
        12,
        Some(10),
        "wolf@example.com",
        "@Cursor please fix",
        15,
    );
    let later = posted(
        &parent,
        13,
        Some(10),
        "julia@example.com",
        "posted after the prompt",
        20,
    );
    let origin = AnnounceOrigin {
        parent: parent.clone(),
        thread_id: calendar.id,
        message_id: prompt.id,
    };

    let mut source = MockMessageReader::new();
    let prompt_message = prompt.clone();
    source
        .expect_get()
        .withf(move |_, id| *id == Uuid::from_u128(12))
        .returning(move |_, _| Ok(prompt_message.clone()));
    let thread = discussion(
        calendar.clone(),
        vec![repro.clone(), prompt.clone(), later],
        None,
    );
    source
        .expect_get_thread()
        .once()
        .withf(|_, root| *root == Uuid::from_u128(10))
        .return_once(move |_, _| Ok(thread));
    // The window starts after the thread's root, as it does in a busy channel.
    let recent = vec![
        spinner.clone(),
        repro.clone(),
        lunch.clone(),
        mobile.clone(),
    ];
    source
        .expect_preceding()
        .once()
        .withf(|_, id, limit| *id == Uuid::from_u128(12) && *limit == 10)
        .return_once(move |_, _, _| Ok(recent));

    let context = context_from(source, Lexical::none(), &origin).await;

    assert_eq!(
        context.thread,
        Some(ContextThread {
            root_id: calendar.id,
            messages: vec![
                context_of(&calendar),
                context_of(&repro),
                context_of(&prompt)
            ],
            messages_omitted: false,
        })
    );
    assert_eq!(
        context.channel,
        [
            ContextThread {
                root_id: spinner.id,
                messages: vec![context_of(&spinner), context_of(&mobile)],
                messages_omitted: false,
            },
            ContextThread {
                root_id: lunch.id,
                messages: vec![context_of(&lunch)],
                messages_omitted: false,
            },
        ]
    );
    assert_eq!(
        context.reply_target,
        Some(ReplyTarget::Thread {
            root_id: calendar.id
        })
    );
    assert_eq!(context.prompt_message_id, Some(prompt.id));
}

#[tokio::test]
async fn a_top_level_channel_prompt_replies_to_nothing_and_ends_the_channel() {
    let parent = channel();
    let root = posted(&parent, 20, None, "teo@example.com", "spinner bug", 0);
    let reply = posted(
        &parent,
        21,
        Some(20),
        "julia@example.com",
        "same on mobile",
        1,
    );
    let orphan = posted(
        &parent,
        41,
        Some(40),
        "jacob@example.com",
        "reply to an old thread",
        2,
    );
    let prompt = posted(
        &parent,
        50,
        None,
        "wolf@example.com",
        "@Cursor what's broken?",
        3,
    );
    let origin = AnnounceOrigin {
        parent: parent.clone(),
        thread_id: prompt.id,
        message_id: prompt.id,
    };

    let mut source = MockMessageReader::new();
    let prompt_message = prompt.clone();
    source
        .expect_get()
        .returning(move |_, _| Ok(prompt_message.clone()));
    source.expect_get_thread().never();
    let recent = vec![root.clone(), reply.clone(), orphan.clone()];
    source
        .expect_preceding()
        .once()
        .return_once(move |_, _, _| Ok(recent));

    let context = context_from(source, Lexical::none(), &origin).await;

    assert_eq!(context.thread, None);
    assert_eq!(context.anchor, None);
    assert_eq!(context.reply_target, Some(ReplyTarget::None));
    assert_eq!(
        context.channel,
        [
            ContextThread {
                root_id: root.id,
                messages: vec![context_of(&root), context_of(&reply)],
                messages_omitted: false,
            },
            ContextThread {
                root_id: Uuid::from_u128(40),
                messages: vec![context_of(&orphan)],
                // Its root fell outside the window.
                messages_omitted: true,
            },
            ContextThread {
                root_id: prompt.id,
                messages: vec![context_of(&prompt)],
                messages_omitted: false,
            },
        ]
    );
}

#[tokio::test]
async fn a_quote_reply_carries_the_quoted_message_even_outside_the_window() {
    let parent = channel();
    let quoted = posted(
        &parent,
        60,
        None,
        "teo@example.com",
        "the spinner never stops",
        0,
    );
    let prompt = posted(
        &parent,
        70,
        None,
        "wolf@example.com",
        "<m-reply-target>…</m-reply-target>\n\n@Cursor fix this",
        30,
    );
    let origin = AnnounceOrigin {
        parent: parent.clone(),
        thread_id: prompt.id,
        message_id: prompt.id,
    };

    let mut source = MockMessageReader::new();
    let prompt_message = prompt.clone();
    source
        .expect_get()
        .withf(|_, id| *id == Uuid::from_u128(70))
        .returning(move |_, _| Ok(prompt_message.clone()));
    let quoted_message = quoted.clone();
    source
        .expect_get()
        .once()
        .withf(|access, id| {
            access.entity().entity_id == channel().entity_id() && *id == Uuid::from_u128(60)
        })
        .return_once(move |_, _| Ok(quoted_message));
    source
        .expect_preceding()
        .once()
        .return_once(|_, _, _| Ok(vec![]));

    let lexical = Lexical {
        quote: Ok(Some(ExtractedExplicitReply {
            parent: parent.clone(),
            target_message_id: quoted.id.to_string(),
            target_thread_id: quoted.id.to_string(),
            display_text: "the spinner never stops".to_owned(),
            sender_id: quoted.sender_id.as_ref().to_owned(),
        })),
        ..Lexical::none()
    };
    let context = context_from(source, lexical, &origin).await;

    assert_eq!(
        context.reply_target,
        Some(ReplyTarget::Quote {
            message_id: quoted.id,
            thread_id: quoted.id,
            preview: "the spinner never stops".to_owned(),
            message: Some(context_of(&quoted)),
        })
    );
}

#[tokio::test]
async fn a_quote_from_another_conversation_travels_as_its_preview() {
    let parent = channel();
    let prompt = posted(
        &parent,
        70,
        None,
        "wolf@example.com",
        "@Cursor fix this",
        30,
    );
    let origin = AnnounceOrigin {
        parent: parent.clone(),
        thread_id: prompt.id,
        message_id: prompt.id,
    };
    let mut source = MockMessageReader::new();
    let prompt_message = prompt.clone();
    // Only the prompt is read: the quoted message is on a parent the actor's
    // capability does not cover.
    source
        .expect_get()
        .once()
        .withf(|_, id| *id == Uuid::from_u128(70))
        .return_once(move |_, _| Ok(prompt_message));
    source
        .expect_preceding()
        .once()
        .return_once(|_, _, _| Ok(vec![]));
    let lexical = Lexical {
        quote: Ok(Some(ExtractedExplicitReply {
            parent: MessageParent::Channel(Uuid::from_u128(99)),
            target_message_id: Uuid::from_u128(61).to_string(),
            target_thread_id: Uuid::from_u128(61).to_string(),
            display_text: "elsewhere".to_owned(),
            sender_id: "macro|teo@example.com".to_owned(),
        })),
        ..Lexical::none()
    };
    let context = context_from(source, lexical, &origin).await;
    assert_eq!(
        context.reply_target,
        Some(ReplyTarget::Quote {
            message_id: Uuid::from_u128(61),
            thread_id: Uuid::from_u128(61),
            preview: "elsewhere".to_owned(),
            message: None,
        })
    );
}

#[tokio::test]
async fn a_failed_quote_lookup_still_names_the_thread() {
    let context = context_from(
        reader(None),
        Lexical {
            quote: Err("lexical unavailable"),
            ..Lexical::none()
        },
        &origin(),
    )
    .await;
    assert_eq!(
        context.reply_target,
        Some(ReplyTarget::Thread {
            root_id: origin().thread_id
        })
    );
}

#[tokio::test]
async fn a_long_thread_keeps_its_root_and_the_messages_nearest_the_prompt() {
    let parent = channel();
    let root = posted(&parent, 1, None, "julia@example.com", "the bug", 0);
    let replies: Vec<Message> = (0..60)
        .map(|index| {
            posted(
                &parent,
                100 + index,
                Some(1),
                "teo@example.com",
                &format!("reply {index}"),
                1 + i64::try_from(index).unwrap(),
            )
        })
        .collect();
    let prompt = replies.last().unwrap().clone();
    let origin = AnnounceOrigin {
        parent: parent.clone(),
        thread_id: root.id,
        message_id: prompt.id,
    };
    let mut source = MockMessageReader::new();
    let prompt_message = prompt.clone();
    source
        .expect_get()
        .returning(move |_, _| Ok(prompt_message.clone()));
    let thread = discussion(root.clone(), replies, None);
    source
        .expect_get_thread()
        .once()
        .return_once(move |_, _| Ok(thread));
    source
        .expect_preceding()
        .once()
        .return_once(|_, _, _| Ok(vec![]));

    let thread = context_from(source, Lexical::none(), &origin)
        .await
        .thread
        .unwrap();
    assert!(thread.messages_omitted);
    assert_eq!(thread.messages.len(), THREAD_MESSAGES);
    assert_eq!(thread.messages[0].content, "the bug");
    assert_eq!(thread.messages[1].content, "reply 11");
    assert_eq!(thread.messages.last().unwrap().id, prompt.id);
}

#[tokio::test]
async fn a_marked_discussion_names_its_mark_and_the_text_it_covers() {
    let mark_id = Uuid::from_u128(7);
    let context = context_from(
        reader(Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: Some("the marked phrase".to_owned()),
        })),
        Lexical::none(),
        &origin(),
    )
    .await;
    assert_eq!(
        context.anchor,
        Some(CommentAnchor::Mark {
            mark_id: mark_id.to_string(),
            marked_text: Some("the marked phrase".to_owned()),
            current: None,
        })
    );
}

#[tokio::test]
async fn a_discussion_anchored_before_snapshots_still_names_its_mark() {
    let mark_id = Uuid::from_u128(8);
    let context = context_from(
        reader(Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: None,
        })),
        Lexical::none(),
        &origin(),
    )
    .await;
    assert_eq!(
        context.anchor,
        Some(CommentAnchor::Mark {
            mark_id: mark_id.to_string(),
            marked_text: None,
            current: None,
        })
    );
}

#[tokio::test]
async fn a_marked_discussion_reads_the_mark_as_the_document_has_it_now() {
    let mark_id = Uuid::from_u128(9);
    let current = MarkedPassage {
        marked_text: "the edited phrase".to_owned(),
        surrounding_text: "Before the edited phrase after.".to_owned(),
    };
    let context = context_from(
        reader(Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: Some("the original phrase".to_owned()),
        })),
        Lexical::mark(Ok(Some(current.clone()))),
        &origin(),
    )
    .await;
    assert_eq!(
        context.anchor,
        Some(CommentAnchor::Mark {
            mark_id: mark_id.to_string(),
            marked_text: Some("the original phrase".to_owned()),
            current: Some(current),
        })
    );
}

#[tokio::test]
async fn a_failed_live_lookup_falls_back_to_the_snapshot() {
    let mark_id = Uuid::from_u128(10);
    let context = context_from(
        reader(Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: Some("the original phrase".to_owned()),
        })),
        Lexical::mark(Err("lexical unavailable")),
        &origin(),
    )
    .await;
    assert_eq!(
        context.anchor,
        Some(CommentAnchor::Mark {
            mark_id: mark_id.to_string(),
            marked_text: Some("the original phrase".to_owned()),
            current: None,
        })
    );
}

#[tokio::test]
async fn a_pdf_highlight_discussion_names_the_text_the_highlight_covers() {
    let anchor_id = Uuid::from_u128(11);
    let context = context_from(
        reader(Some(ThreadAnchor::PdfHighlight {
            anchor_id,
            marked_text: Some("indemnifies the lessor".to_owned()),
        })),
        // The highlight's text arrives with the thread; no document lookup.
        Lexical::mark(Err("never asked")),
        &origin(),
    )
    .await;
    assert_eq!(
        context.anchor,
        Some(CommentAnchor::PdfHighlight {
            anchor_id: anchor_id.to_string(),
            marked_text: Some("indemnifies the lessor".to_owned()),
        })
    );
}

#[tokio::test]
async fn a_pdf_pin_discussion_names_its_pin() {
    let anchor_id = Uuid::from_u128(12);
    let context = context_from(
        reader(Some(ThreadAnchor::PdfPlaceable { anchor_id })),
        Lexical::none(),
        &origin(),
    )
    .await;
    assert_eq!(
        context.anchor,
        Some(CommentAnchor::PdfPin {
            anchor_id: anchor_id.to_string(),
        })
    );
}
