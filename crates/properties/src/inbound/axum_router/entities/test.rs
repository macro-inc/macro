use super::*;

fn update(property_id: Uuid, add: usize, remove: usize) -> EntityPropertyOptionUpdateRequest {
    EntityPropertyOptionUpdateRequest {
        property_id,
        add_option_ids: (0..add).map(|_| Uuid::new_v4()).collect(),
        remove_option_ids: (0..remove).map(|_| Uuid::new_v4()).collect(),
    }
}

#[test]
fn validate_bulk_option_request_accepts_distinct_bounded() {
    let request = BulkUpdateEntityPropertyOptionsRequest {
        properties: vec![update(Uuid::new_v4(), 2, 1), update(Uuid::new_v4(), 0, 3)],
    };
    assert!(validate_bulk_option_request(&request).is_ok());
}

#[test]
fn validate_bulk_option_request_rejects_duplicate_property() {
    let property_id = Uuid::new_v4();
    let request = BulkUpdateEntityPropertyOptionsRequest {
        properties: vec![update(property_id, 1, 0), update(property_id, 0, 1)],
    };
    assert!(matches!(
        validate_bulk_option_request(&request),
        Err(BulkUpdateEntityPropertyOptionsErr::DuplicateProperty)
    ));
}

#[test]
fn validate_bulk_option_request_rejects_too_many_properties() {
    let request = BulkUpdateEntityPropertyOptionsRequest {
        properties: (0..=MAX_BULK_OPTION_PROPERTIES)
            .map(|_| update(Uuid::new_v4(), 0, 0))
            .collect(),
    };
    assert!(matches!(
        validate_bulk_option_request(&request),
        Err(BulkUpdateEntityPropertyOptionsErr::TooManyProperties)
    ));
}

#[test]
fn validate_bulk_option_request_rejects_too_many_options() {
    let request = BulkUpdateEntityPropertyOptionsRequest {
        properties: vec![update(Uuid::new_v4(), MAX_OPTION_IDS_PER_PROPERTY + 1, 0)],
    };
    assert!(matches!(
        validate_bulk_option_request(&request),
        Err(BulkUpdateEntityPropertyOptionsErr::TooManyOptions)
    ));
}

fn entity_ref() -> PropertyTargetReference {
    PropertyTargetReference {
        entity_id: Uuid::new_v4().to_string(),
        entity_type: PropertyTargetEntityType::Document,
    }
}

fn entities_request(
    entities: usize,
    add: usize,
    remove: usize,
) -> BulkUpdateEntitiesPropertyOptionsRequest {
    BulkUpdateEntitiesPropertyOptionsRequest {
        entities: (0..entities).map(|_| entity_ref()).collect(),
        property_id: Uuid::new_v4(),
        add_option_ids: (0..add).map(|_| Uuid::new_v4()).collect(),
        remove_option_ids: (0..remove).map(|_| Uuid::new_v4()).collect(),
    }
}

#[test]
fn validate_bulk_entities_option_request_accepts_bounded() {
    let request = entities_request(MAX_BULK_ENTITIES, 3, 2);
    assert!(validate_bulk_entities_option_request(&request).is_ok());
}

#[test]
fn validate_bulk_entities_option_request_rejects_too_many_entities() {
    let request = entities_request(MAX_BULK_ENTITIES + 1, 1, 0);
    assert!(matches!(
        validate_bulk_entities_option_request(&request),
        Err(BulkUpdateEntitiesPropertyOptionsErr::TooManyEntities)
    ));
}

#[test]
fn validate_bulk_entities_option_request_rejects_too_many_options() {
    let request = entities_request(1, MAX_OPTION_IDS_PER_PROPERTY, 1);
    assert!(matches!(
        validate_bulk_entities_option_request(&request),
        Err(BulkUpdateEntitiesPropertyOptionsErr::TooManyOptions)
    ));
}
