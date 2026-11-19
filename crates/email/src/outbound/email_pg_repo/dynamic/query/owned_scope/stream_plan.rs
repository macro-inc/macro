use super::*;
use crate::outbound::email_pg_repo::dynamic::resolve::ResolvedFilters;
use chrono::TimeZone;
use item_filters::ast::email::Email;
use sqlx::PgPool;

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn owned_sparse_thread_fetches_do_not_scan_the_mailbox(pool: PgPool) -> anyhow::Result<()> {
    let link = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0011);
    let foreign_thread = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0022);
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
           SELECT md5('owned-stream-' || i)::uuid, 'owned-stream-' || i, $1, TRUE,
                  i % 100 != 0 OR i % 200 = 0 OR i IN (100, 200, 300),
                  '2026-02-01'::timestamptz -
                  CASE WHEN i IN (100, 200, 300) THEN 5100 ELSE i END * interval '1 minute'
           FROM generate_series(1, 20000) i"#,
        link,
    )
    .execute(&mut *connection)
    .await?;
    sqlx::query!(
        "UPDATE email_threads SET is_signal = TRUE, latest_non_spam_message_ts = '2026-01-01' \
         WHERE id = $1",
        foreign_thread,
    )
    .execute(&mut *connection)
    .await?;
    let mut matches = sqlx::query_scalar!(
        r#"SELECT md5('owned-stream-' || i)::uuid AS "id!" FROM generate_series(100, 20000, 100) i ORDER BY i"#
    )
    .fetch_all(&mut *connection)
    .await?;
    // Duplicate message matches must not duplicate a thread. A missing ID
    // and another mailbox's thread must not appear after the ID fetch.
    matches.push(matches[51]);
    matches.extend([Uuid::nil(), foreign_thread]);
    let mut expected = sqlx::query_scalar!(
        r#"SELECT md5('owned-stream-' || i)::uuid AS "id!" FROM generate_series(5200, 20000, 200) i ORDER BY i"#
    )
    .fetch_all(&mut *connection)
    .await?;
    let mut ties = [matches[0], matches[1], matches[2]];
    ties.sort_unstable();
    let cursor_id = ties[1];
    expected.insert(0, ties[0]);
    let cursor_timestamp =
        Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap() - chrono::Duration::minutes(5100);
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let filter = Expr::And(
        Box::new(Expr::Literal(EmailLiteral::Recipient(Email::Domain(
            "example.test".into(),
        )))),
        Box::new(Expr::Literal(EmailLiteral::Importance(true))),
    );
    let read = OwnedRead::new(
        &view,
        &filter,
        QueryParams {
            link_ids: vec![link],
            sort_method_str: "updated_at".into(),
            query_limit: 50,
            cursor_timestamp: Some(cursor_timestamp),
            cursor_id_str: Some(cursor_id.to_string()),
            is_important: false,
            shared: SharedEmailFilter::Exclude,
            user_id: "macro|member@example.com".into(),
            resolved: ResolvedFilters::empty(),
            team_id: None,
            project_scope: None,
        },
        OwnedReadTuning::DEFAULT,
    )
    .map_err(|_| anyhow::anyhow!("owned stream rejected the address filter"))?;

    for fresh in [false, true] {
        if fresh {
            sqlx::raw_sql("ANALYZE email_threads")
                .execute(&mut *connection)
                .await?;
        }
        let mut builder =
            QueryBuilder::<Postgres>::new("WITH matching_threads AS MATERIALIZED (SELECT unnest(");
        builder.push_bind(matches.clone());
        builder.push("::uuid[]) AS thread_id) ");
        read.push_stream(
            &mut builder,
            Stream::SparseSuperset,
            None,
            get_sort_timestamp_field(&view),
        );
        sqlx::raw_sql(&format!(
            "PREPARE owned_sparse_stream(uuid[], uuid[], timestamptz, text) AS {}",
            builder.sql()
        ))
        .execute(&mut *connection)
        .await?;
        // EXECUTE accepts SQL literals, not bind parameters. Only typed
        // fixture UUIDs and the cursor timestamp enter these literals.
        let ids_literal = matches
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let execute = format!(
            "EXECUTE owned_sparse_stream('{{{ids_literal}}}', '{{{link}}}', '{}', '{cursor_id}')",
            cursor_timestamp.to_rfc3339(),
        );
        for mode in ["force_custom_plan", "force_generic_plan"] {
            sqlx::query!("SELECT set_config('plan_cache_mode', $1, false)", mode)
                .fetch_one(&mut *connection)
                .await?;
            let ids: Vec<Uuid> = sqlx::query_scalar(&execute)
                .fetch_all(&mut *connection)
                .await?;
            assert_eq!(ids, expected, "{fresh} {mode}");
            let plan: serde_json::Value = sqlx::query_scalar(&format!(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {execute}"
            ))
            .fetch_one(&mut *connection)
            .await?;
            let touched = thread_rows_touched(&plan[0]["Plan"]);
            assert!(touched <= 202, "{fresh} {mode}: touched {touched}: {plan}");
            let counts = sqlx::query!(
                "SELECT generic_plans, custom_plans FROM pg_prepared_statements \
                 WHERE name = 'owned_sparse_stream'"
            )
            .fetch_one(&mut *connection)
            .await?;
            if mode == "force_generic_plan" {
                assert!(counts.generic_plans.unwrap() >= 2);
            } else {
                assert!(counts.custom_plans.unwrap() >= 2);
                assert_eq!(counts.generic_plans, Some(0));
            }
        }
        sqlx::raw_sql("DEALLOCATE owned_sparse_stream")
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

fn thread_rows_touched(plan: &serde_json::Value) -> u64 {
    let own = if plan["Relation Name"] == "email_threads" {
        (plan["Actual Rows"].as_u64().unwrap_or(0)
            + plan["Rows Removed by Filter"].as_u64().unwrap_or(0))
            * plan["Actual Loops"].as_u64().unwrap_or(0)
    } else {
        0
    };
    own + plan["Plans"].as_array().map_or(0, |children| {
        children.iter().map(thread_rows_touched).sum::<u64>()
    })
}
