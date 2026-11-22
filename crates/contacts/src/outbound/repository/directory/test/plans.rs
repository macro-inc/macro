//! Plan checks for the directory reads at the largest-tenant scale: the
//! viewer has 100k list and inbox rows, appears in 75k other directories, and
//! has a 1,000-member team, beside 200k background rows and 20k users in
//! teams of ten. Every read must seek
//! its index and touch a bounded number of buffers in both custom and generic
//! plans, with the hosted planner settings and no PostgreSQL 18 skip scan.

use super::*;
use sqlx::PgConnection;

const SUBJECT: &str = "macro|m@example.com";
const TEAM_SIZE: i32 = 1_000;
const BACKGROUND_USERS: i32 = 20_000;

async fn seed(pool: &PgPool) {
    // Users 0..TEAM_SIZE are the subject and its teammates, spread through
    // the subject's stored contacts so the roster interleaves with every page.
    // The rest fill background teams of ten, so the roster is a small part of
    // team_user as it is in production.
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id)
         SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
                'u' || n, 'u' || n || '@example.com', 'cus_plan_' || n
         FROM generate_series(0, $1::int + $2::int - 1) n",
        TEAM_SIZE,
        BACKGROUND_USERS
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO \"User\" (id, email, macro_user_id)
         SELECT CASE
                    WHEN n = 0 THEN $1
                    WHEN n < $2::int THEN 'macro|c' || lpad((n * 50)::text, 6, '0') || '@example.com'
                    ELSE 'macro|b' || n || '@example.net'
                END,
                'u' || n || '@example.com',
                ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
         FROM generate_series(0, $2::int + $3::int - 1) n",
        SUBJECT,
        TEAM_SIZE,
        BACKGROUND_USERS
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id)
         SELECT ('00000000-0000-4000-9000-' || lpad(t::text, 12, '0'))::uuid, 'Team ' || t,
                CASE WHEN t = 0 THEN $1 ELSE 'macro|b' || ($2::int + (t - 1) * 10) || '@example.net' END
         FROM generate_series(0, $3::int / 10) t",
        SUBJECT,
        TEAM_SIZE,
        BACKGROUND_USERS
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role)
         SELECT u.id,
                ('00000000-0000-4000-9000-' || lpad(
                    CASE WHEN n < $1::int THEN 0 ELSE 1 + (n - $1::int) / 10 END::text, 12, '0'))::uuid,
                'member'
         FROM \"User\" AS u
         JOIN macro_user AS mu ON mu.id = u.macro_user_id
         CROSS JOIN LATERAL (SELECT substr(mu.username, 2)::int AS n) AS number",
        TEAM_SIZE
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
         ('00000000-0000-4000-a000-000000000001', $1, 'fa-m', 'm@example.com', 'GMAIL'),
         ('00000000-0000-4000-a000-000000000002', 'macro|o@example.com', 'fa-o', 'o@example.com', 'GMAIL')",
        SUBJECT
    )
    .execute(pool)
    .await
    .unwrap();
    // 50k interacted, 10k of them also invited; 50k owners have the subject;
    // 1,000 other owners with 100 contacts each.
    sqlx::query!(
        "INSERT INTO contact_list_members (user_id, contact_user_id, list_key)
         SELECT $1, 'macro|c' || lpad(n::text, 6, '0') || '@example.com', 'interacted'
         FROM generate_series(1, 50000) n
         UNION ALL
         SELECT $1, 'macro|c' || lpad(n::text, 6, '0') || '@example.com', 'invited'
         FROM generate_series(1, 10000) n
         UNION ALL
         SELECT 'macro|h' || lpad(n::text, 6, '0') || '@example.com', $1, 'interacted'
         FROM generate_series(1, 50000) n
         UNION ALL
         SELECT 'macro|o' || lpad(o::text, 4, '0') || '@example.org',
                'macro|p' || lpad(k::text, 3, '0') || '@example.org', 'interacted'
         FROM generate_series(1, 1000) o, generate_series(1, 100) k",
        SUBJECT
    )
    .execute(pool)
    .await
    .unwrap();
    // 50k inbox contacts, half also stored; 25k inbox rows name the subject;
    // 100k background inbox rows.
    sqlx::query!(
        "INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key)
         SELECT $1, 'macro|c' || lpad((n + 25000)::text, 6, '0') || '@example.com',
                '00000000-0000-4000-a000-000000000001'::uuid, 'gmail'
         FROM generate_series(1, 50000) n
         UNION ALL
         SELECT 'macro|h' || lpad(n::text, 6, '0') || '@example.com', $1,
                '00000000-0000-4000-a000-000000000002'::uuid, 'gmail'
         FROM generate_series(25001, 50000) n
         UNION ALL
         SELECT 'macro|o' || lpad(o::text, 4, '0') || '@example.org',
                'macro|q' || lpad(k::text, 3, '0') || '@example.org',
                '00000000-0000-4000-a000-000000000002'::uuid, 'gmail'
         FROM generate_series(1, 1000) o, generate_series(1, 100) k",
        SUBJECT
    )
    .execute(pool)
    .await
    .unwrap();
    diagnose(pool, "before VACUUM").await;
    sqlx::query!("VACUUM (ANALYZE) contact_list_members, contact_inbox_members, team_user")
        .execute(pool)
        .await
        .unwrap();
    diagnose(pool, "after VACUUM").await;
}

