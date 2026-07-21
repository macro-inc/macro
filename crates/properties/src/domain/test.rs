//! Unit tests for PropertiesServiceImpl using mockall-generated repo.

use super::service_impl::PropertiesServiceImpl;
use crate::domain::model::{
    EditReceipt, PropertyAccessReceiptExt, ViewReceipt, canonical_entity_type,
};
use crate::domain::{
    ports::{MockNotificationService, MockPermissionService, MockPropertiesRepo},
    service::PropertiesService,
};
use anyhow::anyhow;
use document_sub_type::DocumentSubType;
use entity_access::domain::models::{
    AccessLevel, BotId, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
    EntityType as AccessEntityType, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::{
    EntityType,
    service::{
        entity_property::EntityProperty, property_definition::PropertyDefinition,
        property_value::PropertyValue,
    },
};
use std::collections::HashMap;
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

fn entity_property(
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
) -> EntityProperty {
    EntityProperty {
        id: Uuid::new_v4(),
        entity_id: entity_id.to_owned(),
        entity_type,
        property_definition_id,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

fn caller_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()
}

/// An edit receipt for the test caller, minted without an access check.
fn edit_receipt(entity_id: &str, entity_type: EntityType) -> EditReceipt {
    EditReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        entity_id,
        canonical_entity_type(entity_type),
    )
}

/// A view receipt for the test caller, minted without an access check.
fn view_receipt(entity_id: &str, entity_type: EntityType) -> ViewReceipt {
    ViewReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        entity_id,
        canonical_entity_type(entity_type),
    )
}

#[test]
fn bot_receipt_has_no_authenticated_user_identity() {
    let bot_id = BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000000123"));
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_bot(
        bot_id.into_storage_id(),
        "document-1",
        entity_access::domain::models::EntityType::Document,
    );
    let access = receipt;

    assert!(access.authenticated_user().is_none());
    assert!(matches!(access.auth(), EntityAccessAuth::Bot(id) if id.bot_id() == bot_id));
}

/// Creates a mock permission service that mints edit receipts for any entity.
fn create_mock_permission_service() -> MockPermissionService {
    let mut perm_checker = MockPermissionService::new();
    perm_checker
        .expect_mint_edit_receipt()
        .returning(|_, entity_id, entity_type| {
            let receipt = EditReceipt::dangerously_assert_authenticated_user(
                caller_user_id(),
                entity_id,
                entity_type,
            );
            Box::pin(async move { Ok(receipt) })
        });
    perm_checker
}

#[tokio::test]
async fn test_set_status_complete_through_general_property_mutation() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_property_definition().returning(|_| {
        Box::pin(async {
            Ok(Some(PropertyDefinition {
                id: SystemPropertyKey::STATUS_UUID,
                owner: models_properties::PropertyOwner::System,
                display_name: "Status".to_string(),
                data_type: models_properties::DataType::SelectString,
                is_multi_select: false,
                specific_entity_type: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                is_system: true,
                is_metadata: false,
            }))
        })
    });
    repo.expect_count_valid_property_options()
        .withf(|property_id, option_ids| {
            *property_id == SystemPropertyKey::STATUS_UUID
                && option_ids == [StatusOption::COMPLETED_UUID]
        })
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_upsert_entity_property()
        .withf(|entity_id, entity_type, property_id, value| {
            entity_id == "e1"
                && *entity_type == EntityType::Document
                && *property_id == SystemPropertyKey::STATUS_UUID
                && *value
                    == Some(PropertyValue::SelectOption(vec![
                        StatusOption::COMPLETED_UUID,
                    ]))
        })
        .returning(|entity_id, entity_type, property_definition_id, _| {
            let property = entity_property(entity_id, entity_type, property_definition_id);
            Box::pin(async move { Ok(property) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let property = service
        .set_entity_property(
            &edit_receipt("e1", EntityType::Document),
            SystemPropertyKey::STATUS_UUID,
            Some(
                models_properties::api::requests::SetPropertyValue::SelectOption {
                    option_id: StatusOption::COMPLETED_UUID,
                },
            ),
        )
        .await
        .unwrap();

    assert_eq!(property.property.entity_id, "e1");
    assert_eq!(
        property.property.property_definition_id,
        SystemPropertyKey::STATUS_UUID
    );
    assert_eq!(
        property.value,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID
        ]))
    );
}

// ============================================================================
// task relationship (Parent Task / Subtasks) unit tests
// ============================================================================

