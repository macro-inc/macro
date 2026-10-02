use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::shared::PropertyOwner;
use sqlx::PgPool;

use uuid::Uuid;

use properties::outbound::properties_pg_repo::PropertiesPgRepo;

use super::*;
use crate::domain::models::Viewer;

fn viewer_for_tests() -> Viewer {
    Viewer {
        user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(
            "macro|definitions-test@macro.com",
        )
        .expect("valid user id"),
        acting_bot: None,
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
    DatabaseId::from_uuid(id)
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

fn store(pool: &PgPool) -> PgDefinitionStore<PropertiesPgRepo> {
    PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_typed_definition_is_owned_by_the_database(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = store(&pool);

    let created = store
        .create_typed_definition(database_id, "Headcount", DataType::Number, false, None, &[])
        .await
        .expect("definition should be created");

    let definitions = store
        .definitions(&[created.definition.id])
        .await
        .expect("definitions should be readable");
    let definition = &definitions
        .first()
        .expect("the created definition should come back")
        .definition;

    assert_eq!(definition.display_name, "Headcount");
    assert_eq!(definition.data_type, DataType::Number);
    assert!(!definition.is_multi_select);
    assert!(!definition.is_system);
    // The whole point of the owner scope: the column is owned by the database,
    // so it never appears in the user's or a team's property list.
    assert_eq!(
        definition.owner,
        PropertyOwner::Database {
            database_id: database_id.into_uuid()
        }
    );
    assert!(created.property_options.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_column_may_reuse_a_reserved_system_property_name(pool: PgPool) {
    let database_id = insert_database(&pool).await;

    // "Status" is a seeded system property; the reserved-name trigger applies to
    // the shared namespace only.
    store(&pool)
        .create_typed_definition(
            database_id,
            "Status",
            DataType::SelectString,
            false,
            None,
            &[],
        )
        .await
        .expect("a database column may be named Status");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_existing_definition_of_the_database_is_bindable(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = store(&pool);
    let created = store
        .create_typed_definition(database_id, "Owner", DataType::String, false, None, &[])
        .await
        .expect("definition should be created");

    let bindable = store
        .bindable_definition(database_id, &viewer_for_tests(), created.definition.id)
        .await
        .expect("an existing definition should resolve");

    assert_eq!(bindable, Some(created.definition.id));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_definition_is_not_bindable(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let missing = macro_uuid::generate_uuid_v7();

    let bindable = store(&pool)
        .bindable_definition(database_id, &viewer_for_tests(), missing)
        .await
        .expect("an unknown definition is an answer, not a failure");

    assert_eq!(bindable, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn definitions_attaches_options_and_ignores_unknown_ids(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = store(&pool);

    let select_id = store
        .create_typed_definition(
            database_id,
            "Stage",
            DataType::SelectString,
            false,
            None,
            &[],
        )
        .await
        .expect("definition should be created")
        .definition
        .id;
    let plain_id = store
        .create_typed_definition(database_id, "Notes", DataType::String, false, None, &[])
        .await
        .expect("definition should be created")
        .definition
        .id;
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
        .find(|definition| definition.definition.id == select_id)
        .expect("the select definition should come back");
    let mut values: Vec<&str> = select
        .property_options
        .iter()
        .map(|option| match &option.value {
            PropertyOptionValue::String(text) => text.as_str(),
            PropertyOptionValue::Number(_) => panic!("expected string options"),
        })
        .collect();
    values.sort_unstable();
    assert_eq!(values, ["Draft", "Sent"]);

    let plain = definitions
        .iter()
        .find(|definition| definition.definition.id == plain_id)
        .expect("the plain definition should come back");
    assert!(plain.property_options.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn definitions_of_nothing_is_empty(pool: PgPool) {
    let definitions = store(&pool)
        .definitions(&[])
        .await
        .expect("empty is not an error");

    assert!(definitions.is_empty());
}

/// First options come with the definition, in order, each coloured by its
/// place so neighbours differ.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_typed_definition_starts_with_its_options_in_order_and_colour(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = store(&pool);

    let created = store
        .create_typed_definition(
            database_id,
            "Stage",
            DataType::SelectString,
            false,
            None,
            &[
                PropertyOptionValue::String("Draft".to_string()),
                PropertyOptionValue::String("Sent".to_string()),
                PropertyOptionValue::String("Signed".to_string()),
            ],
        )
        .await
        .expect("definition should be created");

    let definitions = store
        .definitions(&[created.definition.id])
        .await
        .expect("definitions should be readable");
    let stored: Vec<(i32, PropertyOptionValue, Option<&str>)> = definitions[0]
        .property_options
        .iter()
        .map(|option| {
            (
                option.display_order,
                option.value.clone(),
                option.color.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        stored,
        [
            (
                0,
                PropertyOptionValue::String("Draft".to_string()),
                Some("#0091FF")
            ),
            (
                1,
                PropertyOptionValue::String("Sent".to_string()),
                Some("#46A758")
            ),
            (
                2,
                PropertyOptionValue::String("Signed".to_string()),
                Some("#8E4EC6")
            ),
        ]
    );
}

/// A numeric select stores its options as numbers, which is what makes the
/// catalog render `2` rather than `"2"` in the compiled CHECK.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_numeric_select_starts_with_numbers(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let store = store(&pool);

    let created = store
        .create_typed_definition(
            database_id,
            "Priority",
            DataType::SelectNumber,
            false,
            None,
            &[PropertyOptionValue::Number(2.0)],
        )
        .await
        .expect("definition should be created");

    let definitions = store
        .definitions(&[created.definition.id])
        .await
        .expect("definitions should be readable");
    assert_eq!(
        definitions[0].property_options[0].value,
        PropertyOptionValue::Number(2.0)
    );
}
