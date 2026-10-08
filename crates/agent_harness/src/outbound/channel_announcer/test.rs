use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::*;
use bot_id::BotId;
use entity_access::domain::models::{
    AccessError, AccessLevel, CallChannelInfo, Entity, EntityPermission, EntityType,
    RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::MacroUserId;
use messages::domain::models::Message;

fn announcement() -> SessionAnnouncement {
    SessionAnnouncement {
        reuse_origin_message: false,
        bot_id: BotId::TEST_A,
        is_coding: true,
        session_id: agent_session::domain::model::AgentSessionId::TEST_A,
        origin_parent: MessageParent::Channel(Uuid::from_u128(1)),
        origin_thread_id: Uuid::from_u128(2),
        origin_message_id: Uuid::from_u128(3),
        prompted_message_id: agent_session::domain::model::MessageId::first(
            agent_session::domain::model::AuthorKind::User,
        ),
        prompted_content: "@claude fix the failing test".to_owned(),
        triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
    }
}

#[test]
fn chip_carries_the_announcement_identity() {
    let announcement = announcement();

    assert_eq!(
        announcement_chip(&announcement),
        AgentAnnouncementChip {
            agent_session_id: "00000000-0000-0000-0000-00000000000a".to_owned(),
            channel_id: None,
            prompted_message: agent_session::domain::model::MessageId::first(
                agent_session::domain::model::AuthorKind::User,
            ),
            status: "booting".to_owned(),
        }
    );
}

#[test]
fn declined_mentions_target_their_harness_settings() {
    for (blocker, slug, name) in [
        (SessionBlocker::CursorNotConnected, "cursor", "Cursor"),
        (SessionBlocker::CodexNotConnected, "codex-cloud", "Codex"),
        (
            SessionBlocker::CodexEnvironmentNotConfigured,
            "codex-cloud",
            "Codex",
        ),
        (SessionBlocker::ClaudeNotConnected, "claude-cloud", "Claude"),
    ] {
        let prompt = connection_prompt(blocker);
        assert_eq!(
            prompt.chip,
            AgentConnectionChip {
                app_slug: slug.to_owned(),
                name: name.to_owned(),
                target: "harness".to_owned(),
            }
        );
        assert!(prompt.message.contains("mention me again"));
    }
}

#[test]
fn reply_target_carries_the_originating_channel_message() {
    assert_eq!(
        announcement_reply_target(&announcement()),
        AgentAnnouncementReplyTarget {
            parent: MessageParent::Channel(Uuid::from_u128(1)),
            channel_id: Some("00000000-0000-0000-0000-000000000001".to_owned()),
            target_message_id: "00000000-0000-0000-0000-000000000003".to_owned(),
            target_thread_id: "00000000-0000-0000-0000-000000000002".to_owned(),
            display_text: "@claude fix the failing test".to_owned(),
            sender_id: "macro|user@example.com".to_owned(),
        }
    );
}

const SESSION: agent_session::domain::model::AgentSessionId =
    agent_session::domain::model::AgentSessionId::TEST_A;

/// Everything the reply can say, in every state the domain can ask for.
fn every_outcome() -> Vec<ReplyOutcome> {
    vec![
        ReplyOutcome::Answered("Sure.".to_owned()),
        ReplyOutcome::Empty,
        ReplyOutcome::Cancelled,
        ReplyOutcome::Failed,
        ReplyOutcome::NeedsInput {
            question: "Which inbox?".to_owned(),
        },
        ReplyOutcome::AwaitingApproval(HeldToolCall {
            approval_id: "approval-1".to_owned(),
            server_slug: "macro".to_owned(),
            server_name: "Macro".to_owned(),
            tool_name: "ListEntities".to_owned(),
        }),
        ReplyOutcome::Resumed,
    ]
}

fn markdown(body: AgentChatReplyBody) -> String {
    match body {
        AgentChatReplyBody::Markdown { markdown } => markdown,
        AgentChatReplyBody::Pending => panic!("expected prose, got the spinner"),
    }
}

/// A patch replaces the content wholesale, so a link only the pending
/// reply carried would vanish with the spinner. Every state asks Lexical
/// for the same session link ahead of its body.
#[test]
fn every_reply_names_its_session() {
    for outcome in every_outcome() {
        let reply = chat_reply(SESSION, reply_body(outcome.clone()));
        assert_eq!(reply.session_id, SESSION.to_string(), "{outcome:?}");
    }
    assert_eq!(
        chat_reply(SESSION, AgentChatReplyBody::Pending),
        AgentChatReply {
            session_id: "00000000-0000-0000-0000-00000000000a".to_owned(),
            body: AgentChatReplyBody::Pending,
        }
    );
}

/// The wire shape the lexical service validates: `kind` tags the body.
#[test]
fn the_reply_serializes_as_the_endpoint_reads_it() {
    let pending = serde_json::to_value(chat_reply(SESSION, AgentChatReplyBody::Pending)).unwrap();
    assert_eq!(
        pending,
        serde_json::json!({
            "sessionId": "00000000-0000-0000-0000-00000000000a",
            "body": { "kind": "pending" }
        })
    );
    let answered = serde_json::to_value(chat_reply(
        SESSION,
        reply_body(ReplyOutcome::Answered("Sure.".to_owned())),
    ))
    .unwrap();
    assert_eq!(
        answered["body"],
        serde_json::json!({ "kind": "markdown", "markdown": "Sure." })
    );
}

/// The answer goes out as the agent wrote it.
#[test]
fn an_answer_is_posted_as_written() {
    assert_eq!(
        reply_body(ReplyOutcome::Answered("Sure.\n\n- done".to_owned())),
        AgentChatReplyBody::Markdown {
            markdown: "Sure.\n\n- done".to_owned()
        }
    );
}

#[test]
fn a_resolved_reply_is_never_blank() {
    for outcome in every_outcome() {
        if outcome == ReplyOutcome::Resumed {
            continue;
        }
        assert!(
            !markdown(reply_body(outcome.clone())).trim().is_empty(),
            "{outcome:?}"
        );
    }
    assert_ne!(
        reply_body(ReplyOutcome::Failed),
        reply_body(ReplyOutcome::Empty),
        "an error and a silence read differently"
    );
}

/// The thread cannot answer the question; the reply says where it can be
/// answered and what it is.
#[test]
fn a_waiting_reply_shows_the_question_and_points_at_the_session() {
    let content = markdown(reply_body(ReplyOutcome::NeedsInput {
        question: "Which inbox should I send from?".to_owned(),
    }));
    assert!(content.contains("Which inbox should I send from?"));
    assert!(content.contains("open the agent session"), "{content}");
}

/// Once the question is cleared the turn is running again, and the reply
/// looks exactly as it did when it was posted.
#[test]
fn a_resumed_reply_is_the_pending_reply_again() {
    assert_eq!(
        reply_body(ReplyOutcome::Resumed),
        AgentChatReplyBody::Pending
    );
}

/// A held call names the tool, and the app it belongs to when that is not
/// Macro, and asks nothing of the thread: only the owner can approve it.
#[test]
fn a_held_call_names_its_tool_while_it_waits() {
    let held = |server_slug: &str, server_name: &str, tool_name: &str| {
        markdown(reply_body(ReplyOutcome::AwaitingApproval(HeldToolCall {
            approval_id: "approval-1".to_owned(),
            server_slug: server_slug.to_owned(),
            server_name: server_name.to_owned(),
            tool_name: tool_name.to_owned(),
        })))
    };
    assert_eq!(
        held("macro", "Macro", "ListEntities"),
        "Waiting for the session owner to allow `ListEntities`."
    );
    assert_eq!(
        held("linear", "Linear", "create_issue"),
        "Waiting for the session owner to allow `create_issue` from Linear."
    );
}

/// The answer and a question are news; the spinner coming back is not, and
/// a held call is news only to the owner, who the hold notifies itself.
#[test]
fn only_the_answer_and_a_question_notify_the_thread() {
    for outcome in every_outcome() {
        let expected = if matches!(
            outcome,
            ReplyOutcome::Resumed | ReplyOutcome::AwaitingApproval(_)
        ) {
            PatchMessageNotificationPolicy::Default
        } else {
            PatchMessageNotificationPolicy::NotifyAsPostedMessage
        };
        assert_eq!(patch_policy(&outcome), expected, "{outcome:?}");
    }
}

/// Grants the bot whatever the user it acts for may do: here, edit.
#[derive(Clone)]
struct EditingAccess;

impl EntityAccessService for EditingAccess {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
        _: Option<i64>,
        _: &str,
        _: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        EntityAccessReceipt::try_new_bot(
            bot_id.into_storage_id(),
            (&scope).into(),
            Entity {
                entity_id: entity_id.to_owned(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit,
            },
        )
    }
    async fn get_access_level(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
    async fn check_access(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
    async fn check_public_access(
        &self,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
    async fn get_entity_permission(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
    async fn get_crm_entity_permission_with_team(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
    async fn get_users_by_entity(
        &self,
        _: &str,
        _: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
    async fn get_call_channel(&self, _: &Uuid) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
    async fn get_call_channel_by_channel_id(
        &self,
        _: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
    async fn get_user_team(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unimplemented!("the announcer only mints bot receipts")
    }
}

/// An answer that mentions something the person who asked cannot open -
/// what a tool the owner approved found with the owner's access - is
/// refused by the message service. The reply says where the answer is
/// instead of spinning forever.
#[tokio::test]
async fn an_answer_the_thread_may_not_carry_points_at_the_session() {
    let lexical = wiremock::MockServer::start().await;
    for (markdown, composed) in [
        ("Your emails: <m-document-mention/>", "composed answer"),
        (UNSHAREABLE_ANSWER, "composed pointer"),
    ] {
        wiremock::Mock::given(wiremock::matchers::method("POST"))
            .and(wiremock::matchers::path("/agent-announcement"))
            .and(wiremock::matchers::body_partial_json(serde_json::json!({
                "chatReply": { "body": { "kind": "markdown", "markdown": markdown } }
            })))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "markdown": composed })),
            )
            .expect(1)
            .mount(&lexical)
            .await;
    }
    let parent = MessageParent::Channel(Uuid::from_u128(1));
    let reply_id = Uuid::from_u128(3);
    let patched: Arc<std::sync::Mutex<Vec<String>>> = Arc::default();
    let mut messages = messages::domain::api::MockMessageCommands::new();
    let seen = Arc::clone(&patched);
    let replied = Message {
        id: reply_id,
        parent: parent.clone(),
        thread_id: Some(Uuid::from_u128(2)),
        sender_id: channel_sender::ChannelSender::new_from_user(
            MacroUserIdStr::try_from_email("user@example.com").unwrap(),
        ),
        triggered_by: None,
        bot_profile: None,
        mentions: vec![],
        imported_author: None,
        content: "composed pointer".to_owned(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    };
    messages
        .expect_patch()
        .times(2)
        .returning(move |_, id, patch| {
            assert_eq!(id, reply_id);
            let mut seen = seen.lock().unwrap();
            seen.push(patch.content.unwrap());
            if seen.len() == 1 {
                Err(MessageError::Forbidden)
            } else {
                Ok(replied.clone())
            }
        });
    let announcer = MessageAnnouncer::new(
        Arc::new(messages),
        Arc::new(EditingAccess),
        LexicalClient::new("test-key".to_owned(), lexical.uri()),
    );

    announcer
        .resolve(ResolvedReply {
            session_id: SESSION,
            bot_id: BotId::TEST_A,
            is_coding: false,
            message_id: reply_id,
            origin_parent: parent,
            triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
            outcome: ReplyOutcome::Answered("Your emails: <m-document-mention/>".to_owned()),
        })
        .await
        .expect("the pointer replaces the spinner");

    assert_eq!(
        *patched.lock().unwrap(),
        ["composed answer", "composed pointer"]
    );
}
