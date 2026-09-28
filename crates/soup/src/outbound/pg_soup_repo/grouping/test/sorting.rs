use super::*;
use crate::domain::models::grouping::ItemGroupingInfo;
use chrono::{DateTime, Duration, Utc};
use models_pagination::{CursorWithValAndFilter, SortOn};
use models_soup::item::SoupItem;
use uuid::Uuid;

const SORTS: [SimpleSortMethod; 4] = [
    SimpleSortMethod::CreatedAt,
    SimpleSortMethod::UpdatedAt,
    SimpleSortMethod::ViewedAt,
    SimpleSortMethod::ViewedUpdated,
];

async fn fetch(
    pool: &Pool<Postgres>,
    cursor: Query<Uuid, SimpleSortMethod, EntityFilterAst>,
    field: GroupByField,
    group_key: Option<String>,
    limit: u16,
) -> anyhow::Result<Vec<ItemGroupingInfo>> {
    Ok(expanded_dynamic_cursor_soup_grouped(
        pool,
        GroupedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str("macro|user-1@test.com")?,
            limit,
            cursor,
            exclude_frecency: false,
            grouping: GroupingConfig {
                field,
                group_key,
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect())
}

fn cursor_from(
    item: &ItemGroupingInfo,
    sort: SimpleSortMethod,
    filter: EntityFilterAst,
) -> Query<Uuid, SimpleSortMethod, EntityFilterAst> {
    Query::Cursor(CursorWithValAndFilter {
        id: item.item.id(),
        limit: 2,
        val: SoupItem::sort_on(sort)(&item.item),
        filter,
    })
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures(path = ".", scripts("access", "sorting")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn all_sorts_preserve_history_dates_and_real_cursors(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let today = sqlx::query_scalar!(
        r#"SELECT current_date::timestamptz + interval '12 hours' AS "today!""#
    )
    .fetch_one(&pool)
    .await?;
    let created = today - Duration::days(400);
    let updated = today - Duration::days(1);
    let old_history = today - Duration::days(500);
    let epoch = DateTime::<Utc>::default();
    let expected_ids = [
        ("document", "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        ("document", "11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        ("document", "11111111-cccc-cccc-cccc-cccccccccccc"),
        ("document", "11111111-dddd-dddd-dddd-dddddddddddd"),
        ("document", "11111111-0000-0000-0000-000000000000"),
        ("chat", "22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        ("chat", "22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        ("chat", "22222222-cccc-cccc-cccc-cccccccccccc"),
        ("chat", "22222222-0000-0000-0000-000000000000"),
        ("project", "aaaaaaaa-ffff-ffff-ffff-ffffffffffff"),
        ("project", "bbbbbbbb-ffff-ffff-ffff-ffffffffffff"),
        ("project", "cccccccc-ffff-ffff-ffff-ffffffffffff"),
        ("project", "dddddddd-ffff-ffff-ffff-ffffffffffff"),
    ];
    let history = |id: &str| {
        if id.contains("aaaa") {
            Some(today)
        } else if id.contains("bbbb") {
            Some(old_history)
        } else {
            None
        }
    };
    for sort in SORTS {
        let timestamp = |id: &str| match sort {
            SimpleSortMethod::CreatedAt => created,
            SimpleSortMethod::UpdatedAt => updated,
            SimpleSortMethod::ViewedAt => history(id).unwrap_or(epoch),
            SimpleSortMethod::ViewedUpdated => history(id).unwrap_or(updated),
        };
        let initial = fetch(
            &pool,
            Query::Sort(sort, EntityFilterAst::mock_empty()),
            GroupByField::EntityType,
            None,
            2,
        )
        .await?;
        assert_eq!(initial.len(), 13);
        for item in &initial {
            let (actual_created, actual_updated, actual_viewed) = match &item.item {
                SoupItem::Document(d) => (d.created_at, d.updated_at, d.viewed_at),
                SoupItem::Chat(c) => (c.created_at, c.updated_at, c.viewed_at),
                SoupItem::Project(p) => (p.created_at, p.updated_at, p.viewed_at),
                other => panic!("unexpected item: {other:?}"),
            };
            let id = item.item.id().to_string();
            assert_eq!(
                (actual_created, actual_updated, actual_viewed),
                (created, updated, history(&id))
            );
            assert_eq!(SoupItem::sort_on(sort)(&item.item).last_val, timestamp(&id));
        }
        for key in ["document", "chat", "project"] {
            let mut expected = expected_ids
                .iter()
                .filter(|(kind, _)| *kind == key)
                .map(|(_, id)| *id)
                .collect::<Vec<_>>();
            expected.sort_by_key(|id| std::cmp::Reverse((timestamp(id), *id)));
            let group = initial.iter().filter(|i| i.key == key).collect::<Vec<_>>();
            assert_eq!(
                group
                    .iter()
                    .map(|i| i.item.id().to_string())
                    .collect::<Vec<_>>(),
                expected
            );
            let mut cursor = Query::Sort(sort, EntityFilterAst::mock_empty());
            let mut seen = Vec::new();
            loop {
                let page = fetch(
                    &pool,
                    cursor,
                    GroupByField::EntityType,
                    Some(key.to_string()),
                    2,
                )
                .await?;
                if page.is_empty() {
                    break;
                }
                for (index, item) in page.iter().enumerate() {
                    assert_eq!(item.total_group_count, expected.len() - seen.len());
                    assert_eq!(item.index_in_group, index + 1);
                }
                cursor = cursor_from(page.last().unwrap(), sort, EntityFilterAst::mock_empty());
                seen.extend(page.iter().map(|i| i.item.id().to_string()));
                assert!(seen.len() <= expected.len());
            }
            assert_eq!(seen, expected);
        }
        let dated = fetch(
            &pool,
            Query::Sort(sort, EntityFilterAst::mock_empty()),
            GroupByField::Date,
            None,
            50,
        )
        .await?;
        // A single date bucket can exceed the initial ten-item cap. Use its
        // single-group form to check all IDs and its exact count.
        for key in ["today", "yesterday", "older"] {
            let mut expected = expected_ids
                .iter()
                .filter(|(_, id)| {
                    let ts = timestamp(id);
                    let bucket = if ts == today {
                        "today"
                    } else if ts == updated {
                        "yesterday"
                    } else {
                        "older"
                    };
                    bucket == key
                })
                .map(|(_, id)| *id)
                .collect::<Vec<_>>();
            expected.sort_by_key(|id| std::cmp::Reverse((timestamp(id), *id)));
            let group = dated.iter().filter(|i| i.key == key).collect::<Vec<_>>();
            assert_eq!(group.len(), expected.len().min(10));
            assert!(group.iter().all(|i| i.total_group_count == expected.len()));
            let full = fetch(
                &pool,
                Query::Sort(sort, EntityFilterAst::mock_empty()),
                GroupByField::Date,
                Some(key.to_string()),
                50,
            )
            .await?;
            assert_eq!(
                full.iter()
                    .map(|i| i.item.id().to_string())
                    .collect::<Vec<_>>(),
                expected
            );
        }
    }
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures(path = ".", scripts("access")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn calendar_sorts_preserve_reminders_and_linked_account_cursors(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let ids = super::access::seed_calendar_access(&pool).await?;
    let created = "2026-01-01T00:00:00Z".parse::<DateTime<Utc>>()?;
    let updated = created + Duration::days(1);
    let reminder = created + Duration::days(2);
    sqlx::query!(
        "UPDATE calendar_events SET created_at = $1, updated_at = $2, last_reminder_fired_at = CASE WHEN id = $3 THEN $4::timestamptz ELSE NULL END WHERE id = ANY($5)",
        created, updated, ids[0], reminder, &ids,
    ).execute(&pool).await?;
    for sort in SORTS {
        let expected = match sort {
            SimpleSortMethod::CreatedAt => vec![(ids[1], created), (ids[0], created)],
            SimpleSortMethod::ViewedAt => vec![
                (ids[1], DateTime::<Utc>::default()),
                (ids[0], DateTime::<Utc>::default()),
            ],
            _ => vec![(ids[0], reminder), (ids[1], updated)],
        };
        let mut cursor = Query::Sort(sort, super::access::calendar_filter());
        for (index, (id, ts)) in expected.into_iter().enumerate() {
            let page = fetch(
                &pool,
                cursor,
                GroupByField::EntityType,
                Some("calendar_event".to_string()),
                1,
            )
            .await?;
            assert_eq!(page.len(), 1);
            let item = &page[0];
            assert_eq!(item.item.id(), id);
            assert_eq!(item.total_group_count, 2 - index);
            assert_eq!(item.index_in_group, 1);
            assert_eq!(SoupItem::sort_on(sort)(&item.item).last_val, ts);
            let SoupItem::CalendarEvent(event) = &item.item else {
                panic!("expected event")
            };
            assert_eq!(event.created_at, created);
            assert_eq!(event.updated_at, updated);
            assert_eq!(
                event.last_reminder_fired_at,
                (id == ids[0]).then_some(reminder)
            );
            cursor = cursor_from(item, sort, super::access::calendar_filter());
        }
        assert!(
            fetch(
                &pool,
                cursor,
                GroupByField::EntityType,
                Some("calendar_event".to_string()),
                1
            )
            .await?
            .is_empty()
        );
    }
    // Impossible union arms stay typed and executable for every specialized sort.
    for sort in SORTS {
        let filter = EntityFilterAst {
            calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
            ..super::access::calendar_filter()
        };
        assert!(
            fetch(
                &pool,
                Query::Sort(sort, filter),
                GroupByField::EntityType,
                None,
                50
            )
            .await?
            .is_empty()
        );
    }
    Ok(())
}
