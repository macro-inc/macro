use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_grouping::{DeadlineBoundaries, GroupByField, GroupingConfig};
use models_pagination::{Cursor, CursorVal};

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn flat_due_date_pages_handle_ties_both_directions_and_multiple_nulls(
    db: PgPool,
) -> anyhow::Result<()> {
    let user = MacroUserIdStr::parse_from_str("macro|user-1@test.com")?;
    for id in [
        "dddddddd-dddd-dddd-dddd-dddddddddddd",
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ] {
        sqlx::query!(
            "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
            id
        )
        .execute(&db)
        .await?;
    }
    for (id, value) in [
        (
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            serde_json::json!({"type":"Date","value":"2026-03-08T12:00:00Z"}),
        ),
        (
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            serde_json::json!({"type":"Date","value":"2026-03-08T12:00:00Z"}),
        ),
        (
            "dddddddd-dddd-dddd-dddd-dddddddddddd",
            serde_json::json!({"type":"Date","value":"2026-03-10T12:00:00Z"}),
        ),
        (
            "cccccccc-cccc-cccc-cccc-cccccccccccc",
            serde_json::json!({"type":"SelectOption","value":["00000000-0000-0000-0000-000000000099"]}),
        ),
        (
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
            serde_json::json!({"type":"Date","value":"2026-03-01T12:00:00Z"}),
        ),
    ] {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'TASK', $3, $4)",
            Uuid::now_v7(), id, SystemPropertyKey::DUE_DATE_UUID, value,
        ).execute(&db).await?;
    }
    for (sort, expected) in [
        (DueDateSort::Earliest, vec!['a', 'b', 'd', 'c', 'e']),
        (DueDateSort::Latest, vec!['d', 'a', 'b', 'c', 'e']),
    ] {
        let mut found = Vec::new();
        let mut cursor = Query::Sort(sort, EntityFilterAst::default());
        for _ in 0..5 {
            let page = task_page(&db, user.clone(), 1, &cursor).await?;
            if page.is_empty() {
                break;
            }
            let row = &page[0];
            found.push(row.id.to_string().chars().next().unwrap());
            cursor = Query::Cursor(Cursor {
                id: row.id,
                limit: 1,
                val: CursorVal {
                    sort_type: sort,
                    last_val: row.due_at,
                },
                filter: EntityFilterAst::default(),
            });
        }
        assert_eq!(found, expected);
        assert!(task_page(&db, user.clone(), 1, &cursor).await?.is_empty());
    }
    sqlx::query!(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'TASK', $3, NULL)",
        Uuid::now_v7(), "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", SystemPropertyKey::DUE_DATE_UUID,
    ).execute(&db).await?;
    let page = task_page(
        &db,
        user,
        10,
        &Query::Sort(DueDateSort::Earliest, EntityFilterAst::default()),
    )
    .await?;
    assert_eq!(page.len(), 5);
    let cleared = page.last().unwrap();
    assert_eq!(
        cleared.id,
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee".parse::<Uuid>()?
    );
    assert!(cleared.due_at.is_none());
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_due_date_counts_precede_cursor_and_boundaries_stay_frozen(
    db: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::models::due_date::GroupedDueDateRequest;
    let user = MacroUserIdStr::parse_from_str("macro|user-1@test.com")?;
    let today: DateTime<Utc> = "2026-03-08T05:00:00Z".parse()?;
    let grouping = GroupingConfig::new(GroupByField::Deadline {
        boundaries: DeadlineBoundaries {
            today,
            tomorrow: "2026-03-09T04:00:00Z".parse()?,
            day_two: "2026-03-10T04:00:00Z".parse()?,
            day_eight: "2026-03-16T04:00:00Z".parse()?,
        },
    })
    .with_limit(1);
    for id in [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ] {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'TASK', $3, $4)",
            Uuid::now_v7(), id, SystemPropertyKey::DUE_DATE_UUID,
            serde_json::json!({"type":"Date", "value":"2026-03-08T12:00:00Z"}),
        ).execute(&db).await?;
    }
    let rows = grouped_task_page(
        &db,
        GroupedDueDateRequest::initial(
            user.clone(),
            10,
            DueDateSort::Earliest,
            EntityFilterAst::default(),
            grouping.clone(),
        )?,
    )
    .await?;
    assert_eq!(rows.len(), 2);
    let dated = rows.iter().find(|row| row.key == "today").unwrap();
    assert_eq!(dated.total_group_count, 2);
    assert_eq!(dated.index_in_group, 1);
    assert!(rows.iter().any(|row| row.key.is_empty()));
    let continued = grouped_task_page(
        &db,
        GroupedDueDateRequest::continue_from(
            user,
            Cursor {
                id: dated.id,
                limit: 1,
                val: CursorVal {
                    sort_type: DueDateSort::Earliest,
                    last_val: dated.due_at,
                },
                filter: crate::domain::models::due_date::GroupedDueDateContext {
                    filters: EntityFilterAst::default(),
                    grouping: grouping.with_group_key("today"),
                },
            },
            None,
        )?,
    )
    .await?;
    assert_eq!(continued.len(), 1);
    assert_eq!(continued[0].total_group_count, 2);
    assert_eq!(continued[0].index_in_group, 2);
    assert_eq!(continued[0].key, "today");
    Ok(())
}
