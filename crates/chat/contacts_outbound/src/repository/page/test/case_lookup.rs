use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn exact_lookup_resolves_paged_case_aliases_without_expanding_membership(pool: PgPool) {
    sqlx::query!(
        "INSERT INTO contacts_connections(user1, user2) VALUES
         ('macro|ALPHA@EXAMPLE.COM', 'macro|m@example.com'),
         ('macro|m@example.com', 'macro|zEta@Example.COM'),
         ('macro|ZULU@example.com', 'macro|m@example.com'),
         ('macro|m@example.com', 'macro|zulu@example.com'),
         ('macro|O''NEIL%_@Example.COM', 'macro|m@example.com'),
         ('macro|literal-macro|TAG@example.com', 'macro|m@example.com'),
         ('MACRO|impostor@example.com', 'macro|m@example.com'),
         ('macro|m@example.com', 'macro|Known@example.com'),
         ('macro|M@example.com', 'macro|ghost@example.com'),
         ('macro|foreign@example.com', 'macro|outsider@example.com')"
    )
    .execute(&pool)
    .await
    .unwrap();
    let repository = DbContactsRepository::new(pool);
    let viewer = MacroUserIdStr::try_from_email("m@example.com").unwrap();
    let lookup = ContactLookup::new(
        [
            "ZETA@example.com",
            "m@example.com",
            "alpha@example.com",
            "zulu@example.com",
            "o'neil%_@example.com",
            "literal-macro|tag@example.com",
            "outsider@example.com",
            "impostor@example.com",
            "known@example.com",
            "ghost@example.com",
            "ZULU@example.com",
        ]
        .map(|email| MacroUserIdStr::try_from_email(email).unwrap())
        .to_vec(),
    )
    .unwrap();
    let found = repository
        .lookup_contact_ids(viewer.clone(), &lookup)
        .await
        .unwrap();
    assert_eq!(
        found.iter().map(|id| id.email_str()).collect::<Vec<_>>(),
        [
            "zeta@example.com",
            "m@example.com",
            "alpha@example.com",
            "zulu@example.com",
            "o'neil%_@example.com",
            "literal-macro|tag@example.com",
        ]
    );
    assert!(
        repository
            .lookup_contact_ids(
                MacroUserIdStr::try_from_email("stranger@example.com").unwrap(),
                &lookup
            )
            .await
            .unwrap()
            .is_empty()
    );

    // A page preserves raw cursor positions but exposes canonical IDs. Every
    // emitted ID must remain exactly resolvable, including aliases on either side.
    let mut after = None;
    let mut pages = 0;
    loop {
        let page = repository
            .contact_id_page(
                viewer.clone(),
                after.as_ref(),
                ContactPageSize::new(2).unwrap(),
            )
            .await
            .unwrap();
        let lookup = ContactLookup::new(
            page.contacts
                .iter()
                .map(|entry| entry.user_id.clone())
                .collect(),
        )
        .unwrap();
        assert_eq!(
            repository
                .lookup_contact_ids(viewer.clone(), &lookup)
                .await
                .unwrap(),
            lookup.ids()
        );
        pages += 1;
        assert!(
            pages <= 8,
            "raw case/malformed rows must not strand continuation"
        );
        after = page.next_cursor;
        if after.is_none() {
            break;
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn case_lookup_uses_point_reads_at_100k_in_custom_and_generic_plans(pool: PgPool) {
    sqlx::query!(
        "INSERT INTO contacts_connections(user1, user2)
         SELECT 'macro|A' || lpad(n::text, 6, '0') || '@EXAMPLE.COM', 'macro|m@example.com'
         FROM generate_series(1, 50000) n
         UNION ALL
         SELECT 'macro|m@example.com', 'macro|z' || lpad(n::text, 6, '0') || '@EXAMPLE.COM'
         FROM generate_series(1, 50000) n"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("ANALYZE contacts_connections")
        .execute(&pool)
        .await
        .unwrap();
    let requested: Vec<_> = (1..=250)
        .flat_map(|index| {
            [
                MacroUserIdStr::try_from_email(&format!("a{index:06}@example.com")).unwrap(),
                MacroUserIdStr::try_from_email(&format!("z{index:06}@example.com")).unwrap(),
            ]
        })
        .collect();
    let lookup = ContactLookup::new(requested).unwrap();
    let repository = DbContactsRepository::new(pool.clone());
    assert_eq!(
        repository
            .lookup_contact_ids(
                MacroUserIdStr::try_from_email("m@example.com").unwrap(),
                &lookup
            )
            .await
            .unwrap(),
        lookup.ids()
    );

    let mut connection = pool.acquire().await.unwrap();
    // Match the hosted planner costs, without relying on PostgreSQL 18 skip scans.
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
    let prepare = format!(
        "PREPARE contacts_case_lookup(text, text[]) AS {}",
        include_str!("../../lookup.sql")
    );
    #[expect(
        clippy::disallowed_methods,
        reason = "PREPARE wraps the exact production SQL file"
    )]
    sqlx::query(&prepare)
        .execute(&mut *connection)
        .await
        .unwrap();
    // Only generated example-domain fixture literals enter EXECUTE. The adapter
    // binds the real caller's viewer/IDs through query_file!.
    let literal_ids = lookup
        .ids()
        .iter()
        .map(|id| format!("'{id}'"))
        .collect::<Vec<_>>()
        .join(",");
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
        for (viewer, expected) in [
            ("macro|m@example.com", 500.0),
            ("macro|stranger@example.com", 0.0),
        ] {
            let explain = format!(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE contacts_case_lookup('{viewer}', ARRAY[{literal_ids}])"
            );
            #[expect(
                clippy::disallowed_methods,
                reason = "EXPLAIN EXECUTE returns planner JSON using only fixed fixture values"
            )]
            let (plan,): (serde_json::Value,) = sqlx::query_as(&explain)
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            let root = &plan[0]["Plan"];
            let reads = root["Shared Hit Blocks"].as_u64().unwrap_or(0)
                + root["Shared Read Blocks"].as_u64().unwrap_or(0);
            eprintln!("case lookup: generic={generic}, rows={expected}, shared_blocks={reads}");
            assert!(
                reads < 5000,
                "lookup scanned membership (generic={generic}): {plan}"
            );
            assert_eq!(root["Actual Rows"].as_f64(), Some(expected));
            let serialized = plan.to_string();
            assert!(!serialized.contains("Seq Scan"), "{plan}");
            assert!(
                serialized.contains("idx_contacts_connections_user1_peer_ci"),
                "{plan}"
            );
            assert!(
                serialized.contains("idx_contacts_connections_user2_peer_ci"),
                "{plan}"
            );
        }
    }
}
