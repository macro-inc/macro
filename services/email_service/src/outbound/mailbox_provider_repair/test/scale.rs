//! Explicitly run against the task-owned PG14 server; no production data.
use super::*;
use serde_json::{Value, json};
use sqlx::{Row, migrate::Migrator};
use std::{borrow::Cow, time::Instant};

fn migrations_through(version: i64) -> Migrator {
    Migrator {
        migrations: Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version <= version)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    }
}

async fn seed_link(pool: &PgPool, provider: UserProvider) -> Uuid {
    let id = Uuid::now_v7();
    let identity = id.to_string();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, 'macro|repair@example.com', $2, 'repair@example.com', $3::text::email_user_provider_enum)
        ON CONFLICT (id) DO NOTHING
        "#,
        id,
        identity,
        provider.as_str(),
    ).execute(pool).await.unwrap();
    id
}

/// Explain the EXACT production SQL text, not a simplified copy. PREPARE's
/// identifier and parameters below are trusted fixture literals, never input.
async fn page_plan(pool: &PgPool, needle: &str, types: &str, args: &str, mode: &str) -> Value {
    let source = include_str!("../../mailbox_provider_repair.rs");
    let statement = source
        .split("r#\"")
        .skip(1)
        .filter_map(|part| part.split_once("\"#").map(|(sql, _)| sql))
        .find(|sql| sql.contains(needle))
        .expect("production query must exist");
    let command = format!(
        "BEGIN; SET LOCAL plan_cache_mode = '{mode}'; SET LOCAL random_page_cost = 1.1; \
         SET LOCAL work_mem = '16MB'; SET LOCAL statement_timeout = '30s'; \
         PREPARE repair_scale_plan ({types}) AS {statement}; \
         EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE repair_scale_plan ({args}); \
         DEALLOCATE repair_scale_plan; ROLLBACK;"
    );
    let rows = sqlx::raw_sql(&command).fetch_all(pool).await.unwrap();
    rows.into_iter()
        .find_map(|row| row.try_get::<Value, _>("QUERY PLAN").ok())
        .expect("EXPLAIN must return its JSON plan")
}

