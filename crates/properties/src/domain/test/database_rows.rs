use super::*;

#[tokio::test]
async fn database_row_writes_require_the_versioned_database_service() {
    let service =
        service_with_event_broker(MockPropertiesRepo::new(), RecordingEventBroker::default());
    let access = edit_receipt("row", EntityType::DatabaseRow);
    let definition = Uuid::from_u128(1);
    let option = Uuid::from_u128(2);
    let answers = [
        service
            .set_entity_property(&access, definition, None)
            .await
            .map(|_| ()),
        service
            .add_entity_property_option(&access, definition, option)
            .await,
        service
            .remove_entity_property_option(&access, definition, option)
            .await,
        service
            .bulk_update_entity_property_options(&access, vec![])
            .await
            .map(|_| ()),
        service.delete_entity_properties(&access).await,
        service.delete_entity_property(&access, definition).await,
    ];
    for answer in answers {
        assert!(
            matches!(answer, Err(PropertiesErr::Validation(message)) if message == "Database row properties must be edited through database operations")
        );
    }
}

#[tokio::test]
async fn bulk_option_updates_reject_database_rows_without_writing_them() {
    let definition = Uuid::from_u128(1);
    let mut repository = MockPropertiesRepo::new();
    repository
        .expect_get_property_definition()
        .returning(move |_| {
            Box::pin(async move {
                Ok(Some(property_definition_for_event(
                    definition,
                    "Choices",
                    DataType::String,
                    true,
                )))
            })
        });
    let service = service_with_event_broker(repository, RecordingEventBroker::default());
    let outcomes = service
        .bulk_update_entities_property_options(
            &[edit_receipt("row", EntityType::DatabaseRow)],
            definition,
            vec![],
            vec![],
        )
        .await
        .unwrap();
    assert!(
        matches!(outcomes.as_slice(), [crate::domain::model::EntityOptionUpdateOutcome::Failed { message }] if message == "Database row properties must be edited through database operations")
    );
}
