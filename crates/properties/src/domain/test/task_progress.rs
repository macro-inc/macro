use super::*;

fn task_repo(task_id: Uuid) -> MockPropertiesRepo {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .returning(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
    repo
}

fn status(option: StatusOption) -> Option<PropertyValue> {
    Some(PropertyValue::SelectOption(vec![option.uuid()]))
}

fn agent_receipt(task_id: Uuid) -> EditReceipt {
    EditReceipt::dangerously_assert_bot(
        bot_id::CODEX_BOT_ID.into_storage_id(),
        BotReceiptScope::User {
            acting_user: caller_user_id(),
        },
        &task_id.to_string(),
        AccessEntityType::Document,
    )
}

#[tokio::test]
async fn an_unstarted_task_moves_in_progress_with_the_agent_as_actor() {
    let task_id = Uuid::from_u128(1);
    let mut repo = task_repo(task_id);
    repo.expect_transition_entity_property_option()
        .once()
        .withf(move |id, kind, property, from, to| {
            id == task_id.to_string()
                && *kind == EntityType::Task
                && *property == SystemPropertyKey::STATUS_UUID
                && from == [StatusOption::NOT_STARTED_UUID]
                && *to == StatusOption::IN_PROGRESS_UUID
        })
        .return_once(|id, kind, property, _, to| {
            let snapshot = EntityPropertyMutationSnapshot {
                previous_value: status(StatusOption::NotStarted),
                ..entity_property_mutation(
                    id,
                    kind,
                    property,
                    Some(PropertyValue::SelectOption(vec![to])),
                )
            };
            Box::pin(async move { Ok(Some(snapshot)) })
        });
    let events = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, events.clone());

    assert!(
        service
            .mark_task_in_progress(&agent_receipt(task_id))
            .await
            .unwrap()
    );

    let metadata = only_published_property_event(&events).envelope["metadata"].clone();
    assert_eq!(metadata["entity_type"], "TASK");
    assert_eq!(
        metadata["property_definition_id"],
        SystemPropertyKey::STATUS_UUID.to_string()
    );
    assert_eq!(
        metadata["previous_value"],
        serde_json::to_value(status(StatusOption::NotStarted)).unwrap()
    );
    assert_eq!(
        metadata["value"],
        serde_json::to_value(status(StatusOption::InProgress)).unwrap()
    );
    assert_eq!(
        metadata["actor"],
        bot_id::CODEX_BOT_ID.into_storage_id().as_ref()
    );
    assert_eq!(metadata["on_behalf_of"], caller_user_id().as_ref());
}

#[tokio::test]
async fn a_status_the_transition_keeps_publishes_nothing() {
    let task_id = Uuid::from_u128(1);
    let mut repo = task_repo(task_id);
    repo.expect_transition_entity_property_option()
        .once()
        .return_once(|_, _, _, _, _| Box::pin(async { Ok(None) }));
    let events = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, events.clone());

    assert!(
        !service
            .mark_task_in_progress(&agent_receipt(task_id))
            .await
            .unwrap()
    );
    assert!(events.events().is_empty());
}

#[tokio::test]
async fn repository_failures_surface_without_publishing() {
    let task_id = Uuid::from_u128(1);
    let mut repo = task_repo(task_id);
    repo.expect_transition_entity_property_option()
        .once()
        .return_once(|_, _, _, _, _| {
            Box::pin(async { Err(anyhow::Error::new(std::io::Error::other("unavailable"))) })
        });
    let events = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, events.clone());

    let result = service.mark_task_in_progress(&agent_receipt(task_id)).await;

    assert!(matches!(result, Err(PropertiesErr::Repo(error)) if error.is::<std::io::Error>()));
    assert!(events.events().is_empty());
}

#[tokio::test]
async fn documents_that_are_no_longer_tasks_are_left_alone() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_document_sub_types()
        .return_once(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_transition_entity_property_option().never();
    let service = service_with_event_broker(repo, RecordingEventBroker::default());

    assert!(
        !service
            .mark_task_in_progress(&agent_receipt(Uuid::from_u128(1)))
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn only_documents_can_be_marked_in_progress() {
    let service =
        service_with_event_broker(MockPropertiesRepo::new(), RecordingEventBroker::default());

    let result = service
        .mark_task_in_progress(&edit_receipt("project", EntityType::Initiative))
        .await;

    assert!(matches!(result, Err(PropertiesErr::Validation(_))));
}
