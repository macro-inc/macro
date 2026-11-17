use super::*;

#[test]
fn missing_live_marker_is_legacy_history_and_modern_history_requires_its_generation() {
    let legacy = serde_json::json!({"populate_crm_contact": {
        "link_id": Uuid::nil(), "contact_email": "person@example.com",
        "first_at": "2026-01-01T00:00:00Z", "last_at": "2026-01-01T00:00:00Z"
    }});
    let BackfillOperation::PopulateCrmContact(payload) =
        serde_json::from_value(legacy.clone()).unwrap()
    else {
        panic!("legacy contact")
    };
    assert!(!payload.payload.live_mail);
    let mut live = legacy;
    live["populate_crm_contact"]["live_mail"] = serde_json::json!(true);
    let BackfillOperation::PopulateCrmContact(payload) = serde_json::from_value(live).unwrap()
    else {
        panic!("live contact")
    };
    assert!(payload.payload.live_mail);
    let modern = serde_json::json!({"populate_crm_policy": {
        "team_id": Uuid::from_u128(1), "macro_id": "macro|owner@example.com",
        "link_id": Uuid::from_u128(2), "work_id": Uuid::from_u128(3),
        "consent_incarnation": Uuid::from_u128(4), "policy_version": 7
    }});
    let parsed: BackfillOperation = serde_json::from_value(modern.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), modern);
    for key in [
        "team_id",
        "link_id",
        "work_id",
        "consent_incarnation",
        "policy_version",
    ] {
        let mut invalid = modern.clone();
        invalid["populate_crm_policy"]
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert!(
            serde_json::from_value::<BackfillOperation>(invalid).is_err(),
            "{key} is mandatory"
        );
    }
}
