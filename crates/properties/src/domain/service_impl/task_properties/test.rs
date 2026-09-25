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
