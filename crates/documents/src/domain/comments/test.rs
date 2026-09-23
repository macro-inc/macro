use super::*;
use channel_sender::ChannelSender;
use chrono::TimeZone;
use entity_access::domain::models::{Entity, EntityPermission, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MockMessageReader,
    models::{BotSenderProfile, MessageParent, MessageThread, MessageThreadPreview, ThreadState},
    ports::{MessageCursor, MessagePage},
};
use models_permissions::share_permission::access_level::AccessLevel;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|author@macro.com".to_owned()).unwrap()
}

fn receipt() -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: DOCUMENT.to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 23, 12, minute, 0).unwrap()
}

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

fn message(n: u128, root: Option<u128>, content: &str) -> Message {
    Message {
        id: id(n),
        parent: MessageParent::parse("document", DOCUMENT).unwrap(),
        thread_id: root.map(id),
        sender_id: ChannelSender::new_from_user(user()),
        imported_author: None,
        bot_profile: None,
        mentions: vec![],
        triggered_by: None,
        content: content.to_owned(),
        created_at: at(n as u32),
        updated_at: at(n as u32),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    }
}

fn item(root: Message, anchor: Option<ThreadAnchor>, replies: Vec<Message>) -> MessageListItem {
    MessageListItem {
        state: ThreadState {
            root_id: root.id,
            user_id: user().as_ref().to_owned(),
            resolved: false,
            anchor,
            created_at: root.created_at,
            updated_at: root.updated_at,
            deleted_at: None,
        },
        thread: MessageThreadPreview {
            reply_count: replies.len() as i64,
            latest_reply_at: replies.last().map(|reply| reply.created_at),
            preview: replies,
        },
        message: root,
    }
}

fn markdown(mark: u128, snapshot: Option<&str>) -> Option<ThreadAnchor> {
    Some(ThreadAnchor::Markdown {
        mark_id: id(mark),
        marked_text: snapshot.map(str::to_owned),
    })
}

fn page(items: Vec<MessageListItem>, next_cursor: Option<MessageCursor>) -> MessagePage {
    MessagePage {
        items,
        next_cursor,
        previous_cursor: None,
    }
}

/// Mark lookups answered from a fixed table; a mark missing from it fails.
struct Marks(HashMap<Uuid, Option<String>>);

#[async_trait::async_trait]
impl CommentMarks for Marks {
    async fn marked_text(
        &self,
        document_id: &str,
        mark_id: Uuid,
    ) -> anyhow::Result<Option<String>> {
        assert_eq!(document_id, DOCUMENT);
        self.0
            .get(&mark_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("lexical service unavailable"))
    }
}

fn no_marks() -> Marks {
    Marks(HashMap::new())
}

fn reader(messages: MockMessageReader, marks: Marks) -> DocumentCommentReader<Marks> {
    DocumentCommentReader::new(Arc::new(messages), marks)
}

#[tokio::test]
async fn reads_inline_and_discussion_threads_oldest_first() {
    let mut messages = MockMessageReader::new();
    messages.expect_timeline().times(1).returning(|access, _| {
        assert_eq!(access.entity().entity_id, DOCUMENT);
        // The timeline is newest first.
        Ok(page(
            vec![
                item(message(3, None, "Discussion comment"), None, vec![]),
                item(
                    message(1, None, "Inline comment"),
                    markdown(100, Some("resolve linked accounts")),
                    vec![message(2, Some(1), "A reply")],
                ),
            ],
            None,
        ))
    });
    let marks = Marks(HashMap::from([(
        id(100),
        Some("resolve linked accounts at read time instead".to_owned()),
    )]));

    let discussions = reader(messages, marks)
        .discussions(receipt())
        .await
        .unwrap();

    assert_eq!(
        discussions,
        vec![
            DocumentDiscussion {
                id: id(1),
                kind: CommentThreadKind::Inline,
                resolved: false,
                anchor: CommentAnchor::Text {
                    mark_id: id(100),
                    marked_text: Some("resolve linked accounts at read time instead".to_owned()),
                    original_marked_text: Some("resolve linked accounts".to_owned()),
                    removed: false,
                },
                comments: vec![
                    comment(message(1, None, "Inline comment")),
                    comment(message(2, Some(1), "A reply")),
                ],
            },
            DocumentDiscussion {
                id: id(3),
                kind: CommentThreadKind::Discussion,
                resolved: false,
                anchor: CommentAnchor::Document,
                comments: vec![comment(message(3, None, "Discussion comment"))],
            },
        ]
    );
}

