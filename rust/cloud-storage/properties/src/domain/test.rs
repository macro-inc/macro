//! Unit tests for PropertiesServiceImpl using mockall-generated repo.

use super::service_impl::PropertiesServiceImpl;
use crate::domain::{
    ports::{MockNotificationService, MockPermissionService, MockPropertiesRepo},
    service::PropertiesService,
};
use anyhow::anyhow;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::{EntityType, service::property_value::PropertyValue};
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

/// Creates a mock permission service with default expectations for entity edit permission checks.
fn create_mock_permission_service() -> MockPermissionService {
    let mut perm_checker = MockPermissionService::new();
    perm_checker
        .expect_check_entity_edit_permission()
        .returning(|_, _, _| Box::pin(async { Ok(()) }));
    perm_checker
}

#[tokio::test]
async fn test_set_system_property_status_complete_happy_path() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_update_entity_property_value_if_exists()
        .withf(|entity_id, entity_type, prop_id, value| {
            if entity_id != "e1" {
                return false;
            }
            if *entity_type != EntityType::Document {
                return false;
            }
            if *prop_id != SystemPropertyKey::STATUS_UUID {
                return false;
            }
            match value {
                Some(PropertyValue::SelectOption(ids)) => {
                    ids.len() == 1 && ids[0] == StatusOption::COMPLETED_UUID
                }
                _ => false,
            }
        })
        .returning(|_, _, _, _| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let entity_id = "e1";
    let entity_type = EntityType::Document;

    service
        .set_system_property_status_complete(entity_id, entity_type)
        .await
        .unwrap();

    // expectations on the mock validate the call shape
}

#[tokio::test]
async fn test_set_system_property_status_complete_error_path() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_update_entity_property_value_if_exists()
        .returning(|_, _, _, _| Box::pin(async { Err(anyhow!("boom")) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .set_system_property_status_complete("e1", EntityType::Document)
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "boom");
}

// ============================================================================
// link_parent_task unit tests
// ============================================================================

#[tokio::test]
async fn test_link_parent_task_delegates_to_repo() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let parent_id = Uuid::from_u128(0xabcdef01_2345_6789_abcd_ef0123456789);

    repo.expect_link_parent_task()
        .withf(move |t, p| *t == task_id && *p == Some(parent_id))
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .link_parent_task(task_id, Some(parent_id))
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_parent_task_clear_parent() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);

    repo.expect_link_parent_task()
        .withf(move |t, p| *t == task_id && p.is_none())
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service.link_parent_task(task_id, None).await.unwrap();
}

#[tokio::test]
async fn test_link_parent_task_error_propagates() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_link_parent_task()
        .returning(|_, _| Box::pin(async { Err(anyhow!("link failed")) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .link_parent_task(Uuid::nil(), Some(Uuid::nil()))
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "link failed");
}

// ============================================================================
// link_subtasks unit tests
// ============================================================================

#[tokio::test]
async fn test_link_subtasks_delegates_to_repo() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let subtask_1 = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaaaa);
    let subtask_2 = Uuid::from_u128(0xbbbbbbbb_bbbb_bbbb_bbbb_bbbbbbbbbbbb);

    repo.expect_link_subtasks()
        .withf(move |t, s| {
            *t == task_id && s.len() == 2 && s.contains(&subtask_1) && s.contains(&subtask_2)
        })
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .link_subtasks(task_id, vec![subtask_1, subtask_2])
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_subtasks_clear_all() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);

    repo.expect_link_subtasks()
        .withf(move |t, s| *t == task_id && s.is_empty())
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service.link_subtasks(task_id, vec![]).await.unwrap();
}

#[tokio::test]
async fn test_link_subtasks_error_propagates() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_link_subtasks()
        .returning(|_, _| Box::pin(async { Err(anyhow!("subtask link failed")) }));
    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .link_subtasks(Uuid::nil(), vec![Uuid::nil()])
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "subtask link failed");
}

// ============================================================================
// get_property_value unit tests
// ============================================================================

#[tokio::test]
async fn test_get_property_value_returns_value_when_exists() {
    let mut repo = MockPropertiesRepo::new();

    let prop_id = Uuid::from_u128(0xdeadbeef_dead_beef_dead_beefdeadbeef);

    repo.expect_get_entity_property_value()
        .withf(move |entity_id, entity_type, p| {
            entity_id == "e1" && *entity_type == EntityType::Document && *p == prop_id
        })
        .returning(|_, _, _| Box::pin(async { Ok(Some(PropertyValue::Str("hello".to_string()))) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let result = service
        .get_property_value("e1", EntityType::Document, prop_id)
        .await
        .unwrap();

    assert_eq!(result, Some(PropertyValue::Str("hello".to_string())));
}

#[tokio::test]
async fn test_get_property_value_returns_none_when_not_attached() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Ok(None) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let result = service
        .get_property_value("e1", EntityType::Document, Uuid::nil())
        .await
        .unwrap();

    assert_eq!(result, None);
}

#[tokio::test]
async fn test_get_property_value_error_path() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Err(anyhow!("db error")) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .get_property_value("e1", EntityType::Document, Uuid::nil())
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "db error");
}

