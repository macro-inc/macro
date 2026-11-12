use super::*;

#[test]
fn parent_identifiers_are_validated_and_round_trip() {
    for (kind, id) in [
        ("channel", "0194e3b0-121a-7000-8000-000000000001"),
        ("document", "legacy-document-id"),
        ("initiative", "0194e3b0-121a-7000-8000-000000000003"),
        ("crm_company", "0194e3b0-121a-7000-8000-000000000004"),
        ("crm_contact", "0194e3b0-121a-7000-8000-000000000005"),
        ("call", "0194e3b0-121a-7000-8000-000000000002"),
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
        ("initiative", "not-a-uuid"),
        ("project", "0194e3b0-121a-7000-8000-000000000003"),
        ("crm_company", "not-a-uuid"),
        ("crm_contact", "not-a-uuid"),
        ("crm", "0194e3b0-121a-7000-8000-000000000004"),
        ("call", "not-a-uuid"),
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
fn call_chat_does_not_disable_other_entity_discussions() {
    let id = "0194e3b0-121a-7000-8000-000000000002";
    for kind in ["document", "initiative", "crm_company", "crm_contact"] {
        assert!(MessageParent::parse(kind, id).unwrap().is_discussion());
    }
    for kind in ["channel", "call"] {
        assert!(!MessageParent::parse(kind, id).unwrap().is_discussion());
    }
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
fn parents_serialize_as_type_and_id() {
    assert_eq!(
        serde_json::to_value(MessageParent::parse("document", "doc-1").unwrap()).unwrap(),
        serde_json::json!({"type": "document", "id": "doc-1"})
    );
    assert_eq!(
        serde_json::to_value(
            MessageParent::parse("crm_company", "0194e3b0-121a-7000-8000-000000000004").unwrap()
        )
        .unwrap(),
        serde_json::json!({"type": "crm_company", "id": "0194e3b0-121a-7000-8000-000000000004"})
    );
}
