use super::*;
use crate::domain::ports::InitiativeAssigneeService;
use models_properties::EntityReference;
use models_properties::api::requests::SetPropertyValue;
use std::pin::Pin;

#[derive(Debug, Default)]
struct InitiativeSharing {
    calls: Mutex<Vec<(String, Vec<String>)>>,
    deny: bool,
}

impl InitiativeAssigneeService for InitiativeSharing {
    fn grant_assignees<'a>(
        &'a self,
        access: &'a EditReceipt,
        user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> Pin<Box<dyn Future<Output = Result<(), PropertiesErr>> + Send + 'a>> {
        Box::pin(async move {
            assert_eq!(access.entity_type(), AccessEntityType::Initiative);
            if self.deny {
                return Err(PropertiesErr::PermissionDenied);
            }
            self.calls.lock().unwrap().push((
                access.entity_id().to_string(),
                user_ids.iter().map(ToString::to_string).collect(),
            ));
            Ok(())
        })
    }
}

fn assignees_definition() -> PropertyDefinition {
    PropertyDefinition {
        id: SystemPropertyKey::ASSIGNEES_UUID,
        owner: PropertyOwner::System,
        display_name: "Assignees".into(),
        data_type: DataType::Entity,
        is_multi_select: true,
        specific_entity_type: Some(EntityType::User),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        is_system: true,
        is_metadata: false,
    }
}

fn status_definition() -> PropertyDefinition {
    PropertyDefinition {
        id: SystemPropertyKey::STATUS_UUID,
        display_name: "Status".into(),
        data_type: DataType::SelectString,
        is_multi_select: false,
        specific_entity_type: None,
        ..assignees_definition()
    }
}

#[tokio::test]
async fn initiative_status_rejects_review_and_canceled_without_writing() {
    for status in [StatusOption::InReview, StatusOption::Canceled] {
        let mut repo = MockPropertiesRepo::new();
        repo.expect_get_property_definition()
            .return_once(|_| Box::pin(async { Ok(Some(status_definition())) }));
        repo.expect_count_valid_property_options()
            .returning(|_, _| Box::pin(async { Ok(1) }));
        repo.expect_upsert_entity_property().times(0);
        let events = RecordingEventBroker::default();
        let service = service_with_event_broker(repo, events.clone());

        let result = service
            .set_entity_property(
                &edit_receipt("initiative1", EntityType::Initiative),
                SystemPropertyKey::STATUS_UUID,
                Some(SetPropertyValue::SelectOption {
                    option_id: status.uuid(),
                }),
            )
            .await;

        assert!(matches!(result, Err(PropertiesErr::Validation(_))));
        assert!(events.events().is_empty());
    }
}

#[tokio::test]
async fn initiative_status_accepts_not_started_in_progress_and_completed() {
    for status in [
        StatusOption::NotStarted,
        StatusOption::InProgress,
        StatusOption::Completed,
    ] {
        let mut repo = MockPropertiesRepo::new();
        repo.expect_get_property_definition()
            .return_once(|_| Box::pin(async { Ok(Some(status_definition())) }));
        repo.expect_count_valid_property_options()
            .withf(move |property_id, options| {
                *property_id == SystemPropertyKey::STATUS_UUID && options == [status.uuid()]
            })
            .return_once(|_, _| Box::pin(async { Ok(1) }));
        repo.expect_upsert_entity_property()
            .withf(move |_, kind, property_id, value| {
                *kind == EntityType::Initiative
                    && *property_id == SystemPropertyKey::STATUS_UUID
                    && *value == Some(PropertyValue::SelectOption(vec![status.uuid()]))
            })
            .return_once(|id, kind, property_id, value| {
                let snapshot = entity_property_mutation(id, kind, property_id, value);
                Box::pin(async move { Ok(snapshot) })
            });
        let service = service_with_event_broker(repo, RecordingEventBroker::default());

        let property = service
            .set_entity_property(
                &edit_receipt("initiative1", EntityType::Initiative),
                SystemPropertyKey::STATUS_UUID,
                Some(SetPropertyValue::SelectOption {
                    option_id: status.uuid(),
                }),
            )
            .await
            .unwrap();

        assert_eq!(
            property.value,
            Some(PropertyValue::SelectOption(vec![status.uuid()]))
        );
    }
}

