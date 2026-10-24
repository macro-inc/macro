use super::*;
use chrono::TimeZone;
use models_grouping::{CandidateCursor, GroupByField, GroupingConfig, PropertyDateRange};
use sqlx::{Pool, Postgres};

// The source repository, not the shared query helper, executes the SQL.
async fn select_candidate_page(
    pool: &Pool<Postgres>,
    descriptor: &CandidateQuery,
    source: impl FnOnce(&mut QueryBuilder<'_, Postgres>),
) -> anyhow::Result<CandidatePage> {
    let mut query = build_candidate_query(descriptor, |query| {
        source(query);
        Ok(())
    })?;
    let rows = query
        .build_query_as::<CandidateRow>()
        .fetch_all(pool)
        .await?;
    Ok(decode_candidate_page(rows, descriptor))
}

#[sqlx::test(migrations = false)]
async fn counts_ties_nulls_and_exhausted_groups(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let source = |q: &mut QueryBuilder<'_, Postgres>| {
        q.push("SELECT id, entity_type, sort_value, group_key FROM (VALUES ('a', 'TASK', '2025-01-01'::timestamptz, 'a''; --'), ('a', 'TASK', '2025-01-01'::timestamptz, 'a''; --'), ('b', 'TASK', '2025-01-01'::timestamptz, 'a''; --'), ('c', 'DOCUMENT', NULL::timestamptz, 'a''; --'), ('d', 'TASK', NULL::timestamptz, 'a''; --'), ('e', 'TASK', '2024-01-01'::timestamptz, 'other')) AS v(id, entity_type, sort_value, group_key)");
    };
    let mut query = CandidateQuery {
        date_property_id: None,
        timestamp_sort: None,
        direction: CandidateDirection::Descending,
        grouping: None,
        cursor: None,
        limit: 2,
    };
    let first = select_candidate_page(&pool, &query, source).await?;
    // DOCUMENT rows fall beyond this first page but must still appear in metadata.
    assert_eq!(first.entity_types, ["DOCUMENT", "TASK"]);
    assert_eq!(
        first
            .candidates
            .iter()
            .map(|v| v.identity.id.as_str())
            .collect::<Vec<_>>(),
        ["a", "b", "e"]
    );
    assert_eq!(first.groups[0].total_count, 4);
    assert!(first.groups[0].has_more);
    query.cursor = Some(CandidateCursor {
        sort_value: CandidateSortValue(Some(Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap())),
        identity: CandidateIdentity {
            id: "a".into(),
            entity_type: "TASK".into(),
        },
    });
    let second = select_candidate_page(&pool, &query, source).await?;
    assert_eq!(second.groups[0].before_or_at_cursor_count, 1);
    assert_eq!(second.groups[1].before_or_at_cursor_count, 0);
    assert_eq!(
        second
            .candidates
            .iter()
            .map(|v| v.identity.id.as_str())
            .collect::<Vec<_>>(),
        ["b", "c", "e"]
    );
    query.cursor = Some(CandidateCursor {
        sort_value: CandidateSortValue(None),
        identity: CandidateIdentity {
            id: "d".into(),
            entity_type: "TASK".into(),
        },
    });
    let exhausted = select_candidate_page(&pool, &query, source).await?;
    assert!(exhausted.candidates.is_empty());
    assert_eq!(exhausted.entity_types, ["DOCUMENT", "TASK"]);
    assert_eq!(exhausted.groups.len(), 2);
    assert_eq!(exhausted.groups[0].before_or_at_cursor_count, 4);
    assert_eq!(exhausted.groups[1].before_or_at_cursor_count, 1);
    query.direction = CandidateDirection::Ascending;
    query.cursor = None;
    query.grouping = Some(
        GroupingConfig::new(GroupByField::Date)
            .with_group_key("a'; --")
            .with_limit(1),
    );
    let ascending = select_candidate_page(&pool, &query, source).await?;
    assert_eq!(ascending.groups.len(), 1);
    assert_eq!(ascending.candidates[0].identity.id, "a");
    assert!(ascending.groups[0].has_more);
    Ok(())
}

