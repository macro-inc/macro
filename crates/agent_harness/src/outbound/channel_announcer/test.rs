use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::*;

#[test]
fn new_session_response_is_only_a_static_magic_chip() {
    let announcement = SessionAnnouncement {
        session_id: agent_session::domain::model::AgentSessionId::TEST_A,
        origin_channel_id: Uuid::from_u128(1),
        origin_thread_id: Uuid::from_u128(2),
        session_channel_id: Uuid::from_u128(3),
        prompted_turn_id: Uuid::from_u128(4),
        triggered_by: MacroUserIdStr::try_from_email("user@example.com").unwrap(),
    };

    assert_eq!(
        template_new_agent_session_response(&announcement),
        concat!(
            "<m-magic-chip>{\"agentSessionId\":\"00000000-0000-0000-0000-00000000000a\",",
            "\"channelId\":\"00000000-0000-0000-0000-000000000003\",",
            "\"promptedTurnId\":\"00000000-0000-0000-0000-000000000004\",",
            "\"status\":\"booting\"}</m-magic-chip>"
        )
    );
}
