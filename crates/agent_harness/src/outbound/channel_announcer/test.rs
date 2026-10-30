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
        Arc::new(EditingAccess),
        LexicalClient::new("test-key".to_owned(), lexical.uri()),
        KnownFiles(vec![]),
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
                },
                ActivityRow {
                    id: "search".into(),
                    label: "Searched".into(),
                    detail: Some("confidential acquisition".into()),
                    status: ActivityStatus::Completed,
                },
                ActivityRow {
                    id: "request".into(),
                    label: "Fetched".into(),
                    detail: Some("https://internal.example/?token=private-value".into()),
                    status: ActivityStatus::Failed,
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
            Arc::new(EditingAccess),
            LexicalClient::new("test-key".to_owned(), lexical.uri()),
            KnownFiles(vec![]),
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

/// Static files the attachment tests know: their media types by id.
struct KnownFiles(Vec<(Uuid, &'static str)>);

impl ReplyFiles for KnownFiles {
    async fn content_type(&self, static_file_id: Uuid) -> Result<Option<String>> {
        Ok(self
            .0
            .iter()
            .find(|(id, _)| *id == static_file_id)
            .map(|(_, content_type)| (*content_type).to_owned()))
    }
}

/// The prose of every reply Lexical was asked to compose.
async fn composed_prose(lexical: &wiremock::MockServer) -> Vec<String> {
    lexical
        .received_requests()
        .await
        .unwrap()
        .iter()
        .flat_map(|request| {
            let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
            body["chatReply"]["body"]["segments"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|segment| segment["markdown"].as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .collect()
}

/// An agent's reply that pastes an attachment marker is posted with that
/// file as a sized image attachment, and without the marker in its text.
#[tokio::test]
async fn a_resolved_reply_attaches_the_file_its_marker_names() {
    use agent_fold::domain::model::Segment;
    let lexical = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/agent-announcement"))
        .respond_with(
            wiremock::ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "markdown": "composed answer" })),
        )
        .expect(1)
        .mount(&lexical)
        .await;
    let parent = MessageParent::Channel(Uuid::from_u128(1));
    let reply_id = Uuid::from_u128(3);
    let image_id = Uuid::from_u128(7);
    let replied = Message {
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
        content: "composed answer".to_owned(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    };
    let mut messages = messages::domain::api::MockMessageCommands::new();
    messages
        .expect_patch()
        .times(1)
        .returning(move |_, id, patch| {
            assert_eq!(id, reply_id);
            let AttachmentChange::Replace(attachments) = patch.attachments else {
                panic!("expected the marker's file to replace the reply's attachments");
            };
            assert_eq!(
                attachments,
                vec![NewAttachment {
                    entity_type: "static/image".to_owned(),
                    entity_id: image_id.to_string(),
                    width: Some(1184),
                    height: Some(864),
                }]
            );
            Ok(replied.clone())
        });
    let announcer = MessageAnnouncer::new(
        Arc::new(messages),
        Arc::new(EditingAccess),
        LexicalClient::new("test-key".to_owned(), lexical.uri()),
        KnownFiles(vec![(image_id, "image/png")]),
    );
    let answer = format!(
        "Here is the lighthouse.\n\n<m-attachment>{{\"staticFileId\":\"{image_id}\",\"kind\":\"image\",\"width\":1184,\"height\":864}}</m-attachment>"
    );

    announcer
        .resolve(ResolvedReply {
            session_id: SESSION,
            bot_id: BotId::TEST_A,
            is_coding: false,
            message_id: reply_id,
            origin_parent: parent,
            triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
            outcome: ReplyOutcome::Answered(answer.clone()),
            turn: TurnId(0),
            segments: vec![ProjectedSegment {
                segment: Segment {
                    index: 0,
                    kind: SegmentKind::Prose,
                    start: 0,
                    end: 1,
                    sealed: true,
                    rows: vec![],
                },
                text: Some(answer),
            }],
        })
        .await
        .expect("the answer replaces the spinner");

    assert_eq!(composed_prose(&lexical).await, ["Here is the lighthouse."]);
}

/// Every marker is taken from the text; only files that exist and are the
/// media their marker says are attached.
#[tokio::test]
async fn markers_naming_missing_or_mismatched_files_attach_nothing() {
    use agent_fold::domain::model::Segment;
    let lexical = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/agent-announcement"))
        .respond_with(
            wiremock::ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "markdown": "composed answer" })),
        )
        .mount(&lexical)
        .await;
    let parent = MessageParent::Channel(Uuid::from_u128(1));
    let reply_id = Uuid::from_u128(3);
    let image_id = Uuid::from_u128(7);
    let video_id = Uuid::from_u128(8);
    let missing_id = Uuid::from_u128(9);
    let text_file_id = Uuid::from_u128(10);
    let replied = Message {
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
        content: "composed answer".to_owned(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    };
    let mut messages = messages::domain::api::MockMessageCommands::new();
    messages
        .expect_patch()
        .times(1)
        .returning(move |_, _, patch| {
            let AttachmentChange::Replace(attachments) = patch.attachments else {
                panic!("expected the found files to replace the reply's attachments");
            };
            assert_eq!(
                attachments,
                vec![
                    NewAttachment {
                        entity_type: "static/image".to_owned(),
                        entity_id: image_id.to_string(),
                        width: None,
                        height: None,
                    },
                    NewAttachment {
                        entity_type: "static/video".to_owned(),
                        entity_id: video_id.to_string(),
                        width: Some(1920),
                        height: Some(1080),
                    },
                ]
            );
            Ok(replied.clone())
        });
    let announcer = MessageAnnouncer::new(
        Arc::new(messages),
        Arc::new(EditingAccess),
        LexicalClient::new("test-key".to_owned(), lexical.uri()),
        KnownFiles(vec![
            (image_id, "image/png"),
            (video_id, "video/mp4"),
            (text_file_id, "text/plain"),
        ]),
    );
    let answer = format!(
        "Done: <m-attachment>{{\"staticFileId\":\"{image_id}\",\"kind\":\"image\"}}</m-attachment> and the clip.\n<m-attachment>{{\"staticFileId\":\"{video_id}\",\"kind\":\"video\",\"width\":1920,\"height\":1080}}</m-attachment>\n<m-attachment>{{\"staticFileId\":\"{missing_id}\",\"kind\":\"image\"}}</m-attachment>\n<m-attachment>{{\"staticFileId\":\"{text_file_id}\",\"kind\":\"image\"}}</m-attachment>\n<m-attachment>{{\"staticFileId\":\"{image_id}\",\"kind\":\"image\"}}</m-attachment>"
    );

    announcer
        .resolve(ResolvedReply {
            session_id: SESSION,
            bot_id: BotId::TEST_A,
            is_coding: false,
            message_id: reply_id,
            origin_parent: parent,
            triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
            outcome: ReplyOutcome::Answered(answer.clone()),
            turn: TurnId(0),
            segments: vec![ProjectedSegment {
                segment: Segment {
                    index: 0,
                    kind: SegmentKind::Prose,
                    start: 0,
                    end: 1,
                    sealed: true,
                    rows: vec![],
                },
                text: Some(answer),
            }],
        })
        .await
        .expect("the answer replaces the spinner");

    assert_eq!(composed_prose(&lexical).await, ["Done: and the clip."]);
}

/// A reply without markers, or with one only inside code, keeps its text
/// and leaves the message's attachments alone.
#[tokio::test]
async fn a_reply_without_markers_outside_code_is_posted_as_written() {
    use agent_fold::domain::model::Segment;
    let image_id = Uuid::from_u128(7);
    for answer in [
        "Plain answer.".to_owned(),
        format!(
            "Paste this:\n\n```\n<m-attachment>{{\"staticFileId\":\"{image_id}\",\"kind\":\"image\"}}</m-attachment>\n```"
        ),
    ] {
        let lexical = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("POST"))
            .and(wiremock::matchers::path("/agent-announcement"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "markdown": "composed answer" })),
            )
            .expect(1)
            .mount(&lexical)
            .await;
        let parent = MessageParent::Channel(Uuid::from_u128(1));
        let reply_id = Uuid::from_u128(3);
        let replied = Message {
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
            content: "composed answer".to_owned(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            edited_at: None,
            deleted_at: None,
            attachments: vec![],
            reactions: vec![],
        };
        let mut messages = messages::domain::api::MockMessageCommands::new();
        messages
            .expect_patch()
            .times(1)
            .returning(move |_, _, patch| {
                assert!(matches!(patch.attachments, AttachmentChange::Preserve));
                Ok(replied.clone())
            });
        let announcer = MessageAnnouncer::new(
            Arc::new(messages),
            Arc::new(EditingAccess),
            LexicalClient::new("test-key".to_owned(), lexical.uri()),
            KnownFiles(vec![(image_id, "image/png")]),
        );

        announcer
            .resolve(ResolvedReply {
                session_id: SESSION,
                bot_id: BotId::TEST_A,
                is_coding: false,
                message_id: reply_id,
                origin_parent: parent,
                triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
                outcome: ReplyOutcome::Answered(answer.clone()),
                turn: TurnId(0),
                segments: vec![ProjectedSegment {
                    segment: Segment {
                        index: 0,
                        kind: SegmentKind::Prose,
                        start: 0,
                        end: 1,
                        sealed: true,
                        rows: vec![],
                    },
                    text: Some(answer.clone()),
                }],
            })
            .await
            .expect("the answer replaces the spinner");

        assert_eq!(composed_prose(&lexical).await, [answer]);
    }
}

