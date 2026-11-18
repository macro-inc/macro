use std::time::{Duration, SystemTime};

use agent_session::domain::model::AgentSessionId;
use agent_trigger::domain::broker_events::{
    AgentSessionRequestedEvent, AgentTriggerTopicEvent, NewAgentSessionEvent,
};
use bot_id::BotId;
use macro_uuid::Uuid;

use super::*;

/// A session request for `bot`, minted at `minted`.
fn request(bot: BotId, minted: SystemTime) -> TriggerEvent {
    let millis = minted
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let random: [u8; 10] = Uuid::new_v4().as_bytes()[..10].try_into().unwrap();
    let id = uuid::Builder::from_unix_timestamp_millis(u64::try_from(millis).unwrap(), &random)
        .into_uuid();
    macro_event_broker::Event::with_event_id(
        id,
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::Requested(
            AgentSessionRequestedEvent {
                repo_url: None,
                bot_id: bot,
                session_id: AgentSessionId::new_from_uuid(Uuid::now_v7()),
                owner: "macro|requester@example.com".to_owned(),
                origin: trigger_context::TriggerOrigin::Unknown,
                context: None,
                runtime_user: None,
            },
        )),
    )
}

#[test]
fn an_event_is_admitted_once() {
    let now = SystemTime::now();
    let mut position = StreamPosition::new(now);
    let event = request(BotId::TEST_A, now);

    assert!(position.admits(&event));
    assert!(!position.admits(&event));
}

#[test]
fn only_the_most_recent_ids_are_remembered() {
    let now = SystemTime::now();
    let mut position = StreamPosition::new(now);
    let first = request(BotId::TEST_A, now);
    assert!(position.admits(&first));
    for offset in 1..=SEEN_EVENTS {
        let later = now + Duration::from_millis(u64::try_from(offset).unwrap());
        assert!(position.admits(&request(BotId::TEST_A, later)));
    }

    // Long gone from any replay window; remembering it forever would leak.
    assert!(position.admits(&first));
}

#[test]
fn the_cursor_starts_when_the_daemon_did_and_follows_deliveries() {
    let now = SystemTime::now();
    let mut position = StreamPosition::new(now);
    assert_eq!(position.cursor(), cursor_at(now));

    position.delivered("01a1ebf5-48e2-7571-ac38-1ff8c64b2cc3");
    assert_eq!(position.cursor(), "01a1ebf5-48e2-7571-ac38-1ff8c64b2cc3");
}
