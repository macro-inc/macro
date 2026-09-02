use super::*;
use crate::outbound::pg_soup_repo::expanded::dynamic::{
    GroupedDynamicCursorArgs, expanded_dynamic_cursor_soup_grouped,
};
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst, calendar_event::CalendarEventLiteral, chat::ChatLiteral,
    document::DocumentLiteral,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_grouping::date_bucket_sql_key;
use models_grouping::{GroupingConfig, date_bucket_order};
use models_pagination::{Identify, Query, SimpleSortMethod};
use sqlx::{Pool, Postgres};
use std::sync::Arc;

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

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn tagged_calendar_event_participates_in_grouped_property_soup(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const OWNER_ID: &str = "macro|user-1@test.com";
    const EVENT_ID: uuid::Uuid = uuid::uuid!("ca1e0000-0000-0000-0000-000000000001");
    const LINK_ID: uuid::Uuid = uuid::uuid!("ca1e0000-0000-0000-0000-000000000002");
    const STATUS_PROPERTY_ID: uuid::Uuid = uuid::uuid!("00000001-0000-0000-0000-000000000002");
    const IN_PROGRESS_OPTION_ID: &str = "00000001-0000-0000-0002-000000000002";

    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, 'calendar-grouping@example.com', 'GMAIL')
        "#,
        LINK_ID,
        OWNER_ID,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO calendar_events (
            id, owner_id, source_link_id, ical_uid, title,
            starts_at, ends_at, canonical_source_kind, canonical_source_updated_at
        )
        VALUES (
            $1, $2, $3, 'grouped@example.com', 'Grouped calendar event',
            '2026-07-24T14:00:00Z', '2026-07-24T15:00:00Z', 'google',
            '2026-07-24T12:00:00Z'
        )
        "#,
        EVENT_ID,
        OWNER_ID,
        LINK_ID,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO entity_properties
            (id, entity_id, entity_type, property_definition_id, values)
        VALUES (
            'ca1e0000-0000-0000-0000-000000000003',
            ($1::uuid)::text,
            'CALENDAR_EVENT',
            $2,
            '{"type":"SelectOption","value":["00000001-0000-0000-0002-000000000002"]}'::jsonb
        )
        "#,
        EVENT_ID,
        STATUS_PROPERTY_ID,
    )
    .execute(&pool)
    .await?;

    let user_id = MacroUserIdStr::parse_from_str(OWNER_ID).unwrap();
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
    .filter(|item| item.item.id() == EVENT_ID)
    .collect::<Vec<_>>();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].key, IN_PROGRESS_OPTION_ID);
    assert!(matches!(
        items[0].item,
        models_soup::item::SoupItem::CalendarEvent(_)
    ));

    Ok(())
}

/// A fired reminder counts as the event's latest activity: the grouped
/// recency sort must place the event at its delivery time, not at the older
/// Google last-modified time that made reminder rows surface in the past.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grouped_recency_sort_uses_reminder_delivery_time(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const OWNER_ID: &str = "macro|calendar-fired-grouped@example.com";
    let link_id = uuid::Uuid::now_v7();
    let reminded_id = uuid::Uuid::now_v7();
    let edited_id = uuid::Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, 'calendar-fired-grouped@example.com', 'GMAIL')
        "#,
        link_id,
        OWNER_ID,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO calendar_events (
            id, owner_id, source_link_id, ical_uid, title,
            starts_at, ends_at, canonical_source_kind,
            canonical_source_updated_at, updated_at, last_reminder_fired_at
        )
        VALUES (
            $1, $2, $3, 'reminded-grouped@example.com', 'Reminded event',
            now(), now() + interval '1 hour', 'google', now(),
            now() - interval '10 days', now()
        )
        "#,
        reminded_id,
        OWNER_ID,
        link_id,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO calendar_events (
            id, owner_id, source_link_id, ical_uid, title,
            starts_at, ends_at, canonical_source_kind,
            canonical_source_updated_at, updated_at
        )
        VALUES (
            $1, $2, $3, 'edited-grouped@example.com', 'Edited event',
            now(), now() + interval '1 hour', 'google', now(),
            now() - interval '1 day'
        )
        "#,
        edited_id,
        OWNER_ID,
        link_id,
    )
    .execute(&pool)
    .await?;

    let user_id = MacroUserIdStr::parse_from_str(OWNER_ID).unwrap();
    let ids: Vec<uuid::Uuid> = expanded_dynamic_cursor_soup_grouped(
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
    .filter(|item| matches!(item.item, models_soup::item::SoupItem::CalendarEvent(_)))
    .map(|item| item.item.id())
    .collect();

    assert_eq!(ids, vec![reminded_id, edited_id]);
    Ok(())
}