#[sqlx::test(migrations = false)]
#[ignore = "10M-row owned PG14 migration and repair benchmark"]
async fn ten_million_legacy_rows_are_repaired_in_bounded_committed_pages(pool: PgPool) {
    let started = Instant::now();
    sqlx::raw_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        .execute(&pool)
        .await
        .unwrap();
    migrations_through(20261120233249).run(&pool).await.unwrap();
    let gmail = seed_link(&pool, UserProvider::Gmail).await;
    let outlook = seed_link(&pool, UserProvider::Outlook).await;
    let streams = seed_link(&pool, UserProvider::Outlook).await;
    for _ in 0..10 {
        let ids: Vec<Uuid> = (0..10_000).map(|_| Uuid::now_v7()).collect();
        sqlx::query!(
            r#"
            INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
            SELECT id, 'macro|repair@example.com', id::text, 'repair@example.com', 'OUTLOOK'
            FROM unnest($1::uuid[]) AS id
            ON CONFLICT (id) DO NOTHING
            "#,
            &ids,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    for (link, count) in [(gmail, 100_000_i64), (outlook, 9_900_000)] {
        for first in (1..=count).step_by(100_000) {
            sqlx::query!(
                r#"
                INSERT INTO email_message_reconciliation (link_id, generation, provider_id, is_import)
                SELECT $1, 1, 'legacy-' || lpad(n::text, 8, '0'), false
                FROM generate_series($2::bigint, $3::bigint) n
                ON CONFLICT (link_id, generation, provider_id) DO NOTHING
                "#,
                link,
                first,
                (first + 99_999).min(count),
            ).execute(&pool).await.unwrap();
        }
        eprintln!("SCALE fixture queue rows: {count}");
    }
    for _ in 0..10 {
        let ids: Vec<Uuid> = (0..100_000).map(|_| Uuid::now_v7()).collect();
        sqlx::query!(
            r#"
            INSERT INTO email_sync_streams (id, link_id, generation, kind, scope_id)
            SELECT id, $1, 1, 'mail_folder', id::text
            FROM unnest($2::uuid[]) AS id
            ON CONFLICT (id) DO NOTHING
            "#,
            streams,
            &ids,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let before = sqlx::query!(
        r#"
        SELECT c.relname, c.relfilenode::bigint AS "node!"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
            AND c.relname IN ('email_sync_streams', 'email_message_reconciliation')
        ORDER BY c.relname
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let seed_seconds = started.elapsed().as_secs_f64();
    let mut migration_times = Vec::new();
    for migration in MACRO_DB_MIGRATIONS
        .iter()
        .filter(|m| m.version >= 20261120233250)
    {
        let timer = Instant::now();
        migrations_through(migration.version)
            .run(&pool)
            .await
            .unwrap();
        migration_times
            .push(json!({"version": migration.version, "seconds": timer.elapsed().as_secs_f64()}));
    }
    let after = sqlx::query!(
        r#"
        SELECT c.relname, c.relfilenode::bigint AS "node!"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
            AND c.relname IN ('email_sync_streams', 'email_message_reconciliation')
        ORDER BY c.relname
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for (before, after) in before.iter().zip(&after) {
        assert_eq!(before.relname, after.relname);
        assert_eq!(
            before.node, after.node,
            "fast defaults must not rewrite child heaps"
        );
    }
    let mut plans = Vec::new();
    for statistics in ["stale", "analyzed"] {
        if statistics == "analyzed" {
            sqlx::raw_sql("ANALYZE email_links; ANALYZE email_message_reconciliation;")
                .execute(&pool)
                .await
                .unwrap();
        }
        for mode in ["force_custom_plan", "force_generic_plan"] {
            let args =
                format!("'{gmail}'::uuid, '-9223372036854775808'::bigint, ''::text, 1000::bigint");
            plans.push(json!({"query": "child_page", "statistics": statistics, "mode": mode,
                "plan": page_plan(&pool, "WITH page AS MATERIALIZED (\n                        SELECT generation", "uuid,bigint,text,bigint", &args, mode).await}));
            plans.push(json!({"query": "parent_page", "statistics": statistics, "mode": mode,
                "plan": page_plan(&pool, "SELECT id, provider\n                    FROM email_links", "uuid,bigint", "'00000000-0000-0000-0000-000000000000'::uuid, 1000::bigint", mode).await}));
        }
    }
    // Exercise the WORST cohort too: every one of the 10M queue rows requires
    // repair. Only this isolated fixture bypasses the new provider cascade.
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!("SET LOCAL session_replication_role = 'replica'")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_links SET provider = 'GMAIL' WHERE id = $1",
        outlook
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let dedicated = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(pool.connect_options().as_ref().clone())
        .await
        .unwrap();
    let repository = PgProviderRepair(dedicated.clone());
    let timer = Instant::now();
    let mut prior = RepairProgress::default();
    let mut maximum_batch_seconds = 0_f64;
    let mut validation_seconds = None;
    for _ in 0..20_000 {
        let batch_start = Instant::now();
        match repair_once(&repository).await.unwrap() {
            RepairTick::Progress(batch) => {
                assert!(
                    (0..=1000).contains(
                        &(batch.progress.message_rows_scanned - prior.message_rows_scanned)
                    )
                );
                assert!(
                    (0..=1000)
                        .contains(&(batch.progress.link_rows_scanned - prior.link_rows_scanned))
                );
                maximum_batch_seconds =
                    maximum_batch_seconds.max(batch_start.elapsed().as_secs_f64());
                prior = batch.progress;
                if prior.batches % 1000 == 0 {
                    eprintln!(
                        "SCALE repair batches={} rows={}",
                        prior.batches, prior.rows_repaired
                    );
                }
            }
            RepairTick::Complete => {
                validation_seconds = Some(batch_start.elapsed().as_secs_f64());
                break;
            }
            RepairTick::ValidationDeferred => {
                // Autovacuum can legitimately own SHARE UPDATE EXCLUSIVE after
                // a dense repair. Preserve that production outcome, wait for
                // the conflicting lock, then advance only the fixture's clock.
                wait_for_validation_lock(&pool).await;
            }
            RepairTick::Busy => panic!("isolated benchmark unexpectedly lost its lease"),
            RepairTick::ValidationBlocked => {
                panic!("valid scale fixture must never consume the constraint cap")
            }
        }
    }
    let completed = match repository.claim(Uuid::now_v7()).await.unwrap() {
        RepairClaim::Complete(progress) => progress,
        _ => panic!("durable completion marker required"),
    };
    assert_eq!(completed.rows_repaired, 10_000_000);
    assert_eq!(completed.message_rows_scanned, 10_000_000);
    assert_eq!(completed.link_rows_scanned, 100_003);
    let validated = sqlx::query_scalar!(
        r#"
        SELECT count(*) FILTER (WHERE convalidated) AS "validated!"
        FROM pg_constraint
        WHERE conname IN (
            'email_message_reconciliation_link_provider_fkey',
            'email_sync_streams_link_provider_fkey'
        )
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(validated, 2);
    let version = sqlx::query_scalar!(r#"SELECT version() AS "version!""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    eprintln!(
        "SCALE_EVIDENCE_JSON={}",
        json!({
            "postgres": version, "queue_rows": 10_000_000, "stream_rows": 1_000_000,
            "parent_rows": 100_003, "repair_cohort_rows": 10_000_000,
            "seed_seconds": seed_seconds, "migration_times": migration_times,
            "heap_rewritten": false, "repair_seconds_unpaced": timer.elapsed().as_secs_f64(),
            "maximum_batch_wall_seconds": maximum_batch_seconds, "validation_seconds": validation_seconds,
            "batches": completed.batches, "rows_repaired": completed.rows_repaired,
            "connections": 1, "production_pacing_ms": 250,
            "note": "Unpaced isolated benchmark; production adds 250ms between committed pages. No production data. Validation locks SHARE UPDATE EXCLUSIVE; ordinary repair holds ROW EXCLUSIVE and parent KEY SHARE.",
            "plans": plans,
        })
    );
    dedicated.close().await;
}

/// Resume only a failed local scale fixture; never accept a shared or hosted DB.
#[tokio::test]
#[ignore = "resume an owned SQLx scale fixture after a deferred validation"]
async fn resumes_ten_million_repaired_rows_after_validation_backoff() {
    use std::str::FromStr;
    let options = sqlx::postgres::PgConnectOptions::from_str(
        &std::env::var("DATABASE_URL").expect("an explicitly owned scale fixture is required"),
    )
    .unwrap();
    assert_eq!(options.get_host(), "127.0.0.1");
    assert!(
        options
            .get_database()
            .is_some_and(|name| name.starts_with("_sqlx_test_"))
    );
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    let repository = PgProviderRepair(pool.clone());
    wait_for_validation_lock(&pool).await;
    let start = Instant::now();
    assert!(matches!(
        repair_once(&repository).await.unwrap(),
        RepairTick::Complete
    ));
    let progress = match repository.claim(Uuid::now_v7()).await.unwrap() {
        RepairClaim::Complete(progress) => progress,
        _ => panic!("validation must leave a durable completion marker"),
    };
    assert_eq!(progress.rows_repaired, 10_000_000);
    assert_eq!(progress.message_rows_scanned, 10_000_000);
    assert_eq!(progress.link_rows_scanned, 100_003);
    assert!(progress.validation_failures > 0);
    eprintln!(
        "SCALE_RESUME_EVIDENCE_JSON={}",
        json!({
            "rows_repaired": progress.rows_repaired,
            "rows_scanned": progress.message_rows_scanned,
            "parent_rows": progress.link_rows_scanned,
            "batches": progress.batches,
            "validation_failures_before_success": progress.validation_failures,
            "validation_resume_seconds": start.elapsed().as_secs_f64(),
            "result": "automatic validation and durable completion after persisted backoff",
            "data": "owned local synthetic SQLx fixture only",
        })
    );
    pool.close().await;
}

/// Synchronize with real vacuum completion instead of sleeping or polling.
/// This clock advance is confined to the explicitly owned test fixture.
async fn wait_for_validation_lock(pool: &PgPool) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!("SET LOCAL statement_timeout = '120s'")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query!("SET LOCAL lock_timeout = '120s'")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query!(
        r#"
        LOCK TABLE
            email_message_reconciliation,
            email_sync_streams
        IN SHARE UPDATE EXCLUSIVE MODE
        "#,
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
    sqlx::query!(
        r#"
        UPDATE email_reconciliation_provider_backfill
        SET available_at = clock_timestamp()
        WHERE name = 'v1'
            AND phase = 'validating'
            AND lease_id IS NULL
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
}
