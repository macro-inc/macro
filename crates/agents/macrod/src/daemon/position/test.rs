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
    assert_eq!(position.resume_cursor(), cursor_at(now));

    let later = request(BotId::TEST_A, now + Duration::from_secs(1))
        .event_id
        .to_string();
    position.delivered(&later);
    assert_eq!(position.cursor(), later);
    // An event minted before the cursor, from a rewound replay, leaves it.
    position.delivered(&cursor_at(now));
    assert_eq!(position.cursor(), later);
}

/// An agent re-bound here from another runtime: events for it minted before
/// it was bound here were that runtime's to handle, and a reconnect that
/// replays them must not run them again.
#[test]
fn events_from_before_an_agent_was_bound_here_are_skipped() {
    let started = SystemTime::now();
    let mut position = StreamPosition::new(started);
    let other = BotId::TEST_B;
    position.agents_read(&[other.to_string()], started);
    let first_read = started + Duration::from_secs(10);
    position.agents_read(&[other.to_string()], first_read);
    let second_read = first_read + Duration::from_secs(10);

    // The agent shows up at the second read, so it was bound after the first
    // read began.
    position.agents_read(&[other.to_string(), BotId::TEST_A.to_string()], second_read);

    let before = first_read - Duration::from_secs(1);
    let after = first_read + Duration::from_secs(1);
    assert!(!position.admits(&request(BotId::TEST_A, before)));
    assert!(position.admits(&request(BotId::TEST_A, after)));
    // An agent bound since the daemon started keeps every event from then.
    assert!(position.admits(&request(other, before)));
}

/// The bench case: the agent is bound between two reads, and the request
/// for it follows the binding. It is kept however late the read that shows
/// the agent comes.
#[test]
fn a_request_made_after_the_agent_was_bound_is_kept() {
    let started = SystemTime::now();
    let mut position = StreamPosition::new(started);
    position.agents_read(&[], started);
    let requested = started + Duration::from_millis(50);
    position.agents_read(
        &[BotId::TEST_A.to_string()],
        started + Duration::from_secs(10),
    );

    assert!(position.admits(&request(BotId::TEST_A, requested)));
}

/// Unbinding forgets the agent, so binding it again starts over.
#[test]
fn an_agent_bound_again_counts_from_its_new_binding() {
    let started = SystemTime::now();
    let mut position = StreamPosition::new(started);
    position.agents_read(&[BotId::TEST_A.to_string()], started);
    let unbound = started + Duration::from_secs(10);
    position.agents_read(&[], unbound);
    let rebound = unbound + Duration::from_secs(10);
    position.agents_read(&[BotId::TEST_A.to_string()], rebound);

    assert!(!position.admits(&request(BotId::TEST_A, unbound - Duration::from_secs(1))));
    assert!(position.admits(&request(BotId::TEST_A, unbound + Duration::from_secs(1))));
}

/// A request for an agent bound since the last stream opened was filtered
/// out of that stream, however long before its last event it came. The next
/// stream starts back at the binding, and the events already handled come
/// again only to be dropped.
#[test]
fn a_newly_bound_agent_rewinds_the_next_stream_to_its_binding() {
    let started = SystemTime::now();
    let mut position = StreamPosition::new(started);
    position.agents_read(&[BotId::TEST_B.to_string()], started);
    assert_eq!(position.resume_cursor(), cursor_at(started));
    position.opened();

    let first_read = started + Duration::from_secs(10);
    position.agents_read(&[BotId::TEST_B.to_string()], first_read);
    let handled = request(BotId::TEST_B, first_read + Duration::from_secs(30));
    assert!(position.admits(&handled));
    position.delivered(&handled.event_id.to_string());
    position.agents_read(
        &[BotId::TEST_B.to_string(), BotId::TEST_A.to_string()],
        first_read + Duration::from_secs(40),
    );

    assert_eq!(position.resume_cursor(), cursor_at(first_read));
    // A stream that failed to open leaves the rewind for the next attempt.
    assert_eq!(position.resume_cursor(), cursor_at(first_read));
    position.opened();
    assert!(!position.admits(&handled));
    // The rewound stream delivers older events again; the cursor stays put.
    position.delivered(&request(BotId::TEST_A, first_read).event_id.to_string());
    // Once open, later streams resume after the last event again.
    assert_eq!(position.resume_cursor(), handled.event_id.to_string());
}

/// This machine's clock may run ahead of the service's. The agents bound
/// when the daemon starts were bound before it, so nothing the stream
/// delivers for them is "from before their binding", whatever the clocks.
#[test]
fn an_agent_bound_at_start_keeps_events_minted_just_after_a_skewed_start() {
    let service_now = SystemTime::now();
    // This machine reads five seconds ahead of the service.
    let started = service_now + Duration::from_secs(5);
    let mut position = StreamPosition::new(started);
    position.agents_read(&[BotId::TEST_A.to_string()], service_now);

    let mention = request(BotId::TEST_A, service_now + Duration::from_secs(1));
    assert!(position.admits(&mention));
}
