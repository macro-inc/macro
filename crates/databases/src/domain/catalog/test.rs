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
        infer_type: false,
        display_name: None,
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
    assert!(entry_answers_to(&entries[0], &read_table_name(a.id)));

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
        vec![
            qualified_table_name(&dbs[0], "guests"),
            legacy_qualified_table_name(&dbs[0], "guests"),
            read_table_name(t.id)
        ]
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

fn assert_unique_namespace(entries: &[TableEntry], reserved: &[String]) {
    let mut names: HashSet<String> = reserved
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect();
    for schema in schemas(entries) {
        for name in std::iter::once(&schema.sql_name).chain(&schema.aliases) {
            assert!(
                names.insert(name.to_ascii_lowercase()),
                "duplicate SQLite table or view name: {name}"
            );
        }
    }
}

#[test]
fn uuid_v7_databases_with_the_same_timestamp_prefix_have_distinct_names() {
    let db_a = Uuid::parse_str("01a0b6bf-850c-7ead-9916-9632478d23b7").unwrap();
    let db_b = Uuid::parse_str("01a0b6bf-850c-7ead-9916-9632478d23b8").unwrap();
    let tables = [table(db_a, "Table 1", "0"), table(db_b, "Table 1", "0")];
    let grants = [(db_a, AccessGrant::Owner), (db_b, AccessGrant::Owner)].into();
    let entries = build_user_tables(
        &[
            database(db_a, "Untitled database"),
            database(db_b, "Untitled database"),
        ],
        &tables,
        &[],
        &HashMap::new(),
        &grants,
        &[],
    );

    assert_unique_namespace(&entries, &[]);
    assert_ne!(entries[0].schema.sql_name, entries[1].schema.sql_name);
    for entry in &entries {
        assert!(entry_answers_to(entry, &read_table_name(entry.table.id)));
        assert!(!entry_answers_to(entry, "table_1"));
    }
}

#[test]
fn qualified_aliases_and_bare_junctions_share_one_namespace() {
    let db = database(
        Uuid::new_v7(uuid::Timestamp::now(uuid::NoContext)),
        "Offsite",
    );
    let guests = table(db.id, "Guests", "0");
    // This display name can produce a junction with exactly the same name
    // as the Guests table's database-qualified alias.
    let qualified = qualified_table_name(&db, "guests");
    let prefix = qualified.strip_suffix("__guests").unwrap();
    let host = table(db.id, prefix, "1");
    let multi = definition("Guests", DataType::String, true);
    let entries = build_user_tables(
        std::slice::from_ref(&db),
        &[guests.clone(), host.clone()],
        &[placement(host.id, &multi, None)],
        &[(multi.definition.id, multi)].into(),
        &[(db.id, AccessGrant::Owner)].into(),
        &[],
    );

    assert_unique_namespace(&entries, &[]);
    assert_eq!(entries[0].schema.sql_name, "guests");
    assert_eq!(entries[1].schema.sql_name, prefix);
    assert!(!entry_answers_to(&entries[0], &qualified));
    assert!(!junction_answers_to(&entries[1].junctions[0], &qualified));
    assert_eq!(
        entries[1].junctions[0].schema.foreign_keys[0].references_table,
        entries[1].schema.sql_name
    );
}

#[test]
fn magic_names_reserve_tables_aliases_and_junctions_case_insensitively() {
    let db = database(
        Uuid::new_v7(uuid::Timestamp::now(uuid::NoContext)),
        "Offsite",
    );
    let guests = table(db.id, "Guests", "0");
    let multi = definition("People", DataType::Entity, true);
    let qualified = qualified_table_name(&db, "guests");
    let reserved = vec![
        "GUESTS".to_string(),
        qualified.to_ascii_uppercase(),
        format!("{qualified}__PEOPLE"),
    ];
    let entries = build_user_tables(
        std::slice::from_ref(&db),
        std::slice::from_ref(&guests),
        &[placement(guests.id, &multi, None)],
        &[(multi.definition.id, multi)].into(),
        &[(db.id, AccessGrant::Owner)].into(),
        &reserved,
    );

    assert_unique_namespace(&entries, &reserved);
    let entry = &entries[0];
    assert!(entry_answers_to(entry, &read_table_name(guests.id)));
    assert!(junction_answers_to(
        &entry.junctions[0],
        &format!("{}__people", read_table_name(guests.id))
    ));
    assert_eq!(
        entry.junctions[0].schema.foreign_keys[0].references_table,
        entry.schema.sql_name
    );
}

#[test]
fn duplicate_display_names_are_independent_of_catalog_input_order() {
    let db = database(
        Uuid::new_v7(uuid::Timestamp::now(uuid::NoContext)),
        "Offsite",
    );
    let a = table(db.id, "Guests", "0");
    let b = table(db.id, "Guests!", "1");
    let grants = [(db.id, AccessGrant::Owner)].into();
    let names_for = |tables: &[Table]| {
        let entries = build_user_tables(
            std::slice::from_ref(&db),
            tables,
            &[],
            &HashMap::new(),
            &grants,
            &[],
        );
        assert_unique_namespace(&entries, &[]);
        for entry in &entries {
            // Neither ordering can silently hand the old ambiguous name
            // to a different table. Saved answers keep their immutable ID.
            assert!(!entry_answers_to(entry, "guests"));
            assert!(!entry_answers_to(
                entry,
                &qualified_table_name(&db, "guests")
            ));
            assert!(!entry_answers_to(
                entry,
                &legacy_qualified_table_name(&db, "guests")
            ));
            assert!(entry_answers_to(entry, &read_table_name(entry.table.id)));
            assert!(
                entry
                    .schema
                    .sql_name
                    .contains(&entry.table.id.simple().to_string())
            );
        }
        entries
            .into_iter()
            .map(|entry| (entry.table.id, entry.schema.sql_name))
            .collect::<HashMap<_, _>>()
    };

    assert_eq!(names_for(&[a.clone(), b.clone()]), names_for(&[b, a]));
}

