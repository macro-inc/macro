use super::*;
use macro_event_broker::MacroEvent as _;
use macro_event_topics::Topic as _;
use serde_json::json;

#[test]
fn public_call_notification_uses_the_call_key_and_snake_case_metadata() {
    let call_id = Uuid::parse_str("0198a1b2-c3d4-7e5f-8061-728394a5b6c7").unwrap();
    let mut metadata = CallNotificationMetadata::new(call_id, None);
    metadata.recipient_user_id = Some("macro|recipient@example.com".to_string());
    metadata.invited_by = Some("macro|sender@example.com".to_string());
    let event = CallNotificationMacroEvent::new(CallNotificationEvent::Invited(metadata));

    assert_eq!(event.key(), call_id.to_string());
    assert_eq!(
        MacroCallNotificationsTopic::TOPIC_STR,
        "macro.call_notifications"
    );
    assert_eq!(
        serde_json::to_value(&event.event().event).unwrap(),
        json!({
            "event_type": "call.invited",
            "metadata": {
                "call_id": call_id,
                "invited_by": "macro|sender@example.com",
                "recipient_user_id": "macro|recipient@example.com"
            }
        })
    );
}
