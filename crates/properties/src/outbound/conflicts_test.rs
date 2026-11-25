//! Catalog writes that collide with a stored row, through the service and
//! Postgres: a taken name or value is the caller's conflict, never an
//! internal failure, and a replayed add answers with the option it made. The
//! router answers these errors with 409 and 400 (`inbound::axum_router` tests).

use super::definitions_test::{user_1, user_2};
use super::properties_pg_repo::PropertiesPgRepo;
use super::query_error::{DEFINITION_NAME_INDEXES, OPTION_VALUE_INDEXES};
use crate::domain::error::PropertiesErr;
use crate::domain::ports::{MockNotificationService, MockPermissionService};
use crate::domain::service::PropertiesService;
use crate::domain::service_impl::PropertiesServiceImpl;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::api::requests::{
    AddPropertyOptionRequest, AddStringOptionRequest, CreatePropertyDefinitionRequest,
    CreatePropertyScope, PropertyDataType, SelectStringOption, UpdatePropertyOptionRequest,
};
use models_properties::service::property_option::PropertyOptionValue;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// User 1's "Test Personal Priority" (options Low, High); user 1 also has "Test Notes".
const PERSONAL_PRIORITY: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

fn service(
    pool: Pool<Postgres>,
) -> PropertiesServiceImpl<PropertiesPgRepo, MockPermissionService, MockNotificationService> {
    PropertiesServiceImpl::new(PropertiesPgRepo::new(pool), None, None)
}

fn select(display_name: &str, values: &[&str]) -> CreatePropertyDefinitionRequest {
    CreatePropertyDefinitionRequest {
        scope: CreatePropertyScope::User,
        display_name: display_name.to_string(),
        data_type: PropertyDataType::SelectString {
            options: values
                .iter()
                .enumerate()
                .map(|(index, value)| SelectStringOption {
                    display_order: index as i32,
                    value: (*value).to_string(),
                })
                .collect(),
            multi: false,
        },
    }
}

