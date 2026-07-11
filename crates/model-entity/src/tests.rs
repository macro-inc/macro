use crate::EntityType;

#[test]
fn it_should_build_entity_from_type() {
    let entity = EntityType::Document.with_entity_str("my_entity_id");
    assert_eq!(entity.entity_id, "my_entity_id");
    assert_eq!(entity.entity_type, EntityType::Document);
}
