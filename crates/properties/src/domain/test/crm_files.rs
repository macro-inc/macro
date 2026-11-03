use super::*;
use models_properties::EntityReference;

#[tokio::test]
async fn crm_file_append_normalizes_ids_preserves_links_and_ignores_repeat_events() {
    let document_id = Uuid::from_u128(1);
    let first = EntityReference::new(Uuid::from_u128(2).to_string(), EntityType::Company);
    let second_id = Uuid::from_u128(0xabcdef);
    let second = EntityReference::new(second_id.to_string(), EntityType::Company);
    let combined = Some(PropertyValue::EntityRef(vec![
        first.clone(),
        second.clone(),
    ]));
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_document_sub_types()
        .times(2)
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    let expected_second = second.clone();
    let mut first_write = true;
    repo.expect_add_entity_property_references()
        .withf(move |id, kind, property, refs| {
            id == document_id.to_string()
                && *kind == EntityType::Document
                && *property == SystemPropertyKey::COMPANIES_UUID
                && refs == &[expected_second.clone()]
        })
        .times(2)
        .returning(move |id, kind, property, _| {
            let snapshot = EntityPropertyMutationSnapshot {
                previous_value: if first_write {
                    Some(PropertyValue::EntityRef(vec![first.clone()]))
                } else {
                    combined.clone()
                },
                ..entity_property_mutation(id, kind, property, combined.clone())
            };
            first_write = false;
            Box::pin(async move { Ok(snapshot) })
        });
    let events = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, events.clone());
    service
        .append_crm_file_references(
            &edit_receipt(&document_id.to_string(), EntityType::Document),
            SystemPropertyKey::COMPANIES_UUID,
            vec![EntityReference::new(
                second_id.simple().to_string(),
                EntityType::Company,
            )],
        )
        .await
        .unwrap();
    service
        .append_crm_file_references(
            &edit_receipt(&document_id.to_string(), EntityType::Document),
            SystemPropertyKey::COMPANIES_UUID,
            vec![EntityReference::new(
                second_id.to_string().to_uppercase(),
                EntityType::Company,
            )],
        )
        .await
        .unwrap();
    assert_eq!(events.events().len(), 1);
}

#[tokio::test]
async fn crm_file_append_rejects_relationships_and_non_file_targets() {
    let service =
        service_with_event_broker(MockPropertiesRepo::new(), RecordingEventBroker::default());
    for (entity_type, property_id) in [
        (EntityType::Document, SystemPropertyKey::ASSIGNEES_UUID),
        (EntityType::Company, SystemPropertyKey::COMPANIES_UUID),
    ] {
        assert!(matches!(
            service
                .append_crm_file_references(
                    &edit_receipt(&Uuid::from_u128(1).to_string(), entity_type),
                    property_id,
                    vec![EntityReference::new(
                        Uuid::from_u128(2).to_string(),
                        EntityType::Company
                    )],
                )
                .await,
            Err(PropertiesErr::Validation(_))
        ));
    }
}

#[tokio::test]
async fn crm_file_append_rejects_tasks_and_mismatched_reference_types() {
    for task in [false, true] {
        let document_id = Uuid::from_u128(1);
        let mut repo = MockPropertiesRepo::new();
        repo.expect_get_document_sub_types()
            .once()
            .returning(move |_| {
                Box::pin(async move {
                    Ok(if task {
                        HashMap::from([(document_id, DocumentSubType::Task)])
                    } else {
                        HashMap::new()
                    })
                })
            });
        let events = RecordingEventBroker::default();
        let service = service_with_event_broker(repo, events.clone());
        assert!(matches!(
            service
                .append_crm_file_references(
                    &edit_receipt(&document_id.to_string(), EntityType::Document),
                    SystemPropertyKey::COMPANIES_UUID,
                    vec![EntityReference::new(
                        Uuid::from_u128(2).to_string(),
                        if task {
                            EntityType::Company
                        } else {
                            EntityType::Contact
                        }
                    )],
                )
                .await,
            Err(PropertiesErr::Validation(_))
        ));
        assert!(events.events().is_empty());
    }
}
