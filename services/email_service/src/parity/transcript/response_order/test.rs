use super::*;
use serde_json::json;

#[test]
fn message_fields_sort_only_declared_body_paths() {
    if !crate::parity::process_per_test() {
        return;
    }
    let message = json!({
        "labels": [{"provider_id":"Z","name":"last"},{"provider_id":"A","name":"first"}],
        "to": [{"email":"z@example.com"},{"email":"a@example.com"}],
        "cc": [{"email":"c@example.com","name":"Z"},{"email":"c@example.com","name":"A"}],
        "bcc": [{"email":"b@example.com","photo_url":"z"},{"email":"b@example.com","photo_url":null}],
        "attachments": [{"id":"z"},{"id":"a"}],
        "nested": {"labels":[{"provider_id":"Z"},{"provider_id":"A"}]}
    });
    for body in [message.clone(), json!([message.clone()])] {
        let mut response = json!({"body":body,"headers":message});
        ResponseArrayRule::MessageLabelsByProviderId.apply(&Value::Null, &mut response);
        ResponseArrayRule::MessageRecipientsByAddress.apply(&Value::Null, &mut response);
        let sorted = if response["body"].is_array() {
            &response["body"][0]
        } else {
            &response["body"]
        };
        assert_eq!(sorted["labels"][0]["provider_id"], "A");
        assert_eq!(sorted["to"][0]["email"], "a@example.com");
        assert_eq!(sorted["cc"][0]["name"], "A");
        assert!(sorted["bcc"][0]["photo_url"].is_null());
        assert_eq!(sorted["attachments"], message["attachments"]);
        assert_eq!(sorted["nested"], message["nested"]);
        assert_eq!(response["headers"], message);
    }
}

#[test]
fn batch_order_rule_is_scoped_to_batch_post_routes() {
    if !crate::parity::process_per_test() {
        return;
    }
    let original = json!({"body":[{"db_id":"z"},{"db_id":"a"}]});
    for path in [
        "/email/messages/batch",
        "/internal/messages/batch?ignored=1",
    ] {
        let mut response = original.clone();
        ResponseArrayRule::BatchMessagesById
            .apply(&json!({"method":"POST","path":path}), &mut response);
        assert_eq!(response["body"], json!([{"db_id":"a"},{"db_id":"z"}]));
    }
    for (method, path) in [
        ("GET", "/email/messages/batch"),
        ("POST", "/internal/messages/senders"),
        ("GET", "/email/threads/id/messages"),
    ] {
        let mut response = original.clone();
        ResponseArrayRule::BatchMessagesById
            .apply(&json!({"method":method,"path":path}), &mut response);
        assert_eq!(response, original);
    }
}

#[test]
fn thread_order_rule_keeps_primary_order_and_sorts_only_adjacent_timestamp_ties() {
    if !crate::parity::process_per_test() {
        return;
    }
    let original = json!({"body":[
        {"db_id":"z","internal_date_ts":"2026-02-01T00:00:00Z"},
        {"db_id":"c","internal_date_ts":"2026-01-01T00:00:00Z"},
        {"db_id":"b","internal_date_ts":"2026-01-01T00:00:00Z"},
        {"db_id":"y","internal_date_ts":null},
        {"db_id":"x","internal_date_ts":null}
    ]});
    for path in [
        "/email/threads/id/messages?limit=100",
        "/internal/threads/id/messages",
    ] {
        let mut response = original.clone();
        ResponseArrayRule::ThreadTimestampTiesById
            .apply(&json!({"method":"GET","path":path}), &mut response);
        assert_eq!(response["body"][0], original["body"][0]);
        assert_eq!(response["body"][1], original["body"][2]);
        assert_eq!(response["body"][2], original["body"][1]);
        assert_eq!(response["body"][3], original["body"][4]);
        assert_eq!(response["body"][4], original["body"][3]);
    }
    let mut response = original.clone();
    ResponseArrayRule::ThreadTimestampTiesById.apply(
        &json!({"method":"POST","path":"/internal/messages/batch"}),
        &mut response,
    );
    assert_eq!(response, original);
}

#[test]
fn scheduled_rule_sorts_nested_fields_without_reordering_the_schedule() {
    if !crate::parity::process_per_test() {
        return;
    }
    let original = json!({"body":{"messages":[
        {"db_id":"z","labels":[{"provider_id":"Z"},{"provider_id":"A"}],
         "to":[{"email":"z@example.com"},{"email":"a@example.com"}]},
        {"db_id":"a","labels":[]}
    ]}});
    let mut response = original.clone();
    ResponseArrayRule::ScheduledMessageFields.apply(
        &json!({"method":"GET","path":"/email/drafts/scheduled?limit=2"}),
        &mut response,
    );
    assert_eq!(response["body"]["messages"][0]["db_id"], "z");
    assert_eq!(
        response["body"]["messages"][0]["labels"][0]["provider_id"],
        "A"
    );
    assert_eq!(
        response["body"]["messages"][0]["to"][0]["email"],
        "a@example.com"
    );
    let mut unrelated = original.clone();
    ResponseArrayRule::ScheduledMessageFields.apply(
        &json!({"method":"GET","path":"/email/contacts"}),
        &mut unrelated,
    );
    assert_eq!(unrelated, original);
}