// ============================================================================
// get_system_property_value unit tests
// ============================================================================

#[tokio::test]
async fn test_get_system_property_value_returns_value_when_exists() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .withf(|entity_id, entity_type, prop_id| {
            entity_id == "e1"
                && *entity_type == EntityType::Document
                && *prop_id == SystemPropertyKey::STATUS_UUID
        })
        .returning(|_, _, _| {
            Box::pin(async {
                Ok(Some(PropertyValue::SelectOption(vec![
                    StatusOption::COMPLETED_UUID,
                ])))
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let result = service
        .get_system_property_value("e1", EntityType::Document, SystemPropertyKey::Status)
        .await
        .unwrap();

    assert_eq!(
        result,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID
        ]))
    );
}

#[tokio::test]
async fn test_get_system_property_value_returns_none_when_not_attached() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Ok(None) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let result = service
        .get_system_property_value("e1", EntityType::Document, SystemPropertyKey::Status)
        .await
        .unwrap();

    assert_eq!(result, None);
}

#[tokio::test]
async fn test_get_system_property_value_error_path() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Err(anyhow!("db error")) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .get_system_property_value("e1", EntityType::Document, SystemPropertyKey::Status)
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "db error");
}

// ============================================================================
// handle_task_assignee_permissions unit tests
// ============================================================================

#[tokio::test]
async fn test_handle_task_assignee_permissions_grants_permissions() {
    let repo = MockPropertiesRepo::new();
    let mut perm_service = MockPermissionService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let assignee_ids = vec![
        MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap(),
    ];

    perm_service
        .expect_grant_permissions_to_task()
        .withf(move |user_ids, task_id_param| {
            user_ids.len() == 2
                && user_ids
                    .contains(&MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap())
                && user_ids
                    .contains(&MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap())
                && task_id_param == task_id.to_string()
        })
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    service
        .handle_task_assignee_permissions(task_id, &assignee_ids)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_handle_task_assignee_permissions_empty_assignees() {
    let repo = MockPropertiesRepo::new();
    let perm_service = MockPermissionService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    // Should return Ok without calling permission service
    service
        .handle_task_assignee_permissions(task_id, &[])
        .await
        .unwrap();
}

#[tokio::test]
async fn test_handle_task_assignee_permissions_no_service() {
    let repo = MockPropertiesRepo::new();
    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let assignee_ids = vec![MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()];

    let service = PropertiesServiceImpl::new(
        repo,
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );

    let err = service
        .handle_task_assignee_permissions(task_id, &assignee_ids)
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::PermissionDenied
    ));
}

#[tokio::test]
async fn test_handle_task_assignee_permissions_error_propagates() {
    let repo = MockPropertiesRepo::new();
    let mut perm_service = MockPermissionService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let assignee_ids = vec![MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()];

    perm_service
        .expect_grant_permissions_to_task()
        .returning(|_, _| Box::pin(async { Err(anyhow!("permission error")) }));

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    let err = service
        .handle_task_assignee_permissions(task_id, &assignee_ids)
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "permission error");
}

// ============================================================================
// handle_task_assignee_notifications unit tests
// ============================================================================

struct NotificationTestCase {
    task_id: Uuid,
    assigned_by: String,
    assignees: Vec<MacroUserIdStr<'static>>,
    existing_assignees: Vec<String>,
    task_name: Option<String>,
    expected_notification_count: usize,
    expected_recipient_ids: Option<Vec<String>>,
    notification_service_available: bool,
}