#[test]
fn ambiguous_legacy_junction_aliases_disappear_with_their_table_aliases() {
    let db_a = Uuid::parse_str("01a0b6bf-850c-7ead-9916-9632478d23b7").unwrap();
    let db_b = Uuid::parse_str("01a0b6bf-850c-7ead-9916-9632478d23b8").unwrap();
    let databases = [
        database(db_a, "Untitled database"),
        database(db_b, "Untitled database"),
    ];
    let tables = [table(db_a, "Table 1", "0"), table(db_b, "Table 1", "0")];
    let multi = definition("People", DataType::Entity, true);
    let columns = tables
        .iter()
        .map(|table| placement(table.id, &multi, None))
        .collect::<Vec<_>>();
    let entries = build_user_tables(
        &databases,
        &tables,
        &columns,
        &[(multi.definition.id, multi)].into(),
        &[(db_a, AccessGrant::Owner), (db_b, AccessGrant::Owner)].into(),
        &[],
    );

    assert_unique_namespace(&entries, &[]);
    let legacy = legacy_qualified_table_name(&databases[0], "table_1");
    for entry in &entries {
        assert!(!entry_answers_to(entry, &legacy));
        assert!(!junction_answers_to(
            &entry.junctions[0],
            &format!("{legacy}__people")
        ));
        assert!(junction_answers_to(
            &entry.junctions[0],
            &format!("{}__people", read_table_name(entry.table.id))
        ));
    }
}

#[test]
fn a_table_qualified_alias_cannot_conflict_with_its_own_junction() {
    let db = database(
        Uuid::new_v7(uuid::Timestamp::now(uuid::NoContext)),
        "Offsite",
    );
    let qualified = qualified_table_name(&db, "guests");
    let prefix = qualified.strip_suffix("__guests").unwrap();
    let host = table(db.id, prefix, "0");
    let multi = definition(prefix, DataType::String, true);
    let entries = build_user_tables(
        std::slice::from_ref(&db),
        std::slice::from_ref(&host),
        &[placement(host.id, &multi, None)],
        &[(multi.definition.id, multi)].into(),
        &[(db.id, AccessGrant::Owner)].into(),
        &[],
    );

    assert_unique_namespace(&entries, &[]);
    let entry = &entries[0];
    let ambiguous = format!("{prefix}__{prefix}");
    assert_eq!(entry.schema.sql_name, prefix);
    assert!(!entry_answers_to(entry, &ambiguous));
    assert!(!junction_answers_to(&entry.junctions[0], &ambiguous));
    assert!(entry_answers_to(entry, &read_table_name(host.id)));
    assert_eq!(
        entry.junctions[0].schema.foreign_keys[0].references_table,
        prefix
    );
}

#[test]
fn a_literal_name_cannot_retarget_a_generated_qualified_name() {
    let db = database(
        Uuid::new_v7(uuid::Timestamp::now(uuid::NoContext)),
        "Offsite",
    );
    let a = table(db.id, "Guests", "0");
    let b = table(db.id, "Guests!", "1");
    let generated = format!("guests_{}", a.id.simple());
    let literal = table(db.id, &generated, "2");
    let entries = build_user_tables(
        std::slice::from_ref(&db),
        &[a.clone(), b, literal.clone()],
        &[],
        &HashMap::new(),
        &[(db.id, AccessGrant::Owner)].into(),
        &[],
    );

    assert_unique_namespace(&entries, &[]);
    assert_eq!(entries[2].schema.sql_name, generated);
    let ambiguous = qualified_table_name(&db, &generated);
    for entry in &entries {
        assert!(!entry_answers_to(entry, &ambiguous));
        assert!(entry_answers_to(entry, &read_table_name(entry.table.id)));
    }
    assert_ne!(entries[0].schema.sql_name, entries[2].schema.sql_name);
}

#[test]
fn local_duplicates_still_withhold_the_bare_name_from_other_databases() {
    let db_a = database(
        Uuid::new_v7(uuid::Timestamp::now(uuid::NoContext)),
        "Offsite",
    );
    let db_b = database(Uuid::new_v7(uuid::Timestamp::now(uuid::NoContext)), "Party");
    let tables = [
        table(db_a.id, "Guests", "0"),
        table(db_a.id, "Guests!", "1"),
        table(db_b.id, "Guests", "0"),
    ];
    let grants = [(db_a.id, AccessGrant::Owner), (db_b.id, AccessGrant::Owner)].into();
    let entries = build_user_tables(&[db_a, db_b], &tables, &[], &HashMap::new(), &grants, &[]);

    assert_unique_namespace(&entries, &[]);
    for entry in &entries {
        assert!(!entry_answers_to(entry, "guests"));
        assert!(entry_answers_to(entry, &read_table_name(entry.table.id)));
    }
}