#[sqlx::test(migrations = false)]
async fn date_values_and_bucket_boundaries(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Test databases cloned from a pre-migrated template can already contain this table.
    sqlx::query!("DROP SCHEMA public CASCADE")
        .execute(&pool)
        .await?;
    sqlx::query!("CREATE SCHEMA public").execute(&pool).await?;
    sqlx::query!("CREATE TABLE entity_properties (property_definition_id uuid, entity_id text, entity_type text, values jsonb)").execute(&pool).await?;
    let definition = Uuid::from_u128(1);
    let other = Uuid::from_u128(2);
    sqlx::query!("INSERT INTO entity_properties (property_definition_id, entity_id, entity_type, values) VALUES ($1, 'one', 'TASK', '{\"type\":\"Date\",\"value\":\"2025-01-02T00:00:00Z\"}'), ($1, 'two', 'TASK', '{\"type\":\"String\",\"value\":\"not a date\"}'), ($2, 'three', 'TASK', '{\"type\":\"Date\",\"value\":\"2025-01-02T00:00:00Z\"}'), ($1, 'zero', 'TASK', '{\"type\":\"Date\",\"value\":\"2025-01-01T23:59:59Z\"}')", definition, other).execute(&pool).await?;
    let ranges = PropertyDateRanges {
        ranges: vec![
            PropertyDateRange {
                key: "before' OR true --".into(),
                start: None,
                end: Some(Utc.with_ymd_and_hms(2025, 1, 2, 0, 0, 0).unwrap()),
            },
            PropertyDateRange {
                key: "after".into(),
                start: Some(Utc.with_ymd_and_hms(2025, 1, 2, 0, 0, 0).unwrap()),
                end: None,
            },
        ],
        missing_value_bucket_key: "missing".into(),
    };
    let mut q = QueryBuilder::<Postgres>::new("SELECT dated.id, ");
    push_date_range_bucket(&mut q, &ranges).map_err(|error| anyhow::anyhow!("{error:?}"))?;
    q.push(" AS bucket FROM (SELECT candidate.id, ");
    push_date_property_value(&mut q, definition);
    q.push(" AS group_date FROM (VALUES ('one', 'TASK'), ('two', 'TASK'), ('three', 'TASK'), ('zero', 'TASK')) AS candidate(id, entity_type)) dated ORDER BY dated.id");
    // The outer CASE consumes the selected value without application-side bucketing.
    let rows: Vec<(String, String)> = q.build_query_as().fetch_all(&pool).await?;
    assert_eq!(
        rows,
        [
            ("one".into(), "after".into()),
            ("three".into(), "missing".into()),
            ("two".into(), "missing".into()),
            ("zero".into(), "before' OR true --".into())
        ]
    );
    Ok(())
}

#[sqlx::test(migrations = false)]
async fn identity_ties_use_id_then_type_for_every_page(pool: Pool<Postgres>) -> anyhow::Result<()> {
    for value in [None, Some(DateTime::<Utc>::UNIX_EPOCH)] {
        for direction in [
            CandidateDirection::Ascending,
            CandidateDirection::Descending,
        ] {
            let mut descriptor = CandidateQuery {
                date_property_id: None,
                timestamp_sort: None,
                direction,
                grouping: None,
                cursor: None,
                limit: 1,
            };
            for (index, (id, entity_type)) in [("a", "DOCUMENT"), ("a", "TASK"), ("b", "DOCUMENT")]
                .into_iter()
                .enumerate()
            {
                let page = select_candidate_page(&pool, &descriptor, |query| {
                    query.push("SELECT id, entity_type, ");
                    query.push_bind(value);
                    query.push("::timestamptz AS sort_value, ''::text AS group_key FROM (VALUES ('a', 'TASK'), ('b', 'DOCUMENT'), ('a', 'DOCUMENT'), ('a', 'TASK')) AS ids(id, entity_type)");
                }).await?;
                assert_eq!(page.candidates.len(), 1);
                assert_eq!(page.candidates[0].identity.id, id);
                assert_eq!(page.candidates[0].identity.entity_type, entity_type);
                assert_eq!(page.groups[0].total_count, 3);
                assert_eq!(page.groups[0].before_or_at_cursor_count, index as i64);
                assert_eq!(page.groups[0].has_more, index < 2);
                descriptor.cursor = Some(CandidateCursor {
                    identity: page.candidates[0].identity.clone(),
                    sort_value: page.candidates[0].sort_value,
                });
            }
        }
    }
    Ok(())
}

