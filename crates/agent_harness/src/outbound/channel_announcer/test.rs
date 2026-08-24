use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::*;
use bot_id::BotId;

#[test]
fn chip_carries_the_announcement_identity() {
    let announcement = SessionAnnouncement {
        bot_id: BotId::TEST_A,
        session_id: agent_session::domain::model::AgentSessionId::TEST_A,
        origin_channel_id: Uuid::from_u128(1),
        origin_thread_id: Uuid::from_u128(2),
        prompted_message_id: agent_session::domain::model::MessageId::first(
            agent_session::domain::model::AuthorKind::User,
        ),
        prompted_content: "@claude fix the failing test".to_owned(),
        triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
    };

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
