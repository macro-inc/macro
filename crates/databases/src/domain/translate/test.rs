use std::collections::HashMap;

use chrono::Utc;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::shared::{EntityType as PropertyEntityType, PropertyOwner};
use uuid::Uuid;

use super::*;
use crate::domain::catalog::build_user_tables;
use crate::domain::models::{AccessGrant, Column, ColumnConfig, Table, TableVersion};

fn def(name: &str, data_type: DataType, multi: bool) -> PropertyDefinitionWithOptions {
    PropertyDefinitionWithOptions {
        definition: PropertyDefinition {
            id: Uuid::new_v4(),
            owner: PropertyOwner::System,
            display_name: name.to_string(),
            data_type,
            is_multi_select: multi,
            specific_entity_type: (data_type == DataType::Entity)
                .then_some(PropertyEntityType::User),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            is_system: false,
            is_metadata: false,
        },
        property_options: vec![],
    }
}

struct Fixture {
    entries: Vec<TableEntry>,
    status: PropertyDefinitionWithOptions,
    notes: PropertyDefinitionWithOptions,
    tags: PropertyDefinitionWithOptions,
    link_column: Uuid,
}

fn fixture(grant: AccessGrant) -> Fixture {
    let db = Uuid::new_v4();
    let table = Table {
        id: Uuid::new_v4(),
        database_id: db,
        name: "Guests".into(),
        position: "0".into(),
        version: TableVersion(0),
    };
    let mut status = def("Status", DataType::SelectString, false);
    status.property_options = ["Going", "Declined"]
        .iter()
        .map(|v| PropertyOption {
            id: Uuid::new_v4(),
            property_definition_id: status.definition.id,
            display_order: 0,
            value: PropertyOptionValue::String(v.to_string()),
            color: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
        .collect();
    let notes = def("Notes", DataType::String, false);
    let mut tags = def("Tags", DataType::Tag, true);
    tags.property_options = vec![PropertyOption {
        id: Uuid::new_v4(),
        property_definition_id: tags.definition.id,
        display_order: 0,
        value: PropertyOptionValue::String("vip".into()),
        color: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }];
    let when = def("When", DataType::Date, false);
    let sessions = def("Sessions", DataType::Entity, false);
    let link_column = Uuid::new_v4();
    let columns = vec![
        Column {
            id: Uuid::new_v4(),
            table_id: table.id,
            property_definition_id: status.definition.id,
            position: "0".into(),
            config: None,
        },
        Column {
            id: Uuid::new_v4(),
            table_id: table.id,
            property_definition_id: notes.definition.id,
            position: "1".into(),
            config: None,
        },
        Column {
            id: Uuid::new_v4(),
            table_id: table.id,
            property_definition_id: tags.definition.id,
            position: "2".into(),
            config: None,
        },
        Column {
            id: Uuid::new_v4(),
            table_id: table.id,
            property_definition_id: when.definition.id,
            position: "3".into(),
            config: None,
        },
        Column {
            id: link_column,
            table_id: table.id,
            property_definition_id: sessions.definition.id,
            position: "4".into(),
            config: Some(ColumnConfig::Link {
                database_id: db,
                table_id: Uuid::new_v4(),
            }),
        },
    ];
    let defs: HashMap<_, _> = [&status, &notes, &tags, &when, &sessions]
        .into_iter()
        .map(|d| (d.definition.id, d.clone()))
        .collect();
    let grants = HashMap::from([(db, grant)]);
    Fixture {
        entries: build_user_tables(&[table], &columns, &defs, &grants),
        status,
        notes,
        tags,
        link_column,
    }
}

fn change(
    table: &str,
    op: RawOp,
    pk: &[(&str, SqlValue)],
    new: &[(&str, SqlValue)],
) -> RawRowChange {
    RawRowChange {
        table: table.into(),
        op,
        primary_key: pk.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
        new_values: new
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    }
}

fn t(s: &str) -> SqlValue {
    SqlValue::Text(s.into())
}

#[test]
fn insert_translates_display_values_to_typed_cells() {
    let f = fixture(AccessGrant::Edit);
    let changes = translate(
        vec![change(
            "guests",
            RawOp::Insert,
            &[("row_id", t("abc"))],
            &[
                ("row_id", t("abc")),
                ("status", t("Going")),
                ("notes", t("hello")),
                ("tags", t("[\"vip\"]")),
                ("when", t("2026-09-18")),
                ("sessions", SqlValue::Null),
            ],
        )],
        &f.entries,
    )
    .unwrap();
    let RowChange::Insert { table_id, cells } = &changes[0] else {
        panic!("insert")
    };
    assert_eq!(*table_id, f.entries[0].table.id);
    assert_eq!(
        cells.len(),
        4,
        "NULL cells are not written on insert: {cells:?}"
    );
    assert_eq!(
        cells[&f.status.definition.id],
        SetPropertyValue::SelectOption {
            option_id: f.status.property_options[0].id
        }
    );
    assert_eq!(
        cells[&f.notes.definition.id],
        SetPropertyValue::String {
            value: "hello".into()
        }
    );
    assert_eq!(
        cells[&f.tags.definition.id],
        SetPropertyValue::MultiSelectOption {
            option_ids: vec![f.tags.property_options[0].id]
        }
    );
}

#[test]
fn update_clears_with_null_and_rejects_unknown_options() {
    let f = fixture(AccessGrant::Edit);
    let row = Uuid::new_v4();
    let changes = translate(
        vec![change(
            "guests",
            RawOp::Update,
            &[("row_id", t(&row.to_string()))],
            &[("notes", SqlValue::Null), ("status", t("Declined"))],
        )],
        &f.entries,
    )
    .unwrap();
    let RowChange::Update { row_id, cells, .. } = &changes[0] else {
        panic!("update")
    };
    assert_eq!(*row_id, row);
    assert_eq!(cells[&f.notes.definition.id], None);
    assert!(cells[&f.status.definition.id].is_some());

    let err = translate(
        vec![change(
            "guests",
            RawOp::Update,
            &[("row_id", t(&row.to_string()))],
            &[("status", t("Maybe"))],
        )],
        &f.entries,
    )
    .unwrap_err();
    assert!(matches!(err, QueryError::UntranslatableChange(msg) if msg.contains("not an option")));
}

#[test]
fn junction_rows_become_links_and_mirrors_are_read_only() {
    let f = fixture(AccessGrant::Edit);
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let changes = translate(
        vec![
            change(
                "guests__sessions",
                RawOp::Insert,
                &[
                    ("row_id", t(&a.to_string())),
                    ("linked_id", t(&b.to_string())),
                ],
                &[],
            ),
            change(
                "guests__sessions",
                RawOp::Delete,
                &[
                    ("row_id", t(&a.to_string())),
                    ("linked_id", t(&b.to_string())),
                ],
                &[],
            ),
        ],
        &f.entries,
    )
    .unwrap();
    assert_eq!(
        changes[0],
        RowChange::Link {
            column_id: f.link_column,
            source_row_id: a,
            target_row_id: b
        }
    );
    assert_eq!(
        changes[1],
        RowChange::Unlink {
            column_id: f.link_column,
            source_row_id: a,
            target_row_id: b
        }
    );

    let err = translate(
        vec![change(
            "guests__tags",
            RawOp::Insert,
            &[("row_id", t(&a.to_string())), ("linked_id", t("vip"))],
            &[],
        )],
        &f.entries,
    )
    .unwrap_err();
    assert!(matches!(err, QueryError::ReadOnly(_)), "{err:?}");
}

#[test]
fn links_to_freshly_inserted_rows_are_refused_clearly() {
    let f = fixture(AccessGrant::Edit);
    let err = translate(
        vec![change(
            "guests__sessions",
            RawOp::Insert,
            &[
                ("row_id", t("deadbeef")),
                ("linked_id", t(&Uuid::new_v4().to_string())),
            ],
            &[],
        )],
        &f.entries,
    )
    .unwrap_err();
    assert!(matches!(err, QueryError::UntranslatableChange(msg) if msg.contains("same statement")));
}

#[test]
fn view_grant_cannot_write_and_link_cells_are_read_only() {
    let f = fixture(AccessGrant::View);
    let err = translate(
        vec![change(
            "guests",
            RawOp::Update,
            &[("row_id", t(&Uuid::new_v4().to_string()))],
            &[("notes", t("x"))],
        )],
        &f.entries,
    )
    .unwrap_err();
    assert!(matches!(err, QueryError::ReadOnly(_)));

    let f = fixture(AccessGrant::Edit);
    let err = translate(
        vec![change(
            "guests",
            RawOp::Update,
            &[("row_id", t(&Uuid::new_v4().to_string()))],
            &[("sessions", t("[]"))],
        )],
        &f.entries,
    )
    .unwrap_err();
    assert!(matches!(err, QueryError::ReadOnly(msg) if msg.contains("sessions")));
}