#[tokio::test]
async fn task_status_still_accepts_review_and_canceled() {
    for status in [StatusOption::InReview, StatusOption::Canceled] {
        let task_id = Uuid::now_v7();
        let mut repo = MockPropertiesRepo::new();
        repo.expect_get_document_sub_types().return_once(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
        repo.expect_get_property_definition()
            .return_once(|_| Box::pin(async { Ok(Some(status_definition())) }));
        repo.expect_count_valid_property_options()
            .withf(move |property_id, options| {
                *property_id == SystemPropertyKey::STATUS_UUID && options == [status.uuid()]
            })
            .return_once(|_, _| Box::pin(async { Ok(1) }));
        repo.expect_upsert_entity_property()
            .withf(move |_, kind, _, value| {
                *kind == EntityType::Task
                    && *value == Some(PropertyValue::SelectOption(vec![status.uuid()]))
            })
            .return_once(|id, kind, property_id, value| {
                let snapshot = entity_property_mutation(id, kind, property_id, value);
                Box::pin(async move { Ok(snapshot) })
            });
        let service = service_with_event_broker(repo, RecordingEventBroker::default());

        let property = service
            .set_entity_property(
                &edit_receipt(&task_id.to_string(), EntityType::Document),
                SystemPropertyKey::STATUS_UUID,
                Some(SetPropertyValue::SelectOption {
                    option_id: status.uuid(),
                }),
            )
            .await
            .unwrap();

        assert_eq!(
            property.value,
            Some(PropertyValue::SelectOption(vec![status.uuid()]))
        );
    }
}

#[tokio::test]
async fn assignees_share_the_initiative_and_allow_assigning_the_owner() {
    let sharing = Arc::new(InitiativeSharing::default());
    let expected_sharing = sharing.clone();
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition()
        .return_once(|_| Box::pin(async { Ok(Some(assignees_definition())) }));
    repo.expect_upsert_entity_property()
        .return_once(move |id, kind, property_id, value| {
            assert_eq!(kind, EntityType::Initiative);
            assert_eq!(
                expected_sharing.calls.lock().unwrap().len(),
                1,
                "grants precede persistence"
            );
            let snapshot = entity_property_mutation(id, kind, property_id, value);
            Box::pin(async move { Ok(snapshot) })
        });
    let service = PropertiesServiceImpl::new(
        repo,
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    )
    .with_initiative_assignees(sharing.clone());
    let owner = caller_user_id();
    let result = service
        .set_entity_property(
            &edit_receipt("initiative1", EntityType::Initiative),
            SystemPropertyKey::ASSIGNEES_UUID,
            Some(SetPropertyValue::MultiEntityReference {
                references: vec![
                    EntityReference::new(owner.as_ref(), EntityType::User),
                    EntityReference::new("macro|assignee@test.com", EntityType::User),
                ],
            }),
        )
        .await
        .unwrap();
    assert_eq!(result.property.entity_type, EntityType::Initiative);
    assert_eq!(
        sharing.calls.lock().unwrap()[0],
        (
            "initiative1".into(),
            vec![owner.to_string(), "macro|assignee@test.com".into()],
        )
    );
}

#[tokio::test]
async fn assignee_grant_failure_does_not_persist_or_publish() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition()
        .return_once(|_| Box::pin(async { Ok(Some(assignees_definition())) }));
    repo.expect_upsert_entity_property().times(0);
    let events = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, events.clone()).with_initiative_assignees(
        Arc::new(InitiativeSharing {
            deny: true,
            ..Default::default()
        }),
    );
    let result = service
        .set_entity_property(
            &edit_receipt("initiative1", EntityType::Initiative),
            SystemPropertyKey::ASSIGNEES_UUID,
            Some(SetPropertyValue::MultiEntityReference {
                references: vec![EntityReference::new(
                    "macro|assignee@test.com",
                    EntityType::User,
                )],
            }),
        )
        .await;
    assert!(matches!(result, Err(PropertiesErr::PermissionDenied)));
    assert!(events.events().is_empty());
}

#[tokio::test]
async fn assignees_reject_non_user_references_without_granting() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition()
        .return_once(|_| Box::pin(async { Ok(Some(assignees_definition())) }));
    repo.expect_upsert_entity_property().times(0);
    let sharing = Arc::new(InitiativeSharing::default());
    let service = service_with_event_broker(repo, RecordingEventBroker::default())
        .with_initiative_assignees(sharing.clone());
    let result = service
        .set_entity_property(
            &edit_receipt("initiative1", EntityType::Initiative),
            SystemPropertyKey::ASSIGNEES_UUID,
            Some(SetPropertyValue::MultiEntityReference {
                references: vec![EntityReference::new(
                    caller_user_id().as_ref(),
                    EntityType::Document,
                )],
            }),
        )
        .await;
    assert!(matches!(result, Err(PropertiesErr::Validation(_))));
    assert!(sharing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn required_properties_can_be_cleared_but_not_detached() {
    for (key, data_type) in [
        (SystemPropertyKey::Assignees, DataType::Entity),
        (SystemPropertyKey::Status, DataType::SelectString),
        (SystemPropertyKey::Priority, DataType::SelectString),
        (SystemPropertyKey::DueDate, DataType::Date),
    ] {
        let mut repo = MockPropertiesRepo::new();
        repo.expect_get_property_definition().return_once(move |_| {
            Box::pin(async move {
                Ok(Some(PropertyDefinition {
                    id: key.uuid(),
                    data_type,
                    ..assignees_definition()
                }))
            })
        });
        repo.expect_upsert_entity_property()
            .withf(move |_, kind, id, value| {
                *kind == EntityType::Initiative && *id == key.uuid() && value.is_none()
            })
            .return_once(|id, kind, property_id, value| {
                let snapshot = entity_property_mutation(id, kind, property_id, value);
                Box::pin(async move { Ok(snapshot) })
            });
        repo.expect_lookup_entity_property().return_once(move |_| {
            Box::pin(async move {
                Ok(Some(models_properties::EntityPropertyReference {
                    entity_id: "initiative1".into(),
                    entity_type: EntityType::Initiative,
                    property_definition_id: key.uuid(),
                }))
            })
        });
        repo.expect_delete_entity_property().times(0);
        let service = service_with_event_broker(repo, RecordingEventBroker::default());
        let receipt = edit_receipt("initiative1", EntityType::Initiative);
        let property = service
            .set_entity_property(&receipt, key.uuid(), None)
            .await
            .unwrap();
        assert!(property.value.is_none());
        assert!(matches!(
            service
                .delete_entity_property(&receipt, property.property.id)
                .await,
            Err(PropertiesErr::RequiredProperty)
        ));
    }
}
