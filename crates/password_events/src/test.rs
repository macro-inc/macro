use super::*;
use macro_user_id::cowlike::CowLike;

#[test]
fn resolution_is_keyed_by_recipient_and_keeps_its_outbox_id() {
    let recipient = MacroUserIdStr::parse_from_str("macro|agent@example.com")
        .unwrap()
        .into_owned();
    let outbox_id = Uuid::from_u128(7);
    let event = PasswordMacroEvent::access_request_resolved(
        outbox_id,
        AccessRequestResolvedMetadata {
            recipient_user_id: recipient,
            team_id: Uuid::from_u128(1),
            item_id: Uuid::from_u128(2),
            request_id: Uuid::from_u128(3),
            status: AccessRequestResolution::Approved,
        },
    );

    assert_eq!(event.key(), "macro|agent@example.com");
    assert_eq!(event.event().event_id, outbox_id);
    let json = serde_json::to_value(&event.event().event).unwrap();
    assert_eq!(json["event_type"], "passwords.access_request.resolved");
    assert_eq!(
        json["metadata"],
        serde_json::json!({
            "recipientUserId": "macro|agent@example.com",
            "teamId": "00000000-0000-0000-0000-000000000001",
            "itemId": "00000000-0000-0000-0000-000000000002",
            "requestId": "00000000-0000-0000-0000-000000000003",
            "status": "approved",
        })
    );
}