fn add(value: &str) -> AddPropertyOptionRequest {
    AddPropertyOptionRequest::SelectString {
        option: AddStringOptionRequest {
            display_order: 5,
            value: value.to_string(),
            color: None,
        },
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn a_taken_definition_name_is_a_conflict(pool: Pool<Postgres>) {
    let err = service(pool)
        .create_property_definition(&user_1(), None, &select("Test Notes", &[]))
        .await
        .unwrap_err();
    assert!(
        matches!(err, PropertiesErr::DuplicateDefinitionName),
        "{err:?}"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn repeated_seed_options_are_a_conflict_and_write_nothing(pool: Pool<Postgres>) {
    let err = service(pool.clone())
        .create_property_definition(&user_1(), None, &select("Phase", &["Lead", "Lead"]))
        .await
        .unwrap_err();
    assert!(
        matches!(err, PropertiesErr::DuplicateOptionValue),
        "{err:?}"
    );
    let stored = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM property_definitions WHERE display_name = 'Phase'"#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn blank_seed_options_are_refused(pool: Pool<Postgres>) {
    for blank in ["", "   ", "\t\n"] {
        let err = service(pool.clone())
            .create_property_definition(&user_1(), None, &select("Phase", &["Lead", blank]))
            .await
            .unwrap_err();
        assert!(
            matches!(err, PropertiesErr::Validation(_)),
            "{blank:?}: {err:?}"
        );
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn an_add_under_a_new_id_with_a_taken_value_is_a_conflict(pool: Pool<Postgres>) {
    let definition: Uuid = PERSONAL_PRIORITY.parse().unwrap();
    let err = service(pool)
        .add_property_option_with_id(&user_1(), None, definition, Uuid::now_v7(), &add("Low"))
        .await
        .unwrap_err();
    assert!(
        matches!(err, PropertiesErr::DuplicateOptionValue),
        "{err:?}"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn a_replayed_add_answers_with_its_option_after_a_rename(pool: Pool<Postgres>) {
    let service = service(pool);
    let definition: Uuid = PERSONAL_PRIORITY.parse().unwrap();
    let id = Uuid::now_v7();
    service
        .add_property_option_with_id(&user_1(), None, definition, id, &add("Medium"))
        .await
        .unwrap();
    service
        .update_property_option(
            &user_1(),
            None,
            definition,
            id,
            &UpdatePropertyOptionRequest {
                value: Some("Middling".to_string()),
                color: None,
                display_order: None,
            },
        )
        .await
        .unwrap();

    // The add's reply was lost and it is sent again after the rename.
    let replayed = service
        .add_property_option_with_id(&user_1(), None, definition, id, &add("Medium"))
        .await
        .unwrap();

    assert_eq!(replayed.id, id);
    assert_eq!(
        replayed.value,
        PropertyOptionValue::String("Middling".to_string())
    );
}

/// The conflict arms match taken names and values by index name, so a renamed
/// or added unique index would turn a taken name into an internal failure. The
/// primary keys are left out: their ids are minted by the server.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_conflict_arms_name_every_unique_index_but_the_keys(pool: Pool<Postgres>) {
    let indexes: Vec<(String, String)> = sqlx::query!(
        r#"SELECT table_class.relname::text AS "table_name!",
                  index_class.relname::text AS "index_name!"
           FROM pg_index
           JOIN pg_class table_class ON table_class.oid = pg_index.indrelid
           JOIN pg_class index_class ON index_class.oid = pg_index.indexrelid
           WHERE pg_index.indisunique
             AND NOT pg_index.indisprimary
             AND table_class.relname IN ('property_definitions', 'property_options')
           ORDER BY 1, 2"#,
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.table_name, row.index_name))
    .collect();
    let named: Vec<(String, String)> = DEFINITION_NAME_INDEXES
        .iter()
        .map(|index| ("property_definitions", index))
        .chain(
            OPTION_VALUE_INDEXES
                .iter()
                .map(|index| ("property_options", index)),
        )
        .map(|(table, index)| (table.to_string(), (*index).to_string()))
        .collect();
    assert_eq!(indexes, named);
}

/// A promoted tag keeps its option id under another definition, so a delete
/// that names the option's old definition is told the option is elsewhere,
/// not that it is gone.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn a_delete_naming_another_definition_is_told_the_option_lives_on(pool: Pool<Postgres>) {
    let service = service(pool);
    let priority: Uuid = PERSONAL_PRIORITY.parse().unwrap();
    let option = Uuid::now_v7();
    service
        .add_property_option_with_id(&user_1(), None, priority, option, &add("Medium"))
        .await
        .unwrap();
    let other = service
        .create_property_definition(&user_1(), None, &select("Phase", &["Lead"]))
        .await
        .unwrap();
    let err = service
        .delete_property_option(&user_1(), None, other.id, option)
        .await
        .unwrap_err();
    assert!(
        matches!(err, PropertiesErr::OptionInAnotherDefinition),
        "{err:?}"
    );
}

/// A delete sent again after its definition went still finds an option that
/// lives on under another definition.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn a_delete_after_its_definition_went_is_told_the_option_lives_on(pool: Pool<Postgres>) {
    let service = service(pool);
    let priority: Uuid = PERSONAL_PRIORITY.parse().unwrap();
    let option = Uuid::now_v7();
    service
        .add_property_option_with_id(&user_1(), None, priority, option, &add("Medium"))
        .await
        .unwrap();
    let gone = service
        .create_property_definition(&user_1(), None, &select("Phase", &["Lead"]))
        .await
        .unwrap();
    service
        .delete_property_definition(gone.id, &user_1(), None)
        .await
        .unwrap();
    let err = service
        .delete_property_option(&user_1(), None, gone.id, option)
        .await
        .unwrap_err();
    assert!(
        matches!(err, PropertiesErr::OptionInAnotherDefinition),
        "{err:?}"
    );
    let err = service
        .delete_property_option(&user_1(), None, gone.id, Uuid::now_v7())
        .await
        .unwrap_err();
    assert!(matches!(err, PropertiesErr::NotFound), "{err:?}");
}

/// A delete is told an option lives on only when the caller can see where:
/// another account's option answers as gone, whatever definition is named.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn a_delete_of_someone_elses_option_is_told_it_is_gone(pool: Pool<Postgres>) {
    let service = service(pool);
    let theirs = service
        .create_property_definition(&user_2(), None, &select("Rank", &["High"]))
        .await
        .unwrap();
    let option = Uuid::now_v7();
    service
        .add_property_option_with_id(&user_2(), None, theirs.id, option, &add("Low"))
        .await
        .unwrap();
    let mine = service
        .create_property_definition(&user_1(), None, &select("Phase", &["Lead"]))
        .await
        .unwrap();
    let err = service
        .delete_property_option(&user_1(), None, mine.id, option)
        .await
        .unwrap_err();
    assert!(matches!(err, PropertiesErr::OptionNotFound), "{err:?}");
    let err = service
        .delete_property_option(&user_1(), None, Uuid::now_v7(), option)
        .await
        .unwrap_err();
    assert!(matches!(err, PropertiesErr::NotFound), "{err:?}");
}
