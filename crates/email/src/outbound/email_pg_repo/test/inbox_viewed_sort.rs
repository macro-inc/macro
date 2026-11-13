use super::*;
use crate::outbound::email_pg_repo::preview_views::new_inbox::new_inbox_preview_cursor;
use chrono::DateTime;

// The inbox's viewed sorts (`viewed_at`, `viewed_updated`) read a page from each
// inbox's history and from its never-opened threads instead of sorting the whole
// inbox. These tests hold the pages to the order a sort of the whole inbox gives,
// and hold the query to reading about a page of threads.

const INBOX_PREVIEW_SQL: &str = include_str!("../preview_views/new_inbox.sql");

/// Every inbox thread of the links in the order the viewed sorts define, with no
/// page and no cursor: opened threads by view time, never-opened ones at the
/// epoch (`viewed_at`) or at their inbox time (`viewed_updated`), ties by id.
const WHOLE_INBOX_SORTED_SQL: &str = r#"
    SELECT
        t.id,
        CASE $2
            WHEN 'viewed_at' THEN COALESCE(uh.updated_at, '1970-01-01 00:00:00+00')
            ELSE COALESCE(uh.updated_at, GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at))
        END AS sort_ts,
        uh.updated_at AS viewed_at
    FROM email_threads t
    LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
    WHERE t.link_id = ANY($1)
      AND t.inbox_visible = TRUE
      AND GREATEST(t.latest_inbound_message_ts, t.reminder_returned_at) IS NOT NULL
    ORDER BY sort_ts DESC, t.id DESC
"#;

type SortedThread = (Uuid, DateTime<Utc>, Option<DateTime<Utc>>);

fn viewed_sort_links() -> anyhow::Result<[Uuid; 2]> {
    Ok([
        Uuid::parse_str("a4278000-0000-0000-0000-00000000000a")?,
        Uuid::parse_str("a4278000-0000-0000-0000-00000000000b")?,
    ])
}

async fn whole_inbox_sorted(
    pool: &Pool<Postgres>,
    link_ids: &[Uuid],
    sort: SimpleSortMethod,
) -> anyhow::Result<Vec<SortedThread>> {
    Ok(sqlx::query_as(WHOLE_INBOX_SORTED_SQL)
        .bind(link_ids)
        .bind(sort.to_string())
        .fetch_all(pool)
        .await?)
}

async fn all_pages(
    pool: &Pool<Postgres>,
    link_ids: &[Uuid],
    sort: SimpleSortMethod,
    limit: u32,
) -> anyhow::Result<Vec<SortedThread>> {
    let mut threads = Vec::new();
    let mut query = Query::new(None, sort, ());

    loop {
        let page = new_inbox_preview_cursor(pool, link_ids, limit, &query).await?;
        let Some(last) = page.last() else { break };

        query = Query::new(
            Some(Cursor {
                id: last.id,
                limit: limit as usize,
                val: CursorVal {
                    sort_type: sort,
                    last_val: last.sort_ts,
                },
                filter: (),
            }),
            sort,
            (),
        );
        threads.extend(page.iter().map(|row| (row.id, row.sort_ts, row.viewed_at)));
    }

    Ok(threads)
}

/// Thread rows the inbox preview query read for one first page: the rows each
/// `email_threads` scan returned plus the rows its filter dropped. Sequential
/// scans are off because these tables are too small for the planner to prefer
/// an index by itself.
async fn thread_rows_read(
    pool: &Pool<Postgres>,
    link_ids: &[Uuid],
    sort: SimpleSortMethod,
    limit: i64,
) -> anyhow::Result<u64> {
    let mut transaction = pool.begin().await?;
    sqlx::query("SET LOCAL enable_seqscan = off")
        .execute(&mut *transaction)
        .await?;
    let plan: serde_json::Value = sqlx::query_scalar(&format!(
        "EXPLAIN (ANALYZE, FORMAT JSON) {INBOX_PREVIEW_SQL}"
    ))
    .bind(link_ids)
    .bind(limit)
    .bind(None::<DateTime<Utc>>)
    .bind(None::<Uuid>)
    .bind(sort.to_string())
    .fetch_one(&mut *transaction)
    .await?;

    Ok(thread_rows_in_plan(&plan))
}

