//! Unit tests for PropertiesServiceImpl using mockall-generated repo.

use super::service_impl::PropertiesServiceImpl;
use crate::domain::{ports::MockPropertiesRepo, service::PropertiesService};
use anyhow::anyhow;
use models_properties::{EntityType, service::property_value::PropertyValue};
use system_properties::{StatusOption, SystemPropertyKey};

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
