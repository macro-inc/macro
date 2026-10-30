use super::*;
use crate::domain::{ports::ContactsPageService, service::ContactsDomainService};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pages_include_self_once_and_only_the_viewers_neighbors(pool: PgPool) {
    sqlx::query!(
        "INSERT INTO contacts_connections(user1, user2) VALUES
         ('macro|a@example.com', 'macro|m@example.com'),
         ('macro|b@example.com', 'macro|m@example.com'),
         ('macro|m@example.com', 'macro|y@example.com'),
         ('macro|m@example.com', 'macro|z@example.com'),
         ('macro|c@example.com', 'macro|x@example.com')"
    )
    .execute(&pool)
    .await
    .unwrap();
    let service = ContactsDomainService {
        repository: DbContactsRepository::new(pool),
        notifier: None::<crate::outbound::gateway::ConnectionGatewayNotifier>,
    };
    let viewer = MacroUserIdStr::try_from_email("m@example.com").unwrap();
    let limit = ContactPageSize::new(2).unwrap();
    let mut after = None;
    let mut found = Vec::new();
    // The fourth request also proves that resuming past the end is empty.
    for expected in [
        vec!["macro|a@example.com", "macro|b@example.com"],
        vec!["macro|m@example.com", "macro|y@example.com"],
        vec!["macro|z@example.com"],
    ] {
        let page = service
            .contact_id_page(viewer.clone(), after.as_ref(), limit)
            .await
            .unwrap();
        let ids: Vec<_> = page.contacts.iter().map(|id| id.as_ref()).collect();
        assert_eq!(ids, expected);
        found.extend(page.contacts);
        after = page.next_cursor;
    }
    assert!(after.is_none());
    assert_eq!(found.len(), 5);
    let last = ContactCursor::from_position("macro|z@example.com".into()).unwrap();
    let end = service
        .contact_id_page(viewer, Some(&last), limit)
        .await
        .unwrap();
    assert!(end.contacts.is_empty());
    assert!(end.next_cursor.is_none());
    // A cursor from another listing is just a position, never access to its rows.
    let unrelated = MacroUserIdStr::try_from_email("nobody@example.com").unwrap();
    let foreign_cursor = ContactCursor::from_position("macro|a@example.com".into()).unwrap();
    let own = service
        .contact_id_page(unrelated.clone(), Some(&foreign_cursor), limit)
        .await
        .unwrap();
    assert_eq!(own.contacts, vec![unrelated]);
    assert!(own.next_cursor.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn full_final_page_has_no_cursor_and_bad_rows_do_not_strand_pagination(pool: PgPool) {
    sqlx::query!(
        "INSERT INTO contacts_connections(user1, user2) VALUES
         ('broken-id', 'macro|m@example.com'),
         ('macro|a@example.com', 'macro|m@example.com')"
    )
    .execute(&pool)
    .await
    .unwrap();
    let repository = DbContactsRepository::new(pool);
    let viewer = MacroUserIdStr::try_from_email("m@example.com").unwrap();
    let skipped = repository
        .contact_id_page(viewer.clone(), None, ContactPageSize::new(1).unwrap())
        .await
        .unwrap();
    assert!(skipped.contacts.is_empty());
    assert_eq!(
        skipped.next_cursor.as_ref().unwrap().position(),
        "broken-id"
    );
    let rest = repository
        .contact_id_page(
            viewer,
            skipped.next_cursor.as_ref(),
            ContactPageSize::new(2).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        rest.contacts
            .iter()
            .map(|id| id.as_ref())
            .collect::<Vec<_>>(),
        ["macro|a@example.com", "macro|m@example.com"]
    );
    assert!(rest.next_cursor.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deep_pages_seek_both_directions_without_scanning_the_directory(pool: PgPool) {
    sqlx::query!(
        "INSERT INTO contacts_connections(user1, user2)
         SELECT 'macro|a' || lpad(n::text, 6, '0') || '@example.com', 'macro|m@example.com'
         FROM generate_series(1, 50000) n
         UNION ALL
         SELECT 'macro|m@example.com', 'macro|z' || lpad(n::text, 6, '0') || '@example.com'
         FROM generate_series(1, 50000) n"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("ANALYZE contacts_connections")
        .execute(&pool)
        .await
        .unwrap();
    let mut connection = pool.acquire().await.unwrap();
    let prepare = format!(
        "PREPARE contacts_page(text, text, bigint) AS {}",
        include_str!("../page.sql")
    );
    // PREPARE/EXPLAIN use the exact production SQL file, not a duplicate query.
    #[expect(
        clippy::disallowed_methods,
        reason = "diagnostic PREPARE wraps the production SQL file"
    )]
    sqlx::query(&prepare)
        .execute(&mut *connection)
        .await
        .unwrap();
    for generic in [false, true] {
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
        // Only fixed fixture literals enter diagnostic EXECUTE; production uses binds.
        for after in [
            "NULL",
            "'macro|a049990@example.com'",
            "'macro|z049990@example.com'",
        ] {
            let explain = format!(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE contacts_page('macro|m@example.com', {after}, 3)"
            );
            #[expect(
                clippy::disallowed_methods,
                reason = "EXPLAIN EXECUTE returns dynamic planner JSON over fixed fixture literals"
            )]
            let (plan,): (serde_json::Value,) = sqlx::query_as(&explain)
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            let root = &plan[0]["Plan"];
            let reads = root["Shared Hit Blocks"].as_u64().unwrap_or(0)
                + root["Shared Read Blocks"].as_u64().unwrap_or(0);
            assert!(
                reads < 100,
                "bounded seek read {reads} blocks (generic={generic}): {plan}"
            );
            assert_eq!(root["Actual Rows"].as_f64(), Some(3.0));
            let serialized = plan.to_string();
            assert!(!serialized.contains("Seq Scan"), "{plan}");
        }
    }
}
