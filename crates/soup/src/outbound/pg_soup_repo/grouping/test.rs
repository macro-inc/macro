use super::*;
use crate::outbound::pg_soup_repo::expanded::dynamic::{
    GroupedDynamicCursorArgs, expanded_dynamic_cursor_soup_grouped,
};
use item_filters::ast::EntityFilterAst;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_grouping::date_bucket_sql_key;
use models_grouping::{GroupingConfig, date_bucket_order};
use models_pagination::{Identify, Query, SimpleSortMethod};
use sqlx::{Pool, Postgres};

#[test]
fn date_bucket_select_contains_all_keys() {
    let expr = date_bucket_sql_key("sort_ts");
    assert!(expr.contains("'today'"));
    assert!(expr.contains("'yesterday'"));
    assert!(expr.contains("'this_week'"));
    assert!(expr.contains("'last_week'"));
    assert!(expr.contains("'this_month'"));
    assert!(expr.contains("'last_month'"));
    assert!(expr.contains("'older'"));
}

#[test]
fn date_bucket_order_matches_display_order() {
    assert_eq!(date_bucket_order("today"), 0);
    assert_eq!(date_bucket_order("yesterday"), 1);
    assert_eq!(date_bucket_order("this_week"), 2);
    assert_eq!(date_bucket_order("older"), 6);
    assert_eq!(date_bucket_order("unknown"), 6);
}

#[test]
fn entity_type_expr() {
    let expr = group_select_expr(&GroupByField::EntityType);
    assert_eq!(&*expr, "item_type");
}

#[test]
fn project_expr() {
    let expr = group_select_expr(&GroupByField::Project);
    assert!(expr.contains("project_id"));
    assert!(expr.contains("COALESCE"));
}

#[test]
fn property_join_includes_definition_id() {
    let field = GroupByField::Property {
        property_definition_id: uuid::Uuid::nil(),
        entity_type: None,
    };
    let join = group_join_clause(&field).unwrap();
    assert!(join.sql.contains("ep_group"));
    assert!(join.sql.contains(&uuid::Uuid::nil().to_string()));
}

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn property_grouping_uses_canonical_task_entity_type(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const TASK_ID: &str = "11111111-0000-0000-0000-000000000000";
    const STATUS_PROPERTY_ID: uuid::Uuid = uuid::uuid!("00000001-0000-0000-0000-000000000002");
    const IN_PROGRESS_OPTION_ID: &str = "00000001-0000-0000-0002-000000000002";

    sqlx::query!(
        r#"
        INSERT INTO document_sub_type (document_id, sub_type)
        VALUES ('11111111-0000-0000-0000-000000000000', 'task')
        "#
    )
    .execute(&pool)
    .await?;

    // A task and its canonical Document share an id. Legacy data can contain
    // assignments under both storage types; only the TASK value is relevant.
    sqlx::query!(
        r#"
        INSERT INTO entity_properties
            (id, entity_id, entity_type, property_definition_id, values)
        VALUES
            (
                'e0000000-0000-0000-0000-000000000001',
                '11111111-0000-0000-0000-000000000000',
                'DOCUMENT',
                '00000001-0000-0000-0000-000000000002',
                '{"type":"SelectOption","value":["00000001-0000-0000-0002-000000000001"]}'::jsonb
            ),
            (
                'e0000000-0000-0000-0000-000000000002',
                '11111111-0000-0000-0000-000000000000',
                'TASK',
                '00000001-0000-0000-0000-000000000002',
                '{"type":"SelectOption","value":["00000001-0000-0000-0002-000000000002"]}'::jsonb
            )
        "#
    )
    .execute(&pool)
    .await?;

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(
                SimpleSortMethod::ViewedUpdated,
                EntityFilterAst::mock_empty(),
            ),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::Property {
                    property_definition_id: STATUS_PROPERTY_ID,
                    entity_type: None,
                },
                group_key: None,
                per_group_limit: None,
            },
        },
    )
    .await?
    .filter(|item| item.item.id().to_string() == TASK_ID)
    .collect::<Vec<_>>();

    assert_eq!(items.len(), 1, "task must belong to exactly one status bin");
    assert_eq!(items[0].key, IN_PROGRESS_OPTION_ID);

    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_grouped_by_entity_type(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let grouping = GroupingConfig {
        field: GroupByField::EntityType,
        group_key: None,
        per_group_limit: None,
    };

    let items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(
                SimpleSortMethod::ViewedUpdated,
                EntityFilterAst::mock_empty(),
            ),
            exclude_frecency: false,
            grouping,
        },
    )
    .await?
    .collect::<Vec<_>>();

    assert!(!items.is_empty(), "Should return some items");

    // Check that items have group keys
    for item in &items {
        assert!(
            ["document", "chat", "project"].contains(&item.key.as_str()),
            "Group key should be a valid entity type, got: {}",
            item.key
        );
    }

    // Check that group_total_count is populated
    for item in &items {
        assert!(
            item.total_group_count > 0,
            "group_total_count should be > 0"
        );
    }

    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_grouped_by_project(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let grouping = GroupingConfig {
        field: GroupByField::Project,
        group_key: None,
        per_group_limit: None,
    };

    let items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(
                SimpleSortMethod::ViewedUpdated,
                EntityFilterAst::mock_empty(),
            ),
            exclude_frecency: false,
            grouping,
        },
    )
    .await?
    .collect::<Vec<_>>();

    assert!(!items.is_empty(), "Should return some items");

    // Group keys should be UUIDs or empty string (for unassigned)
    for item in &items {
        if !item.key.is_empty() {
            uuid::Uuid::parse_str(&item.key).expect("Non-empty group key should be a valid UUID");
        }
    }

    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn test_grouped_single_group_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    // First, get all items grouped by entity type
    let all_items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(
                SimpleSortMethod::ViewedUpdated,
                EntityFilterAst::mock_empty(),
            ),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::EntityType,
                group_key: None,
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect::<Vec<_>>();

    // Find a group key that has items
    let target_group_key = all_items.first().map(|i| i.key.clone());
    let Some(group_key) = target_group_key else {
        return Ok(()); // No items to test with
    };

    // Now fetch only that group
    let filtered_items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(
                SimpleSortMethod::ViewedUpdated,
                EntityFilterAst::mock_empty(),
            ),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::EntityType,
                group_key: Some(group_key.clone()),
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect::<Vec<_>>();

    // All returned items should have the same group key
    for item in &filtered_items {
        assert_eq!(
            item.key, group_key,
            "All items should belong to the filtered group"
        );
    }

    Ok(())
}
