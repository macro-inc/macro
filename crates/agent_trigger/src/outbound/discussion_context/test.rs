use super::*;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MockMessageReader,
    models::{BotSenderProfile, ImportedAuthor, MessageThread, ThreadState},
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

/// Names one expected parent.
struct Names {
    parent: MessageParent,
    name: ParentName,
}
impl ParentNames for Names {
    async fn name(
        &self,
        access: &EntityAccessReceipt<MessageView>,
        parent: &MessageParent,
    ) -> Result<ParentName> {
        assert_eq!(*parent, self.parent);
        assert_eq!(access.entity().entity_id, parent.entity_id());
        Ok(self.name.clone())
    }
}
fn document_names() -> Names {
    Names {
        parent: document(),
        name: ParentName::Named("Launch plan".to_owned()),
    }
}
fn channel_names() -> Names {
    Names {
        parent: channel(),
        name: ParentName::Channel {
            name: Some("eng".to_owned()),
            channel_type: ChannelType::Public,
        },
    }
}

/// Names each user after their email's local part.
struct Directory;
impl PeopleDirectory for Directory {
    async fn people(&self, ids: Vec<String>) -> Result<Vec<ContextPerson>> {
        Ok(ids
            .into_iter()
            .map(|id| {
                let email = id.strip_prefix("macro|").unwrap().to_owned();
                ContextPerson {
                    name: email.split('@').next().unwrap().to_owned(),
                    id,
                    email: Some(email),
                }
            })
            .collect())
    }
}
fn person(email: &str) -> ContextPerson {
    ContextPerson {
        id: format!("macro|{email}"),
        name: email.split('@').next().unwrap().to_owned(),
        email: Some(email.to_owned()),
    }
}

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("actor@example.com").unwrap()
}
fn document() -> MessageParent {
    MessageParent::parse("document", "doc").unwrap()
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
/// The context entry for a message by a user the directory names.
fn entry(message: &Message) -> ContextMessage {
    ContextMessage {
        id: message.id,
        author: person(message.sender_id.as_user().unwrap().email_str()),
        content: message.content.clone(),
        posted_at: message.created_at,
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

/// The actor's verified capability on `prompt`'s parent and discussion.
fn invocation(prompt: &Message) -> AuthorizedInvocation {
    AuthorizedInvocation::new(
        EntityAccessReceipt::try_new_authenticated_user(
            actor(),
            Entity {
                entity_type: prompt.parent.access_entity_type(),
                entity_id: prompt.parent.entity_id(),
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Comment,
            },
        )
        .unwrap(),
        prompt.root_id(),
    )
}

async fn context_from(
    source: MockMessageReader,
    names: Names,
    lexical: Lexical,
    prompt: &Message,
) -> DiscussionContext {
    MessageDiscussionReader::new(Arc::new(source), Directory, names, lexical)
        .discussion(
            &invocation(prompt),
            &MessagePostedMetadata::from_message(prompt, vec![]),
        )
        .await
        .unwrap()
}

/// The prompting reply in a comment thread on `parent`.
fn comment(parent: &MessageParent) -> Message {
    posted(
        parent,
        2,
        Some(1),
        "actor@example.com",
        "@agent explain this paragraph",
        5,
    )
}

/// A comment thread on `parent`: the root and the prompting reply.
fn reader(parent: &MessageParent, anchor: Option<ThreadAnchor>) -> MockMessageReader {
    let root = posted(parent, 1, None, "alice@example.com", "is this right?", 0);
    let prompt = comment(parent);
    let mut source = MockMessageReader::new();
    let prompt_message = prompt.clone();
    source
        .expect_get()
        .withf(|_, id| *id == Uuid::from_u128(2))
        .returning(move |_, _| Ok(prompt_message.clone()));
    // A comment discussion is its own thread; nothing outside it is read.
    source.expect_preceding().never();
    let expected = parent.entity_id();
    source
        .expect_get_thread()
        .once()
        .withf(move |access, root| {
            access.entity().entity_id == expected && *root == Uuid::from_u128(1)
        })
        .return_once(move |_, _| Ok(discussion(root, vec![prompt], anchor)));
    source
}

#[tokio::test]
async fn a_document_comment_carries_its_whole_thread_through_the_prompt() {
    let prompt = comment(&document());
    let context = context_from(
        reader(&document(), None),
        document_names(),
        Lexical::none(),
        &prompt,
    )
    .await;
    assert_eq!(
        context,
        DiscussionContext {
            // An unanchored discussion names no place in the document.
            surface: DiscussionSurface::DocumentComment {
                id: "doc".to_owned(),
                name: "Launch plan".to_owned(),
                anchor: None,
            },
            prompt_message_id: Uuid::from_u128(2),
            sender: ContextPerson {
                id: "macro|actor@example.com".to_owned(),
                name: "actor".to_owned(),
                email: Some("actor@example.com".to_owned()),
            },
            reply_target: ReplyTarget::Thread {
                root_id: Uuid::from_u128(1)
            },
            thread: Some(ContextThread {
                root_id: Uuid::from_u128(1),
                messages: vec![
                    ContextMessage {
                        id: Uuid::from_u128(1),
                        author: ContextPerson {
                            id: "macro|alice@example.com".to_owned(),
                            name: "alice".to_owned(),
                            email: Some("alice@example.com".to_owned()),
                        },
                        content: "is this right?".to_owned(),
                        posted_at: at(0),
                    },
                    ContextMessage {
                        id: Uuid::from_u128(2),
                        author: ContextPerson {
                            id: "macro|actor@example.com".to_owned(),
                            name: "actor".to_owned(),
                            email: Some("actor@example.com".to_owned()),
                        },
                        content: "@agent explain this paragraph".to_owned(),
                        posted_at: at(5),
                    },
                ],
                messages_omitted: false,
            }),
            channel: vec![],
        }
    );
}

/// "please fix" in thread A, posted while another thread was busier. The
/// agent must get thread A whole and be told the rest is background, not a
/// flat list whose last entry is someone else's bug.
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

    let context = context_from(source, channel_names(), Lexical::none(), &prompt).await;

    assert_eq!(
        context,
        DiscussionContext {
            surface: DiscussionSurface::Channel {
                id: Uuid::from_u128(3),
                name: Some("eng".to_owned()),
                channel_type: ChannelType::Public,
            },
            prompt_message_id: prompt.id,
            sender: person("wolf@example.com"),
            reply_target: ReplyTarget::Thread {
                root_id: calendar.id
            },
            thread: Some(ContextThread {
                root_id: calendar.id,
                messages: vec![entry(&calendar), entry(&repro), entry(&prompt)],
                messages_omitted: false,
            }),
            channel: vec![
                ContextThread {
                    root_id: spinner.id,
                    messages: vec![entry(&spinner), entry(&mobile)],
                    messages_omitted: false,
                },
                ContextThread {
                    root_id: lunch.id,
                    messages: vec![entry(&lunch)],
                    messages_omitted: false,
                },
            ],
        }
    );
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

    let context = context_from(source, channel_names(), Lexical::none(), &prompt).await;

    assert_eq!(context.thread, None);
    assert_eq!(context.reply_target, ReplyTarget::None);
    assert_eq!(
        context.channel,
        [
            ContextThread {
                root_id: root.id,
                messages: vec![entry(&root), entry(&reply)],
                messages_omitted: false,
            },
            ContextThread {
                root_id: Uuid::from_u128(40),
                messages: vec![entry(&orphan)],
                // Its root fell outside the window.
                messages_omitted: true,
            },
            ContextThread {
                root_id: prompt.id,
                messages: vec![entry(&prompt)],
                messages_omitted: false,
            },
        ]
    );
}

#[tokio::test]
async fn deleted_blank_imported_and_bot_messages_read_as_their_authors_wrote_them() {
    let parent = channel();
    let deleted = Message {
        deleted_at: Some(at(1)),
        ..posted(&parent, 20, None, "teo@example.com", "retracted", 0)
    };
    let blank = posted(&parent, 21, None, "teo@example.com", "  \n ", 1);
    let imported = Message {
        imported_author: Some(ImportedAuthor {
            name: "Dana (Slack)".to_owned(),
        }),
        ..posted(&parent, 22, None, "importer@example.com", "from slack", 2)
    };
    let bot = Message {
        sender_id: channel_sender::ChannelSender::new_from_bot(bot_id::BotId::new_from_uuid(
            Uuid::from_u128(99),
        )),
        bot_profile: Some(BotSenderProfile {
            name: "Deploy Bot".to_owned(),
            avatar_url: None,
        }),
        ..posted(&parent, 23, None, "unused@example.com", "deployed v2", 3)
    };
    let prompt = posted(&parent, 50, None, "wolf@example.com", "@Cursor status?", 4);

    let mut source = MockMessageReader::new();
    let prompt_message = prompt.clone();
    source
        .expect_get()
        .returning(move |_, _| Ok(prompt_message.clone()));
    let recent = vec![deleted, blank, imported, bot];
    source
        .expect_preceding()
        .once()
        .return_once(move |_, _, _| Ok(recent));

    let context = context_from(source, channel_names(), Lexical::none(), &prompt).await;

    assert_eq!(
        context.channel,
        [
            ContextThread {
                root_id: Uuid::from_u128(22),
                messages: vec![ContextMessage {
                    id: Uuid::from_u128(22),
                    author: ContextPerson {
                        id: "macro|importer@example.com".to_owned(),
                        name: "Dana (Slack)".to_owned(),
                        email: None,
                    },
                    content: "from slack".to_owned(),
                    posted_at: at(2),
                }],
                messages_omitted: false,
            },
            ContextThread {
                root_id: Uuid::from_u128(23),
                messages: vec![ContextMessage {
                    id: Uuid::from_u128(23),
                    author: ContextPerson {
                        id: "bot|00000000-0000-0000-0000-000000000063".to_owned(),
                        name: "Deploy Bot".to_owned(),
                        email: None,
                    },
                    content: "deployed v2".to_owned(),
                    posted_at: at(3),
                }],
                messages_omitted: false,
            },
            ContextThread {
                root_id: prompt.id,
                messages: vec![entry(&prompt)],
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
    let context = context_from(source, channel_names(), lexical, &prompt).await;

    assert_eq!(
        context.reply_target,
        ReplyTarget::Quote {
            message_id: quoted.id,
            thread_id: quoted.id,
            preview: "the spinner never stops".to_owned(),
            message: Some(ContextMessage {
                id: quoted.id,
                author: ContextPerson {
                    id: "macro|teo@example.com".to_owned(),
                    name: "teo".to_owned(),
                    email: Some("teo@example.com".to_owned()),
                },
                content: "the spinner never stops".to_owned(),
                posted_at: at(0),
            }),
        }
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
    let context = context_from(source, channel_names(), lexical, &prompt).await;
    assert_eq!(
        context.reply_target,
        ReplyTarget::Quote {
            message_id: Uuid::from_u128(61),
            thread_id: Uuid::from_u128(61),
            preview: "elsewhere".to_owned(),
            message: None,
        }
    );
}

#[tokio::test]
async fn a_failed_quote_lookup_still_names_the_thread() {
    let context = context_from(
        reader(&document(), None),
        document_names(),
        Lexical {
            quote: Err("lexical unavailable"),
            ..Lexical::none()
        },
        &comment(&document()),
    )
    .await;
    assert_eq!(
        context.reply_target,
        ReplyTarget::Thread {
            root_id: Uuid::from_u128(1)
        }
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

    let thread = context_from(source, channel_names(), Lexical::none(), &prompt)
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
async fn a_post_outside_the_invoked_discussion_is_never_read() {
    let prompt = comment(&document());
    let elsewhere = Message {
        thread_id: Some(Uuid::from_u128(77)),
        ..prompt.clone()
    };
    let error = MessageDiscussionReader::new(
        Arc::new(MockMessageReader::new()),
        Directory,
        document_names(),
        Lexical::none(),
    )
    .discussion(
        &invocation(&prompt),
        &MessagePostedMetadata::from_message(&elsewhere, vec![]),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, AgentSessionError::Forbidden));
}

#[tokio::test]
async fn a_direct_message_channel_has_no_name() {
    let prompt = posted(&channel(), 50, None, "wolf@example.com", "@Cursor hi", 0);
    let mut source = MockMessageReader::new();
    let prompt_message = prompt.clone();
    source
        .expect_get()
        .returning(move |_, _| Ok(prompt_message.clone()));
    source
        .expect_preceding()
        .once()
        .return_once(|_, _, _| Ok(vec![]));
    let names = Names {
        parent: channel(),
        name: ParentName::Channel {
            name: None,
            channel_type: ChannelType::DirectMessage,
        },
    };
    let context = context_from(source, names, Lexical::none(), &prompt).await;
    assert_eq!(
        context.surface,
        DiscussionSurface::Channel {
            id: Uuid::from_u128(3),
            name: None,
            channel_type: ChannelType::DirectMessage,
        }
    );
}

#[tokio::test]
async fn a_project_comment_names_its_project() {
    let parent = MessageParent::Initiative(Uuid::from_u128(901));
    let names = Names {
        parent: parent.clone(),
        name: ParentName::Named("Q4 launch".to_owned()),
    };
    let context = context_from(
        reader(&parent, None),
        names,
        Lexical::none(),
        &comment(&parent),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::ProjectComment {
            id: Uuid::from_u128(901),
            name: "Q4 launch".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_crm_company_comment_names_its_company() {
    let parent = MessageParent::CrmCompany(Uuid::from_u128(902));
    let names = Names {
        parent: parent.clone(),
        name: ParentName::Named("Acme".to_owned()),
    };
    let context = context_from(
        reader(&parent, None),
        names,
        Lexical::none(),
        &comment(&parent),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::CrmCompanyComment {
            id: Uuid::from_u128(902),
            name: "Acme".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_crm_contact_comment_names_its_contact() {
    let parent = MessageParent::CrmContact(Uuid::from_u128(903));
    let names = Names {
        parent: parent.clone(),
        name: ParentName::Named("Dana Lee".to_owned()),
    };
    let context = context_from(
        reader(&parent, None),
        names,
        Lexical::none(),
        &comment(&parent),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::CrmContactComment {
            id: Uuid::from_u128(903),
            name: "Dana Lee".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_call_chat_names_its_call() {
    let parent = MessageParent::Call(Uuid::from_u128(904));
    let names = Names {
        parent: parent.clone(),
        name: ParentName::Named("Weekly sync".to_owned()),
    };
    let context = context_from(
        reader(&parent, None),
        names,
        Lexical::none(),
        &comment(&parent),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::CallChat {
            id: Uuid::from_u128(904),
            title: "Weekly sync".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_marked_discussion_names_its_mark_and_the_text_it_covers() {
    let mark_id = Uuid::from_u128(7);
    let context = context_from(
        reader(
            &document(),
            Some(ThreadAnchor::Markdown {
                mark_id,
                marked_text: Some("the marked phrase".to_owned()),
            }),
        ),
        document_names(),
        Lexical::none(),
        &comment(&document()),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::DocumentComment {
            id: "doc".to_owned(),
            name: "Launch plan".to_owned(),
            anchor: Some(CommentAnchor::Mark {
                mark_id: mark_id.to_string(),
                marked_text: Some("the marked phrase".to_owned()),
                current: None,
            }),
        }
    );
}

#[tokio::test]
async fn a_discussion_anchored_before_snapshots_still_names_its_mark() {
    let mark_id = Uuid::from_u128(8);
    let context = context_from(
        reader(
            &document(),
            Some(ThreadAnchor::Markdown {
                mark_id,
                marked_text: None,
            }),
        ),
        document_names(),
        Lexical::none(),
        &comment(&document()),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::DocumentComment {
            id: "doc".to_owned(),
            name: "Launch plan".to_owned(),
            anchor: Some(CommentAnchor::Mark {
                mark_id: mark_id.to_string(),
                marked_text: None,
                current: None,
            }),
        }
    );
}

#[tokio::test]
async fn a_marked_discussion_reads_the_mark_as_the_document_has_it_now() {
    let mark_id = Uuid::from_u128(9);
    let context = context_from(
        reader(
            &document(),
            Some(ThreadAnchor::Markdown {
                mark_id,
                marked_text: Some("the original phrase".to_owned()),
            }),
        ),
        document_names(),
        Lexical::mark(Ok(Some(MarkedPassage {
            marked_text: "the edited phrase".to_owned(),
            surrounding_text: "Before the edited phrase after.".to_owned(),
        }))),
        &comment(&document()),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::DocumentComment {
            id: "doc".to_owned(),
            name: "Launch plan".to_owned(),
            anchor: Some(CommentAnchor::Mark {
                mark_id: mark_id.to_string(),
                marked_text: Some("the original phrase".to_owned()),
                current: Some(MarkedPassage {
                    marked_text: "the edited phrase".to_owned(),
                    surrounding_text: "Before the edited phrase after.".to_owned(),
                }),
            }),
        }
    );
}

#[tokio::test]
async fn a_failed_live_lookup_falls_back_to_the_snapshot() {
    let mark_id = Uuid::from_u128(10);
    let context = context_from(
        reader(
            &document(),
            Some(ThreadAnchor::Markdown {
                mark_id,
                marked_text: Some("the original phrase".to_owned()),
            }),
        ),
        document_names(),
        Lexical::mark(Err("lexical unavailable")),
        &comment(&document()),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::DocumentComment {
            id: "doc".to_owned(),
            name: "Launch plan".to_owned(),
            anchor: Some(CommentAnchor::Mark {
                mark_id: mark_id.to_string(),
                marked_text: Some("the original phrase".to_owned()),
                current: None,
            }),
        }
    );
}

#[tokio::test]
async fn a_pdf_highlight_discussion_names_the_text_the_highlight_covers() {
    let anchor_id = Uuid::from_u128(11);
    let context = context_from(
        reader(
            &document(),
            Some(ThreadAnchor::PdfHighlight {
                anchor_id,
                marked_text: Some("indemnifies the lessor".to_owned()),
            }),
        ),
        document_names(),
        // The highlight's text arrives with the thread; no document lookup.
        Lexical::mark(Err("never asked")),
        &comment(&document()),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::DocumentComment {
            id: "doc".to_owned(),
            name: "Launch plan".to_owned(),
            anchor: Some(CommentAnchor::PdfHighlight {
                anchor_id: anchor_id.to_string(),
                marked_text: Some("indemnifies the lessor".to_owned()),
            }),
        }
    );
}

#[tokio::test]
async fn a_pdf_pin_discussion_names_its_pin() {
    let anchor_id = Uuid::from_u128(12);
    let context = context_from(
        reader(&document(), Some(ThreadAnchor::PdfPlaceable { anchor_id })),
        document_names(),
        Lexical::none(),
        &comment(&document()),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::DocumentComment {
            id: "doc".to_owned(),
            name: "Launch plan".to_owned(),
            anchor: Some(CommentAnchor::PdfPin {
                anchor_id: anchor_id.to_string(),
            }),
        }
    );
}

#[tokio::test]
async fn spreadsheet_discussions_carry_the_range_without_resolving_a_mark() {
    let context = context_from(
        reader(
            &document(),
            Some(ThreadAnchor::Spreadsheet {
                sheet_id: "sheet-1".into(),
                sheet_name: "Budget".into(),
                range: "B4:C9".into(),
            }),
        ),
        document_names(),
        Lexical::mark(Err("never asked")),
        &comment(&document()),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::DocumentComment {
            id: "doc".to_owned(),
            name: "Launch plan".to_owned(),
            anchor: Some(CommentAnchor::Spreadsheet {
                sheet_id: "sheet-1".into(),
                sheet_name: "Budget".into(),
                range: "B4:C9".into(),
            }),
        }
    );
}

#[tokio::test]
async fn design_discussions_reach_the_agent_unanchored() {
    let context = context_from(
        reader(
            &document(),
            Some(ThreadAnchor::Fig {
                page_id: "0:1".into(),
                node_id: Some("12:34".into()),
                x: 18.5,
                y: -4.0,
            }),
        ),
        document_names(),
        Lexical::mark(Err("never asked")),
        &comment(&document()),
    )
    .await;
    assert_eq!(
        context.surface,
        DiscussionSurface::DocumentComment {
            id: "doc".to_owned(),
            name: "Launch plan".to_owned(),
            anchor: None,
        }
    );
    assert!(context.thread.is_some());
}