fn thread_rows_in_plan(plan: &serde_json::Value) -> u64 {
    let mut rows_read = 0;
    let mut nodes = vec![&plan[0]["Plan"]];
    while let Some(node) = nodes.pop() {
        if node["Relation Name"] == "email_threads" {
            let returned = node["Actual Rows"].as_f64().unwrap_or(0.0);
            let dropped = node["Rows Removed by Filter"].as_f64().unwrap_or(0.0);
            let loops = node["Actual Loops"].as_f64().unwrap_or(0.0);
            rows_read += ((returned + dropped) * loops).round() as u64;
        }
        if let Some(children) = node["Plans"].as_array() {
            nodes.extend(children);
        }
    }

    rows_read
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_inbox_viewed_sort"))
)]
async fn viewed_at_pages_follow_the_whole_inbox_sort(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = viewed_sort_links()?;
    let expected = whole_inbox_sorted(&pool, &link_ids, SimpleSortMethod::ViewedAt).await?;
    assert_eq!(
        expected.len(),
        282,
        "inbox threads that have a time to sort by"
    );
    assert_eq!(
        expected.iter().filter(|thread| thread.2.is_some()).count(),
        106,
        "opened threads still in the inbox"
    );

    // 7 breaks pages inside the tied view times and inside the never-opened
    // threads; 64 takes more than one inbox's opened threads in one page.
    for limit in [7, 64] {
        let paged = all_pages(&pool, &link_ids, SimpleSortMethod::ViewedAt, limit).await?;
        assert_eq!(paged, expected, "limit {limit}");
    }

    let one_inbox = &link_ids[1..];
    let expected = whole_inbox_sorted(&pool, one_inbox, SimpleSortMethod::ViewedAt).await?;
    let paged = all_pages(&pool, one_inbox, SimpleSortMethod::ViewedAt, 7).await?;
    assert_eq!(paged, expected, "one inbox");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_inbox_viewed_sort"))
)]
async fn viewed_updated_pages_follow_the_whole_inbox_sort(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_ids = viewed_sort_links()?;
    let expected = whole_inbox_sorted(&pool, &link_ids, SimpleSortMethod::ViewedUpdated).await?;
    assert_eq!(
        expected.len(),
        282,
        "inbox threads that have a time to sort by"
    );

    for limit in [7, 64] {
        let paged = all_pages(&pool, &link_ids, SimpleSortMethod::ViewedUpdated, limit).await?;
        assert_eq!(paged, expected, "limit {limit}");
    }

    let one_inbox = &link_ids[1..];
    let expected = whole_inbox_sorted(&pool, one_inbox, SimpleSortMethod::ViewedUpdated).await?;
    let paged = all_pages(&pool, one_inbox, SimpleSortMethod::ViewedUpdated, 7).await?;
    assert_eq!(paged, expected, "one inbox");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_inbox_viewed_sort"))
)]
async fn viewed_updated_keeps_newer_unopened_threads_above_older_views(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Every view in the fixture is newer than every inbound time, so the walk
    // of never-opened threads is cut off below the page. Move the views behind
    // the mail: the page must then mix both kinds.
    sqlx::query("UPDATE email_user_history SET updated_at = updated_at - interval '96 days'")
        .execute(&pool)
        .await?;
    let link_ids = viewed_sort_links()?;
    let expected = whole_inbox_sorted(&pool, &link_ids, SimpleSortMethod::ViewedUpdated).await?;
    let first_page = &expected[..7];
    assert!(first_page.iter().any(|thread| thread.2.is_some()));
    assert!(first_page.iter().any(|thread| thread.2.is_none()));

    let paged = all_pages(&pool, &link_ids, SimpleSortMethod::ViewedUpdated, 7).await?;
    assert_eq!(paged, expected);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_inbox_viewed_sort"))
)]
async fn an_inbox_that_archives_what_it_reads_pages_like_the_whole_inbox_sort(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // The third inbox's newest views are all archived, so its first page comes
    // from its inbox threads; later pages come from what is left of its history.
    let archiving_inbox = [Uuid::parse_str("a4278000-0000-0000-0000-00000000000c")?];
    let every_inbox = [
        viewed_sort_links()?[0],
        viewed_sort_links()?[1],
        archiving_inbox[0],
    ];

    for sort in [SimpleSortMethod::ViewedAt, SimpleSortMethod::ViewedUpdated] {
        let expected = whole_inbox_sorted(&pool, &archiving_inbox, sort).await?;
        assert_eq!(expected.len(), 20, "{sort}");
        for limit in [7, 64] {
            let paged = all_pages(&pool, &archiving_inbox, sort, limit).await?;
            assert_eq!(paged, expected, "{sort}, limit {limit}");
        }

        let expected = whole_inbox_sorted(&pool, &every_inbox, sort).await?;
        let paged = all_pages(&pool, &every_inbox, sort, 7).await?;
        assert_eq!(paged, expected, "{sort}, every inbox");
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_inbox_viewed_sort"))
)]
async fn viewed_sorts_read_a_page_of_threads_not_the_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query("ANALYZE email_threads, email_user_history")
        .execute(&pool)
        .await?;
    let link_ids = viewed_sort_links()?;

    // The two inboxes hold 288 inbox threads. A page of 5 reads at most 5
    // opened and 5 never-opened threads per inbox, plus the opened threads the
    // never-opened walk steps over.
    for sort in [SimpleSortMethod::ViewedAt, SimpleSortMethod::ViewedUpdated] {
        let rows_read = thread_rows_read(&pool, &link_ids, sort, 5).await?;
        assert!(rows_read <= 40, "{sort} read {rows_read} thread rows");
    }

    // With nothing opened, every row comes from the never-opened walk.
    sqlx::query("DELETE FROM email_user_history")
        .execute(&pool)
        .await?;
    for sort in [SimpleSortMethod::ViewedAt, SimpleSortMethod::ViewedUpdated] {
        let rows_read = thread_rows_read(&pool, &link_ids, sort, 5).await?;
        assert!(
            rows_read <= 40,
            "{sort} with no history read {rows_read} thread rows"
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_inbox_viewed_sort"))
)]
async fn a_deep_recency_page_reads_a_page_of_threads_under_a_generic_plan(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query("ANALYZE email_threads, email_user_history")
        .execute(&pool)
        .await?;
    let link_ids = viewed_sort_links()?;

    // The cursor sits 200 rows into the two inboxes' 282.
    let first_page = new_inbox_preview_cursor(
        &pool,
        &link_ids,
        200,
        &Query::new(None, SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;
    assert_eq!(first_page.len(), 200);
    let cursor = &first_page[199];

    // A reused statement can get a generic plan, built without the cursor's
    // values. There the cursor has to be an index condition, or the scan
    // starts at the top of each inbox and filters its way down to the cursor.
    let mut transaction = pool.begin().await?;
    sqlx::raw_sql(&format!(
        "SET LOCAL enable_seqscan = off;
         SET LOCAL plan_cache_mode = force_generic_plan;
         PREPARE inbox_preview(uuid[], bigint, timestamptz, uuid, text) AS {INBOX_PREVIEW_SQL}"
    ))
    .execute(&mut *transaction)
    .await?;
    let plan: serde_json::Value = sqlx::query_scalar(&format!(
        "EXPLAIN (ANALYZE, FORMAT JSON)
         EXECUTE inbox_preview('{{{},{}}}', 5, '{}', '{}', 'updated_at')",
        link_ids[0],
        link_ids[1],
        cursor.sort_ts.to_rfc3339(),
        cursor.id,
    ))
    .fetch_one(&mut *transaction)
    .await?;

    let rows_read = thread_rows_in_plan(&plan);
    assert!(rows_read <= 20, "read {rows_read} thread rows");
    Ok(())
}