#[sqlx::test(migrations = false)]
async fn grouping_date_is_independent_of_sorting_date(pool: Pool<Postgres>) -> anyhow::Result<()> {
    use models_grouping::PropertyBucketing;
    use models_pagination::SimpleSortMethod;

    sqlx::query!("DROP SCHEMA public CASCADE")
        .execute(&pool)
        .await?;
    sqlx::query!("CREATE SCHEMA public").execute(&pool).await?;
    sqlx::query!("CREATE TABLE entity_properties (property_definition_id uuid, entity_id text, entity_type text, values jsonb)").execute(&pool).await?;
    let sort_property = Uuid::from_u128(1);
    let group_property = Uuid::from_u128(2);
    sqlx::query!(
        r#"INSERT INTO entity_properties (property_definition_id, entity_id, entity_type, values) VALUES
        ($1, 'a', 'TASK', '{"type":"Date","value":"2026-05-05T00:00:00Z"}'),
        ($1, 'b', 'DOCUMENT', '{"type":"Date","value":"2026-05-01T00:00:00Z"}'),
        ($2, 'a', 'TASK', '{"type":"Date","value":"2026-01-01T00:00:00Z"}'),
        ($2, 'b', 'DOCUMENT', '{"type":"Date","value":"2026-02-01T00:00:00Z"}'),
        ($2, 'c', 'TASK', '{"type":"Date","value":"2026-01-01T00:00:00Z"}')"#,
        sort_property, group_property
    ).execute(&pool).await?;
    let boundary: DateTime<Utc> = "2026-02-01T00:00:00Z".parse()?;
    let mut descriptor = CandidateQuery {
        date_property_id: Some(sort_property),
        timestamp_sort: None,
        direction: CandidateDirection::Ascending,
        grouping: Some(GroupingConfig::new(GroupByField::Property {
            property_definition_id: group_property,
            entity_type: None,
            bucketing: Some(PropertyBucketing::DateRanges(PropertyDateRanges {
                ranges: vec![
                    PropertyDateRange {
                        key: "before".into(),
                        start: None,
                        end: Some(boundary),
                    },
                    PropertyDateRange {
                        key: "after".into(),
                        start: Some(boundary),
                        end: None,
                    },
                ],
                missing_value_bucket_key: "missing".into(),
            })),
        })),
        cursor: None,
        limit: 10,
    };
    for date_sort in [true, false] {
        if !date_sort {
            descriptor.date_property_id = None;
            descriptor.timestamp_sort = Some(SimpleSortMethod::UpdatedAt);
        }
        let mut query = build_property_candidate_query_impl(&descriptor, |query| {
            query.push("SELECT id, entity_type, '2020-01-01'::timestamptz AS activity_at, NULL::text AS project_id FROM (VALUES ('a', 'TASK'), ('b', 'DOCUMENT'), ('c', 'TASK')) AS ids(id, entity_type)");
            Ok(())
        })?;
        let rows = query
            .build_query_as::<CandidateRow>()
            .fetch_all(&pool)
            .await?;
        let page = decode_candidate_page(rows, &descriptor);
        assert_eq!(
            page.candidates
                .iter()
                .map(|row| (row.group_key.as_str(), row.identity.id.as_str()))
                .collect::<Vec<_>>(),
            [("before", "a"), ("before", "c"), ("after", "b")]
        );
        assert_eq!(
            page.groups
                .iter()
                .map(|group| (group.group_key.as_str(), group.total_count))
                .collect::<Vec<_>>(),
            [("before", 2), ("after", 1)]
        );
    }
    Ok(())
}
