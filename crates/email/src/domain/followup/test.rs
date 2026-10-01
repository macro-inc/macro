use super::*;
use chrono::Duration;

#[test]
fn only_new_inbound_mail_after_the_boundary_counts() {
    let now = Utc::now();
    let existing = Uuid::from_u128(1);
    let mut thread = FollowupThread {
        link_id: Uuid::from_u128(2),
        subject: "Subject".into(),
        returned_at: None,
        inbox_visible: true,
        unavailable: false,
        messages: vec![FollowupMessage {
            id: existing,
            received_at: Some(now),
            outgoing: false,
            from_self: false,
        }],
    };
    let baseline = thread.baseline(now);
    // Provider replay, even if its date has changed, keeps the saved identity.
    thread.messages[0].received_at = Some(now + Duration::seconds(1));
    assert!(!thread.has_reply(&baseline));
    thread.messages.push(FollowupMessage {
        id: Uuid::from_u128(3),
        received_at: Some(now - Duration::days(1)),
        outgoing: false,
        from_self: false,
    });
    assert!(!thread.has_reply(&baseline), "historical backfill");
    let message = thread.messages.last_mut().unwrap();
    message.received_at = Some(now + Duration::seconds(1));
    message.outgoing = true;
    assert!(
        !thread.has_reply(&baseline),
        "sent or draft, including aliases"
    );
    let message = thread.messages.last_mut().unwrap();
    message.outgoing = false;
    message.from_self = true;
    assert!(!thread.has_reply(&baseline), "own/delegated inbox sender");
    thread.messages.last_mut().unwrap().from_self = false;
    assert!(thread.has_reply(&baseline));
}
