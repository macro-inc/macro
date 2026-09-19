use super::*;

fn test_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("loader@test.com").unwrap()
}

#[tokio::test]
async fn schema_reader_preserves_canonical_entity_keys() {
    let keys = vec![
        model_entity::EntityType::CrmCompany.with_entity_string("company-1".to_owned()),
        model_entity::EntityType::Document.with_entity_string("document-1".to_owned()),
        model_entity::EntityType::ForeignEntity.with_entity_string("foreign-1".to_owned()),
    ];

    let result = NoOpSoupNotificationEdgeReader
        .get_notifications(test_user(), keys.clone())
        .await
        .unwrap();

    assert_eq!(result.len(), keys.len());
    assert!(keys.iter().all(|key| result[key].is_empty()));
}
