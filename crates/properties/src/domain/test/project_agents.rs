use super::*;
use models_properties::EntityReference;

fn agent() -> EntityReference {
    EntityReference::new(
        bot_id::CODEX_BOT_ID.into_storage_id().as_ref(),
        EntityType::User,
    )
}

fn human() -> EntityReference {
    EntityReference::new("macro|assignee@example.com", EntityType::User)
}

fn task_repo(task_id: Uuid) -> MockPropertiesRepo {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .returning(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
    repo
}

#[tokio::test]
async fn inheritance_merges_only_agents_and_emits_attributed_delta() {
    let task_id = Uuid::from_u128(1);
    let mut repo = task_repo(task_id);
    repo.expect_get_entity_property_value()
        .withf(|id, kind, property| {
            id == "project"
                && *kind == EntityType::Initiative
                && *property == SystemPropertyKey::ASSIGNEES_UUID
        })
        .return_once(|_, _, _| {
            Box::pin(async { Ok(Some(PropertyValue::EntityRef(vec![human(), agent()]))) })
        });
    repo.expect_add_entity_property_references()
        .withf(move |id, kind, property, refs| {
            id == task_id.to_string()
                && *kind == EntityType::Task
                && *property == SystemPropertyKey::ASSIGNEES_UUID
                && refs == &[agent()]
        })
        .return_once(|id, kind, property, _| {
            let snapshot = EntityPropertyMutationSnapshot {
                previous_value: Some(PropertyValue::EntityRef(vec![human()])),
                ..entity_property_mutation(
                    id,
                    kind,
                    property,
                    Some(PropertyValue::EntityRef(vec![human(), agent()])),
                )
            };
            Box::pin(async move { Ok(snapshot) })
        });
    let events = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, events.clone());

    service
        .inherit_project_agent_assignees(
            &view_receipt("project", EntityType::Initiative),
            &edit_receipt(&task_id.to_string(), EntityType::Task),
        )
        .await
        .unwrap();

    let events = events.events();
    assert_eq!(events.len(), 1);
    let metadata = &events[0].envelope["metadata"];
    assert_eq!(metadata["actor_user_id"], caller_user_id().as_ref());
    assert_eq!(
        metadata["previous_value"],
        serde_json::to_value(PropertyValue::EntityRef(vec![human()])).unwrap()
    );
    assert_eq!(
        metadata["value"],
        serde_json::to_value(PropertyValue::EntityRef(vec![human(), agent()])).unwrap()
    );
}

#[tokio::test]
async fn repeated_inheritance_does_not_publish_another_assignment() {
    let task_id = Uuid::from_u128(1);
    let mut repo = task_repo(task_id);
    repo.expect_get_entity_property_value()
        .return_once(|_, _, _| {
            Box::pin(async { Ok(Some(PropertyValue::EntityRef(vec![agent()]))) })
        });
    repo.expect_add_entity_property_references()
        .return_once(|id, kind, property, _| {
            let value = Some(PropertyValue::EntityRef(vec![agent()]));
            let snapshot = EntityPropertyMutationSnapshot {
                previous_value: value.clone(),
                ..entity_property_mutation(id, kind, property, value)
            };
            Box::pin(async move { Ok(snapshot) })
        });
    let events = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, events.clone());
    service
        .inherit_project_agent_assignees(
            &view_receipt("project", EntityType::Initiative),
            &edit_receipt(&task_id.to_string(), EntityType::Task),
        )
        .await
        .unwrap();
    assert!(events.events().is_empty());
}

#[tokio::test]
async fn inheritance_preserves_a_delegated_bot_actor() {
    let task_id = Uuid::from_u128(1);
    let mut repo = task_repo(task_id);
    repo.expect_get_entity_property_value()
        .return_once(|_, _, _| {
            Box::pin(async { Ok(Some(PropertyValue::EntityRef(vec![agent()]))) })
        });
    repo.expect_add_entity_property_references()
        .return_once(|id, kind, property, references| {
            let snapshot = entity_property_mutation(
                id,
                kind,
                property,
                Some(PropertyValue::EntityRef(references)),
            );
            Box::pin(async move { Ok(snapshot) })
        });
    let bot_id = bot_id::MACRO_SYSTEM_BOT_ID;
    let scope = BotReceiptScope::User {
        acting_user: caller_user_id(),
    };
    let project = ViewReceipt::dangerously_assert_bot(
        bot_id.into_storage_id(),
        scope.clone(),
        "project",
        AccessEntityType::Initiative,
    );
    let task = EditReceipt::dangerously_assert_bot(
        bot_id.into_storage_id(),
        scope,
        &task_id.to_string(),
        AccessEntityType::Document,
    );
    let events = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, events.clone());
    service
        .inherit_project_agent_assignees(&project, &task)
        .await
        .unwrap();

    let event = only_published_property_event(&events);
    assert_eq!(
        event.envelope["metadata"]["actor"],
        bot_id.into_storage_id().as_ref(),
    );
    assert_eq!(
        event.envelope["metadata"]["on_behalf_of"],
        caller_user_id().as_ref(),
    );
    assert!(event.envelope["metadata"]["actor_user_id"].is_null());
}

#[tokio::test]
async fn projects_without_agent_assignees_do_not_change_tasks() {
    for value in [None, Some(PropertyValue::EntityRef(vec![human()]))] {
        let task_id = Uuid::from_u128(1);
        let mut repo = task_repo(task_id);
        repo.expect_get_entity_property_value()
            .return_once(|_, _, _| Box::pin(async move { Ok(value) }));
        let events = RecordingEventBroker::default();
        let service = service_with_event_broker(repo, events.clone());
        service
            .inherit_project_agent_assignees(
                &view_receipt("project", EntityType::Initiative),
                &edit_receipt(&task_id.to_string(), EntityType::Task),
            )
            .await
            .unwrap();
        assert!(events.events().is_empty());
    }
}

#[tokio::test]
async fn inheritance_rejects_mismatched_actors_before_reading_or_writing() {
    let service =
        service_with_event_broker(MockPropertiesRepo::new(), RecordingEventBroker::default());
    let result = service
        .inherit_project_agent_assignees(
            &view_receipt("project", EntityType::Initiative),
            &edit_receipt_for_user(
                "macro|other@example.com",
                &Uuid::from_u128(1).to_string(),
                EntityType::Task,
            ),
        )
        .await;
    assert!(matches!(result, Err(PropertiesErr::PermissionDenied)));
}

#[tokio::test]
async fn inheritance_ignores_documents_that_are_no_longer_tasks() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_document_sub_types()
        .return_once(|_| Box::pin(async { Ok(HashMap::new()) }));
    let service = service_with_event_broker(repo, RecordingEventBroker::default());
    service
        .inherit_project_agent_assignees(
            &view_receipt("project", EntityType::Initiative),
            &edit_receipt(&Uuid::from_u128(1).to_string(), EntityType::Document),
        )
        .await
        .unwrap();
}
