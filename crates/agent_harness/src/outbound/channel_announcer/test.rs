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

#[test]
fn the_pending_reply_is_an_inline_await_node() {
    assert!(PENDING_REPLY.starts_with("<m-await>"));
    assert!(PENDING_REPLY.ends_with("</m-await>"));
    let body: serde_json::Value = serde_json::from_str(
        PENDING_REPLY
            .trim_start_matches("<m-await>")
            .trim_end_matches("</m-await>"),
    )
    .expect("the await node body is JSON");
    assert_eq!(body["inline"], true);
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

/// The exact bytes the frontend's `I_AGENT_SESSION_MENTION` transformer
/// matches and `buildAgentSessionMentionMarkdown` produces: the tag around
/// one JSON object with `id` first.
#[test]
fn the_session_link_is_an_agent_session_mention_node() {
    assert_eq!(
        session_link(SESSION),
        r#"<m-agent-session-mention>{"id":"00000000-0000-0000-0000-00000000000a","label":"Agent session"}</m-agent-session-mention>"#
    );
    let body: serde_json::Value = serde_json::from_str(
        session_link(SESSION)
            .trim_start_matches("<m-agent-session-mention>")
            .trim_end_matches("</m-agent-session-mention>"),
    )
    .expect("the mention node body is JSON");
    assert_eq!(body["id"], SESSION.to_string());
}

/// A patch replaces the content wholesale, so a link only the pending
/// reply carried would vanish with the spinner. Every state leads with it,
/// on its own line, with the body following intact.
#[test]
fn the_session_link_survives_every_patch() {
    let link = session_link(SESSION);
    let pending = pending_reply(SESSION);
    assert_eq!(pending, format!("{link}\n\n{PENDING_REPLY}"));
    for outcome in every_outcome() {
        let content = reply_content(SESSION, outcome.clone());
        assert!(
            content.starts_with(&format!("{link}\n\n")),
            "{outcome:?}: {content}"
        );
        assert_eq!(
            content.matches("<m-agent-session-mention>").count(),
            1,
            "{outcome:?}: one link, not one per patch"
        );
    }
    assert_eq!(
        reply_content(SESSION, ReplyOutcome::Answered("Sure.".to_owned())),
        format!("{link}\n\nSure.")
    );
}

#[test]
fn a_resolved_reply_is_never_blank() {
    let link = session_link(SESSION);
    for outcome in every_outcome() {
        let body = reply_content(SESSION, outcome.clone())
            .trim_start_matches(link.as_str())
            .trim()
            .to_owned();
        assert!(!body.is_empty(), "{outcome:?}");
    }
    assert_ne!(
        reply_content(SESSION, ReplyOutcome::Failed),
        reply_content(SESSION, ReplyOutcome::Empty),
        "an error and a silence read differently"
    );
}

/// The thread cannot answer the question; the reply says where it can be
/// answered and what it is.
#[test]
fn a_waiting_reply_shows_the_question_and_points_at_the_session() {
    let content = reply_content(
        SESSION,
        ReplyOutcome::NeedsInput {
            question: "Which inbox should I send from?".to_owned(),
        },
    );
    assert!(content.contains("Which inbox should I send from?"));
    assert!(content.contains("open the agent session"), "{content}");
    assert!(content.contains(&session_link(SESSION)));
}

/// Once the question is cleared the turn is running again, and the reply
/// looks exactly as it did when it was posted.
#[test]
fn a_resumed_reply_is_the_pending_reply_again() {
    assert_eq!(
        reply_content(SESSION, ReplyOutcome::Resumed),
        pending_reply(SESSION)
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
