use super::*;
use crate::domain::ports::{MockNotificationService, MockPermissionService, MockPropertiesRepo};
use models_properties::EntityReference;

fn assignment(references: Vec<EntityReference>) -> Option<SetPropertyValue> {
    Some(SetPropertyValue::MultiEntityReference { references })
}

fn agent_reference() -> EntityReference {
    EntityReference::new(
        bot_id::CODEX_BOT_ID.into_storage_id().as_ref(),
        EntityType::User,
    )
}

#[tokio::test]
async fn agents_do_not_require_human_permission_or_notification_services() {
    let service = PropertiesServiceImpl::new(
        MockPropertiesRepo::new(),
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );

    service
        .handle_task_assignees_property(
            &Uuid::from_u128(1).to_string(),
            assignment(vec![agent_reference()]),
            Some(&MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap()),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn project_agents_do_not_require_human_collaborator_grants() {
    let service = PropertiesServiceImpl::new(
        MockPropertiesRepo::new(),
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );
    let access = EditReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap(),
        &Uuid::from_u128(1).to_string(),
        entity_access::domain::models::EntityType::Initiative,
    );
    service
        .handle_initiative_assignees_property(
            &access,
            &Some(PropertyValue::EntityRef(vec![agent_reference()])),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn mixed_assignments_grant_access_and_notify_only_humans() {
    let task_id = Uuid::from_u128(1);
    let assignee = MacroUserIdStr::parse_from_str("macro|assignee@example.com").unwrap();
    let assigner = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_entity_property_value()
        .times(1)
        .returning(|_, _, _| Box::pin(async { Ok(None) }));

    let mut permissions = MockPermissionService::new();
    let expected_assignee = assignee.clone();
    permissions
        .expect_grant_permissions_to_task()
        .times(1)
        .withf(move |users, id| users == [expected_assignee.clone()] && id == task_id.to_string())
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let mut notifications = MockNotificationService::new();
    let expected_assignee = assignee.clone();
    let expected_assigner = assigner.clone();
    notifications
        .expect_send_task_assigned()
        .times(1)
        .withf(move |notification| {
            notification.task_id == task_id
                && notification.recipient_ids == [expected_assignee.clone()]
                && notification.assigned_by == expected_assigner
        })
        .returning(|_| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(repo, Some(permissions), Some(notifications));
    service
        .handle_task_assignees_property(
            &task_id.to_string(),
            assignment(vec![
                agent_reference(),
                EntityReference::new(assignee.as_ref(), EntityType::User),
            ]),
            Some(&assigner),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn malformed_agent_and_non_user_references_are_rejected_before_side_effects() {
    for reference in [
        EntityReference::new("bot|invalid", EntityType::User),
        EntityReference::new(
            bot_id::CODEX_BOT_ID.into_storage_id().as_ref(),
            EntityType::Document,
        ),
        EntityReference::new("macro|assignee@example.com", EntityType::Document),
    ] {
        let service = PropertiesServiceImpl::new(
            MockPropertiesRepo::new(),
            Some(MockPermissionService::new()),
            Some(MockNotificationService::new()),
        );
        let result = service
            .handle_task_assignees_property(
                &Uuid::from_u128(1).to_string(),
                assignment(vec![reference]),
                Some(&MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap()),
            )
            .await;

        assert!(matches!(result, Err(PropertiesErr::Validation(_))));
    }
}

fn task_edit(user: &MacroUserIdStr<'static>) -> EditReceipt {
    EditReceipt::dangerously_assert_authenticated_user(
        user.clone(),
        &Uuid::from_u128(1).to_string(),
        entity_access::domain::models::EntityType::Document,
    )
}

fn project_reference(entity_id: &str, entity_type: EntityType) -> Option<PropertyValue> {
    Some(PropertyValue::EntityRef(vec![EntityReference::new(
        entity_id,
        entity_type,
    )]))
}

#[tokio::test]
async fn joining_a_project_requires_project_edit_access_and_stores_the_canonical_id() {
    let user = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let project = Uuid::from_u128(0xABCDEF);
    let mut permissions = MockPermissionService::new();
    let expected_user = user.clone();
    permissions
        .expect_mint_edit_receipt()
        .once()
        .withf(move |user, id, entity_type| {
            *user == expected_user
                && id == project.to_string()
                && *entity_type == entity_access::domain::models::EntityType::Initiative
        })
        .returning(|user, id, entity_type| {
            let receipt = EditReceipt::dangerously_assert_authenticated_user(
                user.clone().into_owned(),
                id,
                entity_type,
            );
            Box::pin(async move { Ok(receipt) })
        });
    let service = PropertiesServiceImpl::new(
        MockPropertiesRepo::new(),
        Some(permissions),
        None::<MockNotificationService>,
    );

    let value = service
        .validate_task_project(
            &task_edit(&user),
            project_reference(&project.to_string().to_uppercase(), EntityType::Initiative),
        )
        .await
        .unwrap();
    assert_eq!(
        value,
        project_reference(&project.to_string(), EntityType::Initiative)
    );
}

#[tokio::test]
async fn joining_a_project_without_project_edit_access_is_denied() {
    let user = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let mut permissions = MockPermissionService::new();
    permissions
        .expect_mint_edit_receipt()
        .once()
        .returning(|_, _, _| Box::pin(async { Err(anyhow::anyhow!("view only")) }));
    let service = PropertiesServiceImpl::new(
        MockPropertiesRepo::new(),
        Some(permissions),
        None::<MockNotificationService>,
    );

    let result = service
        .validate_task_project(
            &task_edit(&user),
            project_reference(&Uuid::from_u128(2).to_string(), EntityType::Initiative),
        )
        .await;
    assert!(matches!(result, Err(PropertiesErr::PermissionDenied)));
}

#[tokio::test]
async fn leaving_a_project_needs_only_task_edit_access() {
    let user = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    // No permission service: clearing must not check the project.
    let service = PropertiesServiceImpl::new(
        MockPropertiesRepo::new(),
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );
    for value in [None, Some(PropertyValue::EntityRef(vec![]))] {
        assert_eq!(
            service
                .validate_task_project(&task_edit(&user), value.clone())
                .await
                .unwrap(),
            value
        );
    }
}

#[tokio::test]
async fn project_values_must_name_one_project() {
    let user = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let service = PropertiesServiceImpl::new(
        MockPropertiesRepo::new(),
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );
    let project = Uuid::from_u128(2).to_string();
    for value in [
        project_reference(&project, EntityType::Document),
        project_reference("not-a-uuid", EntityType::Initiative),
        Some(PropertyValue::EntityRef(vec![
            EntityReference::new(&project, EntityType::Initiative),
            EntityReference::new(Uuid::from_u128(3).to_string(), EntityType::Initiative),
        ])),
    ] {
        assert!(matches!(
            service
                .validate_task_project(&task_edit(&user), value)
                .await,
            Err(PropertiesErr::Validation(_))
        ));
    }
}

#[tokio::test]
async fn dependency_removal_requires_edit_access_to_removed_task() {
    let user = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let blocker = Uuid::from_u128(2);
    for key in [
        SystemPropertyKey::DEPENDS_ON_UUID,
        SystemPropertyKey::BLOCKING_UUID,
    ] {
        // Rebuild mocks per direction so the expectation verifies each removal.
        let mut repo = MockPropertiesRepo::new();
        repo.expect_task_dependency_targets()
            .once()
            .returning(move |_, _| Box::pin(async move { Ok(vec![blocker]) }));
        let mut permissions = MockPermissionService::new();
        permissions
            .expect_mint_edit_receipt()
            .once()
            .withf(move |_, id, _| id == blocker.to_string())
            .returning(|_, _, _| Box::pin(async { Err(anyhow::anyhow!("view only")) }));
        let service =
            PropertiesServiceImpl::new(repo, Some(permissions), None::<MockNotificationService>);
        assert!(matches!(
            service
                .handle_task_relationship_property(&task_edit(&user), key, None)
                .await,
            Err(PropertiesErr::PermissionDenied)
        ));
    }
}

#[tokio::test]
async fn dependency_self_and_invalid_references_are_rejected_without_writes() {
    let user = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let service = PropertiesServiceImpl::new(
        MockPropertiesRepo::new(),
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );
    for reference in [
        EntityReference::new(Uuid::from_u128(1).to_string(), EntityType::Task),
        EntityReference::new("not-a-uuid", EntityType::Task),
        EntityReference::new(Uuid::from_u128(2).to_string(), EntityType::Document),
    ] {
        assert!(matches!(
            service
                .handle_task_relationship_property(
                    &task_edit(&user),
                    SystemPropertyKey::DEPENDS_ON_UUID,
                    Some(SetPropertyValue::MultiEntityReference {
                        references: vec![reference]
                    }),
                )
                .await,
            Err(PropertiesErr::Validation(_))
        ));
    }
}

#[tokio::test]
async fn adding_a_dependency_checks_edit_access_before_writing() {
    let user = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let blocker = Uuid::from_u128(2);
    let mut repo = MockPropertiesRepo::new();
    repo.expect_task_dependency_targets()
        .once()
        .returning(|_, _| Box::pin(async { Ok(vec![]) }));
    let mut permissions = MockPermissionService::new();
    permissions
        .expect_mint_edit_receipt()
        .once()
        .withf(move |_, id, _| id == blocker.to_string())
        .returning(|_, _, _| Box::pin(async { Err(anyhow::anyhow!("view only")) }));
    let service =
        PropertiesServiceImpl::new(repo, Some(permissions), None::<MockNotificationService>);

    assert!(matches!(
        service
            .handle_task_relationship_property(
                &task_edit(&user),
                SystemPropertyKey::DEPENDS_ON_UUID,
                Some(SetPropertyValue::MultiEntityReference {
                    references: vec![EntityReference::new(blocker.to_string(), EntityType::Task),]
                }),
            )
            .await,
        Err(PropertiesErr::PermissionDenied)
    ));
}

#[tokio::test]
async fn changed_dependency_snapshot_rejects_write() {
    let user = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let mut repo = MockPropertiesRepo::new();
    repo.expect_task_dependency_targets()
        .once()
        .returning(|_, _| Box::pin(async { Ok(vec![]) }));
    repo.expect_link_task_dependencies()
        .once()
        .withf(|_, key, expected, desired| {
            *key == SystemPropertyKey::DEPENDS_ON_UUID && expected.is_empty() && desired.is_empty()
        })
        .returning(|_, _, _, _| Box::pin(async { Ok(TaskDependencyLinkOutcome::Stale) }));
    let service = PropertiesServiceImpl::new(
        repo,
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );
    assert!(matches!(
        service
            .handle_task_relationship_property(
                &task_edit(&user),
                SystemPropertyKey::DEPENDS_ON_UUID,
                None
            )
            .await,
        Err(PropertiesErr::Validation(_))
    ));
}

#[tokio::test]
async fn oversized_dependency_snapshot_can_clear_after_authorizing_every_endpoint() {
    let user = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    for key in [
        SystemPropertyKey::DEPENDS_ON_UUID,
        SystemPropertyKey::BLOCKING_UUID,
    ] {
        let endpoints = (2..1003).map(Uuid::from_u128).collect::<Vec<_>>();
        let expected = endpoints.clone();
        let mut repo = MockPropertiesRepo::new();
        repo.expect_task_dependency_targets()
            .once()
            .return_once(|_, _| Box::pin(async move { Ok(endpoints) }));
        repo.expect_link_task_dependencies()
            .once()
            .withf(move |_, property, snapshot, desired| {
                *property == key && *snapshot == expected && desired.is_empty()
            })
            .returning(move |task, _, _, _| {
                Box::pin(async move {
                    Ok(TaskDependencyLinkOutcome::Updated(
                        models_properties::service::entity_property::EntityProperty {
                            id: Uuid::now_v7(),
                            entity_id: task.to_string(),
                            entity_type: EntityType::Task,
                            property_definition_id: key,
                            created_at: chrono::Utc::now(),
                            updated_at: chrono::Utc::now(),
                        },
                        vec![],
                    ))
                })
            });
        let mut permissions = MockPermissionService::new();
        permissions
            .expect_mint_edit_receipt()
            .times(1001)
            .returning(|user, id, entity_type| {
                let receipt = EditReceipt::dangerously_assert_authenticated_user(
                    user.clone().into_owned(),
                    id,
                    entity_type,
                );
                Box::pin(async move { Ok(receipt) })
            });
        let service =
            PropertiesServiceImpl::new(repo, Some(permissions), None::<MockNotificationService>);
        let result = service
            .handle_task_relationship_property(&task_edit(&user), key, None)
            .await
            .unwrap();
        assert!(
            matches!(result.previous_value, Some(PropertyValue::EntityRef(refs)) if refs.len() == 1001)
        );
    }
}
