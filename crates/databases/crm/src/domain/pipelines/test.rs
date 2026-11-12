use super::*;
use properties_types::DataType;

#[test]
fn creation_is_private_unless_requested_otherwise() {
    let input: CreatePipeline = serde_json::from_value(serde_json::json!({
        "name": "Renewals", "recordType": "company"
    }))
    .unwrap();
    assert_eq!(input.sharing, PipelineSharing::Private);
    assert_eq!(input.record_type, Some(PipelineRecordType::Company));
    assert_eq!(
        PipelineRecordType::Company.property_type(),
        PropertyEntityType::Company
    );
    assert_eq!(
        PipelineRecordType::Contact.property_type(),
        PropertyEntityType::Contact
    );
}

#[test]
fn a_pipeline_without_a_record_type_starts_like_a_new_database() {
    let input: CreatePipeline = serde_json::from_value(serde_json::json!({
        "name": "Hiring"
    }))
    .unwrap();
    let creator = MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap();
    let blueprint = pipeline_blueprint(Uuid::nil(), creator, input, vec!["Lead".to_owned()]);
    assert_eq!(blueprint.record_type, None);
    let [name] = blueprint.database.columns.as_slice() else {
        panic!("a generic pipeline starts with one column");
    };
    assert_eq!(name.id, blueprint.primary_column_id);
    assert_eq!(name.name, "Name");
    assert_eq!(name.data_type, DataType::String);
    assert_eq!(name.entity_type, None);
    assert!(name.nullable);
    assert!(name.protections.is_empty());
}

#[test]
fn names_are_trimmed_and_limited_by_characters() {
    assert_eq!(name("  Renewals  ").unwrap(), "Renewals");
    assert!(name(" \n ").is_err());
    assert!(name(&"あ".repeat(200)).is_ok());
    assert!(name(&"あ".repeat(201)).is_err());
}

#[test]
fn an_insert_with_client_row_ids_still_names_its_primary_records() {
    use databases_types::{
        CellValue, CellWrite, DatabaseOp, EntityKind, EntityRef, RowId, RowsChange,
    };

    let record = Uuid::parse_str("01900000-0000-7000-8000-0000000000aa").unwrap();
    let pipeline = Pipeline {
        id: Uuid::nil(),
        team_id: Uuid::nil(),
        user_id: "macro|owner@example.com".to_owned(),
        name: "Renewals".to_owned(),
        record_type: Some(PipelineRecordType::Company),
        database_id: DatabaseId::from_uuid(Uuid::nil()),
        table_id: TableId::from_uuid(Uuid::from_u128(1)),
        primary_column_id: ColumnId::from_uuid(Uuid::from_u128(2)),
        sharing: PipelineSharing::Private,
        created_at: DateTime::<Utc>::UNIX_EPOCH,
        trashed_at: None,
    };
    let batch = OpBatch {
        ops: vec![DatabaseOp::Rows {
            table: TableId::from_uuid(Uuid::from_u128(1)),
            change: RowsChange::Insert {
                rows: vec![vec![CellWrite {
                    column: ColumnId::from_uuid(Uuid::from_u128(2)),
                    value: CellValue::Entities(vec![EntityRef {
                        entity_type: EntityKind::Company,
                        entity_id: record.to_string(),
                    }]),
                }]],
                ids: Some(vec![RowId::from_uuid(Uuid::from_u128(3))]),
            },
        }],
        base_versions: HashMap::new(),
    };

    let references = primary_references(&pipeline, PipelineRecordType::Company, &batch).unwrap();

    assert_eq!(references, std::collections::BTreeSet::from([record]));
}
