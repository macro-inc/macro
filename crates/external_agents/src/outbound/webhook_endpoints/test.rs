use super::*;
use crate::domain::models::ExternalAgentEventKind;
use messages::domain::models::MessageParent;
use uuid::Uuid;

/// The body pushed to an endpoint is the documented contract: the SDK and
/// every runtime decode exactly this.
#[test]
fn a_pushed_event_is_the_documented_message_envelope() {
    let event = ExternalAgentEvent {
        id: Uuid::from_u128(1),
        bot_id: BotId::new_from_uuid(Uuid::from_u128(0xA6E)),
        kind: ExternalAgentEventKind::Mention,
        parent: MessageParent::Channel(Uuid::from_u128(0xC4)),
        message_id: Uuid::from_u128(2),
        message_thread_id: Some(Uuid::from_u128(3)),
        reply_thread_id: Some(Uuid::from_u128(3)),
        sender_id: "macro|owner@example.com".to_owned(),
        invoking_user: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        content: "@outside what changed?".to_owned(),
        message_created_at: chrono::DateTime::UNIX_EPOCH,
    };

    let queued = queued_event("wh_outside", &event).unwrap();

    assert_eq!(queued.webhook_id, "wh_outside");
    assert_eq!(queued.event.event_name, "external_agent.message");
    assert_eq!(queued.event.event_id, event.id.to_string());
    assert_eq!(queued.event.ordering_key, event.bot_id.to_string());
    assert_eq!(
        queued.event.broker_envelope,
        serde_json::json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 1,
            "event_type": "external_agent.message",
            "metadata": {
                "agent_id": "00000000-0000-0000-0000-000000000a6e",
                "kind": "mention",
                "conversation": {
                    "type": "channel",
                    "id": "00000000-0000-0000-0000-0000000000c4"
                },
                "message": {
                    "id": "00000000-0000-0000-0000-000000000002",
                    "thread_id": "00000000-0000-0000-0000-000000000003",
                    "sender_id": "macro|owner@example.com",
                    "text": "@outside what changed?",
                    "created_at": "1970-01-01T00:00:00Z"
                }
            }
        }),
    );
}

#[test]
fn an_endpoint_subscribes_to_its_own_agents_events_alone() {
    let bot_id = BotId::new_from_uuid(Uuid::from_u128(0xA6E));
    let filter = agent_filter(bot_id);

    assert!(filter.accepts("external_agent.message", &bot_id.to_string()));
    assert!(!filter.accepts(
        "external_agent.message",
        &BotId::new_from_uuid(Uuid::from_u128(0xB07)).to_string()
    ));
    assert!(!filter.accepts("agent_trigger.new", &bot_id.to_string()));
}
