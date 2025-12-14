//! Unit tests for PropertiesServiceImpl using mockall-generated repo.

use super::service_impl::PropertiesServiceImpl;
use crate::domain::{ports::MockPropertiesRepo, service::PropertiesService};
use anyhow::anyhow;
use models_properties::{EntityType, service::property_value::PropertyValue};
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

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

    let service = PropertiesServiceImpl::new(repo);

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

    let service = PropertiesServiceImpl::new(repo);

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

    let service = PropertiesServiceImpl::new(repo);

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

    let service = PropertiesServiceImpl::new(repo);

    service.link_parent_task(task_id, None).await.unwrap();
}

#[tokio::test]
async fn test_link_parent_task_error_propagates() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_link_parent_task()
        .returning(|_, _| Box::pin(async { Err(anyhow!("link failed")) }));

    let service = PropertiesServiceImpl::new(repo);

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

    let service = PropertiesServiceImpl::new(repo);

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

    let service = PropertiesServiceImpl::new(repo);

    service.link_subtasks(task_id, vec![]).await.unwrap();
}

#[tokio::test]
async fn test_link_subtasks_error_propagates() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_link_subtasks()
        .returning(|_, _| Box::pin(async { Err(anyhow!("subtask link failed")) }));

    let service = PropertiesServiceImpl::new(repo);

    let err = service
        .link_subtasks(Uuid::nil(), vec![Uuid::nil()])
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "subtask link failed");
}
