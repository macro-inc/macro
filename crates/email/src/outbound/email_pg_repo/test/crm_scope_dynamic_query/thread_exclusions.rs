use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn private_thread_is_excluded_from_contact_company_and_broad_crm_reads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let thread = Uuid::parse_str(TB1_BOB_INBOX_ACME)?;
    let contact_scope = item_filters::ast::email::expand_crm_scope(
        vec![],
        vec!["outsider@acme.example.com".into()],
    )?
    .unwrap();
    let company_scope =
        item_filters::ast::email::expand_crm_scope(vec!["acme.example.com".into()], vec![])?
            .unwrap();
    let filters = [
        Arc::new(contact_scope.0),
        Arc::new(company_scope.0),
        Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
            "com".into(),
        )))),
    ];
    for filter in &filters {
        assert!(
            run_and_collect_ids(&pool, filter.clone(), Some(team))
                .await?
                .contains(TB1_BOB_INBOX_ACME)
        );
    }
    let exclusion = sqlx::query!(
        "INSERT INTO crm_email_thread_exclusions (team_id, user_id, link_id, thread_id) SELECT $1, l.macro_id, l.id, t.id FROM email_threads t JOIN email_links l ON l.id = t.link_id WHERE t.id = $2 RETURNING link_id, user_id",
        team, thread
    ).fetch_one(&pool).await?;
    for filter in &filters {
        let ids = run_and_collect_ids(&pool, filter.clone(), Some(team)).await?;
        assert!(!ids.contains(TB1_BOB_INBOX_ACME));
        assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    }
    // Sales Email uses ordinary own-mailbox access, without a contribution scope.
    let own = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[exclusion.link_id],
        100,
        &PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        Query::new(None, SimpleSortMethod::UpdatedAt, filters[0].clone()),
        &exclusion.user_id,
        None,
    )
    .await?;
    assert!(own.iter().any(|item| item.id == thread));
    assert!(
        !run_and_collect_ids(&pool, filters[0].clone(), None)
            .await?
            .contains(TB1_BOB_INBOX_ACME)
    );
    sqlx::query!(
        "DELETE FROM crm_email_thread_exclusions WHERE team_id = $1 AND thread_id = $2",
        team,
        thread
    )
    .execute(&pool)
    .await?;
    for filter in filters {
        assert!(
            run_and_collect_ids(&pool, filter, Some(team))
                .await?
                .contains(TB1_BOB_INBOX_ACME)
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("email_dynamic_query_crm_dedupe")
    )
)]
async fn private_thread_deduplication_falls_back_to_another_contributors_copy(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team = Uuid::parse_str(TEAM_BETA_ID)?;
    let thread = Uuid::parse_str(TD1_DAVE_CONV_X)?;
    sqlx::query!(
        "INSERT INTO crm_email_thread_exclusions (team_id, user_id, link_id, thread_id) SELECT $1, l.macro_id, l.id, t.id FROM email_threads t JOIN email_links l ON l.id = t.link_id WHERE t.id = $2",
        team, thread
    ).execute(&pool).await?;
    let caller = sqlx::query_scalar!(
        "SELECT macro_id FROM email_links WHERE id = $1",
        Uuid::parse_str(DAVE_LINK_ID)?
    )
    .fetch_one(&pool)
    .await?;
    let ids = run_dedupe_query(&pool, DAVE_LINK_ID, &caller).await?;
    assert!(!ids.contains(&TD1_DAVE_CONV_X.to_string()));
    assert!(ids.contains(&TE1_ERIN_CONV_X.to_string()));
    Ok(())
}