fn parent_task_value(parent_id: Uuid) -> models_properties::api::requests::SetPropertyValue {
    models_properties::api::requests::SetPropertyValue::EntityReference {
        reference: models_properties::shared::EntityReference {
            entity_type: EntityType::Task,
            entity_id: parent_id.to_string(),
            specific_message_id: None,
        },
    }
}

fn subtasks_value(subtask_ids: &[Uuid]) -> models_properties::api::requests::SetPropertyValue {
    models_properties::api::requests::SetPropertyValue::MultiEntityReference {
        references: subtask_ids
            .iter()
            .map(|id| models_properties::shared::EntityReference {
                entity_type: EntityType::Task,
                entity_id: id.to_string(),
                specific_message_id: None,
            })
            .collect(),
    }
}

#[tokio::test]
async fn test_link_parent_task_delegates_to_repo() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let parent_id = Uuid::from_u128(0xabcdef01_2345_6789_abcd_ef0123456789);

    repo.expect_link_parent_task()
        .withf(move |t, p| *t == task_id && *p == Some(parent_id))
        .returning(|task_id, _| {
            let property = entity_property(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::PARENT_TASK_UUID,
            );
            Box::pin(async move { Ok(Some(property)) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(parent_id)),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_parent_task_clear_parent() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);

    repo.expect_link_parent_task()
        .withf(move |t, p| *t == task_id && p.is_none())
        .returning(|task_id, _| {
            let property = entity_property(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::PARENT_TASK_UUID,
            );
            Box::pin(async move { Ok(Some(property)) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            None,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_parent_task_requires_edit_on_parent() {
    // Linking mutates the parent's Subtasks property, so edit access to the
    // parent is required: a failed mint on the parent must deny the link and
    // never touch the repo.
    let mut repo = MockPropertiesRepo::new();
    repo.expect_link_parent_task().times(0);

    let mut perm_service = MockPermissionService::new();
    perm_service
        .expect_mint_edit_receipt()
        .returning(|_, _, _| Box::pin(async { Err(anyhow!("Access denied")) }));

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let err = service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(Uuid::from_u128(0xF00D))),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::PermissionDenied
    ));
}

#[tokio::test]
async fn test_link_parent_task_rejects_bot_and_unauthenticated_callers() {
    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let bot_id = BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000000123"));
    let bot_access = EditReceipt::dangerously_assert_bot(
        bot_id.into_storage_id(),
        &task_id.to_string(),
        AccessEntityType::Document,
    );
    let unauthenticated_access = EditReceipt::try_new(
        EntityAccessAuth::Unauthenticated,
        Entity {
            entity_id: task_id.to_string(),
            entity_type: AccessEntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();

    for access in [bot_access, unauthenticated_access] {
        let mut repo = MockPropertiesRepo::new();
        repo.expect_link_parent_task().times(0);
        let service = PropertiesServiceImpl::new(
            repo,
            None::<MockPermissionService>,
            None::<MockNotificationService>,
        );

        let err = service
            .handle_task_relationship_property(
                &access,
                SystemPropertyKey::PARENT_TASK_UUID,
                Some(parent_task_value(Uuid::from_u128(0xF00D))),
            )
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            crate::domain::error::PropertiesErr::PermissionDenied
        ));
    }
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
        .handle_task_relationship_property(
            &edit_receipt(&Uuid::nil().to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(Uuid::nil())),
        )
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "link failed");
}

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
        .returning(|task_id, _| {
            let property = entity_property(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::SUBTASKS_UUID,
            );
            Box::pin(async move { Ok(Some(property)) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::SUBTASKS_UUID,
            Some(subtasks_value(&[subtask_1, subtask_2])),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_subtasks_clear_all() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);

    repo.expect_link_subtasks()
        .withf(move |t, s| *t == task_id && s.is_empty())
        .returning(|task_id, _| {
            let property = entity_property(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::SUBTASKS_UUID,
            );
            Box::pin(async move { Ok(Some(property)) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::SUBTASKS_UUID,
            None,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_subtasks_requires_edit_on_subtasks() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_link_subtasks().times(0);

    let mut perm_service = MockPermissionService::new();
    perm_service
        .expect_mint_edit_receipt()
        .returning(|_, _, _| Box::pin(async { Err(anyhow!("Access denied")) }));

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let err = service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::SUBTASKS_UUID,
            Some(subtasks_value(&[Uuid::from_u128(0xF00D)])),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::PermissionDenied
    ));
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
        .handle_task_relationship_property(
            &edit_receipt(&Uuid::nil().to_string(), EntityType::Task),
            SystemPropertyKey::SUBTASKS_UUID,
            Some(subtasks_value(&[Uuid::nil()])),
        )
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
        .get_property_value(&view_receipt("e1", EntityType::Document), prop_id)
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
        .get_property_value(&view_receipt("e1", EntityType::Document), Uuid::nil())
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
        .get_property_value(&view_receipt("e1", EntityType::Document), Uuid::nil())
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
        .get_system_property_value(
            &view_receipt("e1", EntityType::Document),
            SystemPropertyKey::Status,
        )
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
        .get_system_property_value(
            &view_receipt("e1", EntityType::Document),
            SystemPropertyKey::Status,
        )
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
        .get_system_property_value(
            &view_receipt("e1", EntityType::Document),
            SystemPropertyKey::Status,
        )
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "db error");
}

// ============================================================================
// delete_entity_property unit tests
// ============================================================================

#[tokio::test]
async fn test_delete_entity_property_rejects_receipt_for_other_entity() {
    let mut repo = MockPropertiesRepo::new();
    let entity_property_id = Uuid::from_u128(0xC3);

    repo.expect_lookup_entity_property().returning(move |_| {
        Box::pin(async move {
            Ok(Some(models_properties::EntityPropertyReference {
                entity_id: "other-entity".to_string(),
                entity_type: EntityType::Document,
                property_definition_id: Uuid::from_u128(0xA1),
            }))
        })
    });
    repo.expect_delete_entity_property().times(0);

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .delete_entity_property(
            &edit_receipt("doc1", EntityType::Document),
            entity_property_id,
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::PermissionDenied
    ));
}

#[tokio::test]
async fn test_delete_entity_property_happy_path() {
    let mut repo = MockPropertiesRepo::new();
    let entity_property_id = Uuid::from_u128(0xC3);

    repo.expect_lookup_entity_property().returning(move |_| {
        Box::pin(async move {
            Ok(Some(models_properties::EntityPropertyReference {
                entity_id: "doc1".to_string(),
                entity_type: EntityType::Document,
                property_definition_id: Uuid::from_u128(0xA1),
            }))
        })
    });
    repo.expect_delete_entity_property()
        .withf(move |id| *id == entity_property_id)
        .returning(|_| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .delete_entity_property(
            &edit_receipt("doc1", EntityType::Document),
            entity_property_id,
        )
        .await
        .unwrap();
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
        crate::domain::error::PropertiesErr::PermissionServiceNotConfigured
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

    // Mock: send notifications (one batched call covering all new assignees)
    if test_case.notification_service_available && test_case.expected_notification_count > 0 {
        let expected_count = test_case.expected_notification_count;
        let expected_recipients = test_case.expected_recipient_ids.clone();
        let expected_assigned_by = assigned_by.clone();
        notif_service
            .expect_send_task_assigned()
            .times(1)
            .withf(move |notification| {
                notification.task_id == task_id
                    && notification.assigned_by.as_ref() == expected_assigned_by.as_str()
                    && notification.recipient_ids.len() == expected_count
                    && expected_recipients.as_ref().is_none_or(|expected| {
                        expected.iter().all(|id| {
                            notification
                                .recipient_ids
                                .iter()
                                .any(|r| r.as_ref() == id.as_str())
                        })
                    })
            })
            .returning(|_| Box::pin(async { Ok(()) }));
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

    let assigned_by = MacroUserIdStr::parse_from_str(&assigned_by).unwrap();
    service
        .handle_task_assignee_notifications(task_id, &assignees, Some(&assigned_by))
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
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap()],
        existing_assignees: vec![],
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
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![],
        existing_assignees: vec![],
        expected_notification_count: 0,
        expected_recipient_ids: None,
        notification_service_available: true,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_internal_write_skips() {
    // Internal (machine) writes have no assigning user and must not notify.
    let repo = MockPropertiesRepo::new();
    let mut notif_service = MockNotificationService::new();
    notif_service.expect_send_task_assigned().times(0);

    let service =
        PropertiesServiceImpl::new(repo, None::<MockPermissionService>, Some(notif_service));

    service
        .handle_task_assignee_notifications(
            Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
            &[MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap()],
            None,
        )
        .await
        .unwrap();
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

    // Mock: permissions should be granted to all assignees
    let entity_id_clone = entity_id.clone();
    perm_service
        .expect_grant_permissions_to_task()
        .times(1)
        .withf(move |user_ids, tid| user_ids.len() == 2 && tid == entity_id_clone)
        .returning(|_, _| Box::pin(async { Ok(()) }));

    // Mock: notifications should be sent to both new assignees in one batch
    notif_service
        .expect_send_task_assigned()
        .times(1)
        .withf(|notification| notification.recipient_ids.len() == 2)
        .returning(|_| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(repo, Some(perm_service), Some(notif_service));

    let assigned_by = MacroUserIdStr::parse_from_str(&assigned_by).unwrap();
    service
        .handle_task_assignees_property(&entity_id, value, Some(&assigned_by))
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
        .handle_task_assignees_property(
            &entity_id,
            None,
            Some(&MacroUserIdStr::parse_from_str("macro|assigner@macro.com").unwrap()),
        )
        .await
        .unwrap();
}

// ============================================================================
// add/remove_entity_property_option unit tests
// ============================================================================

fn multi_select_definition(id: Uuid, is_multi_select: bool) -> PropertyDefinition {
    PropertyDefinition {
        id,
        owner: models_properties::PropertyOwner::System,
        display_name: "Tags".to_string(),
        data_type: models_properties::DataType::SelectString,
        is_multi_select,
        specific_entity_type: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        is_system: false,
        is_metadata: false,
    }
}

#[tokio::test]
async fn test_add_entity_property_option_happy_path() {
    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);
    let option_id = Uuid::from_u128(0xB2);

    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_add_entity_property_option()
        .withf(move |entity_id, entity_type, prop, opt| {
            entity_id == "doc1"
                && *entity_type == EntityType::Document
                && *prop == def_id
                && *opt == option_id
        })
        .returning(|_, _, _, _| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .add_entity_property_option(
            &edit_receipt("doc1", EntityType::Document),
            def_id,
            option_id,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_add_entity_property_option_rejects_single_select() {
    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);

    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, false))) })
    });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .add_entity_property_option(
            &edit_receipt("doc1", EntityType::Document),
            def_id,
            Uuid::from_u128(0xB2),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::Validation(_)
    ));
}

