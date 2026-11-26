//! Keep IMAP's plan fixture separate from the directory's existing 100k seed.

use super::*;

const IMAP_SUBJECT: &str = "macro|imap-plan@example.net";

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imap_list_members_seek_the_partial_index_at_20k_in_both_plan_modes(pool: PgPool) {
    let mut connection = pool.acquire().await.unwrap();
    hosted_planner(&mut connection).await;
    // Each statement commits before VACUUM; no fixture transaction or reader
    // is held while the test establishes the visibility-map precondition.
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ('00000000-0000-4000-a000-000000000001', $1, 'fa-imap', 'imap-plan@example.net', 'IMAP'),
               ('00000000-0000-4000-a000-000000000002', $1, 'fa-imap', 'imap-two@example.net', 'IMAP'),
               ('00000000-0000-4000-a000-000000000003', $1, 'fa-imap', 'imap-other@example.net', 'GMAIL')
        "#,
        IMAP_SUBJECT,
    )
    .execute(&mut *connection)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key)
        SELECT $1, 'macro|z' || lpad(n::text, 6, '0') || '@example.net',
               '00000000-0000-4000-a000-000000000001'::uuid, 'imap'
        FROM generate_series(1, 20000) n
        UNION ALL
        SELECT $1, 'macro|z' || lpad(n::text, 6, '0') || '@example.net',
               '00000000-0000-4000-a000-000000000002'::uuid, 'imap'
        FROM generate_series(1, 2000) n
        UNION ALL
        SELECT $1, 'macro|z' || lpad(n::text, 6, '0') || '@example.net',
               '00000000-0000-4000-a000-000000000003'::uuid, 'gmail'
        FROM generate_series(1, 20000) n
        "#,
        IMAP_SUBJECT,
    )
    .execute(&mut *connection)
    .await
    .unwrap();

    // Preserve the original plan suite's strict precondition and retry bound:
    // unmarked heap pages must fail rather than disguise index-only costs.
    let mut unmarked = None;
    for _ in 0..10 {
        sqlx::query!("VACUUM (FREEZE, ANALYZE) contact_inbox_members")
            .execute(&mut *connection)
            .await
            .unwrap();
        let pages = sqlx::query_scalar!(
            r#"SELECT (relpages - relallvisible)::bigint AS "pages!"
               FROM pg_class WHERE oid = 'contact_inbox_members'::regclass"#
        )
        .fetch_one(&mut *connection)
        .await
        .unwrap();
        unmarked = Some(pages);
        if pages == 0 {
            break;
        }
    }
    assert_eq!(unmarked, Some(0), "IMAP fixture pages must be all-visible");

    prepare(
        &mut connection,
        "members_imap",
        "text, text, bigint",
        include_str!("../../list_members/imap.sql"),
    )
    .await;
    for generic in [false, true] {
        plan_mode(&mut connection, generic).await;
        for (viewer, after, rows) in [
            (IMAP_SUBJECT, "NULL", 501),
            (IMAP_SUBJECT, "'macro|z010000@example.net'", 501),
            (IMAP_SUBJECT, "'macro|z019990@example.net'", 10),
            ("macro|stranger@example.net", "NULL", 0),
        ] {
            let explain = format!(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE members_imap('{viewer}', {after}, 501)"
            );
            #[expect(
                clippy::disallowed_methods,
                reason = "EXPLAIN EXECUTE uses only fixed fixture values and the production SQL"
            )]
            let (plan,): (serde_json::Value,) = sqlx::query_as(&explain)
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            let root = &plan[0]["Plan"];
            let buffers = root["Shared Hit Blocks"].as_u64().unwrap_or(0)
                + root["Shared Read Blocks"].as_u64().unwrap_or(0);
            assert_eq!(
                root["Actual Rows"].as_f64(),
                Some(f64::from(rows)),
                "{plan}"
            );
            assert!(
                plan.to_string().contains("contact_inbox_members_imap_idx"),
                "{plan}"
            );
            assert!(!plan.to_string().contains("Seq Scan"), "{plan}");
            assert!(!plan.to_string().contains("Sort"), "{plan}");
            assert!(
                buffers <= 30,
                "generic={generic}, buffers={buffers}: {plan}"
            );
            eprintln!("IMAP generic={generic}, after={after}, rows={rows}, buffers={buffers}");
        }
    }
}
