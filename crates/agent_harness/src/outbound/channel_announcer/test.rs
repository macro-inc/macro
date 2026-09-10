use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::*;
use bot_id::BotId;

fn announcement() -> SessionAnnouncement {
    SessionAnnouncement {
        bot_id: BotId::TEST_A,
        session_id: agent_session::domain::model::AgentSessionId::TEST_A,
        origin_channel_id: Uuid::from_u128(1),
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
fn reply_target_carries_the_originating_channel_message() {
    assert_eq!(
        announcement_reply_target(&announcement()),
        AgentAnnouncementReplyTarget {
            channel_id: "00000000-0000-0000-0000-000000000001".to_owned(),
            target_message_id: "00000000-0000-0000-0000-000000000003".to_owned(),
            target_thread_id: "00000000-0000-0000-0000-000000000002".to_owned(),
            display_text: "@claude fix the failing test".to_owned(),
            sender_id: "macro|user@example.com".to_owned(),
        }
    );
}
