use super::*;
use chrono::TimeZone;
fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, m, d, h, min, 0).single().unwrap()
}
const EVENTBRIDGE_SWEEP_PAYLOAD: &str = r#"{"operation":"sweep"}"#;

#[test]
fn the_eventbridge_sweep_payload_round_trips() {
    let parsed: ReminderDispatchMessage =
        serde_json::from_str(EVENTBRIDGE_SWEEP_PAYLOAD).expect("parses");

    assert_eq!(parsed.operation, ReminderDispatchOperation::Sweep);
    assert_eq!(
        serde_json::to_string(&parsed).expect("serializes"),
        EVENTBRIDGE_SWEEP_PAYLOAD
    );
}

#[test]
fn a_deliver_message_round_trips() {
    let firing = DueFiring {
        reminder_id: uuid::Uuid::from_bytes([7; 16]),
        scheduled_for: utc(2026, 7, 1, 12, 0),
    };
    let message = ReminderDispatchMessage::deliver(firing);

    let encoded = serde_json::to_string(&message).expect("serializes");
    let decoded: ReminderDispatchMessage = serde_json::from_str(&encoded).expect("parses");

    assert_eq!(decoded, message);
    assert_eq!(
        decoded.operation,
        ReminderDispatchOperation::Deliver {
            reminder_id: firing.reminder_id,
            scheduled_for: firing.scheduled_for,
        }
    );
}

#[test]
fn an_unknown_operation_is_rejected() {
    // The worker relies on this to discard a message it cannot act on rather
    // than letting it cycle to the dead-letter queue.
    let result = serde_json::from_str::<ReminderDispatchMessage>(r#"{"operation":"explode"}"#);

    assert!(result.is_err());
}
