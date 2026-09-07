use super::*;

#[test]
fn parent_identifiers_are_validated_and_round_trip() {
    for (kind, id) in [
        ("channel", "0194e3b0-121a-7000-8000-000000000001"),
        ("document", "legacy-document-id"),
    ] {
        let parent = MessageParent::parse(kind, id).unwrap();
        assert_eq!(parent.entity_type(), kind);
        assert_eq!(parent.entity_id(), id);
        assert_eq!(
            serde_json::from_value::<MessageParent>(serde_json::to_value(&parent).unwrap())
                .unwrap(),
            parent
        );
    }
    for (kind, id) in [
        ("user", "macro|example@example.com"),
        ("channel", "not-a-uuid"),
        ("email_thread", "not-a-uuid"),
        ("document", ""),
        ("document", " leading-space"),
        ("document", "control\ncharacter"),
    ] {
        assert!(MessageParent::parse(kind, id).is_err());
    }
    assert!(serde_json::from_str::<MessageParent>(r#"{"type":"document","id":""}"#).is_err());
}

#[test]
fn email_threads_are_not_message_parents() {
    let id = "0194e3b0-121a-7000-8000-000000000002";
    for kind in ["email_thread", "email"] {
        assert!(MessageParent::parse(kind, id).is_err());
        assert!(
            serde_json::from_value::<MessageParent>(serde_json::json!({
                "type": kind,
                "id": id,
            }))
            .is_err()
        );
    }
}

#[test]
fn anchors_require_a_known_kind_and_stable_uuid() {
    let mark_id = Uuid::from_u128(123);
    let anchor = ThreadAnchor::Markdown { mark_id };
    assert_eq!(
        serde_json::to_value(anchor).unwrap(),
        serde_json::json!({ "type": "markdown", "mark_id": mark_id })
    );
    for invalid in [
        serde_json::json!({ "type": "arbitrary", "anchor_id": mark_id }),
        serde_json::json!({ "type": "markdown", "mark_id": "DISCUSSION:old" }),
        serde_json::json!({ "type": "markdown", "mark_id": mark_id, "is_comment": false }),
    ] {
        assert!(serde_json::from_value::<ThreadAnchor>(invalid).is_err());
    }
}