#[tokio::test]
async fn unchanged_mark_text_is_not_repeated() {
    let mut messages = MockMessageReader::new();
    messages.expect_timeline().returning(|_, _| {
        Ok(page(
            vec![item(
                message(1, None, "c"),
                markdown(100, Some("same")),
                vec![],
            )],
            None,
        ))
    });
    let marks = Marks(HashMap::from([(id(100), Some("same".to_owned()))]));

    let discussions = reader(messages, marks)
        .discussions(receipt())
        .await
        .unwrap();

    assert_eq!(
        discussions[0].anchor,
        CommentAnchor::Text {
            mark_id: id(100),
            marked_text: Some("same".to_owned()),
            original_marked_text: None,
            removed: false,
        }
    );
}

#[tokio::test]
async fn removed_or_unreadable_marks_fall_back_to_the_snapshot() {
    let mut messages = MockMessageReader::new();
    messages.expect_timeline().returning(|_, _| {
        Ok(page(
            vec![
                item(
                    message(2, None, "b"),
                    markdown(200, Some("unreadable")),
                    vec![],
                ),
                item(
                    message(1, None, "a"),
                    markdown(100, Some("deleted text")),
                    vec![],
                ),
            ],
            None,
        ))
    });
    // Mark 100 is gone from the document; mark 200's lookup fails.
    let marks = Marks(HashMap::from([(id(100), None)]));

    let discussions = reader(messages, marks)
        .discussions(receipt())
        .await
        .unwrap();

    assert_eq!(
        discussions
            .into_iter()
            .map(|discussion| discussion.anchor)
            .collect::<Vec<_>>(),
        vec![
            CommentAnchor::Text {
                mark_id: id(100),
                marked_text: Some("deleted text".to_owned()),
                original_marked_text: None,
                removed: true,
            },
            CommentAnchor::Text {
                mark_id: id(200),
                marked_text: Some("unreadable".to_owned()),
                original_marked_text: None,
                removed: false,
            },
        ]
    );
}

#[tokio::test]
async fn pdf_anchors_are_inline_threads() {
    let mut messages = MockMessageReader::new();
    messages.expect_timeline().returning(|_, _| {
        Ok(page(
            vec![
                item(
                    message(2, None, "pin"),
                    Some(ThreadAnchor::PdfPlaceable { anchor_id: id(20) }),
                    vec![],
                ),
                item(
                    message(1, None, "highlight"),
                    Some(ThreadAnchor::PdfHighlight { anchor_id: id(10) }),
                    vec![],
                ),
            ],
            None,
        ))
    });

    let discussions = reader(messages, no_marks())
        .discussions(receipt())
        .await
        .unwrap();

    assert_eq!(
        discussions
            .iter()
            .map(|discussion| (discussion.kind, discussion.anchor.clone()))
            .collect::<Vec<_>>(),
        vec![
            (
                CommentThreadKind::Inline,
                CommentAnchor::PdfHighlight { anchor_id: id(10) }
            ),
            (
                CommentThreadKind::Inline,
                CommentAnchor::PdfPin { anchor_id: id(20) }
            ),
        ]
    );
}

#[tokio::test]
async fn threads_beyond_the_preview_load_every_reply() {
    let mut messages = MockMessageReader::new();
    messages.expect_timeline().returning(|_, _| {
        let replies = (2..5).map(|n| message(n, Some(1), "preview")).collect();
        let mut root = item(message(1, None, "root"), None, replies);
        root.thread.reply_count = 4;
        Ok(page(vec![root], None))
    });
    messages.expect_get_thread().times(1).returning(|_, root| {
        assert_eq!(root, id(1));
        let mut deleted = message(6, Some(1), "gone");
        deleted.deleted_at = Some(at(7));
        Ok(MessageThread {
            state: item(message(1, None, "root"), None, vec![]).state,
            root: message(1, None, "root"),
            replies: vec![
                message(2, Some(1), "r2"),
                message(3, Some(1), "r3"),
                message(4, Some(1), "r4"),
                message(5, Some(1), "r5"),
                deleted,
            ],
        })
    });

    let discussions = reader(messages, no_marks())
        .discussions(receipt())
        .await
        .unwrap();

    assert_eq!(
        discussions[0]
            .comments
            .iter()
            .map(|comment| comment.id)
            .collect::<Vec<_>>(),
        vec![id(1), id(2), id(3), id(4), id(5)]
    );
}