/// A reply shown in segments attaches a passage's files to the message that
/// shows the passage, including one already posted while the turn ran.
#[tokio::test]
async fn a_presented_passage_attaches_the_file_its_marker_names() {
    use agent_fold::domain::model::Segment;
    let lexical = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/agent-announcement"))
        .respond_with(
            wiremock::ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "markdown": "closing passage" })),
        )
        .expect(1)
        .mount(&lexical)
        .await;
    let parent = MessageParent::Channel(Uuid::from_u128(1));
    let message_id = Uuid::from_u128(3);
    let image_id = Uuid::from_u128(7);
    let wanted = vec![NewAttachment {
        entity_type: "static/image".to_owned(),
        entity_id: image_id.to_string(),
        width: Some(768),
        height: Some(1024),
    }];
    let shown = Message {
        id: message_id,
        parent: parent.clone(),
        thread_id: None,
        sender_id: channel_sender::ChannelSender::new_from_user(
            MacroUserIdStr::try_from_email("user@example.com").unwrap(),
        ),
        triggered_via: None,
        triggered_by: None,
        bot_profile: None,
        mentions: vec![],
        guest_name: None,
        imported_author: None,
        content: "closing passage".to_owned(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    };
    let mut messages = messages::domain::api::MockMessageCommands::new();
    let posted = wanted.clone();
    let existing = shown.clone();
    messages
        .expect_post_from_event()
        .times(1)
        .returning(move |_, _, post| {
            assert_eq!(post.attachments, posted);
            Ok(existing.clone())
        });
    let patched = wanted.clone();
    messages
        .expect_patch()
        .times(1)
        .returning(move |_, id, patch| {
            assert_eq!(id, message_id);
            let AttachmentChange::Replace(attachments) = patch.attachments else {
                panic!("expected the file to replace the message's attachments");
            };
            assert_eq!(attachments, patched);
            Ok(shown.clone())
        });
    let announcer = MessageAnnouncer::new(
        Arc::new(messages),
        Arc::new(EditingAccess),
        LexicalClient::new("test-key".to_owned(), lexical.uri()),
        KnownFiles(vec![(image_id, "image/webp")]),
    );

    announcer
        .present(ReplyPresentation {
            session_id: SESSION,
            bot_id: BotId::TEST_A,
            triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
            parent,
            thread_id: None,
            message_id,
            turn: TurnId(0),
            segments: vec![ProjectedSegment {
                segment: Segment {
                    index: 0,
                    kind: SegmentKind::Prose,
                    start: 0,
                    end: 1,
                    sealed: true,
                    rows: vec![],
                },
                text: Some(format!(
                    "Portrait version:\n<m-attachment>{{\"staticFileId\":\"{image_id}\",\"kind\":\"image\",\"width\":768,\"height\":1024}}</m-attachment>"
                )),
            }],
            link: false,
            pending: false,
            outcome: Some(ReplyOutcome::Answered("closing passage".to_owned())),
            notify: true,
        })
        .await
        .expect("the closing message is shown with its file");

    assert_eq!(composed_prose(&lexical).await, ["Portrait version:"]);
}
