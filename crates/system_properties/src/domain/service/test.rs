use super::*;

#[test]
fn initiatives_share_task_property_definitions_and_null_defaults() {
    let task_rows = collect_task_property_rows("task");
    let initiative_rows = collect_required_property_rows("initiative", EntityType::Initiative);

    assert_eq!(initiative_rows.len(), 4);
    for key in [
        SystemPropertyKey::Status,
        SystemPropertyKey::Priority,
        SystemPropertyKey::Assignees,
        SystemPropertyKey::DueDate,
    ] {
        let row = initiative_rows
            .iter()
            .find(|row| row.property_definition_id() == key.uuid())
            .unwrap();
        let task_row = task_rows
            .iter()
            .find(|row| row.property_definition_id() == key.uuid())
            .unwrap();
        assert_eq!(row.entity_id(), "initiative");
        assert_eq!(row.entity_type(), EntityType::Initiative);
        assert_eq!(row.values(), task_row.values());
        assert!(row.values().is_null());
        assert!(SystemPropertyKey::is_required_for_entity(
            key.uuid(),
            EntityType::Initiative
        ));
        assert!(!SystemPropertyKey::is_required_for_entity(
            key.uuid(),
            EntityType::Project
        ));
    }
    assert!(!SystemPropertyKey::is_required_for_entity(
        SystemPropertyKey::PARENT_TASK_UUID,
        EntityType::Initiative,
    ));
}
