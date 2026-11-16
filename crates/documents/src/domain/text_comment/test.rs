use super::*;
use crate::domain::permission_token::decode_permission_token;
use crate::domain::ports::editing::MockEditingWorkerService;
use channel_sender::ChannelSender;
use chrono::{TimeZone, Utc};
use entity_access::domain::models::{Entity, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{api::MockMessageCommands, models::MessageParent};
use model_owner::Owner;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
const USER: &str = "macro|commenter@example.com";
const SECRET: &str = "text-comment-secret";

fn document(file_type: &str) -> DocumentBasic {
    DocumentBasic {
        document_id: DOCUMENT.into(),
        document_name: "Launch plan".into(),
        owner: Owner::from_principal_str("macro|owner@example.com").unwrap(),
        file_type: Some(file_type.into()),
        sub_type: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    }
}

/// A user's own comment receipt, as the HTTP route mints for a user credential
/// that names no agent.
fn user_receipt(document_id: &str) -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from(USER.to_owned()).unwrap(),
        Entity {
            entity_id: document_id.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Comment,
        },
    )
    .unwrap()
}

fn posted(input: &PostMessage) -> Message {
    let at = Utc.with_ymd_and_hms(2026, 11, 5, 9, 0, 0).unwrap();
    Message {
        id: Uuid::from_u128(7),
        parent: MessageParent::parse("document", DOCUMENT).unwrap(),
        thread_id: None,
        sender_id: ChannelSender::try_from(USER.to_owned()).unwrap(),
        guest_name: None,
        imported_author: None,
        bot_profile: None,
        mentions: vec![],
        triggered_via: None,
        triggered_by: None,
        content: input.content.clone(),
        created_at: at,
        updated_at: at,
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
        kind: messages::domain::models::MessageKind::Message,
        visibility: Default::default(),
    }
}

fn request(occurrence: Option<u32>) -> TextCommentRequest<'static> {
    TextCommentRequest {
        content: "Is this date still right?",
        mentions: vec![],
        quote: "ships on Friday",
        occurrence,
    }
}

#[tokio::test]
async fn a_user_comment_places_the_mark_with_the_users_token_and_posts_the_thread() {
    let mut worker = MockEditingWorkerService::new();
    let placed = std::sync::Arc::new(std::sync::Mutex::new(None));
    let placed_in_mock = placed.clone();
    worker.expect_add_comment_mark().times(1).returning(
        move |document_id, token, mark_id, text, occurrence| {
            assert_eq!(document_id, DOCUMENT);
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.as_ref().map(|user| user.as_ref()),
                Some(USER)
            );
            assert_eq!(claims.actor, None);
            assert_eq!(claims.access_level, AccessLevel::Comment);
            assert_eq!(text, "ships on Friday");
            assert_eq!(occurrence, Some(2));
            *placed_in_mock.lock().unwrap() = Some(mark_id);
            Box::pin(async {
                Ok(CommentMarkPlacement::Placed {
                    marked_text: "ships on Friday".to_owned(),
                })
            })
        },
    );
    let mut messages = MockMessageCommands::new();
    let placed_in_post = placed.clone();
    messages
        .expect_post()
        .times(1)
        .returning(move |access, input| {
            assert_eq!(
                access.acting_user_id().map(|user| user.as_ref()),
                Some(USER)
            );
            assert_eq!(input.content, "Is this date still right?");
            assert_eq!(input.thread_id, None);
            assert_eq!(
                input.attribution,
                MessageAttribution::ActingUserVia {
                    client: "Claude Code".to_owned()
                }
            );
            let Some(NewThreadAnchor::Markdown {
                mark_id,
                marked_text,
            }) = &input.anchor
            else {
                panic!("expected a markdown anchor, got {:?}", input.anchor);
            };
            assert_eq!(Some(*mark_id), *placed_in_post.lock().unwrap());
            assert_eq!(marked_text.as_deref(), Some("ships on Friday"));
            Ok(posted(&input))
        });

    let comment = comment_on_text(
        &worker,
        &messages,
        SECRET,
        user_receipt(DOCUMENT),
        &document("md"),
        MessageAttribution::ActingUserVia {
            client: "Claude Code".to_owned(),
        },
        request(Some(2)),
    )
    .await
    .unwrap();

    assert_eq!(comment.message.id, Uuid::from_u128(7));
    assert_eq!(comment.marked_text, "ships on Friday");
}

#[tokio::test]
async fn a_receipt_for_another_document_is_refused_before_anything_is_written() {
    let error = comment_on_text(
        &MockEditingWorkerService::new(),
        &MockMessageCommands::new(),
        SECRET,
        user_receipt("019fd3b9-3c6c-7c05-89c2-a27f01218100"),
        &document("md"),
        MessageAttribution::ActingUser,
        request(None),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(
            error,
            TextCommentError::Document(DocumentError::Unauthorized)
        ),
        "{error:?}"
    );
}

#[tokio::test]
async fn a_refused_quote_returns_the_documents_reason_and_posts_nothing() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_add_comment_mark()
        .times(1)
        .returning(|_, _, _, _, _| {
            Box::pin(async {
                Ok(CommentMarkPlacement::Refused(
                    "The text appears 2 times.".to_owned(),
                ))
            })
        });

    let error = comment_on_text(
        &worker,
        &MockMessageCommands::new(),
        SECRET,
        user_receipt(DOCUMENT),
        &document("md"),
        MessageAttribution::ActingUser,
        request(None),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, TextCommentError::Refused(reason) if reason == "The text appears 2 times."),
        "{error:?}"
    );
}
