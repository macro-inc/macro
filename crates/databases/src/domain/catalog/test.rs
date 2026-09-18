use chrono::Utc;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::PropertyOption;
use models_properties::shared::PropertyOwner;
use uuid::Uuid;

use super::*;
use crate::domain::models::TableVersion;

fn definition(name: &str, data_type: DataType, multi: bool) -> PropertyDefinitionWithOptions {
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

fn with_options(
    mut def: PropertyDefinitionWithOptions,
    values: &[&str],
) -> PropertyDefinitionWithOptions {
    def.property_options = values
        .iter()
        .enumerate()
        .map(|(i, v)| PropertyOption {
            id: Uuid::new_v4(),
            property_definition_id: def.definition.id,
            display_order: i as i32,
            value: PropertyOptionValue::String(v.to_string()),
            color: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
        .collect();
    def
}

fn database(id: DatabaseId, name: &str) -> Database {
    Database {
        id,
        name: name.to_string(),
        owner_id: "macro|owner@macro.com".to_string(),
        created_at: Utc::now(),
        trashed_at: None,
    }
}

fn table(db: DatabaseId, name: &str, position: &str) -> Table {
    Table {
        id: Uuid::new_v4(),
        database_id: db,
        name: name.to_string(),
        position: position.to_string(),
        version: TableVersion(0),
    }
}

fn placement(
    table_id: TableId,
    def: &PropertyDefinitionWithOptions,
    config: Option<ColumnConfig>,
) -> Column {
    Column {
        id: Uuid::new_v4(),
        table_id,
        property_definition_id: def.definition.id,
        position: "0".to_string(),
        config,
    }
}

#[test]
fn identifiers_are_sanitized() {
    assert_eq!(sql_identifier("Guests"), "guests");
    assert_eq!(sql_identifier("Plus ones (+1)"), "plus_ones_1");
    assert_eq!(sql_identifier("2024 budget"), "_2024_budget");
    assert_eq!(sql_identifier("!!!"), "t");
    assert_eq!(sql_identifier("  Trailing  "), "trailing");
}

#[test]
fn builds_columns_junctions_and_constraints() {
    let db = Uuid::new_v4();
    let guests = table(db, "Guests", "0");
    let status = with_options(
        definition("Status", DataType::SelectString, false),
        &["Going", "Declined"],
    );
    let people = definition("People", DataType::Entity, true);
    let notes = definition("Notes", DataType::String, false);
    let columns = vec![
        placement(guests.id, &status, None),
        placement(guests.id, &people, None),
        placement(guests.id, &notes, None),
    ];
    let definitions: HashMap<_, _> = [&status, &people, &notes]
        .into_iter()
        .map(|d| (d.definition.id, d.clone()))
        .collect();
    let grants: HashMap<_, _> = [(db, AccessGrant::Edit)].into_iter().collect();

    let entries = build_user_tables(
        &[database(db, "Offsite")],
        std::slice::from_ref(&guests),
        &columns,
        &definitions,
        &grants,
        &[],
    );
    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert_eq!(entry.schema.sql_name, "guests");
    assert!(entry.schema.writable);
    let names: Vec<_> = entry
        .schema
        .columns
        .iter()
        .map(|c| c.sql_name.as_str())
        .collect();
    assert_eq!(names, vec!["row_id", "status", "people", "notes"]);
    assert!(
        !entry.schema.columns[0].writable,
        "row_id is never updatable"
    );
    assert_eq!(
        entry.schema.columns[1].allowed_values,
        Some(vec!["Going".to_string(), "Declined".to_string()])
    );
    assert!(entry.schema.columns[2].is_multi_select);
    assert_eq!(
        entry.schema.columns[2].entity_type,
        Some(model_entity::EntityType::User)
    );
    assert_eq!(entry.junctions.len(), 1);
    assert_eq!(entry.junctions[0].schema.sql_name, "guests__people");
    assert_eq!(entry.junctions[0].kind, JunctionKind::MultiValue);
    assert!(
        !entry.junctions[0].schema.writable,
        "multi-value junctions are mirrors"
    );
}

#[test]
fn view_grant_makes_everything_read_only() {
    let db = Uuid::new_v4();
    let t = table(db, "T", "0");
    let notes = definition("Notes", DataType::String, false);
    let definitions: HashMap<_, _> = [(notes.definition.id, notes.clone())].into_iter().collect();
    let grants: HashMap<_, _> = [(db, AccessGrant::View)].into_iter().collect();
    let entries = build_user_tables(
        &[database(db, "Offsite")],
        std::slice::from_ref(&t),
        &[placement(t.id, &notes, None)],
        &definitions,
        &grants,
        &[],
    );
    assert!(!entries[0].schema.writable);
    assert!(!entries[0].schema.columns[1].writable);
}

#[test]
fn colliding_names_get_suffixes_and_link_columns_get_writable_junctions() {
    let db_a = Uuid::new_v4();
    let db_b = Uuid::new_v4();
    let a = table(db_a, "Guests", "0");
    let b = table(db_b, "guests!", "0");
    let link_def = definition("Sessions", DataType::Entity, false);
    let link = placement(
        a.id,
        &link_def,
        Some(ColumnConfig::Link {
            database_id: db_a,
            table_id: b.id,
        }),
    );
    let definitions: HashMap<_, _> = [(link_def.definition.id, link_def.clone())]
        .into_iter()
        .collect();
    let grants: HashMap<_, _> = [(db_a, AccessGrant::Owner), (db_b, AccessGrant::View)]
        .into_iter()
        .collect();

    let entries = build_user_tables(
        &[database(db_a, "Offsite"), database(db_b, "Party")],
        &[a.clone(), b.clone()],
        &[link],
        &definitions,
        &grants,
        &[],
    );
    // Two `guests` across databases: neither gets the bare name; both are
    // addressable by their qualified, viewer-independent names.
    assert!(
        entries[0].schema.sql_name.starts_with("offsite_"),
        "{}",
        entries[0].schema.sql_name
    );
    assert!(entries[0].schema.sql_name.ends_with("__guests"));
    assert!(entries[1].schema.sql_name.starts_with("party_"));
    assert!(entries[0].schema.aliases.is_empty());

    let link_col = &entries[0].schema.columns[1];
    assert!(
        !link_col.writable,
        "link cells are edges, written via the junction"
    );
    assert!(link_col.is_multi_select);
    let junction = &entries[0].junctions[0];
    assert_eq!(junction.kind, JunctionKind::Link);
    assert!(junction.schema.writable);
    assert!(junction.schema.sql_name.ends_with("__guests__sessions"));
}

#[test]
fn bare_names_are_viewer_independent_aliases() {
    let db = Uuid::new_v4();
    let t = table(db, "Guests", "0");
    let notes = definition("Notes", DataType::String, false);
    let definitions: HashMap<_, _> = [(notes.definition.id, notes.clone())].into_iter().collect();
    let grants: HashMap<_, _> = [(db, AccessGrant::Edit)].into_iter().collect();
    let dbs = [database(db, "Summer Offsite")];
    let entries = build_user_tables(
        &dbs,
        std::slice::from_ref(&t),
        &[placement(t.id, &notes, None)],
        &definitions,
        &grants,
        &[],
    );
    assert_eq!(entries[0].schema.sql_name, "guests");
    assert_eq!(
        entries[0].schema.aliases,
        vec![qualified_table_name(&dbs[0], "guests")]
    );
    assert!(entries[0].schema.aliases[0].starts_with("summer_offsite_"));

    // A reserved (magic) name is never handed out bare.
    let people = table(db, "People", "1");
    let entries = build_user_tables(
        &dbs,
        std::slice::from_ref(&people),
        &[placement(people.id, &notes, None)],
        &definitions,
        &grants,
        &["people".to_string()],
    );
    assert_ne!(entries[0].schema.sql_name, "people");
    assert!(entries[0].schema.sql_name.ends_with("__people"));
}

#[test]
fn unreadable_databases_and_lookups_are_absent() {
    let db = Uuid::new_v4();
    let t = table(db, "T", "0");
    let notes = definition("Notes", DataType::String, false);
    let definitions: HashMap<_, _> = [(notes.definition.id, notes.clone())].into_iter().collect();
    // No grant for `db` at all.
    let entries = build_user_tables(
        &[database(db, "Offsite")],
        std::slice::from_ref(&t),
        &[placement(t.id, &notes, None)],
        &definitions,
        &HashMap::new(),
        &[],
    );
    assert!(entries.is_empty());

    let grants: HashMap<_, _> = [(db, AccessGrant::Edit)].into_iter().collect();
    let lookup = placement(
        t.id,
        &notes,
        Some(ColumnConfig::Lookup {
            via_column_id: Uuid::new_v4(),
            target: "x".to_string(),
        }),
    );
    let entries = build_user_tables(
        &[database(db, "Offsite")],
        &[t],
        &[lookup],
        &definitions,
        &grants,
        &[],
    );
    assert_eq!(entries[0].schema.columns.len(), 1, "only row_id");
}
