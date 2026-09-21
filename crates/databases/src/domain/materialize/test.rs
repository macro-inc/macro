use std::collections::HashMap;

use chrono::{TimeZone, Utc};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::shared::{
    DataType, EntityReference, EntityType as PropertyEntityType, PropertyOwner,
};
use uuid::Uuid;

use super::*;
use crate::domain::catalog::build_user_tables;
use crate::domain::models::{AccessGrant, Column, ColumnConfig, Database, Table, TableVersion};

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

fn option(def: &PropertyDefinitionWithOptions, value: PropertyOptionValue) -> PropertyOption {
    PropertyOption {
        id: Uuid::new_v4(),
        property_definition_id: def.definition.id,
        display_order: 0,
        value,
        color: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

struct Fixture {
    entry: TableEntry,
    status: PropertyDefinitionWithOptions,
    people: PropertyDefinitionWithOptions,
    when: PropertyDefinitionWithOptions,
    link_column: ColumnId,
}

fn fixture() -> Fixture {
    let db = Uuid::new_v4();
    let table = Table {
        id: Uuid::new_v4(),
        database_id: db,
        name: "Guests".into(),
        position: "0".into(),
        version: TableVersion(0),
    };
    let mut status = def("Status", DataType::SelectNumber, false);
    status.property_options = vec![
        option(&status, PropertyOptionValue::Number(1.0)),
        option(&status, PropertyOptionValue::Number(2.5)),
    ];
    let people = def("People", DataType::Entity, true);
    let when = def("When", DataType::Date, false);
    let sessions = def("Sessions", DataType::Entity, false);
    let link_column = Uuid::new_v4();
    let columns = vec![
        Column {
            infer_type: false,
            display_name: None,
            id: Uuid::new_v4(),
            table_id: table.id,
            property_definition_id: status.definition.id,
            position: "0".into(),
            config: None,
        },
        Column {
            infer_type: false,
            display_name: None,
            id: Uuid::new_v4(),
            table_id: table.id,
            property_definition_id: people.definition.id,
            position: "1".into(),
            config: None,
        },
        Column {
            infer_type: false,
            display_name: None,
            id: Uuid::new_v4(),
            table_id: table.id,
            property_definition_id: when.definition.id,
            position: "2".into(),
            config: None,
        },
        Column {
            infer_type: false,
            display_name: None,
            id: link_column,
            table_id: table.id,
            property_definition_id: sessions.definition.id,
            position: "3".into(),
            config: Some(ColumnConfig::Link {
                database_id: db,
                table_id: Uuid::new_v4(),
            }),
        },
    ];
    let defs: HashMap<_, _> = [&status, &people, &when, &sessions]
        .into_iter()
        .map(|d| (d.definition.id, d.clone()))
        .collect();
    let grants = HashMap::from([(db, AccessGrant::Edit)]);
    let entry = build_user_tables(
        &[Database {
            id: db,
            name: "Offsite".into(),
            owner_id: "macro|o@macro.com".into(),
            created_at: Utc::now(),
            trashed_at: None,
        }],
        &[table],
        &columns,
        &defs,
        &grants,
        &[],
    )
    .remove(0);
    Fixture {
        entry,
        status,
        people,
        when,
        link_column,
    }
}

#[test]
fn cells_project_to_display_values() {
    let f = fixture();
    let row_id = Uuid::new_v4();
    let target = Uuid::new_v4();
    let row = Row {
        id: row_id,
        table_id: f.entry.table.id,
        position: "0".into(),
        cells: HashMap::from([
            (
                f.status.definition.id,
                PropertyValue::SelectOption(vec![f.status.property_options[1].id]),
            ),
            (
                f.people.definition.id,
                PropertyValue::EntityRef(vec![
                    EntityReference::new("usr_a", PropertyEntityType::User),
                    EntityReference::new("usr_b", PropertyEntityType::User),
                ]),
            ),
            (
                f.when.definition.id,
                PropertyValue::Date(Utc.with_ymd_and_hms(2026, 9, 18, 12, 0, 0).unwrap()),
            ),
        ]),
    };
    let links = HashMap::from([(f.link_column, HashMap::from([(row_id, vec![target])]))]);

    let table = user_table(&f.entry, std::slice::from_ref(&row), &links);
    assert_eq!(table.rows.len(), 1);
    let values = &table.rows[0];
    assert_eq!(values[0], SqlValue::Text(row_id.to_string()));
    assert_eq!(
        values[1],
        SqlValue::Text("2.5".into()),
        "number option displays without noise"
    );
    assert_eq!(values[2], SqlValue::Text("[\"usr_a\",\"usr_b\"]".into()));
    assert_eq!(
        values[3],
        SqlValue::Text("2026-09-18T12:00:00+00:00".into())
    );
    assert_eq!(
        values[4],
        SqlValue::Text(format!("[\"{target}\"]")),
        "link column is the JSON of linked ids"
    );

    let people_junction = f
        .entry
        .junctions
        .iter()
        .find(|j| j.kind == JunctionKind::MultiValue)
        .unwrap();
    let mirror = junction(
        &f.entry,
        people_junction,
        std::slice::from_ref(&row),
        &links,
    );
    assert_eq!(mirror.rows.len(), 2);
    assert_eq!(
        mirror.rows[0],
        vec![
            SqlValue::Text(row_id.to_string()),
            SqlValue::Text("usr_a".into())
        ]
    );

    let link_junction = f
        .entry
        .junctions
        .iter()
        .find(|j| j.kind == JunctionKind::Link)
        .unwrap();
    let edges = junction(&f.entry, link_junction, &[row], &links);
    assert_eq!(
        edges.rows,
        vec![vec![
            SqlValue::Text(row_id.to_string()),
            SqlValue::Text(target.to_string())
        ]]
    );
}

#[test]
fn missing_cells_are_null_and_unknown_options_keep_their_id() {
    let f = fixture();
    let ghost = Uuid::new_v4();
    let row = Row {
        id: Uuid::new_v4(),
        table_id: f.entry.table.id,
        position: "0".into(),
        cells: HashMap::from([(
            f.status.definition.id,
            PropertyValue::SelectOption(vec![ghost]),
        )]),
    };
    let table = user_table(&f.entry, &[row], &HashMap::new());
    let values = &table.rows[0];
    assert_eq!(values[1], SqlValue::Text(ghost.to_string()));
    assert_eq!(values[2], SqlValue::Null);
    assert_eq!(values[3], SqlValue::Null);
    assert_eq!(
        values[4],
        SqlValue::Text("[]".into()),
        "no links → empty array"
    );
}
