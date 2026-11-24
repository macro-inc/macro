use super::*;
use crate::domain::ports::TaskDependencyLinkOutcome;
use models_properties::api::requests::SetPropertyValue;
use models_properties::shared::EntityReference;

#[tokio::test]
async fn dependency_response_and_event_use_the_committed_primary_value() {
    let task_id = Uuid::from_u128(0xabcdef);
    let blocker = Uuid::from_u128(0xfedcba);
    for definition_id in [
        SystemPropertyKey::DEPENDS_ON_UUID,
        SystemPropertyKey::BLOCKING_UUID,
    ] {
        let mut repo = MockPropertiesRepo::new();
        expect_task_storage(&mut repo, task_id);
        repo.expect_get_property_definition().return_once(move |_| {
            Box::pin(async move {
                Ok(Some(property_definition_for_event(
                    definition_id,
                    "Relationship",
                    DataType::Entity,
                    true,
                )))
            })
        });
        repo.expect_task_dependency_targets()
            .return_once(move |_, _| Box::pin(async move { Ok(vec![blocker]) }));
        let canonical = Some(PropertyValue::EntityRef(vec![EntityReference::new(
            blocker.to_string(),
            EntityType::Task,
        )]));
        let stored = canonical.clone();
        repo.expect_link_task_dependencies()
            .withf(move |id, key, expected, desired| {
                *id == task_id
                    && *key == definition_id
                    && expected == &[blocker]
                    && desired == &[blocker]
            })
            .return_once(move |_, _, _, _| {
                Box::pin(async move {
                    Ok(TaskDependencyLinkOutcome::Updated(
                        entity_property_mutation(
                            &task_id.to_string(),
                            EntityType::Task,
                            definition_id,
                            stored,
                        ),
                        vec![],
                    ))
                })
            });
        let broker = RecordingEventBroker::default();
        let service = service_with_event_broker(repo, broker.clone());
        let result = service
            .set_entity_property_with_effects(
                &edit_receipt(&task_id.to_string(), EntityType::Task),
                definition_id,
                Some(SetPropertyValue::MultiEntityReference {
                    references: vec![
                        EntityReference::new(blocker.to_string().to_uppercase(), EntityType::Task),
                        EntityReference::new(blocker.to_string(), EntityType::Task),
                    ],
                }),
                None,
            )
            .await
            .unwrap();
        assert_eq!(result.property.value, canonical);
        let published = only_published_property_event(&broker);
        assert_eq!(
            published.envelope["metadata"]["value"],
            serde_json::to_value(&canonical).unwrap()
        );
    }
}