/// Regression: when a filter makes an arm of the Combined UNION impossible,
/// the remaining arms must still type-align. Postgres resolves UNION column
/// types pairwise left-to-right, and untyped `NULL`s across two arms resolve
/// to `text`, which then clashed with the calendar-event arm's typed NULLs
/// ("UNION types text and boolean cannot be matched").
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_soup_runs_when_chat_arm_excluded(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    // Importance(false) never matches a chat, so the chat arm is omitted and
    // Combined unions document ∪ project ∪ calendar_event.
    let filter = EntityFilterAst {
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        ..EntityFilterAst::mock_empty()
    };

    let items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(SimpleSortMethod::ViewedUpdated, filter),
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

    assert!(!items.is_empty(), "documents and projects should remain");
    assert!(
        items.iter().all(|item| item.key != "chat"),
        "chats must be filtered out"
    );

    Ok(())
}

/// Same regression as [`grouped_soup_runs_when_chat_arm_excluded`] for the
/// document arm: chat ∪ project ∪ calendar_event previously failed with
/// "UNION types text and bigint cannot be matched".
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_soup_runs_when_document_arm_excluded(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    // A nil document id filter is impossible, so the document arm is omitted.
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::Id(uuid::Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    };

    let items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(SimpleSortMethod::ViewedUpdated, filter),
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

    assert!(!items.is_empty(), "chats and projects should remain");
    assert!(
        items.iter().all(|item| item.key != "document"),
        "documents must be filtered out"
    );

    Ok(())
}

/// Every Soup query sends a NIL calendar id to scope calendar events out. The
/// calendar arm was the one leg with no impossible-filter gate, so it stayed in
/// the union and pushed its id through `push_bind` — whose $1 collided with the
/// hand-numbered user id, failing with "operator does not exist: text = uuid".
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_soup_runs_when_calendar_arm_excluded(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let filter = EntityFilterAst {
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(
            uuid::Uuid::nil(),
        )))),
        ..EntityFilterAst::mock_empty()
    };

    let items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(SimpleSortMethod::ViewedUpdated, filter),
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

    assert!(!items.is_empty(), "documents and chats should remain");
    assert!(
        items.iter().all(|item| item.key != "calendar_event"),
        "calendar events must be filtered out"
    );

    Ok(())
}

