//! Integration tests for property option and tag operations on PropertiesPgRepo.

use super::properties_pg_repo::PropertiesPgRepo;
use crate::domain::model::{PropertyDefinitionOwner, UpdatePropertyOptionOutcome};
use crate::domain::ports::PropertiesRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityType};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const PRIORITY_PROPERTY_ID: &str = "11111111-1111-1111-1111-111111111111";
const SCORE_PROPERTY_ID: &str = "44444444-4444-4444-4444-444444444444";
const PRIORITY_OPTION_LOW: &str = "10111111-1111-1111-1111-111111111111";
const PRIORITY_OPTION_MEDIUM: &str = "10111111-1111-1111-1111-111111111112";
const PRIORITY_OPTION_HIGH: &str = "10111111-1111-1111-1111-111111111113";
const PRIORITY_OPTION_URGENT: &str = "10111111-1111-1111-1111-111111111114";

fn team_1() -> Uuid {
    "0e000000-0000-0000-0000-000000000001".parse().unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn create_property_option_string(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);
    let property_id = PRIORITY_PROPERTY_ID.parse::<Uuid>().unwrap();

    let options_before = repo.get_property_options(property_id).await?;
    assert_eq!(options_before.len(), 4);

    let option = repo
        .create_property_option(
            property_id,
            4,
            PropertyOptionValue::String("Extra High".to_string()),
            None,
        )
        .await?;

    let options_after = repo.get_property_options(property_id).await?;
    assert_eq!(options_after.len(), 5);

    assert_eq!(option.display_order, 4);
    assert_eq!(option.property_definition_id, property_id);
    assert_eq!(
        option.value,
        PropertyOptionValue::String("Extra High".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn create_property_option_number(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);
    let property_id = SCORE_PROPERTY_ID.parse::<Uuid>().unwrap();

    let option = repo
        .create_property_option(property_id, 0, PropertyOptionValue::Number(3.5), None)
        .await?;

    assert_eq!(option.display_order, 0);
    assert_eq!(option.value, PropertyOptionValue::Number(3.5));

    // Options are ordered by display_order, so the new option sorts first.
    let options = repo.get_property_options(property_id).await?;
    assert_eq!(options[0].value, PropertyOptionValue::Number(3.5));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn create_property_option_duplicate_fails(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    // "Low" already exists on the priority property.
    let result = repo
        .create_property_option(
            PRIORITY_PROPERTY_ID.parse().unwrap(),
            4,
            PropertyOptionValue::String("Low".to_string()),
            None,
        )
        .await;
    assert!(result.is_err());

    // 1.0 already exists on the score property.
    let result = repo
        .create_property_option(
            SCORE_PROPERTY_ID.parse().unwrap(),
            5,
            PropertyOptionValue::Number(1.0),
            None,
        )
        .await;
    assert!(result.is_err());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn create_property_option_invalid_property_fails(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let result = repo
        .create_property_option(
            Uuid::nil(),
            0,
            PropertyOptionValue::String("Test".to_string()),
            None,
        )
        .await;

    assert!(result.is_err()); // Foreign key constraint violation

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn update_property_option_renames_and_recolors(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);
    let option_id = PRIORITY_OPTION_LOW.parse::<Uuid>().unwrap();

    let outcome = repo
        .update_property_option(
            option_id,
            PropertyOptionValue::String("Lowest".to_string()),
            Some("#FF0000".to_string()),
            3,
        )
        .await?;

    // Same id, so every entity referencing it resolves the new value/color (propagation by id).
    let UpdatePropertyOptionOutcome::Updated(updated) = outcome else {
        panic!("expected Updated outcome");
    };
    assert_eq!(updated.id, option_id);
    assert_eq!(updated.color.as_deref(), Some("#FF0000"));
    assert_eq!(updated.display_order, 3);
    assert_eq!(
        updated.value,
        PropertyOptionValue::String("Lowest".to_string())
    );

    let fetched = repo
        .get_property_option(option_id)
        .await?
        .expect("option should still exist");
    assert_eq!(fetched.color.as_deref(), Some("#FF0000"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn update_property_option_missing_returns_not_found(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let outcome = repo
        .update_property_option(
            Uuid::nil(),
            PropertyOptionValue::String("x".to_string()),
            None,
            0,
        )
        .await?;

    assert!(matches!(outcome, UpdatePropertyOptionOutcome::NotFound));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn update_property_option_duplicate_value(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);
    let option_id = PRIORITY_OPTION_LOW.parse::<Uuid>().unwrap();

    // "Medium" already exists on the same property.
    let outcome = repo
        .update_property_option(
            option_id,
            PropertyOptionValue::String("Medium".to_string()),
            None,
            0,
        )
        .await?;

    assert!(matches!(
        outcome,
        UpdatePropertyOptionOutcome::DuplicateValue
    ));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn delete_property_option_removes_option(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);
    let property_id = PRIORITY_PROPERTY_ID.parse::<Uuid>().unwrap();
    let option_id = PRIORITY_OPTION_LOW.parse::<Uuid>().unwrap();

    assert!(repo.get_property_option(option_id).await?.is_some());

    let deleted = repo.delete_property_option(property_id, option_id).await?;
    assert!(deleted);

    assert!(repo.get_property_option(option_id).await?.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn delete_nonexistent_property_option(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);

    let deleted = repo
        .delete_property_option(PRIORITY_PROPERTY_ID.parse().unwrap(), Uuid::nil())
        .await?;
    assert!(!deleted);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn delete_property_option_reduces_count(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);
    let property_id = PRIORITY_PROPERTY_ID.parse::<Uuid>().unwrap();
    let option_id = PRIORITY_OPTION_LOW.parse::<Uuid>().unwrap();

    let count_before = repo.get_property_options(property_id).await?.len();

    repo.delete_property_option(property_id, option_id).await?;

    let count_after = repo.get_property_options(property_id).await?.len();
    assert_eq!(count_after, count_before - 1);

    Ok(())
}

/// Reproduces the dangling-option bug: an entity value referencing
/// [A, B, C, D] must drop D once option D is deleted, so a later set-value
/// echoing the surviving ids passes option validation.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn delete_property_option_strips_value_references(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let property_id = PRIORITY_PROPERTY_ID.parse::<Uuid>().unwrap();
    let opt_a = PRIORITY_OPTION_LOW.parse::<Uuid>().unwrap();
    let opt_b = PRIORITY_OPTION_MEDIUM.parse::<Uuid>().unwrap();
    let opt_c = PRIORITY_OPTION_HIGH.parse::<Uuid>().unwrap();
    let opt_d = PRIORITY_OPTION_URGENT.parse::<Uuid>().unwrap();

    // Entity selects all four options.
    repo.upsert_entity_property(
        "doc_cascade",
        EntityType::Document,
        property_id,
        Some(PropertyValue::SelectOption(vec![
            opt_a, opt_b, opt_c, opt_d,
        ])),
    )
    .await?;

    // A new option created after selection (the "new tag" in the repro).
    let opt_e = repo
        .create_property_option(
            property_id,
            4,
            PropertyOptionValue::String("New".to_string()),
            None,
        )
        .await?
        .id;

    // Delete option D.
    let deleted = repo.delete_property_option(property_id, opt_d).await?;
    assert!(deleted);

    // Read the raw stored value (bypassing the read-path cleaner) to prove
    // the dangling id is gone from storage, not just filtered on read.
    let raw: serde_json::Value = sqlx::query_scalar!(
        r#"
        SELECT values as "values!: serde_json::Value"
        FROM entity_properties
        WHERE entity_id = $1 AND entity_type = $2 AND property_definition_id = $3
        "#,
        "doc_cascade",
        EntityType::Document as EntityType,
        property_id
    )
    .fetch_one(&pool)
    .await?;

    let stored: PropertyValue = serde_json::from_value(raw)?;
    let PropertyValue::SelectOption(ids) = stored else {
        panic!("expected SelectOption");
    };
    assert_eq!(ids, vec![opt_a, opt_b, opt_c]);

    // The surviving selection plus the new option all validate, so the
    // set-value that previously 400'd now succeeds.
    let valid = repo
        .count_valid_property_options(property_id, &[opt_a, opt_b, opt_c, opt_e])
        .await?;
    assert_eq!(valid, 4);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_or_create_tag_definition_is_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);
    let owner = PropertyDefinitionOwner::Team(team_1());

    let first = repo.get_or_create_tag_definition(owner).await?;
    assert_eq!(first.data_type, DataType::Tag);
    assert!(first.is_multi_select);

    // A second call returns the same definition rather than creating a duplicate.
    let second = repo.get_or_create_tag_definition(owner).await?;
    assert_eq!(first.id, second.id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_tag_definition_none_then_some(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);
    let owner = PropertyDefinitionOwner::Team(team_1());

    let before = repo.get_tag_definition(owner).await?;
    assert!(before.is_none());

    let created = repo.get_or_create_tag_definition(owner).await?;

    let after = repo.get_tag_definition(owner).await?;
    assert_eq!(after.map(|d| d.id), Some(created.id));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_or_create_tag_definition_coexists_with_same_named_property(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool);
    let owner = PropertyDefinitionOwner::Team(team_1());

    // Owner already has a non-tag property literally named "Tags".
    repo.create_property_definition(owner, "Tags", DataType::String, false, None, Vec::new())
        .await?;

    // Provisioning the tag set still succeeds: tag definitions are exempt from the
    // display-name uniqueness that applies to user-created properties.
    let tag_def = repo.get_or_create_tag_definition(owner).await?;
    assert_eq!(tag_def.data_type, DataType::Tag);

    let again = repo.get_or_create_tag_definition(owner).await?;
    assert_eq!(tag_def.id, again.id);

    Ok(())
}
