use super::*;
use serde_json::json;

fn snapshot() -> SendSnapshot {
    serde_json::from_value(json!({
        "message": {
            "subject": "Approved subject",
            "to": [{"email": "recipient@example.invalid", "name": "Recipient"}],
            "cc": [], "bcc": [], "body_text": "Approved body"
        },
        "attachment_ids": [], "forwarded_attachment_ids": []
    }))
    .unwrap()
}

#[test]
fn legacy_optional_defaults_and_operational_fields_do_not_change_approval() {
    let snapshot = snapshot();
    let mut legacy = serde_json::to_value(&snapshot).unwrap();
    let message = legacy["message"].as_object_mut().unwrap();
    message.remove("body_html");
    message.insert("sender_email".into(), Value::Null);
    message.insert("actor".into(), json!("historical attribution"));
    message.insert("draft_client_binding".into(), json!("historical binding"));
    message.insert("future_operational_field".into(), json!(true));
    legacy["message"]["to"][0]["photo_url"] = json!("https://photo.invalid/old");
    assert!(snapshot.matches_approved_request(&legacy).unwrap());
    let mut replay = snapshot.clone();
    replay.message.to[0].photo_url = Some("https://photo.invalid/new".into());
    replay.message.draft_client_binding = Some(Uuid::new_v4());
    assert!(
        replay
            .matches_approved_request(&snapshot.persisted_request().unwrap())
            .unwrap()
    );
}

#[test]
fn approved_content_changes_conflict_for_both_legacy_and_versioned_requests() {
    let snapshot = snapshot();
    let requests = [
        serde_json::to_value(&snapshot).unwrap(),
        snapshot.persisted_request().unwrap(),
    ];
    for change in [
        |s: &mut SendSnapshot| s.message.subject.push('!'),
        |s: &mut SendSnapshot| s.message.draft_generation = 2,
        |s: &mut SendSnapshot| s.message.send_time = Some(chrono::Utc::now()),
        |s: &mut SendSnapshot| s.message.frozen_signature_html = Some("Frozen signature".into()),
        |s: &mut SendSnapshot| s.message.body_text = Some("Changed body".into()),
        |s: &mut SendSnapshot| s.message.to[0].email = "other@example.invalid".into(),
        |s: &mut SendSnapshot| s.message.to[0].name = Some("Other name".into()),
        |s: &mut SendSnapshot| {
            s.message.sender_email = Some(
                macro_user_id::email::EmailStr::parse_from_str("alias@example.invalid").unwrap(),
            )
        },
        |s: &mut SendSnapshot| s.message.include_signature = Some(false),
        |s: &mut SendSnapshot| s.message.db_id = Some(Uuid::new_v4()),
        |s: &mut SendSnapshot| s.attachment_ids.push(Uuid::new_v4()),
        |s: &mut SendSnapshot| s.forwarded_attachment_ids.push(Uuid::new_v4()),
        |s: &mut SendSnapshot| s.restore_body_text = Some("Other restore body".into()),
    ] {
        let mut changed = snapshot.clone();
        change(&mut changed);
        for request in &requests {
            assert!(!changed.matches_approved_request(request).unwrap());
        }
    }
}

#[test]
fn versioned_approval_survives_snapshot_representation_changes() {
    let snapshot = snapshot();
    let mut request = snapshot.persisted_request().unwrap();
    request["message"]["sender_email"] = Value::Null;
    request["message"]
        .as_object_mut()
        .unwrap()
        .remove("body_html");
    request["message"]["future_model_default"] = json!(false);
    assert!(snapshot.matches_approved_request(&request).unwrap());
    // Delivery readers still receive the full snapshot alongside its fingerprint.
    let _: SendSnapshot = serde_json::from_value(request).unwrap();
}

#[test]
fn unknown_or_malformed_approval_versions_never_authorize_replay() {
    let snapshot = snapshot();
    let mut request = snapshot.persisted_request().unwrap();
    request[FINGERPRINT_FIELD]["version"] = json!(99);
    assert!(!snapshot.matches_approved_request(&request).unwrap());
    request[FINGERPRINT_FIELD] = json!({"version": 1});
    assert!(snapshot.matches_approved_request(&request).is_err());
}

#[test]
fn object_key_and_attachment_order_do_not_change_approval() {
    let mut snapshot = snapshot();
    snapshot.message.headers_json =
        Some(serde_json::from_str(r#"{"z":{"b":1,"a":2},"a":0}"#).unwrap());
    snapshot.attachment_ids = vec![Uuid::from_u128(1), Uuid::from_u128(2)];
    let request = snapshot.persisted_request().unwrap();
    snapshot.message.headers_json =
        Some(serde_json::from_str(r#"{"a":0,"z":{"a":2,"b":1}}"#).unwrap());
    snapshot.attachment_ids.reverse();
    assert!(snapshot.matches_approved_request(&request).unwrap());
}

#[test]
fn approval_v1_fingerprint_is_stable_across_deployments() {
    let snapshot = snapshot();
    let digest = ApprovalV1::from(&snapshot).digest().unwrap();
    assert_eq!(
        digest,
        "5ddf3b96f8989d91e1deb409f896fa594a848854483e093239176fe1107e6caf"
    );
    let legacy = json!({"_send_approval": {"version": 1, "digest": digest}});
    assert!(snapshot.matches_approved_request(&legacy).unwrap());
}