/// The inbox surfaces calendar events through the grouped query with a
/// `NotificationDone(false)` filter: only events carrying a not-done
/// notification for the requester appear, and the filter renders bind-free so
/// it survives this query's hand-numbered parameters.
#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_soup_renders_bind_bearing_calendar_literals(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const OWNER_ID: &str = "macro|user-1@test.com";
    const LINK_ID: uuid::Uuid = uuid::uuid!("ca1e0000-0000-0000-0000-000000000030");
    const EVENT_ID: uuid::Uuid = uuid::uuid!("ca1e0000-0000-0000-0000-000000000031");

    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, 'calendar-binds-soup@example.com', 'GMAIL')
        "#,
        LINK_ID,
        OWNER_ID,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO calendar_events (
            id, owner_id, source_link_id, ical_uid, title, organizer_email,
            starts_at, ends_at, canonical_source_kind, canonical_source_updated_at
        )
        VALUES (
            $1, $2, $3, 'binds@example.com', 'Bind-bearing event', 'Host@Example.com',
            '2026-07-24T14:00:00Z', '2026-07-24T15:00:00Z', 'google',
            '2026-07-24T12:00:00Z'
        )
        "#,
        EVENT_ID,
        OWNER_ID,
        LINK_ID,
    )
    .execute(&pool)
    .await?;

    let user_id = MacroUserIdStr::parse_from_str(OWNER_ID).unwrap();
    // Every bind-bearing literal at once: the grouped query numbers its
    // parameters by hand, so these must render inline — `push_bind`
    // placeholders would collide with `$1` (the user id) and fail with a
    // Postgres type error.
    let filter = EntityFilterAst {
        calendar_event_filter: Some(Arc::new(Expr::and(
            Expr::val(CalendarEventLiteral::Id(EVENT_ID)),
            Expr::and(
                Expr::val(CalendarEventLiteral::Status("confirmed".to_string())),
                Expr::and(
                    Expr::val(CalendarEventLiteral::StartsBefore(
                        "2026-07-25T00:00:00Z".parse::<chrono::DateTime<chrono::Utc>>()?,
                    )),
                    Expr::and(
                        Expr::val(CalendarEventLiteral::EndsAfter(
                            "2026-07-24T14:30:00Z".parse::<chrono::DateTime<chrono::Utc>>()?,
                        )),
                        Expr::or(
                            Expr::val(CalendarEventLiteral::Organizer(
                                "host@example.com".to_string(),
                            )),
                            Expr::val(CalendarEventLiteral::Attendee(
                                "guest's+friend@example.com".to_string(),
                            )),
                        ),
                    ),
                ),
            ),
        ))),
        ..EntityFilterAst::mock_empty()
    };

    let calendar_items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(SimpleSortMethod::ViewedUpdated, filter),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::Date,
                group_key: None,
                per_group_limit: None,
            },
        },
    )
    .await?
    .filter(|item| matches!(item.item, models_soup::item::SoupItem::CalendarEvent(_)))
    .collect::<Vec<_>>();

    assert_eq!(calendar_items.len(), 1);
    assert_eq!(calendar_items[0].item.id(), EVENT_ID);

    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_soup_filters_calendar_events_by_notification_done(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const OWNER_ID: &str = "macro|user-1@test.com";
    const LINK_ID: uuid::Uuid = uuid::uuid!("ca1e0000-0000-0000-0000-000000000010");
    const ALERTED_EVENT_ID: uuid::Uuid = uuid::uuid!("ca1e0000-0000-0000-0000-000000000011");
    const DONE_EVENT_ID: uuid::Uuid = uuid::uuid!("ca1e0000-0000-0000-0000-000000000012");
    const QUIET_EVENT_ID: uuid::Uuid = uuid::uuid!("ca1e0000-0000-0000-0000-000000000013");

    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, 'calendar-notif-soup@example.com', 'GMAIL')
        "#,
        LINK_ID,
        OWNER_ID,
    )
    .execute(&pool)
    .await?;
    for (event_id, uid, title) in [
        (ALERTED_EVENT_ID, "alerted@example.com", "Alerted event"),
        (DONE_EVENT_ID, "done@example.com", "Done event"),
        (QUIET_EVENT_ID, "quiet@example.com", "Quiet event"),
    ] {
        sqlx::query!(
            r#"
            INSERT INTO calendar_events (
                id, owner_id, source_link_id, ical_uid, title,
                starts_at, ends_at, canonical_source_kind, canonical_source_updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5,
                '2026-07-24T14:00:00Z', '2026-07-24T15:00:00Z', 'google',
                '2026-07-24T12:00:00Z'
            )
            "#,
            event_id,
            OWNER_ID,
            LINK_ID,
            uid,
            title,
        )
        .execute(&pool)
        .await?;
    }
    for (notification_id, event_id, done) in [
        (
            uuid::uuid!("ca1e0000-0000-0000-0000-000000000021"),
            ALERTED_EVENT_ID,
            false,
        ),
        (
            uuid::uuid!("ca1e0000-0000-0000-0000-000000000022"),
            DONE_EVENT_ID,
            true,
        ),
    ] {
        sqlx::query!(
            r#"
            INSERT INTO notification (
                id, notification_event_type, event_item_id, event_item_type,
                service_sender, metadata
            )
            VALUES ($1, 'calendar_event_reminder', $2, 'calendar_event', 'test', '{}'::jsonb)
            "#,
            notification_id,
            event_id.to_string(),
        )
        .execute(&pool)
        .await?;
        sqlx::query!(
            r#"
            INSERT INTO user_notification (user_id, notification_id, done)
            VALUES ($1, $2, $3)
            "#,
            OWNER_ID,
            notification_id,
            done,
        )
        .execute(&pool)
        .await?;
    }

    let user_id = MacroUserIdStr::parse_from_str(OWNER_ID).unwrap();
    let filter = EntityFilterAst {
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::NotificationDone(
            false,
        )))),
        ..EntityFilterAst::mock_empty()
    };

    let calendar_items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id.copied(),
            limit: 50,
            cursor: Query::Sort(SimpleSortMethod::ViewedUpdated, filter),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::Date,
                group_key: None,
                per_group_limit: None,
            },
        },
    )
    .await?
    .filter(|item| matches!(item.item, models_soup::item::SoupItem::CalendarEvent(_)))
    .collect::<Vec<_>>();

    assert_eq!(
        calendar_items.len(),
        1,
        "only the event with a not-done notification appears"
    );
    assert_eq!(calendar_items[0].item.id(), ALERTED_EVENT_ID);

    Ok(())
}
