use serde_json::json;

use super::{Asked, QueueStep, Recorder, Served, counted, path_shape, shape};

#[test]
fn a_shape_keeps_tags_and_drops_content() {
    let message = json!({
        "operation": { "upsert_message": { "provider_message_id": "18c2f0a9", "attempt": 3 } },
        "link_id": "0190d4b2-7a51-7c3e-9f5e-2f1d6f1f3a10",
        "to": ["ada@example.com", "grace@example.com"],
        "urgent": true,
        "note": null,
    });
    assert_eq!(
        shape(&message),
        json!({
            "operation": { "upsert_message": { "provider_message_id": "<str>", "attempt": 0 } },
            "link_id": "<str>",
            "to": ["<str>"],
            "urgent": true,
            "note": null,
        })
    );
}

#[test]
fn a_path_shape_drops_ids() {
    assert_eq!(
        path_shape("/message/user/macro|ada@example.com?x=1"),
        "/message/user/{}"
    );
    assert_eq!(path_shape("/internal/health"), "/internal/health");
}

#[test]
fn equal_items_are_counted_once() {
    let items = counted([json!({"a": 1}), json!({"a": 2}), json!({"a": 1})]);
    assert_eq!(
        items,
        vec![json!({"a": 1, "count": 2}), json!({"a": 2, "count": 1})]
    );
}

#[test]
fn a_message_is_handled_once_it_is_deleted() {
    let recorder = Recorder::default();
    let queue = "http://sqs/000000000000/e2e-1-gmail-ops";
    let body = json!({ "operation": "archive" }).to_string();
    let receive = json!({ "QueueUrl": queue }).to_string();
    let received = json!({
        "Messages": [
            { "Body": body, "ReceiptHandle": "first" },
            { "Body": body, "ReceiptHandle": "second" },
        ]
    })
    .to_string();
    recorder.queue_call("ReceiveMessage", receive.as_bytes(), received.as_bytes());
    let delete = json!({ "QueueUrl": queue, "ReceiptHandle": "first" }).to_string();
    recorder.queue_call("DeleteMessage", delete.as_bytes(), b"{}");
    // A second delete of the same receipt is not a second message.
    recorder.queue_call("DeleteMessage", delete.as_bytes(), b"{}");

    let seen = recorder.seen();
    let shape = json!({ "operation": "archive" }).to_string();
    assert_eq!(
        seen.queue
            .get(&(queue.to_owned(), QueueStep::Received, shape.clone())),
        Some(&2)
    );
    assert_eq!(
        seen.queue
            .get(&(queue.to_owned(), QueueStep::Handled, shape)),
        Some(&1)
    );
}

#[test]
fn a_graphql_request_is_kept_by_its_query() {
    let recorder = Recorder::default();
    let body =
        json!({ "query": "{ emailThreads { id } }", "variables": { "to": "ada@example.com" } })
            .to_string();
    for answer in [
        json!({ "data": { "emailThreads": [] } }),
        json!({ "data": null, "errors": [{ "message": "no" }] }),
    ] {
        recorder.served(&Served {
            service: "document_storage_service",
            method: "POST",
            path: "/graphql",
            query: None,
            body: body.as_bytes(),
            status: 200,
            answer: answer.to_string().as_bytes(),
        });
    }

    let seen = recorder.seen();
    let key = |answered| Asked {
        service: "document_storage_service".to_owned(),
        query: "{ emailThreads { id } }".to_owned(),
        variables: json!({ "to": "<str>" }).to_string(),
        answered,
    };
    assert_eq!(seen.graphql.get(&key(true)), Some(&1));
    assert_eq!(seen.graphql.get(&key(false)), Some(&1));
}

#[test]
fn a_request_is_kept_with_the_shape_of_its_query_and_body() {
    let recorder = Recorder::default();
    let body =
        json!({ "value": [{ "lifecycleEvent": "missed", "subscriptionId": "4f1c" }] }).to_string();
    recorder.served(&Served {
        service: "email_service",
        method: "POST",
        path: "/outlook/webhook/4f1c22",
        query: Some("validationToken=abc%20def&view=inbox"),
        body: body.as_bytes(),
        status: 202,
        answer: b"",
    });

    let seen = recorder.seen();
    let request = seen.http.keys().next().unwrap();
    assert_eq!(request.path, "/outlook/webhook/{}");
    assert_eq!(request.query, "validationToken&view=inbox");
    assert_eq!(
        request.body,
        json!({ "value": [{ "lifecycleEvent": "missed", "subscriptionId": "<str>" }] }).to_string()
    );
    assert_eq!(seen.http.values().copied().collect::<Vec<_>>(), vec![1]);
}
