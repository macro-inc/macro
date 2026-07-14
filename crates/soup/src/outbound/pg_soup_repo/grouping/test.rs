use super::*;
use crate::outbound::pg_soup_repo::expanded::dynamic::{
    GroupedDynamicCursorArgs, expanded_dynamic_cursor_soup_grouped,
};
use item_filters::ast::EntityFilterAst;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_grouping::date_bucket_sql_key;
use models_grouping::{GroupingConfig, date_bucket_order};
use models_pagination::{Query, SimpleSortMethod};
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
    .await?;

    assert!(!items.is_empty(), "Should return some items");

    // Check that items have group keys
    for item in &items {
        assert!(
            ["document", "chat", "project"].contains(&item.group_key.as_str()),
            "Group key should be a valid entity type, got: {}",
            item.group_key
        );
    }

    // Check that group_total_count is populated
    for item in &items {
        assert!(
            item.group_total_count > 0,
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
    .await?;

    assert!(!items.is_empty(), "Should return some items");

    // Group keys should be UUIDs or empty string (for unassigned)
    for item in &items {
        if !item.group_key.is_empty() {
            uuid::Uuid::parse_str(&item.group_key)
                .expect("Non-empty group_key should be a valid UUID");
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
    .await?;

    // Find a group key that has items
    let target_group_key = all_items.first().map(|i| i.group_key.clone());
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
    .await?;

    // All returned items should have the same group key
    for item in &filtered_items {
        assert_eq!(
            item.group_key, group_key,
            "All items should belong to the filtered group"
        );
    }

    Ok(())
}