async fn check_notifications(test_case: NotificationTestCase) {
    let mut repo = MockPropertiesRepo::new();
    let mut notif_service = MockNotificationService::new();

    let task_id = test_case.task_id;
    let assigned_by = test_case.assigned_by.clone();
    let assignees = test_case.assignees.clone();
    let existing_assignees = test_case.existing_assignees.clone();
    let task_name = test_case.task_name.clone();

    // Mock: get current assignees
    repo.expect_get_entity_property_value()
        .withf(move |entity_id, entity_type, prop_id| {
            entity_id == task_id.to_string()
                && *entity_type == EntityType::Task
                && *prop_id == SystemPropertyKey::ASSIGNEES_UUID
        })
        .returning({
            let existing = existing_assignees.clone();
            move |_, _, _| {
                if existing.is_empty() {
                    Box::pin(async { Ok(None) })
                } else {
                    let refs: Vec<models_properties::shared::EntityReference> = existing
                        .iter()
                        .map(|id| models_properties::shared::EntityReference {
                            entity_type: EntityType::User,
                            entity_id: id.clone(),
                            specific_message_id: None,
                        })
                        .collect();
                    Box::pin(async { Ok(Some(PropertyValue::EntityRef(refs))) })
                }
            }
        });

    // Mock: get task name (only if we expect notifications)
    if test_case.expected_notification_count > 0 {
        let task_id_clone = task_id;
        let task_name_result = task_name.clone();
        repo.expect_get_document_name()
            .withf(move |id| id == task_id_clone.to_string())
            .returning(move |_| {
                let name = task_name_result.clone();
                Box::pin(async move { Ok(name) })
            });
    }

    // Mock: send notifications
    if test_case.notification_service_available && test_case.expected_notification_count > 0 {
        let expected_count = test_case.expected_notification_count;
        let expected_recipients = test_case.expected_recipient_ids.clone();
        notif_service
            .expect_send_notification()
            .times(expected_count)
            .returning(|_| Box::pin(async { Ok(Uuid::new_v4()) }));
    }

    let service = if test_case.notification_service_available {
        PropertiesServiceImpl::new(repo, None::<MockPermissionService>, Some(notif_service))
    } else {
        PropertiesServiceImpl::new(
            repo,
            None::<MockPermissionService>,
            None::<MockNotificationService>,
        )
    };

    service
        .handle_task_assignee_notifications(task_id, &assignees, &assigned_by)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_sends_to_new_assignees_only() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![
            MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user2@macro.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user3@macro.com").unwrap(), // existing, should not get notification
        ],
        existing_assignees: vec!["macro|user3@macro.com".to_string()],
        task_name: Some("Test Task".to_string()),
        expected_notification_count: 2, // user1 and user2, but not user3 (existing) or assigner
        expected_recipient_ids: None,
        notification_service_available: true,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_filters_out_assigner() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![
            MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|assigner@macro.com").unwrap(),
        ],
        existing_assignees: vec![],
        task_name: Some("Test Task".to_string()),
        expected_notification_count: 1, // only user1, not assigner
        expected_recipient_ids: Some(vec!["macro|user1@macro.com".to_string()]),
        notification_service_available: true,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_no_new_assignees() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap()],
        existing_assignees: vec!["macro|user1@macro.com".to_string()],
        task_name: None,                // Should not call get_entity_name
        expected_notification_count: 0, // no new assignees
        expected_recipient_ids: None,
        notification_service_available: true,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_no_service() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "assigner".to_string(),
        assignees: vec![MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap()],
        existing_assignees: vec![],
        task_name: None, // Should not call get_entity_name when no service
        expected_notification_count: 0,
        expected_recipient_ids: None,
        notification_service_available: false,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_empty_assignees() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "assigner".to_string(),
        assignees: vec![],
        existing_assignees: vec![],
        task_name: None, // Should not call get_entity_name
        expected_notification_count: 0,
        expected_recipient_ids: None,
        notification_service_available: true,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_task_name_none() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap()],
        existing_assignees: vec![],
        task_name: None, // task doesn't exist yet
        expected_notification_count: 1,
        expected_recipient_ids: None,
        notification_service_available: true,
    })
    .await;
}

// ============================================================================
// handle_task_assignees_property integration tests
// ============================================================================

#[tokio::test]
async fn test_handle_task_assignees_property_calls_both_handlers() {
    let mut repo = MockPropertiesRepo::new();
    let mut perm_service = MockPermissionService::new();
    let mut notif_service = MockNotificationService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let entity_id = task_id.to_string();
    let assigned_by = "macro|assigner@macro.com".to_string();
    let assignees = [
        MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|user2@macro.com").unwrap(),
    ];

    let value = Some(
        models_properties::api::requests::SetPropertyValue::MultiEntityReference {
            references: assignees
                .iter()
                .map(|id| models_properties::shared::EntityReference {
                    entity_type: EntityType::User,
                    entity_id: id.to_string(),
                    specific_message_id: None,
                })
                .collect(),
        },
    );

    // Mock: no existing assignees
    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Ok(None) }));

    // Mock: get task name
    repo.expect_get_document_name()
        .returning(|_| Box::pin(async { Ok(Some("Test Task".to_string())) }));

    // Mock: permissions should be granted to all assignees
    let entity_id_clone = entity_id.clone();
    perm_service
        .expect_grant_permissions_to_task()
        .times(1)
        .withf(move |user_ids, tid| user_ids.len() == 2 && tid == entity_id_clone)
        .returning(|_, _| Box::pin(async { Ok(()) }));

    // Mock: notifications should be sent
    notif_service
        .expect_send_notification()
        .times(2) // user1 and user2
        .returning(|_| Box::pin(async { Ok(Uuid::new_v4()) }));

    let service = PropertiesServiceImpl::new(repo, Some(perm_service), Some(notif_service));

    service
        .handle_task_assignees_property(&entity_id, value, &assigned_by)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_handle_task_assignees_property_clearing_assignees() {
    let repo = MockPropertiesRepo::new();
    let perm_service = MockPermissionService::new();
    let notif_service = MockNotificationService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let entity_id = task_id.to_string();

    let service = PropertiesServiceImpl::new(repo, Some(perm_service), Some(notif_service));

    // Should return Ok without calling any handlers
    service
        .handle_task_assignees_property(&entity_id, None, "assigner")
        .await
        .unwrap();
}
