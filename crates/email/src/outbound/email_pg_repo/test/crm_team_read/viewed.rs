use super::*;

async fn assert_viewed_parity(
    pool: &Pool<Postgres>,
    caller: u8,
    filter: &Expr<EmailLiteral>,
    limit: u32,
) -> anyhow::Result<Vec<Vec<ThreadPreviewCursorDbRow>>> {
    let expected = pages_sorted(
        pool,
        TEAM_GAMMA_ID,
        &[link(caller)],
        &user(caller),
        filter,
        limit,
        None,
        SimpleSortMethod::ViewedUpdated,
    )
    .await?;
    for (name, tuning) in [
        ("default", TeamReadTuning::DEFAULT),
        (
            "sparse",
            TeamReadTuning {
                superset_limit: i64::MAX,
                window_per_row: 1,
            },
        ),
        (
            "refill",
            TeamReadTuning {
                superset_limit: -1,
                window_per_row: 1,
            },
        ),
    ] {
        let actual = pages_sorted(
            pool,
            TEAM_GAMMA_ID,
            &[link(caller)],
            &user(caller),
            filter,
            limit,
            Some(tuning),
            SimpleSortMethod::ViewedUpdated,
        )
        .await?;
        assert_eq!(
            printed(&actual),
            printed(&expected),
            "{name}, caller {caller}, {filter:?}"
        );
    }
    Ok(expected)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn viewed_updated_without_history_keeps_complete_pages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let pages = assert_viewed_parity(&pool, 0, &company(&["dense.test"]), 17).await?;
    assert!(pages.iter().map(Vec::len).sum::<usize>() > 300);
    // The first windows hold no matching old mail. Empty intermediate
    // windows must advance, rather than return a short page.
    let old = assert_viewed_parity(&pool, 0, &company(&["old.test"]), 11).await?;
    assert!(old.iter().map(Vec::len).sum::<usize>() > 20);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn viewed_updated_old_views_ties_and_foreign_history_keep_pages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO email_user_history (link_id, thread_id, updated_at)
        SELECT link_id, id, CASE get_byte(uuid_send(id), 0) % 3
            WHEN 1 THEN '2026-02-01'::timestamptz
            ELSE '2026-07-01'::timestamptz END
        FROM email_threads WHERE get_byte(uuid_send(id), 0) % 3 <> 0
        "#
    )
    .execute(&pool)
    .await?;
    // The independent link/thread foreign keys permit this row. It must
    // neither order nor introduce a thread owned by a different mailbox.
    sqlx::query!(
        r#"
        INSERT INTO email_user_history (link_id, thread_id, updated_at)
        SELECT $1, id, '2099-01-01'::timestamptz FROM email_threads
        WHERE link_id = $2 ORDER BY id LIMIT 50
        "#,
        link(1),
        link(0),
    )
    .execute(&pool)
    .await?;

    let pages = assert_viewed_parity(&pool, 0, &company(&["dense.test"]), 17).await?;
    let mut older_views = 0;
    for row in pages.iter().flatten() {
        if let Some(viewed_at) = row.viewed_at
            && viewed_at < row.updated_at
        {
            assert_eq!(row.sort_ts, viewed_at, "view time overrides newer mail");
            older_views += 1;
        }
    }
    assert!(older_views > 20);
    assert_viewed_parity(&pool, 1, &contact(&["p1@dense.test"]), 13).await?;
    assert_viewed_parity(&pool, 0, &signal(company(&["old.test"])), 3).await?;
    // Every candidate is rejected by the same privacy rule, across both
    // history partitions and multiple windows.
    let hidden = assert_viewed_parity(&pool, 0, &company(&["mail.hidden.test"]), 7).await?;
    assert!(hidden.iter().all(Vec::is_empty));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn viewed_updated_copy_priority_and_selected_privacy_keep_pages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Every contributing thread is viewed, with ties much larger than a
    // window. An older own copy still wins a newer teammate's copy, even
    // when that representative falls outside the current cursor/window.
    sqlx::query!(
        r#"
        INSERT INTO email_user_history (link_id, thread_id, updated_at)
        SELECT link_id, id, CASE WHEN link_id = $1
            THEN '2026-02-01'::timestamptz ELSE '2026-07-01'::timestamptz END
        FROM email_threads
        "#,
        link(0),
    )
    .execute(&pool)
    .await?;
    assert_viewed_parity(&pool, 0, &company(&["dense.test"]), 17).await?;
    assert_viewed_parity(&pool, 3, &company(&["dense.test"]), 23).await?;

    let team = Uuid::parse_str(TEAM_GAMMA_ID)?;
    sqlx::query!(
        r#"INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition)
           SELECT team_id, user_id, 1, link_id, 1, '{"schema_version":1,"include":[]}'::jsonb
           FROM crm_email_consent WHERE team_id = $1 AND user_id = $2"#,
        team, user(0),
    ).execute(&pool).await?;
    sqlx::query!(
        "UPDATE crm_email_consent SET enabled = FALSE WHERE team_id = $1 AND user_id = $2",
        team,
        user(0),
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE crm_email_consent SET mode = 'selected', selected_enabled = TRUE, active_rule_revision = 1 WHERE team_id = $1 AND user_id = $2",
        team, user(0),
    ).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO crm_email_rule_addresses (team_id, user_id, revision, address) VALUES ($1, $2, 1, 'p1@dense.test')",
        team, user(0),
    ).execute(&pool).await?;
    // Some old own copies are now ineligible, so their newer teammate
    // copies must become the representative instead of disappearing.
    let selected = assert_viewed_parity(&pool, 0, &company(&["dense.test"]), 17).await?;
    assert!(selected.iter().flatten().any(|row| row.link_id == link(0)));
    assert!(selected.iter().flatten().any(|row| row.link_id != link(0)));
    sqlx::query!(
        r#"INSERT INTO crm_email_thread_exclusions (team_id, user_id, link_id, thread_id)
           SELECT $1, $2, $3, id FROM email_threads WHERE link_id = $3"#,
        team,
        user(0),
        link(0),
    )
    .execute(&pool)
    .await?;
    let excluded = assert_viewed_parity(&pool, 0, &company(&["dense.test"]), 17).await?;
    assert!(excluded.iter().flatten().all(|row| row.link_id != link(0)));
    Ok(())
}
