use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashSet;
fn value(realtime: bool, apns: bool) -> InboxSyncNotification {
    InboxSyncNotification {
        sender: Some("Sender".into()),
        to_email: "staff@macro.com".into(),
        thread_id: Uuid::nil(),
        subject: "Subject".into(),
        snippet: "Snippet".into(),
        sender_id: Some(MacroUserIdStr::try_from("macro|sender@example.com".to_owned()).unwrap()),
        recipients: HashSet::from([
            MacroUserIdStr::try_from("macro|staff@macro.com".to_owned()).unwrap()
        ]),
        realtime,
        apns,
    }
}
#[test]
fn noise_requests_preserve_rows_without_realtime_delivery() {
    let request = serde_json::to_value(notification_request(value(false, false))).unwrap();
    assert_eq!(request["send_conn_gateway"], false);
    assert!(request["build_apns"].is_null());
    assert!(request["build_email"].is_null());
    assert!(request["uuid_to_write"].is_string());
    assert_eq!(request["req"]["notification"]["tag"], "new_email");
    assert_eq!(
        request["req"]["notification"]["content"]["subject"],
        "Subject"
    );
    assert_eq!(
        request["req"]["notification"]["content"]["sender"],
        "Sender"
    );
}
#[test]
fn signal_requests_keep_realtime_delivery_for_both_recipient_partitions() {
    let request = serde_json::to_value(notification_request(value(true, false))).unwrap();
    assert_eq!(request["send_conn_gateway"], true);
    assert!(request["build_apns"].is_null());
}
#[test]
fn signal_staff_requests_keep_apns_and_realtime_delivery() {
    let request =
        serde_json::to_value(notification_request(value(true, true)).with_apns()).unwrap();
    assert_eq!(request["send_conn_gateway"], true);
    assert!(request["build_apns"].is_object());
}