#[tokio::test]
async fn deleted_first_comments_are_kept_only_with_replies() {
    let mut messages = MockMessageReader::new();
    messages.expect_timeline().returning(|_, _| {
        let mut lone = message(3, None, "lone");
        lone.deleted_at = Some(at(4));
        let mut answered = message(1, None, "answered");
        answered.deleted_at = Some(at(4));
        Ok(page(
            vec![
                item(lone, None, vec![]),
                item(answered, None, vec![message(2, Some(1), "reply")]),
            ],
            None,
        ))
    });

    let discussions = reader(messages, no_marks())
        .discussions(receipt())
        .await
        .unwrap();

    assert_eq!(discussions.len(), 1);
    assert_eq!(discussions[0].id, id(1));
    assert_eq!(discussions[0].comments[0].content, None);
    assert_eq!(discussions[0].comments[1].content.as_deref(), Some("reply"));
}

#[tokio::test]
async fn follows_the_timeline_to_its_oldest_page() {
    let mut messages = MockMessageReader::new();
    let mut sequence = mockall::Sequence::new();
    messages
        .expect_timeline()
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_, query| {
            assert!(query.cursor.is_none());
            assert_eq!(query.limit, Some(PAGE_SIZE));
            Ok(page(
                vec![item(message(2, None, "newer"), None, vec![])],
                Some(MessageCursor {
                    created_at: at(2),
                    id: id(2),
                }),
            ))
        });
    messages
        .expect_timeline()
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_, query| {
            assert_eq!(query.cursor.map(|cursor| cursor.id), Some(id(2)));
            Ok(page(
                vec![item(message(1, None, "older"), None, vec![])],
                None,
            ))
        });

    let discussions = reader(messages, no_marks())
        .discussions(receipt())
        .await
        .unwrap();

    assert_eq!(
        discussions.iter().map(|d| d.id).collect::<Vec<_>>(),
        vec![id(1), id(2)]
    );
}

#[tokio::test]
async fn message_failures_fail_the_read() {
    let mut messages = MockMessageReader::new();
    messages
        .expect_timeline()
        .returning(|_, _| Err(MessageError::Forbidden));

    let error = reader(messages, no_marks())
        .discussions(receipt())
        .await
        .unwrap_err();

    assert!(matches!(error, DocumentError::Unauthorized));
}

#[test]
fn serializes_ids_kind_and_anchor_for_agents() {
    let mut bot = message(2, Some(1), "On it");
    bot.bot_profile = Some(BotSenderProfile {
        name: "Macro AI".to_owned(),
        avatar_url: None,
    });
    let discussion = DocumentDiscussion {
        id: id(1),
        kind: CommentThreadKind::Inline,
        resolved: true,
        anchor: CommentAnchor::Text {
            mark_id: id(100),
            marked_text: Some("marked".to_owned()),
            original_marked_text: None,
            removed: false,
        },
        comments: vec![comment(message(1, None, "Why?")), comment(bot)],
    };

    assert_eq!(
        serde_json::to_value(discussion).unwrap(),
        serde_json::json!({
            "id": id(1),
            "kind": "inline",
            "resolved": true,
            "anchor": { "type": "text", "markId": id(100), "markedText": "marked" },
            "comments": [
                {
                    "id": id(1),
                    "author": "macro|author@macro.com",
                    "content": "Why?",
                    "createdAt": "2026-09-23T12:01:00Z"
                },
                {
                    "id": id(2),
                    "author": "macro|author@macro.com",
                    "authorName": "Macro AI",
                    "content": "On it",
                    "createdAt": "2026-09-23T12:02:00Z"
                }
            ]
        })
    );
}

#[tokio::test]
async fn deleted_threads_do_not_count_toward_the_cap() {
    let mut messages = MockMessageReader::new();
    let mut sequence = mockall::Sequence::new();
    messages
        .expect_timeline()
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_, _| {
            let items = (0..MAX_DISCUSSIONS as u128)
                .map(|n| {
                    let mut root = message(2, None, "deleted");
                    root.id = id(1_000 + n);
                    root.deleted_at = Some(at(0));
                    item(root, None, vec![])
                })
                .collect();
            Ok(page(
                items,
                Some(MessageCursor {
                    created_at: at(0),
                    id: id(1_000),
                }),
            ))
        });
    messages
        .expect_timeline()
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_, _| {
            Ok(page(
                vec![item(message(1, None, "live"), None, vec![])],
                None,
            ))
        });

    let discussions = reader(messages, no_marks())
        .discussions(receipt())
        .await
        .unwrap();

    assert_eq!(
        discussions.iter().map(|d| d.id).collect::<Vec<_>>(),
        vec![id(1)]
    );
}
