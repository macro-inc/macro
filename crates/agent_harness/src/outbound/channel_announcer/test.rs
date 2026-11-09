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
        reply_message_id: None,
        reply_placement: Default::default(),
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
        AgentChatReplyBody::Segments { .. } => panic!("expected prose, got segments"),
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
            link: None,
            label: None,
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

/// Grants the bot whatever the user it acts for may do: here, edit. Reads
/// the thread's and the session's audiences from its fields.
#[derive(Clone)]
struct EditingAccess {
    thread_public: bool,
    thread_readers: Vec<MacroUserIdStr<'static>>,
    session_readers: Vec<MacroUserIdStr<'static>>,
}

fn reader(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

impl EditingAccess {
    /// Everyone in the thread can open the session.
    fn shared() -> Self {
        Self {
            thread_public: false,
            thread_readers: vec![reader("user@example.com")],
            session_readers: vec![reader("user@example.com"), reader("owner@example.com")],
        }
    }
}

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
        user: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        assert!(user.is_none(), "the announcer only asks for public access");
        assert_ne!(entity_type, EntityType::AgentSession);
        Ok(self.thread_public.then_some(AccessLevel::View))
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
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(if entity_type == EntityType::AgentSession {
            self.session_readers.clone()
        } else {
            self.thread_readers.clone()
        })
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
                "chatReply": {
                    "label": "Fix login",
                    "body": { "kind": "markdown", "markdown": markdown }
                }
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
        kind: messages::domain::models::MessageKind::Message,
        id: reply_id,
        parent: parent.clone(),
        thread_id: Some(Uuid::from_u128(2)),
        sender_id: channel_sender::ChannelSender::new_from_user(
            MacroUserIdStr::try_from_email("user@example.com").unwrap(),
        ),
        triggered_via: None,
        triggered_by: None,
        bot_profile: None,
        mentions: vec![],
        guest_name: None,
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
        Arc::new(EditingAccess::shared()),
        LexicalClient::new("test-key".to_owned(), lexical.uri()),
    );

    announcer
        .resolve(ResolvedReply {
            session_id: SESSION,
            bot_id: BotId::TEST_A,
            is_coding: false,
            message_id: reply_id,
            session_name: Some("Fix login".to_owned()),
            origin_parent: parent,
            triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
            outcome: ReplyOutcome::Answered("Your emails: <m-document-mention/>".to_owned()),
            turn: agent_fold::domain::model::TurnId(0),
            segments: Vec::new(),
        })
        .await
        .expect("the pointer replaces the spinner");

    assert_eq!(
        *patched.lock().unwrap(),
        ["composed answer", "composed pointer"]
    );
}

/// Shared threads and DMs both persist message snapshots. Neither audience
/// grants session access, even when the live view can show tool details.
#[tokio::test]
async fn shared_thread_and_dm_snapshots_omit_raw_tool_details() {
    use agent_fold::domain::model::{ActivityRow, Segment};
    let segments = vec![ProjectedSegment {
        segment: Segment {
            index: 1,
            kind: SegmentKind::Activity,
            start: 0,
            end: 3,
            sealed: true,
            rows: vec![
                ActivityRow {
                    id: "terminal".into(),
                    label: "Ran".into(),
                    detail: Some("TOKEN=private-value run-report".into()),
                    status: ActivityStatus::Completed,
                    card: None,
                },
                ActivityRow {
                    id: "search".into(),
                    label: "Searched".into(),
                    detail: Some("confidential acquisition".into()),
                    status: ActivityStatus::Completed,
                    card: None,
                },
                ActivityRow {
                    id: "request".into(),
                    label: "Fetched".into(),
                    detail: Some("https://internal.example/?token=private-value".into()),
                    status: ActivityStatus::Failed,
                    card: None,
                },
            ],
        },
        text: None,
    }];
    for thread in [None, Some(Uuid::from_u128(2))] {
        let lexical = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("POST"))
            .and(wiremock::matchers::path("/agent-announcement"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"markdown": "safe activity"})),
            )
            .expect(1)
            .mount(&lexical)
            .await;
        let parent = MessageParent::Channel(Uuid::from_u128(1));
        let message_parent = parent.clone();
        let mut messages = messages::domain::api::MockMessageCommands::new();
        messages
            .expect_post_from_event()
            .times(1)
            .returning(move |_, id, post| {
                assert_eq!(post.thread_id, thread);
                assert_eq!(post.content, "safe activity");
                Ok(Message {
                    kind: messages::domain::models::MessageKind::Message,
                    id,
                    parent: message_parent.clone(),
                    thread_id: thread,
                    sender_id: channel_sender::ChannelSender::new_from_user(
                        MacroUserIdStr::try_from_email("user@example.com").unwrap(),
                    ),
                    triggered_via: None,
                    triggered_by: None,
                    bot_profile: None,
                    mentions: vec![],
                    guest_name: None,
                    imported_author: None,
                    content: post.content,
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                    edited_at: None,
                    deleted_at: None,
                    attachments: vec![],
                    reactions: vec![],
                })
            });
        let announcer = MessageAnnouncer::new(
            Arc::new(messages),
            Arc::new(EditingAccess::shared()),
            LexicalClient::new("test-key".to_owned(), lexical.uri()),
        );
        announcer
            .present(ReplyPresentation {
                session_id: SESSION,
                bot_id: BotId::TEST_A,
                triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
                parent,
                thread_id: thread,
                message_id: Uuid::from_u128(3),
                turn: TurnId(0),
                segments: segments.clone(),
                link: thread.is_some(),
                pending: false,
                outcome: None,
                notify: false,
            })
            .await
            .unwrap();
        let requests = lexical.received_requests().await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        let rows = body["chatReply"]["body"]["segments"][0]["rows"]
            .as_array()
            .unwrap();
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|row| row.get("detail").is_none()));
        assert_eq!(rows[0]["label"], "Ran");
        assert_eq!(rows[0]["status"], "completed");
        assert_eq!(rows[2]["status"], "failed");
        let serialized = String::from_utf8(requests[0].body.clone()).unwrap();
        assert!(!serialized.contains("private-value"));
        assert!(!serialized.contains("confidential acquisition"));
        assert!(!serialized.contains("internal.example"));
    }
    assert_eq!(
        segments[0].segment.rows[0].detail.as_deref(),
        Some("TOKEN=private-value run-report"),
        "snapshot serialization leaves live session details intact"
    );
}

