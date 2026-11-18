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
    params.cursor_timestamp =
        Some(Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap() - chrono::Duration::minutes(5100));
    params.cursor_id_str = Some(Uuid::nil().to_string());
    let read = team_read(&view, &filter, params).unwrap();
    for fresh in [false, true] {
        if fresh {
            sqlx::raw_sql("ANALYZE email_threads")
                .execute(&mut *connection)
                .await?;
        }
        for mode in ["force_custom_plan", "force_generic_plan"] {
            sqlx::query!("SELECT set_config('plan_cache_mode', $1, false)", mode)
                .fetch_one(&mut *connection)
                .await?;
            for stream in [Stream::Superset, Stream::SparseSuperset, Stream::Selection] {
                for explain in [false, true] {
                    let mut builder = QueryBuilder::<Postgres>::new(if explain {
                        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "
                    } else {
                        ""
                    });
                    builder.push("WITH matching_threads AS MATERIALIZED (SELECT unnest(");
                    builder.push_bind(matches.clone());
                    builder.push("::uuid[]) AS thread_id) ");
                    read.push_stream(&mut builder, stream, get_sort_timestamp_field(&view));
                    if explain {
                        let plan: serde_json::Value = builder
                            .build_query_scalar()
                            .fetch_one(&mut *connection)
                            .await?;
                        let visited = thread_rows_visited(&plan[0]["Plan"]);
                        assert!(
                            visited > 0.0 && visited <= matches.len() as f64,
                            "{fresh} {mode} {stream:?}: visited {visited} rows for {} IDs: {plan}",
                            matches.len(),
                        );
                    } else {
                        let ids: Vec<Uuid> = builder
                            .build_query_scalar()
                            .fetch_all(&mut *connection)
                            .await?;
                        assert_eq!(ids, expected, "{fresh} {mode} {stream:?}");
                    }
                }
            }
        }
    }
    Ok(())
}

fn thread_rows_visited(plan: &serde_json::Value) -> f64 {
    let own = if plan["Relation Name"] == "email_threads" {
        (plan["Actual Rows"].as_f64().unwrap_or_default()
            + plan["Rows Removed by Filter"].as_f64().unwrap_or_default()
            + plan["Rows Removed by Index Recheck"]
                .as_f64()
                .unwrap_or_default())
            * plan["Actual Loops"].as_f64().unwrap_or_default()
    } else {
        0.0
    };
    own + plan["Plans"]
        .as_array()
        .map(|children| children.iter().map(thread_rows_visited).sum::<f64>())
        .unwrap_or_default()
}
