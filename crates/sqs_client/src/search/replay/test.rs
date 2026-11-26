use super::*;
use crate::{PrimaryId, search::SearchQueueMessage};

#[test]
fn a_replay_keeps_its_record_byte_for_byte() {
    let message = SearchQueueMessage::ReplayBrokerEvent(ReplayBrokerEvent {
        event_id: "01a1f096-00c0-73f6-8ae9-c4161a52e0bb".to_owned(),
        topic: "macro.email".to_owned(),
        partition: 2,
        offset: 51_785_354,
        key: "link-1".to_owned(),
        payload: r#"{"event_id":"e","nested":{"quote":"\"","unicode":"é"}}"#.to_owned(),
        produced_at_ms: Some(1_795_000_000_000),
        attempts: 3,
        failure: "overloaded".to_owned(),
        traceparent: Some("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01".to_owned()),
    });

    let serialized = serde_json::to_string(&message).unwrap();
    let deserialized: SearchQueueMessage = serde_json::from_str(&serialized).unwrap();

    assert_eq!(deserialized, message);
    assert_eq!(deserialized.id(), "01a1f096-00c0-73f6-8ae9-c4161a52e0bb");
}

#[test]
fn a_replay_without_a_broker_timestamp_deserializes() {
    let payload = r#"{"ReplayBrokerEvent":{"event_id":"e","topic":"macro.chats","partition":0,
        "offset":1,"key":"chat-1","payload":"{}","attempts":1,"failure":"error"}}"#;

    let SearchQueueMessage::ReplayBrokerEvent(replay) = serde_json::from_str(payload).unwrap()
    else {
        panic!("expected a replay");
    };

    assert_eq!(replay.produced_at_ms, None);
    assert_eq!(replay.traceparent, None);
}
