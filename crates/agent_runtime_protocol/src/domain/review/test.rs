use super::*;

#[test]
fn a_review_update_is_logged_as_a_macro_extension_notification_with_only_its_identity() {
    let update = ReviewUpdatedNotification {
        review_id: "0192f7a0-0000-7000-8000-000000000001".parse().unwrap(),
        revision: 3,
    };

    assert_eq!(
        serde_json::to_value(update.to_server_message()).unwrap(),
        serde_json::json!({
            "type": "acp",
            "jsonrpc": "2.0",
            "method": "_macro/review_updated",
            "params": {
                "reviewId": "0192f7a0-0000-7000-8000-000000000001",
                "revision": 3,
            },
        })
    );
}
