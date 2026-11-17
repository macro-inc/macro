use serde_json::json;

use super::*;

const ROUTINE: &str = "0195c0de-0000-7000-8000-000000000001";

fn routine() -> Uuid {
    Uuid::parse_str(ROUTINE).unwrap()
}

#[test]
fn a_delivery_keeps_its_text_and_trimmed_content_type() {
    let delivery = WebhookDelivery::new(
        routine(),
        "Deploy finished".as_bytes(),
        Some("  text/plain; charset=utf-8 "),
    )
    .unwrap();

    assert_eq!(
        delivery,
        WebhookDelivery {
            routine_id: routine(),
            body: Some("Deploy finished".to_owned()),
            content_type: Some("text/plain; charset=utf-8".to_owned()),
        }
    );
}

#[test]
fn a_blank_content_type_is_none() {
    let delivery = WebhookDelivery::new(routine(), b"", Some("  ")).unwrap();

    assert_eq!(delivery.content_type, None);
    assert_eq!(delivery.body.as_deref(), Some(""));
}

#[test]
fn bodies_must_be_text_of_at_most_64_kib() {
    let largest = vec![b'a'; MAX_WEBHOOK_BODY_BYTES];
    assert!(WebhookDelivery::new(routine(), &largest, None).is_ok());

    let too_large = vec![b'a'; MAX_WEBHOOK_BODY_BYTES + 1];
    assert_eq!(
        WebhookDelivery::new(routine(), &too_large, None),
        Err(WebhookBodyError::TooLarge)
    );
    assert_eq!(
        WebhookDelivery::new(routine(), &[0xff, 0xfe], None),
        Err(WebhookBodyError::NotText)
    );
}

#[test]
fn a_body_with_a_nul_character_is_not_text() {
    // Postgres can't keep U+0000 in the jsonb event context.
    assert_eq!(
        WebhookDelivery::new(routine(), b"deploy\0failed", None),
        Err(WebhookBodyError::NotText)
    );
}

#[test]
fn a_json_body_reads_as_json_whatever_its_content_type() {
    let delivery = WebhookDelivery::new(
        routine(),
        br#"{"status":"failed","run":{"id":7}}"#,
        Some("text/plain"),
    )
    .unwrap();
    assert_eq!(
        delivery.json(),
        Some(json!({ "status": "failed", "run": { "id": 7 } }))
    );

    let text = WebhookDelivery::new(routine(), b"status: failed", None).unwrap();
    assert_eq!(text.json(), None);
}

#[test]
fn a_finished_delivery_without_its_body_still_reads() {
    let stored = json!({ "routine_id": ROUTINE, "content_type": "application/json" });

    let delivery: WebhookDelivery = serde_json::from_value(stored).unwrap();

    assert_eq!(delivery.body, None);
    assert_eq!(delivery.json(), None);
}