/// A view is part of the reply, as its passages are: the stored step keeps
/// it, while the step's detail stays in authorized live views.
#[test]
fn a_stored_step_keeps_the_view_it_presented() {
    use agent_fold::domain::model::{ActivityCard, ActivityRow, Segment};
    let view = dynamic_ui::View {
        title: Some("Launch notes".to_owned()),
        widgets: vec![dynamic_ui::Widget::Md {
            markdown: "Shipped.".to_owned(),
        }],
    };
    let segments = vec![ProjectedSegment {
        segment: Segment {
            index: 0,
            kind: SegmentKind::Activity,
            start: 0,
            end: 1,
            sealed: true,
            rows: vec![ActivityRow {
                id: "view_1".into(),
                label: "Present view".into(),
                detail: Some("Launch notes".into()),
                status: ActivityStatus::Completed,
                card: Some(ActivityCard::View { view: view.clone() }),
            }],
        },
        text: None,
    }];
    let stored = reply_segments(TurnId(0), &segments);
    let [AgentReplySegment::Activity { rows, .. }] = stored.as_slice() else {
        panic!("one run of steps");
    };
    assert_eq!(rows[0].card, Some(ActivityCard::View { view }));
    assert_eq!(rows[0].detail, None);
}

fn announcer_with(access: EditingAccess) -> MessageAnnouncer<EditingAccess> {
    MessageAnnouncer::new(
        Arc::new(messages::domain::api::MockMessageCommands::new()),
        Arc::new(access),
        LexicalClient::new("test-key".to_owned(), "http://127.0.0.1:9".to_owned()),
    )
}

/// The link carries the session's name only when every thread reader can
/// open the session: push and search text reach the whole thread.
#[tokio::test]
async fn a_thread_whose_readers_all_open_the_session_sees_its_name() {
    let label = announcer_with(EditingAccess::shared())
        .link_label(
            SESSION,
            Some("Fix login".to_owned()),
            &MessageParent::Channel(Uuid::from_u128(1)),
        )
        .await;
    assert_eq!(label.as_deref(), Some("Fix login"));
}

/// One reader who cannot open the session, or a thread anyone with the link
/// can read, keeps the name out of the reply's text.
#[tokio::test]
async fn a_thread_with_readers_outside_the_session_sees_the_generic_label() {
    let outsider = EditingAccess {
        thread_readers: vec![reader("user@example.com"), reader("guest@example.com")],
        ..EditingAccess::shared()
    };
    let public = EditingAccess {
        thread_public: true,
        ..EditingAccess::shared()
    };
    for access in [outsider, public] {
        let label = announcer_with(access)
            .link_label(
                SESSION,
                Some("Fix login".to_owned()),
                &MessageParent::Channel(Uuid::from_u128(1)),
            )
            .await;
        assert_eq!(label, None);
    }
}
