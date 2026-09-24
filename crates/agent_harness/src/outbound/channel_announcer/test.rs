use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::*;
use bot_id::BotId;

fn announcement() -> SessionAnnouncement {
    SessionAnnouncement {
        bot_id: BotId::TEST_A,
        kind: crate::domain::model::AgentKind::SandboxedCoder,
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

/// The answer and a question are news; the spinner coming back is not.
#[test]
fn only_the_spinner_returning_is_a_silent_patch() {
    for outcome in every_outcome() {
        let expected = if outcome == ReplyOutcome::Resumed {
            PatchMessageNotificationPolicy::Default
        } else {
            PatchMessageNotificationPolicy::NotifyAsPostedMessage
        };
        assert_eq!(patch_policy(&outcome), expected, "{outcome:?}");
    }
}
