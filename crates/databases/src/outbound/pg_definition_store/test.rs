use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::shared::PropertyOwner;
use sqlx::PgPool;

use uuid::Uuid;

use super::*;
use crate::domain::models::Viewer;

fn viewer_for_tests() -> Viewer {
    Viewer {
        user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(
            "macro|definitions-test@macro.com",
        )
        .expect("valid user id"),
    }
}

const USER: &str = "macro|databases-defs@macro.com";

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        id,
    )
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("user should insert");
}

/// A database owned by [`USER`], which every database-scoped definition needs.
async fn insert_database(pool: &PgPool) -> DatabaseId {
    insert_user(pool, USER).await;
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO databases (id, name, owner_id) VALUES ($1, 'Guests', $2)",
        id,
        USER,
    )
    .execute(pool)
    .await
    .expect("database should insert");
    id
}

async fn insert_option(
    pool: &PgPool,
    definition_id: PropertyDefinitionId,
    string_value: Option<&str>,
    number_value: Option<f64>,
) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO property_options (id, property_definition_id, display_order, string_value, number_value)
        VALUES ($1, $2, 0, $3, $4)
        "#,
        id,
        definition_id,
        string_value,
        number_value,
    )
    .execute(pool)
    .await
    .expect("option should insert");
    id
}

fn new_definition(name: &str, data_type: DataType) -> ColumnBinding {
    ColumnBinding::NewDefinition {
        name: name.to_string(),
        data_type,
        is_multi_select: false,
        // Options are attached through `add_options`, never by the binding.
        options: vec![],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn new_binding_creates_a_database_owned_definition(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool),
    );

    let definition_id = store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &new_definition("Headcount", DataType::Number),
        )
        .await
        .expect("definition should be created");

    let definitions = store
        .definitions(&[definition_id])
        .await
        .expect("definitions should be readable");
    let definition = &definitions
        .first()
        .expect("the created definition should come back")
        .definition;

    assert_eq!(definition.id, definition_id);
    assert_eq!(definition.display_name, "Headcount");
    assert_eq!(definition.data_type, DataType::Number);
    assert!(!definition.is_multi_select);
    assert!(!definition.is_system);
    // The whole point of the owner scope: the column is owned by the database,
    // so it never appears in the user's or a team's property list.
    assert_eq!(definition.owner, PropertyOwner::Database { database_id });
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_column_may_reuse_a_reserved_system_property_name(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool),
    );

    // "Status" is a seeded system property; the reserved-name trigger applies to
    // the shared namespace only.
    store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &new_definition("Status", DataType::SelectString),
        )
        .await
        .expect("a database column may be named Status");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn existing_binding_returns_the_definition_id(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool),
    );

    let created = store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &new_definition("Owner", DataType::String),
        )
        .await
        .expect("definition should be created");

    let resolved = store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &ColumnBinding::ExistingDefinition(created),
        )
        .await
        .expect("an existing definition should resolve");

    assert_eq!(resolved, created);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn existing_binding_rejects_an_unknown_definition(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool),
    );
    let missing = macro_uuid::generate_uuid_v7();

    let error = store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &ColumnBinding::ExistingDefinition(missing),
        )
        .await
        .expect_err("an unknown definition should not resolve");

    match error {
        PgDefinitionStoreError::NotFound(id) => assert_eq!(id, missing),
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn definitions_attaches_options_and_ignores_unknown_ids(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool.clone()),
    );

    let select_id = store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &new_definition("Stage", DataType::SelectString),
        )
        .await
        .expect("definition should be created");
    let plain_id = store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &new_definition("Notes", DataType::String),
        )
        .await
        .expect("definition should be created");
    insert_option(&pool, select_id, Some("Draft"), None).await;
    insert_option(&pool, select_id, Some("Sent"), None).await;

    let unknown = macro_uuid::generate_uuid_v7();
    let definitions = store
        .definitions(&[select_id, plain_id, unknown])
        .await
        .expect("definitions should be readable");

    assert_eq!(definitions.len(), 2);
    let select = definitions
        .iter()
        .find(|d| d.definition.id == select_id)
        .expect("the select definition should come back");
    let mut values: Vec<&str> = select
        .property_options
        .iter()
        .map(|option| match &option.value {
            PropertyOptionValue::String(s) => s.as_str(),
            PropertyOptionValue::Number(_) => panic!("expected string options"),
        })
        .collect();
    values.sort_unstable();
    assert_eq!(values, ["Draft", "Sent"]);

    let plain = definitions
        .iter()
        .find(|d| d.definition.id == plain_id)
        .expect("the plain definition should come back");
    assert!(plain.property_options.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn definitions_of_nothing_is_empty(pool: PgPool) {
    let store = PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool),
    );

    let definitions = store.definitions(&[]).await.expect("empty is not an error");

    assert!(definitions.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn add_options_appends_to_the_definition(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool),
    );

    let definition_id = store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &new_definition("Stage", DataType::SelectString),
        )
        .await
        .expect("definition should be created");

    let created = store
        .add_options(
            definition_id,
            &[
                PropertyOptionValue::String("Draft".to_string()),
                PropertyOptionValue::String("Sent".to_string()),
            ],
        )
        .await
        .expect("options should be created");
    assert_eq!(created.len(), 2);
    assert_eq!(created[0].display_order, 0);
    assert_eq!(created[1].display_order, 1);

    // A second call appends rather than restarting the order, so the labels
    // the catalog derives from it stay put.
    let later = store
        .add_options(
            definition_id,
            &[PropertyOptionValue::String("Signed".to_string())],
        )
        .await
        .expect("options should be created");
    assert_eq!(later[0].display_order, 2);

    let definitions = store
        .definitions(&[definition_id])
        .await
        .expect("definitions should be readable");
    let labels: Vec<String> = definitions[0]
        .property_options
        .iter()
        .map(|option| match &option.value {
            PropertyOptionValue::String(s) => s.clone(),
            PropertyOptionValue::Number(_) => panic!("expected string options"),
        })
        .collect();
    assert_eq!(labels, ["Draft", "Sent", "Signed"]);
}

/// A numeric select stores its options as numbers, which is what makes the
/// catalog render `2` rather than `"2"` in the compiled CHECK.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn add_options_stores_numbers_for_a_numeric_select(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool),
    );

    let definition_id = store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &new_definition("Priority", DataType::SelectNumber),
        )
        .await
        .expect("definition should be created");

    store
        .add_options(definition_id, &[PropertyOptionValue::Number(2.0)])
        .await
        .expect("options should be created");

    let definitions = store
        .definitions(&[definition_id])
        .await
        .expect("definitions should be readable");
    assert_eq!(
        definitions[0].property_options[0].value,
        PropertyOptionValue::Number(2.0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn add_options_of_nothing_writes_nothing(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool),
    );
    let definition_id = store
        .resolve_binding(
            database_id,
            &viewer_for_tests(),
            &new_definition("Stage", DataType::SelectString),
        )
        .await
        .expect("definition should be created");

    let created = store
        .add_options(definition_id, &[])
        .await
        .expect("empty is not an error");

    assert!(created.is_empty());
}
