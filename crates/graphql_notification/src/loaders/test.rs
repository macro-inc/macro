use super::*;

/// CRM companies are omitted because the notification domain has no CRM
/// notification item type.
#[test]
fn crm_companies_have_an_empty_notification_edge() {
    let keys =
        vec![model_entity::EntityType::CrmCompany.with_entity_string("company-1".to_owned())];

    assert!(notification_refs(&keys).is_empty());
}

/// Unsupported entities do not prevent supported entities in the same Soup
/// page from being requested.
#[test]
fn mixed_batches_keep_supported_notification_entities() {
    let keys = vec![
        model_entity::EntityType::CrmCompany.with_entity_string("company-1".to_owned()),
        model_entity::EntityType::Document.with_entity_string("document-1".to_owned()),
    ];

    let refs = notification_refs(&keys);

    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].0, keys[1]);
    assert_eq!(refs[0].1.entity_type, NotificationItemType::Document);
    assert_eq!(refs[0].1.id, "document-1");
}
