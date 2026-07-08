//! Integration tests for entity property reads, deletes, and option batch queries.

use super::{entity_properties_get_query, entity_property_queries, property_option_queries};
use chrono::Datelike;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityReference, EntityType};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_entity_properties_values_sorted(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc1",
        EntityType::Document,
    )
    .await?;

    assert_eq!(properties.len(), 6);

    // Verify they are sorted by display name (case-insensitive alphabetical)
    assert_eq!(properties[0].definition.display_name, "Test Assigned To");
    assert_eq!(properties[1].definition.display_name, "Test Completed");
    assert_eq!(properties[2].definition.display_name, "Test Department");
    assert_eq!(properties[3].definition.display_name, "Test Description");
    assert_eq!(properties[4].definition.display_name, "Test Due Date");
    assert_eq!(properties[5].definition.display_name, "Test Priority");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_entity_properties_values_value_kinds(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc1",
        EntityType::Document,
    )
    .await?;

    // Select property has its options attached.
    let priority_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Priority")
        .unwrap();
    assert_eq!(priority_prop.options.as_ref().unwrap().len(), 4);

    // Boolean value
    let completed_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Completed")
        .unwrap();
    assert_eq!(completed_prop.value, Some(PropertyValue::Bool(false)));

    // String value
    let desc_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Description")
        .unwrap();
    assert_eq!(
        desc_prop.value,
        Some(PropertyValue::Str(
            "Important document for testing".to_string()
        ))
    );

    // Date value
    let date_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Due Date")
        .unwrap();
    assert_eq!(date_prop.definition.data_type, DataType::Date);
    let Some(PropertyValue::Date(date)) = &date_prop.value else {
        panic!("Expected Date value");
    };
    assert_eq!((date.year(), date.month(), date.day()), (2025, 12, 31));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_entity_properties_values_null_values(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc3",
        EntityType::Document,
    )
    .await?;

    // doc3 has 3 properties with NULL values
    assert_eq!(properties.len(), 3);

    for prop in properties {
        assert!(prop.value.is_none());
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_entity_properties_values_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "nonexistent",
        EntityType::Document,
    )
    .await?;

    assert_eq!(properties.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_entity_properties_entity_references(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Single entity reference on doc1.
    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc1",
        EntityType::Document,
    )
    .await?;
    let assigned_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Assigned To")
        .unwrap();
    assert_eq!(assigned_prop.definition.data_type, DataType::Entity);
    assert_eq!(
        assigned_prop.definition.specific_entity_type,
        Some(EntityType::User)
    );
    assert!(assigned_prop.definition.is_multi_select);
    let Some(PropertyValue::EntityRef(refs)) = &assigned_prop.value else {
        panic!("Expected EntityReference value");
    };
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].entity_id, "macro|user1@test.com");
    assert_eq!(refs[0].entity_type, EntityType::User);

    // Multiple entity references on doc2.
    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc2",
        EntityType::Document,
    )
    .await?;
    let assigned_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Assigned To")
        .unwrap();
    let Some(PropertyValue::EntityRef(refs)) = &assigned_prop.value else {
        panic!("Expected EntityReference value with 2 users");
    };
    assert_eq!(refs.len(), 2);
    let user_ids: Vec<&str> = refs.iter().map(|r| r.entity_id.as_str()).collect();
    assert!(user_ids.contains(&"macro|user1@test.com"));
    assert!(user_ids.contains(&"macro|user2@test.com"));

    // Null entity reference on doc3.
    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc3",
        EntityType::Document,
    )
    .await?;
    let assigned_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Assigned To")
        .unwrap();
    assert_eq!(assigned_prop.definition.data_type, DataType::Entity);
    assert!(assigned_prop.value.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_entity_properties_multi_select_string(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc2",
        EntityType::Document,
    )
    .await?;

    // Department property is a multi-select SELECT_STRING
    let dept_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Department")
        .unwrap();

    assert_eq!(dept_prop.definition.data_type, DataType::SelectString);
    assert!(dept_prop.definition.is_multi_select);

    let options = dept_prop.options.as_ref().unwrap();
    assert_eq!(options.len(), 3); // Engineering, Marketing, Human Resources

    let Some(PropertyValue::SelectOption(ids)) = &dept_prop.value else {
        panic!("Expected SelectOption value with 2 departments");
    };
    assert_eq!(ids.len(), 2);
    for id in ids {
        assert!(options.iter().any(|opt| opt.id == *id));
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_entity_properties_link_and_number_values(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "proj1",
        EntityType::Project,
    )
    .await?;

    let link_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Website")
        .unwrap();
    assert_eq!(link_prop.definition.data_type, DataType::Link);
    assert_eq!(
        link_prop.value,
        Some(PropertyValue::Link(vec!["https://example.com".to_string()]))
    );

    let budget_prop = properties
        .iter()
        .find(|p| p.definition.display_name == "Test Budget")
        .unwrap();
    assert_eq!(budget_prop.definition.data_type, DataType::Number);
    assert_eq!(budget_prop.value, Some(PropertyValue::Num(50000.50)));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_bulk_entity_properties(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let entity_refs = vec![
        EntityReference::new("doc1", EntityType::Document),
        EntityReference::new("doc2", EntityType::Document),
        EntityReference::new("proj1", EntityType::Project),
    ];
    let properties_map =
        entity_properties_get_query::get_bulk_entity_properties_values(&pool, &entity_refs).await?;

    assert_eq!(properties_map.len(), 3);
    assert_eq!(properties_map.get("doc1").unwrap().len(), 6);
    assert_eq!(properties_map.get("doc2").unwrap().len(), 4);
    assert_eq!(properties_map.get("proj1").unwrap().len(), 5);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_bulk_entity_properties_includes_empty_entities(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let entity_refs = vec![
        EntityReference::new("doc1", EntityType::Document),
        EntityReference::new("nonexistent", EntityType::Document),
    ];
    let properties_map =
        entity_properties_get_query::get_bulk_entity_properties_values(&pool, &entity_refs).await?;

    // Both entities should be in the map
    assert_eq!(properties_map.len(), 2);
    assert!(properties_map.contains_key("doc1"));
    assert!(properties_map.contains_key("nonexistent"));

    // nonexistent should have empty array
    assert_eq!(properties_map.get("nonexistent").unwrap().len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_bulk_entity_properties_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let entity_refs: Vec<EntityReference> = vec![];
    let properties_map =
        entity_properties_get_query::get_bulk_entity_properties_values(&pool, &entity_refs).await?;

    assert_eq!(properties_map.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn lookup_entity_property(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let entity_property_id = "e0111111-1111-1111-1111-111111111111"
        .parse::<Uuid>()
        .unwrap();
    let info = entity_properties_get_query::lookup_entity_property(&pool, entity_property_id)
        .await?
        .expect("entity property should exist");

    assert_eq!(info.entity_id, "doc1");
    assert_eq!(info.entity_type, EntityType::Document);
    assert_eq!(
        info.property_definition_id,
        "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap()
    );

    // Nonexistent id yields None.
    let missing = entity_properties_get_query::lookup_entity_property(&pool, Uuid::nil()).await?;
    assert!(missing.is_none());

    Ok(())
}

/// Definition ids returned for tagdoc1 given a set of requested property
/// ids and an optional tag viewer.
async fn tagdoc_definition_ids(
    pool: &Pool<Postgres>,
    property_ids: &[Uuid],
    tag_viewer: Option<&macro_user_id::user_id::MacroUserIdStr<'_>>,
) -> anyhow::Result<Vec<Uuid>> {
    let entity_refs = vec![EntityReference {
        entity_id: "tagdoc1".to_string(),
        entity_type: EntityType::Document,
        specific_message_id: None,
    }];
    let map = entity_properties_get_query::get_bulk_entity_properties_values_filtered(
        pool,
        &entity_refs,
        property_ids,
        tag_viewer,
    )
    .await?;
    Ok(map["tagdoc1"]
        .iter()
        .map(|p| p.definition.id)
        .collect::<Vec<_>>())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties", "tags"))
)]
async fn get_bulk_filtered_includes_caller_visible_tags(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let priority = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let user1_tags = Uuid::parse_str("aa111111-1111-1111-1111-111111111111")?;
    let team1_tags = Uuid::parse_str("aa222222-2222-2222-2222-222222222222")?;
    let user2_tags = Uuid::parse_str("aa333333-3333-3333-3333-333333333333")?;

    // user1 sees the requested id plus their own and their team's tags,
    // never another user's personal tags.
    let user1 =
        macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap();
    let user3 =
        macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user3@test.com").unwrap();

    let ids = tagdoc_definition_ids(&pool, &[priority], Some(&user1)).await?;
    assert_eq!(ids.len(), 3);
    assert!(ids.contains(&priority));
    assert!(ids.contains(&user1_tags));
    assert!(ids.contains(&team1_tags));
    assert!(!ids.contains(&user2_tags));

    // A teammate without a personal set sees only the team tags.
    let ids = tagdoc_definition_ids(&pool, &[priority], Some(&user3)).await?;
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&priority));
    assert!(ids.contains(&team1_tags));

    // No viewer: only the explicitly requested ids.
    let ids = tagdoc_definition_ids(&pool, &[priority], None).await?;
    assert_eq!(ids, vec![priority]);

    // A viewer with no requested ids still gets their tags.
    let ids = tagdoc_definition_ids(&pool, &[], Some(&user1)).await?;
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&user1_tags));
    assert!(ids.contains(&team1_tags));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn delete_entity_property_removes_property(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let entity_property_id = "e0111111-1111-1111-1111-111111111111"
        .parse::<Uuid>()
        .unwrap();

    let properties_before = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc1",
        EntityType::Document,
    )
    .await?;
    let initial_count = properties_before.len();
    assert!(initial_count > 0);

    entity_property_queries::delete_entity_property(&pool, entity_property_id).await?;

    let properties_after = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc1",
        EntityType::Document,
    )
    .await?;
    assert_eq!(properties_after.len(), initial_count - 1);

    // Deleting a non-existent entity property should succeed (no error).
    entity_property_queries::delete_entity_property(&pool, Uuid::nil()).await?;

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn delete_entity_properties_only_deletes_specific_entity(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let entity_ref = EntityReference::new("doc1", EntityType::Document);

    let doc1_before = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc1",
        EntityType::Document,
    )
    .await?;
    assert!(!doc1_before.is_empty());
    let doc2_before = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc2",
        EntityType::Document,
    )
    .await?;
    let proj1_before = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "proj1",
        EntityType::Project,
    )
    .await?;
    assert!(!proj1_before.is_empty());

    entity_property_queries::delete_entity_properties(&pool, &entity_ref).await?;

    // doc1's properties are gone; doc2 and proj1 are unchanged.
    let doc1_after = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc1",
        EntityType::Document,
    )
    .await?;
    assert_eq!(doc1_after.len(), 0);
    let doc2_after = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "doc2",
        EntityType::Document,
    )
    .await?;
    assert_eq!(doc2_after.len(), doc2_before.len());
    let proj1_after = entity_properties_get_query::get_entity_properties_values(
        &pool,
        "proj1",
        EntityType::Project,
    )
    .await?;
    assert_eq!(proj1_after.len(), proj1_before.len());

    // Deleting a non-existent entity should succeed (no error).
    let nonexistent_ref = EntityReference::new("nonexistent", EntityType::Document);
    entity_property_queries::delete_entity_properties(&pool, &nonexistent_ref).await?;

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn get_property_options_batch(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let property_ids = vec![
        "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap(), // Priority: 4 options
        "44444444-4444-4444-4444-444444444444"
            .parse::<Uuid>()
            .unwrap(), // Score: 5 options
    ];

    let options_map =
        property_option_queries::get_property_options_batch(&pool, &property_ids).await?;

    assert_eq!(options_map.len(), 2);
    assert_eq!(options_map.get(&property_ids[0]).unwrap().len(), 4);
    assert_eq!(options_map.get(&property_ids[1]).unwrap().len(), 5);

    // Empty input yields an empty map.
    let empty = property_option_queries::get_property_options_batch(&pool, &[]).await?;
    assert_eq!(empty.len(), 0);

    Ok(())
}
