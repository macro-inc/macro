//! Integration tests for property definition operations on PropertiesPgRepo.

use super::properties_pg_repo::PropertiesPgRepo;
use crate::domain::model::PropertyDefinitionOwner;
use crate::domain::ports::PropertiesRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::{DataType, EntityType};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

fn user_1() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()
}

fn user_2() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap()
}

fn user_3() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user3@test.com").unwrap()
}

fn team_1() -> Uuid {
    "0e000000-0000-0000-0000-000000000001".parse().unwrap()
}

fn team_2() -> Uuid {
    "0e000000-0000-0000-0000-000000000002".parse().unwrap()
}

fn new_option(display_order: i32, value: PropertyOptionValue) -> PropertyOption {
    PropertyOption {
        id: Uuid::nil(),
        property_definition_id: Uuid::nil(),
        display_order,
        value,
        color: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn list_property_definitions_by_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let properties = repo
        .list_property_definitions(Some(team_1()), None, false)
        .await?;

    assert_eq!(properties.len(), 10); // Team 1 has 10 properties

    // Verify they are sorted by display name (case-insensitive alphabetical)
    assert_eq!(properties[0].display_name, "Test Assigned To");
    assert_eq!(properties[1].display_name, "Test Budget");
    assert_eq!(properties[2].display_name, "Test Completed");
    assert_eq!(properties[3].display_name, "Test Department");
    assert_eq!(properties[4].display_name, "Test Description");
    assert_eq!(properties[5].display_name, "Test Due Date");
    assert_eq!(properties[6].display_name, "Test Priority");
    assert_eq!(properties[7].display_name, "Test Relevant Documents");
    assert_eq!(properties[8].display_name, "Test Score");
    assert_eq!(properties[9].display_name, "Test Website");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn list_property_definitions_by_user(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let properties = repo
        .list_property_definitions(None, Some(&user_1()), false)
        .await?;

    assert_eq!(properties.len(), 2); // User1 has 2 properties
    assert_eq!(properties[0].display_name, "Test Notes");
    assert_eq!(properties[1].display_name, "Test Personal Priority");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_property_definition_with_owner_checks_ownership(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let team_property_id = "11111111-1111-1111-1111-111111111111"
        .parse::<Uuid>()
        .unwrap();

    // The team owner can access the team property.
    let property = repo
        .get_property_definition_with_owner(team_property_id, &user_1(), Some(team_1()))
        .await?;
    assert!(property.is_some());

    // A different member of the same team can also access it.
    let property = repo
        .get_property_definition_with_owner(team_property_id, &user_3(), Some(team_1()))
        .await?;
    assert!(property.is_some());

    // A user on a different team cannot access it.
    let property = repo
        .get_property_definition_with_owner(team_property_id, &user_2(), Some(team_2()))
        .await?;
    assert!(property.is_none());

    // A user with no team cannot access it.
    let property = repo
        .get_property_definition_with_owner(team_property_id, &user_2(), None)
        .await?;
    assert!(property.is_none());

    // The owning user can access their own user property.
    let user_property_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        .parse::<Uuid>()
        .unwrap();
    let property = repo
        .get_property_definition_with_owner(user_property_id, &user_1(), Some(team_1()))
        .await?;
    assert!(property.is_some());

    // A different user cannot access someone else's user property.
    let property = repo
        .get_property_definition_with_owner(user_property_id, &user_3(), Some(team_1()))
        .await?;
    assert!(property.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn list_property_definitions_with_options(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let properties = repo
        .list_property_definitions_with_options(Some(team_1()), None, false)
        .await?;

    assert_eq!(properties.len(), 10);

    // Priority property should have 4 options, properly ordered.
    let priority_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Priority")
        .unwrap();

    assert_eq!(priority_prop.property_options.len(), 4);
    assert_eq!(priority_prop.property_options[0].display_order, 0);
    assert_eq!(
        priority_prop.property_options[0].value,
        PropertyOptionValue::String("Low".to_string())
    );

    // Non-select properties should have no options.
    let completed_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Completed")
        .unwrap();
    assert_eq!(completed_prop.definition.data_type, DataType::Boolean);
    assert_eq!(completed_prop.property_options.len(), 0);

    // Number select options.
    let score_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Score")
        .unwrap();
    assert_eq!(score_prop.property_options.len(), 5);
    assert_eq!(score_prop.definition.data_type, DataType::SelectNumber);
    assert_eq!(
        score_prop.property_options[0].value,
        PropertyOptionValue::Number(4.0)
    );

    // Multi-select string options.
    let dept_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Department")
        .unwrap();
    assert!(dept_prop.definition.is_multi_select);
    assert_eq!(dept_prop.definition.data_type, DataType::SelectString);
    assert_eq!(dept_prop.property_options.len(), 3);
    assert_eq!(
        dept_prop.property_options[0].value,
        PropertyOptionValue::String("Engineering".to_string())
    );
    assert_eq!(
        dept_prop.property_options[1].value,
        PropertyOptionValue::String("Human Resources".to_string())
    );
    assert_eq!(
        dept_prop.property_options[2].value,
        PropertyOptionValue::String("Marketing".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn create_property_definition_simple(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let property = repo
        .create_property_definition(
            PropertyDefinitionOwner::Team(team_1()),
            "New Test Property",
            DataType::String,
            false,
            None,
            Vec::new(),
        )
        .await?;

    assert_eq!(property.display_name, "New Test Property");
    assert_eq!(property.data_type, DataType::String);
    assert!(!property.is_multi_select);
    assert!(property.specific_entity_type.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn create_property_definition_user_owned(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let property = repo
        .create_property_definition(
            PropertyDefinitionOwner::User(&user_1()),
            "My User Property",
            DataType::Number,
            false,
            None,
            Vec::new(),
        )
        .await?;

    assert_eq!(property.display_name, "My User Property");
    assert_eq!(property.data_type, DataType::Number);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn create_property_definition_duplicate_name_fails(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    // "Test Priority" already exists for team 1 in the fixture.
    let result = repo
        .create_property_definition(
            PropertyDefinitionOwner::Team(team_1()),
            "Test Priority",
            DataType::String,
            false,
            None,
            Vec::new(),
        )
        .await;

    assert!(result.is_err());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn create_property_definition_with_options(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    let options = vec![
        new_option(0, PropertyOptionValue::String("Alpha".to_string())),
        new_option(1, PropertyOptionValue::String("Beta".to_string())),
    ];

    let property = repo
        .create_property_definition(
            PropertyDefinitionOwner::Team(team_1()),
            "Select With Options",
            DataType::SelectString,
            false,
            None,
            options,
        )
        .await?;

    let option_count: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM property_options WHERE property_definition_id = $1"#,
        property.id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(option_count, 2);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn create_property_definition_specific_entity(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let property = repo
        .create_property_definition(
            PropertyDefinitionOwner::Team(team_1()),
            "Document Only Property",
            DataType::String,
            false,
            Some(EntityType::Document),
            Vec::new(),
        )
        .await?;

    assert_eq!(property.specific_entity_type, Some(EntityType::Document));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn delete_property_definition_removes_definition(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let property_id = "11111111-1111-1111-1111-111111111111"
        .parse::<Uuid>()
        .unwrap();

    // Verify it exists
    assert!(repo.get_property_definition(property_id).await?.is_some());

    // Delete it
    repo.delete_property_definition(property_id).await?;

    // Verify it's gone
    assert!(repo.get_property_definition(property_id).await?.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn delete_property_definition_cascades(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    let property_id = "11111111-1111-1111-1111-111111111111"
        .parse::<Uuid>()
        .unwrap();

    // Verify options and entity properties exist for this definition.
    let options_before: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM property_options WHERE property_definition_id = $1"#,
        property_id
    )
    .fetch_one(&pool)
    .await?;
    assert!(options_before > 0);

    let entity_props_before: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM entity_properties WHERE property_definition_id = $1"#,
        property_id
    )
    .fetch_one(&pool)
    .await?;
    assert!(entity_props_before > 0);

    repo.delete_property_definition(property_id).await?;

    // Verify options and entity properties are also deleted (cascade).
    let options_after: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM property_options WHERE property_definition_id = $1"#,
        property_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(options_after, 0);

    let entity_props_after: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM entity_properties WHERE property_definition_id = $1"#,
        property_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(entity_props_after, 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn delete_nonexistent_property_definition_is_noop(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let property_id = "00000000-0000-0000-0000-000000000000"
        .parse::<Uuid>()
        .unwrap();

    // Deleting non-existent property should succeed (no error)
    repo.delete_property_definition(property_id).await?;

    Ok(())
}
