use entity_access::domain::models::{EntityAccessAuth, EntityType};

use super::handle::{count_occurrences, document_and_owner, document_cleanup_receipt};
use aws_sdk_sqs::types::{Message, MessageAttributeValue};
use model_owner::Owner;

fn deletion_message(owner: Option<&str>) -> Message {
    let mut message = Message::builder().message_attributes(
        "document_id",
        MessageAttributeValue::builder()
            .data_type("String")
            .string_value("01900000-0000-7000-8000-000000000001")
            .build()
            .unwrap(),
    );
    if let Some(owner) = owner {
        message = message.message_attributes(
            "user_id",
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(owner)
                .build()
                .unwrap(),
        );
    }
    message.build()
}

#[test]
fn deletion_message_preserves_owner_for_shared_s3_prefix() {
    for principal in [
        "macro|user@example.com",
        "bot|01900000-0000-7000-8000-000000000002",
        "01900000-0000-7000-8000-000000000003",
    ] {
        let message = deletion_message(Some(principal));
        let (document_id, owner) =
            document_and_owner(message.message_attributes().unwrap()).unwrap();
        let owner = owner.unwrap();

        assert_eq!(owner, Owner::from_principal_str(principal).unwrap());
        assert_eq!(
            s3_key::build_cloud_storage_bucket_document_prefix(&owner, document_id),
            format!("{principal}/{document_id}"),
        );
    }
}

#[test]
fn deletion_message_without_owner_requires_database_lookup() {
    let message = deletion_message(None);
    let (_, owner) = document_and_owner(message.message_attributes().unwrap()).unwrap();
    assert!(owner.is_none());
}

#[test]
fn deletion_message_rejects_invalid_owner() {
    let message = deletion_message(Some("bot|not-a-uuid"));
    assert!(document_and_owner(message.message_attributes().unwrap()).is_err());
}

#[test]
fn document_cleanup_receipt_is_internal_for_the_document() {
    let document_id = "410ee0f3-80df-4ae7-b9a6-5c87fe5408af";

    let receipt = document_cleanup_receipt(document_id);

    assert_eq!(receipt.entity().entity_id, document_id);
    assert_eq!(receipt.entity().entity_type, EntityType::Document);
    assert!(matches!(receipt.auth(), EntityAccessAuth::Internal));
}

#[test]
fn test_count_occurrences() {
    let shas = vec![
        "a1b2c3".to_string(),
        "d4e5f6".to_string(),
        "a1b2c3".to_string(),
        "g7h8i9".to_string(),
        "a1b2c3".to_string(),
        "d4e5f6".to_string(),
    ];

    let mut result = count_occurrences(shas);
    result.sort();
    assert_eq!(
        result,
        vec![
            ("a1b2c3".to_string(), 3),
            ("d4e5f6".to_string(), 2),
            ("g7h8i9".to_string(), 1),
        ]
    );
}

/// The worker deletes an artifact's objects by listing this prefix; every key
/// the artifact store writes must fall under it, and no other document's.
#[test]
fn artifact_cleanup_prefix_covers_only_that_artifacts_objects() {
    let prefix = s3_key::build_artifact_document_prefix("01900000-0000-7000-8000-000000000001");
    let sha = "0f8ca7467b0a55599c03aad0aed980d35f15acafcfa344cfdcd152af3044f7e8";

    assert!(
        s3_key::build_artifact_object_key("01900000-0000-7000-8000-000000000001", sha)
            .starts_with(&prefix)
    );
    assert!(
        !s3_key::build_artifact_object_key("01900000-0000-7000-8000-0000000000012", sha)
            .starts_with(&prefix)
    );
}
