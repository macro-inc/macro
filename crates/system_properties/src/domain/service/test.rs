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

#[test]
fn crm_record_rows_reference_companies_and_contacts() {
    let company_id = uuid::Uuid::from_u128(1);
    let contact_id = uuid::Uuid::from_u128(2);
    let rows = collect_crm_record_rows(CrmRecordLink {
        entity_id: "call".to_string(),
        entity_type: EntityType::CallRecord,
        company_ids: vec![company_id],
        contact_ids: vec![contact_id],
    });

    assert_eq!(rows.len(), 2);
    let companies = &rows[0];
    assert_eq!(companies.entity_id(), "call");
    assert_eq!(companies.entity_type(), EntityType::CallRecord);
    assert_eq!(
        companies.property_definition_id(),
        SystemPropertyKey::COMPANIES_UUID
    );
    assert_eq!(
        companies.values(),
        &serde_json::json!({
            "type": "EntityReference",
            "value": [{ "entity_type": "COMPANY", "entity_id": company_id.to_string() }]
        })
    );
    let contacts = &rows[1];
    assert_eq!(
        contacts.property_definition_id(),
        SystemPropertyKey::CONTACTS_UUID
    );
    assert_eq!(
        contacts.values(),
        &serde_json::json!({
            "type": "EntityReference",
            "value": [{ "entity_type": "CONTACT", "entity_id": contact_id.to_string() }]
        })
    );
}

#[test]
fn crm_record_rows_skip_empty_lists() {
    let rows = collect_crm_record_rows(CrmRecordLink {
        entity_id: "task".to_string(),
        entity_type: EntityType::Task,
        company_ids: vec![uuid::Uuid::from_u128(1)],
        contact_ids: Vec::new(),
    });

    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].property_definition_id(),
        SystemPropertyKey::COMPANIES_UUID
    );
}