// Throwaway CI diagnostic: what holds the xmin horizon back.
async fn diagnose(pool: &PgPool, when: &str) {
    for (label, query) in [
        (
            "activity",
            "SELECT coalesce(json_agg(json_build_object('pid', pid, 'datname', datname, 'state', state,              'backend_xid', backend_xid::text, 'backend_xmin', backend_xmin::text,              'xact_start', xact_start, 'backend_type', backend_type, 'query', left(query, 120))), '[]')::text              FROM pg_stat_activity WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL",
        ),
        (
            "prepared",
            "SELECT coalesce(json_agg(row_to_json(p)), '[]')::text FROM pg_prepared_xacts p",
        ),
        (
            "slots",
            "SELECT coalesce(json_agg(json_build_object('slot', slot_name, 'xmin', xmin::text,              'catalog_xmin', catalog_xmin::text, 'active', active)), '[]')::text FROM pg_replication_slots",
        ),
        (
            "me",
            "SELECT json_build_object('db', current_database(), 'txid', txid_current()::text,              'snapshot', txid_current_snapshot()::text, 'version', version())::text",
        ),
    ] {
        let row: (String,) = sqlx::query_as(query).fetch_one(pool).await.unwrap();
        eprintln!("HORIZON {when} {label}: {}", row.0);
    }
    sqlx::query("CREATE EXTENSION IF NOT EXISTS pg_visibility")
        .execute(pool)
        .await
        .unwrap();
    let row: (String,) = sqlx::query_as(
        "SELECT (SELECT row_to_json(v)::text FROM pg_visibility_map_summary('contact_inbox_members') v)          || ' pages=' || (SELECT relpages::text FROM pg_class WHERE relname = 'contact_inbox_members')",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    eprintln!("HORIZON {when} visibility contact_inbox_members: {}", row.0);
}

async fn hosted_planner(connection: &mut PgConnection) {
    sqlx::query!("SET random_page_cost = 1.1")
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::query!("SET work_mem = '16MB'")
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::query!("SET jit = off")
        .execute(&mut *connection)
        .await
        .unwrap();
}

async fn plan_mode(connection: &mut PgConnection, generic: bool) {
    if generic {
        sqlx::query!("SET plan_cache_mode = force_generic_plan")
            .execute(&mut *connection)
            .await
            .unwrap();
    } else {
        sqlx::query!("SET plan_cache_mode = force_custom_plan")
            .execute(&mut *connection)
            .await
            .unwrap();
    }
}

/// Prepare the production SQL file under `name` with the given parameter types.
async fn prepare(connection: &mut PgConnection, name: &str, types: &str, sql: &str) {
    let prepare = format!("PREPARE {name}({types}) AS {sql}");
    #[expect(
        clippy::disallowed_methods,
        reason = "diagnostic PREPARE wraps the exact production SQL file"
    )]
    sqlx::query(&prepare)
        .execute(&mut *connection)
        .await
        .unwrap();
}

