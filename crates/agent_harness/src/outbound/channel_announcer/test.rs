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

#[test]
fn a_resolved_reply_is_never_blank() {
    assert_eq!(
        reply_content(ReplyOutcome::Answered("Sure.".to_owned())),
        "Sure."
    );
    for outcome in [
        ReplyOutcome::Empty,
        ReplyOutcome::Cancelled,
        ReplyOutcome::Failed,
    ] {
        assert!(
            !reply_content(outcome.clone()).trim().is_empty(),
            "{outcome:?}"
        );
    }
    assert_ne!(
        reply_content(ReplyOutcome::Failed),
        reply_content(ReplyOutcome::Empty),
        "an error and a silence read differently"
    );
}
