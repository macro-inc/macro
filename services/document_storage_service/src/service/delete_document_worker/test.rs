use entity_access::domain::models::{EntityAccessAuth, EntityType};

use super::handle::{count_occurrences, document_cleanup_receipt};

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
