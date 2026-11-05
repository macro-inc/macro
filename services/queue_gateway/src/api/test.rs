use super::*;

#[test]
fn numbers_arrive_as_numbers_or_strings() {
    assert_eq!(as_number(&json!(30)), Some(30));
    assert_eq!(as_number(&json!("30")), Some(30));
    assert_eq!(as_number(&json!("soon")), None);
    assert_eq!(as_number(&Value::Null), None);
}

#[test]
fn a_queue_is_named_by_the_end_of_its_url() {
    let request = json!({ "QueueUrl": "http://localstack:4566/000000000000/work.fifo" });
    assert!(matches!(named(&request), Ok(name) if name == "work.fifo"));
    assert!(named(&json!({ "QueueUrl": "http://x/" })).is_err());
    assert!(named(&json!({})).is_err());
}

#[test]
fn queue_attributes_set_the_settings_they_name() {
    let mut settings = Settings::default();
    apply_attributes(
        &mut settings,
        &json!({
            "VisibilityTimeout": "120",
            "DelaySeconds": "5",
            "ContentBasedDeduplication": "true",
            "RedrivePolicy":
                r#"{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:000000000000:work-dlq","maxReceiveCount":"3"}"#,
        }),
    );
    assert_eq!(settings.visibility_seconds, 120);
    assert_eq!(settings.delay_seconds, 5);
    assert!(settings.content_based_dedup);
    assert_eq!(
        settings.redrive,
        Some(Redrive {
            dead_letter_queue: "work-dlq".to_owned(),
            max_receive_count: 3,
        })
    );
    assert_eq!(settings.raw["VisibilityTimeout"], "120");
}

#[test]
fn a_malformed_redrive_policy_is_ignored() {
    assert_eq!(parse_redrive(&json!("not json")), None);
    assert_eq!(parse_redrive(&json!("{}")), None);
}

#[test]
fn the_body_digest_matches_sqs() {
    assert_eq!(md5_hex("hello"), "5d41402abc4b2a76b9719d911017c592");
}

#[test]
fn a_delivery_reports_what_receivers_read() {
    let delivery = crate::state::Delivery {
        receipt_handle: "0:1:2".to_owned(),
        envelope: Envelope {
            message_id: "id".to_owned(),
            body: "hello".to_owned(),
            attributes: Some(json!({ "kind": { "DataType": "String", "StringValue": "x" } })),
            group: Some("g".to_owned()),
            dedup: None,
            sent_ms: 5,
            not_before_ms: 0,
        },
        receive_count: 2,
        first_received_ms: 7,
    };
    let message = delivery_json(&delivery);
    assert_eq!(message["ReceiptHandle"], "0:1:2");
    assert_eq!(message["Body"], "hello");
    assert_eq!(message["Attributes"]["ApproximateReceiveCount"], "2");
    assert_eq!(message["Attributes"]["MessageGroupId"], "g");
    assert_eq!(message["MessageAttributes"]["kind"]["StringValue"], "x");
}
