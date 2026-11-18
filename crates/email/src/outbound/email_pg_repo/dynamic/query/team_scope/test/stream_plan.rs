//! The page must fetch matching thread IDs, even when mailbox statistics
//! still describe the tiny fixture from before an import.
use super::*;

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn matching_thread_fetches_stay_bounded_with_stale_statistics(
    pool: PgPool,
) -> anyhow::Result<()> {
    let link = Uuid::parse_str("00000000-0000-4000-8000-000000000011")?;
    let mut connection = pool.acquire().await?;
    sqlx::raw_sql(
        "ALTER TABLE email_threads SET (autovacuum_enabled = false); \
         ANALYZE email_threads; SET random_page_cost = 1.1; \
         SET work_mem = '16MB'; SET jit = off; SET statement_timeout = '10s';",
    )
    .execute(&mut *connection)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_threads
               (id, provider_id, link_id, inbox_visible, is_signal, latest_non_spam_message_ts)
           SELECT md5('stream-plan-' || i)::uuid, 'stream-plan-' || i, $1, TRUE, i % 200 = 0,
                  '2026-02-01'::timestamptz - i * interval '1 minute'
           FROM generate_series(1, 20000) i
           ON CONFLICT (id) DO NOTHING"#,
        link,
    )
    .execute(&mut *connection)
    .await?;
    let mut matches = sqlx::query_scalar!(
        r#"SELECT md5('stream-plan-' || i)::uuid AS "id!" FROM generate_series(100, 20000, 100) i"#
    )
    .fetch_all(&mut *connection)
    .await?;
    // A single address branch can name the same thread for several messages.
    // Preserve one row per thread, including after the cursor.
    matches.push(matches[51]);
    // A missing ID and another inbox's ID must not leak into this stream.
    matches.extend([
        Uuid::nil(),
        Uuid::parse_str("00000000-0000-4000-8000-000000000022")?,
    ]);
    let expected = sqlx::query_scalar!(
        r#"SELECT md5('stream-plan-' || i)::uuid AS "id!" FROM generate_series(5200, 20000, 200) i ORDER BY i"#
    )
    .fetch_all(&mut *connection)
    .await?;
    let view = all_mail();
    let filter = signal_and_me(link);
    let mut params = params(SimpleSortMethod::UpdatedAt);
    params.link_ids = vec![link];
    params.resolved = ResolvedFilters::empty().with_contributing_links(vec![link]);
    let cursor_timestamp =
        Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap() - chrono::Duration::minutes(5100);
    let cursor_id = Uuid::nil();
    params.cursor_timestamp = Some(cursor_timestamp);
    params.cursor_id_str = Some(cursor_id.to_string());
    let read = team_read(&view, &filter, params).unwrap();
    for fresh in [false, true] {
        if fresh {
            sqlx::raw_sql("ANALYZE email_threads")
                .execute(&mut *connection)
                .await?;
        }
        for stream in [Stream::Superset, Stream::SparseSuperset, Stream::Selection] {
            let mut builder = QueryBuilder::<Postgres>::new(
                "WITH matching_threads AS MATERIALIZED (SELECT unnest(",
            );
            builder.push_bind(matches.clone());
            builder.push("::uuid[]) AS thread_id) ");
            read.push_stream(&mut builder, stream, get_sort_timestamp_field(&view));
            sqlx::raw_sql(&format!(
                "PREPARE matching_thread_stream(uuid[], uuid[], uuid, timestamptz, text) AS {}",
                builder.sql()
            ))
            .execute(&mut *connection)
            .await?;

            // EXECUTE cannot bind its arguments. Only typed fixture UUIDs and
            // a timestamp enter these literals, in the builder's bind order.
            let ids_literal = matches
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let execute = format!(
                "EXECUTE matching_thread_stream('{{{ids_literal}}}', '{{{link}}}', \
                 '{link}', '{}', '{cursor_id}')",
                cursor_timestamp.to_rfc3339(),
            );
            for mode in ["force_custom_plan", "force_generic_plan"] {
                sqlx::query!("SELECT set_config('plan_cache_mode', $1, false)", mode)
                    .fetch_one(&mut *connection)
                    .await?;
                let ids: Vec<Uuid> = sqlx::query_scalar(&execute)
                    .fetch_all(&mut *connection)
                    .await?;
                assert_eq!(ids, expected, "{fresh} {mode} {stream:?}");

                // Explain the prepared SELECT itself: preparing an EXPLAIN
                // statement does not exercise its SELECT's generic plan.
                let plan: serde_json::Value = sqlx::query_scalar(&format!(
                    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {execute}"
                ))
                .fetch_one(&mut *connection)
                .await?;
                let scans = thread_scans(&plan[0]["Plan"]);
                assert_eq!(scans.len(), 1, "{fresh} {mode} {stream:?}: {plan}");
                let scan = scans[0];
                assert!(
                    matches!(
                        scan["Node Type"].as_str(),
                        Some("Index Scan" | "Index Only Scan")
                    ),
                    "{fresh} {mode} {stream:?}: {plan}",
                );
                assert_eq!(scan["Index Name"], "email_threads_pkey", "{plan}");
                assert!(
                    matches!(
                        scan["Index Cond"].as_str(),
                        Some("(id = matched.thread_id)" | "(id = matching_threads.thread_id)")
                    ),
                    "{plan}",
                );
                let distinct_ids = matches
                    .iter()
                    .collect::<std::collections::HashSet<_>>()
                    .len();
                // The unique-key equality can fetch at most one row per loop,
                // including a missing ID. EXPLAIN's row counters are rounded.
                assert!(
                    scan["Actual Loops"].as_u64().unwrap() <= distinct_ids as u64,
                    "{fresh} {mode} {stream:?}: {plan}",
                );
                let plans = sqlx::query!(
                    "SELECT generic_plans, custom_plans FROM pg_prepared_statements \
                     WHERE name = 'matching_thread_stream'"
                )
                .fetch_one(&mut *connection)
                .await?;
                if mode == "force_custom_plan" {
                    assert!(plans.custom_plans.unwrap() >= 2);
                    assert_eq!(plans.generic_plans, Some(0));
                } else {
                    assert!(plans.generic_plans.unwrap() >= 2);
                }
            }
            sqlx::raw_sql("DEALLOCATE matching_thread_stream")
                .execute(&mut *connection)
                .await?;
        }
    }
    Ok(())
}

fn thread_scans(plan: &serde_json::Value) -> Vec<&serde_json::Value> {
    let mut scans = Vec::new();
    if plan["Relation Name"] == "email_threads" && plan["Actual Loops"].as_u64().unwrap() > 0 {
        scans.push(plan);
    }
    if let Some(children) = plan["Plans"].as_array() {
        scans.extend(children.iter().flat_map(thread_scans));
    }
    scans
}