#[tokio::test]
async fn test_add_entity_property_option_rejects_invalid_option() {
    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);

    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    // Option does not belong to the property.
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(0) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .add_entity_property_option(
            &edit_receipt("doc1", EntityType::Document),
            def_id,
            Uuid::from_u128(0xB2),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::Validation(_)
    ));
}

#[tokio::test]
async fn test_remove_entity_property_option_happy_path() {
    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);
    let option_id = Uuid::from_u128(0xB2);

    repo.expect_remove_entity_property_option()
        .withf(move |entity_id, entity_type, prop, opt| {
            entity_id == "doc1"
                && *entity_type == EntityType::Document
                && *prop == def_id
                && *opt == option_id
        })
        .returning(|_, _, _, _| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .remove_entity_property_option(
            &edit_receipt("doc1", EntityType::Document),
            def_id,
            option_id,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn canonical_document_task_write_uses_task_storage_type() {
    let task_id = Uuid::from_u128(0xA11CE);
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .returning(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
    repo.expect_get_property_definition().returning(|_| {
        Box::pin(async {
            Ok(Some(PropertyDefinition {
                id: SystemPropertyKey::STATUS_UUID,
                owner: models_properties::PropertyOwner::System,
                display_name: "Status".to_string(),
                data_type: models_properties::DataType::SelectString,
                is_multi_select: false,
                specific_entity_type: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                is_system: true,
                is_metadata: false,
            }))
        })
    });
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_upsert_entity_property()
        .withf(move |entity_id, entity_type, property_id, _| {
            entity_id == task_id.to_string()
                && *entity_type == EntityType::Task
                && *property_id == SystemPropertyKey::STATUS_UUID
        })
        .returning(|entity_id, entity_type, property_definition_id, _| {
            let property = entity_property(entity_id, entity_type, property_definition_id);
            Box::pin(async move { Ok(property) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );
    let receipt = EditReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        &task_id.to_string(),
        AccessEntityType::Document,
    );

    let property = service
        .set_entity_property(
            &receipt,
            SystemPropertyKey::STATUS_UUID,
            Some(
                models_properties::api::requests::SetPropertyValue::SelectOption {
                    option_id: StatusOption::COMPLETED_UUID,
                },
            ),
        )
        .await
        .unwrap();

    assert_eq!(property.property.entity_type, EntityType::Task);
}

#[tokio::test]
async fn canonical_document_task_assignee_write_grants_permissions() {
    let task_id = Uuid::from_u128(0xA5516E);
    let assignee = MacroUserIdStr::parse_from_str("macro|assignee@test.com").unwrap();
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .returning(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
    repo.expect_get_property_definition().returning(|_| {
        Box::pin(async {
            Ok(Some(PropertyDefinition {
                id: SystemPropertyKey::ASSIGNEES_UUID,
                owner: models_properties::PropertyOwner::System,
                display_name: "Assignees".to_string(),
                data_type: models_properties::DataType::Entity,
                is_multi_select: true,
                specific_entity_type: Some(EntityType::User),
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                is_system: true,
                is_metadata: false,
            }))
        })
    });
    repo.expect_upsert_entity_property()
        .withf(move |entity_id, entity_type, property_id, _| {
            entity_id == task_id.to_string()
                && *entity_type == EntityType::Task
                && *property_id == SystemPropertyKey::ASSIGNEES_UUID
        })
        .returning(|entity_id, entity_type, property_definition_id, _| {
            let property = entity_property(entity_id, entity_type, property_definition_id);
            Box::pin(async move { Ok(property) })
        });

    let mut permission_service = MockPermissionService::new();
    let expected_assignee = assignee.clone();
    permission_service
        .expect_grant_permissions_to_task()
        .withf(move |user_ids, id| {
            user_ids == [expected_assignee.clone()] && id == task_id.to_string()
        })
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let service = PropertiesServiceImpl::new(
        repo,
        Some(permission_service),
        None::<MockNotificationService>,
    );
    let receipt = EditReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        &task_id.to_string(),
        AccessEntityType::Document,
    );

    service
        .set_entity_property(
            &receipt,
            SystemPropertyKey::ASSIGNEES_UUID,
            Some(
                models_properties::api::requests::SetPropertyValue::MultiEntityReference {
                    references: vec![models_properties::EntityReference::new(
                        assignee.as_ref(),
                        EntityType::User,
                    )],
                },
            ),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn canonical_document_task_read_uses_task_storage_type() {
    let task_id = Uuid::from_u128(0xBEEF);
    let property_id = Uuid::from_u128(0xCAFE);
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .returning(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
    repo.expect_get_entity_property_value()
        .withf(move |entity_id, entity_type, id| {
            entity_id == task_id.to_string()
                && *entity_type == EntityType::Task
                && *id == property_id
        })
        .returning(|_, _, _| Box::pin(async { Ok(Some(PropertyValue::Str("value".into()))) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );
    let receipt = ViewReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        &task_id.to_string(),
        AccessEntityType::Document,
    );

    assert_eq!(
        service
            .get_property_value(&receipt, property_id)
            .await
            .unwrap(),
        Some(PropertyValue::Str("value".into()))
    );
}

#[tokio::test]
async fn mixed_document_bulk_read_batches_subtypes_and_returns_canonical_keys() {
    let task_id = Uuid::from_u128(0x1001);
    let snippet_id = Uuid::from_u128(0x1002);
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_document_sub_types()
        .times(1)
        .withf(move |ids| ids.len() == 2 && ids.contains(&task_id) && ids.contains(&snippet_id))
        .returning(move |_| {
            Box::pin(async move {
                Ok(HashMap::from([
                    (task_id, DocumentSubType::Task),
                    (snippet_id, DocumentSubType::Snippet),
                ]))
            })
        });
    repo.expect_get_entity_properties_batch()
        .withf(move |references| {
            references.len() == 2
                && references.iter().any(|reference| {
                    reference.entity_id == task_id.to_string()
                        && reference.entity_type == EntityType::Task
                })
                && references.iter().any(|reference| {
                    reference.entity_id == snippet_id.to_string()
                        && reference.entity_type == EntityType::Document
                })
        })
        .returning(|references| {
            Box::pin(async move {
                Ok(references
                    .iter()
                    .map(|reference| {
                        (
                            crate::domain::model::EntityPropertiesKey::from(reference),
                            Vec::new(),
                        )
                    })
                    .collect())
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );
    let receipts = [
        ViewReceipt::dangerously_assert_authenticated_user(
            caller_user_id(),
            &task_id.to_string(),
            AccessEntityType::Document,
        ),
        ViewReceipt::dangerously_assert_authenticated_user(
            caller_user_id(),
            &snippet_id.to_string(),
            AccessEntityType::Document,
        ),
    ];

    let result = service
        .get_bulk_entity_properties(&receipts, Vec::new())
        .await
        .unwrap();

    assert!(
        result
            .keys()
            .all(|key| key.entity_type == AccessEntityType::Document)
    );
    assert!(
        result.contains_key(&crate::domain::model::PropertyTargetKey {
            entity_id: task_id.to_string(),
            entity_type: AccessEntityType::Document,
        })
    );
    assert!(
        result.contains_key(&crate::domain::model::PropertyTargetKey {
            entity_id: snippet_id.to_string(),
            entity_type: AccessEntityType::Document,
        })
    );
}