/// Run `EXECUTE` under `EXPLAIN (ANALYZE, BUFFERS)` and check the plan: the
/// expected row count, no sequential scan, and at most `max_blocks` buffers.
async fn check(
    connection: &mut PgConnection,
    execute: &str,
    expected_rows: usize,
    max_blocks: u64,
    generic: bool,
) {
    let explain = format!("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {execute}");
    #[expect(
        clippy::disallowed_methods,
        reason = "EXPLAIN EXECUTE returns planner JSON over fixed fixture literals"
    )]
    let (plan,): (serde_json::Value,) = sqlx::query_as(&explain)
        .fetch_one(&mut *connection)
        .await
        .unwrap();
    let root = &plan[0]["Plan"];
    let blocks = root["Shared Hit Blocks"].as_u64().unwrap_or(0)
        + root["Shared Read Blocks"].as_u64().unwrap_or(0);
    let label: String = execute.chars().take(80).collect();
    eprintln!("{label}: generic={generic}, shared_blocks={blocks}");
    assert_eq!(
        root["Actual Rows"].as_f64(),
        Some(expected_rows as f64),
        "{execute} (generic={generic}): {plan}"
    );
    assert!(
        !plan.to_string().contains("Seq Scan"),
        "{execute} (generic={generic}): {plan}"
    );
    assert!(
        blocks <= max_blocks,
        "{execute} read {blocks} blocks (generic={generic}): {plan}"
    );
}

/// 500 ids: stored and inbox contacts, teammates, strangers, and the subject.
fn requested() -> String {
    let mut ids: Vec<String> = (1..500)
        .map(|n| match n % 4 {
            0 => format!("'macro|c{:06}@example.com'", n * 150),
            1 => format!("'macro|c{:06}@example.com'", n * 50),
            2 => format!("'macro|s{n:06}@example.com'"),
            _ => format!("'macro|c{:06}@example.com'", 60_000 + n),
        })
        .collect();
    ids.push(format!("'{SUBJECT}'"));
    ids.join(",")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn directory_reads_stay_bounded_at_100k_in_custom_and_generic_plans(pool: PgPool) {
    seed(&pool).await;
    let mut connection = pool.acquire().await.unwrap();
    hosted_planner(&mut connection).await;
    // Only fixed fixture literals enter EXECUTE; the adapter binds parameters.
    prepare(
        &mut connection,
        "directory_page",
        "text, text, bigint",
        include_str!("../page.sql"),
    )
    .await;
    prepare(
        &mut connection,
        "directory_audience",
        "text, text, bigint",
        include_str!("../audience.sql"),
    )
    .await;
    prepare(
        &mut connection,
        "directory_lookup",
        "text, text[]",
        include_str!("../lookup.sql"),
    )
    .await;
    prepare(
        &mut connection,
        "directory_lists",
        "text, text[], text",
        include_str!("../lists.sql"),
    )
    .await;
    prepare(
        &mut connection,
        "directory_inbox_contacts",
        "text",
        include_str!("../inbox_contacts.sql"),
    )
    .await;
    let requested = requested();

    for generic in [false, true] {
        plan_mode(&mut connection, generic).await;
        // A full page from the start, the middle, and a short last page.
        for (after, rows) in [
            ("NULL", 501),
            ("'macro|c040000@example.com'", 501),
            ("'macro|c074990@example.com'", 11),
        ] {
            check(
                &mut connection,
                &format!("EXECUTE directory_page('{SUBJECT}', {after}, 501)"),
                rows,
                300,
                generic,
            )
            .await;
        }
        check(
            &mut connection,
            "EXECUTE directory_page('macro|stranger@example.com', NULL, 501)",
            1,
            50,
            generic,
        )
        .await;
        for (after, rows) in [("NULL", 501), ("'macro|h049900@example.com'", 101)] {
            check(
                &mut connection,
                &format!("EXECUTE directory_audience('{SUBJECT}', {after}, 501)"),
                rows,
                300,
                generic,
            )
            .await;
        }
        // Strangers (n % 4 == 2) are not members: 125 of 500 are dropped.
        check(
            &mut connection,
            &format!("EXECUTE directory_lookup('{SUBJECT}', ARRAY[{requested}])"),
            375,
            5_000,
            generic,
        )
        .await;
        check(
            &mut connection,
            &format!("EXECUTE directory_lookup('macro|stranger@example.com', ARRAY[{requested}])"),
            0,
            5_000,
            generic,
        )
        .await;
        // The subject has no lists of their own, so one more is left out.
        check(
            &mut connection,
            &format!("EXECUTE directory_lists('{SUBJECT}', ARRAY[{requested}], 'teammates')"),
            374,
            6_000,
            generic,
        )
        .await;
        // One range read of the subject's inbox rows.
        check(
            &mut connection,
            &format!("EXECUTE directory_inbox_contacts('{SUBJECT}')"),
            50_000,
            1_000,
            generic,
        )
        .await;
    }
}
