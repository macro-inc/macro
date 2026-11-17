use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn source_pages_include_inactive_history_and_deleted_targets_without_skipping(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    // Source IDs can outlive their records; saved rules deliberately have no FK
    // to those records. Every revision below is inactive, but still advances the
    // worker's bounded raw-reference cursor.
    let source = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition)
           SELECT $1, $2, n, $3, 1, '{"schema_version":1,"include":[]}'::jsonb FROM generate_series(1, 205) n"#,
        team, OWNER, link
    ).execute(&pool).await?;
    sqlx::query!("INSERT INTO crm_email_rule_contacts (team_id, user_id, revision, contact_id) SELECT $1, $2, n, $3 FROM generate_series(1, 205) n", team, OWNER, source).execute(&pool).await?;
    sqlx::query!("INSERT INTO crm_email_rule_companies (team_id, user_id, revision, company_id) SELECT $1, $2, n, $3 FROM generate_series(1, 205) n", team, OWNER, source).execute(&pool).await?;
    for kind in [
        EmailPolicySourceKind::Contact,
        EmailPolicySourceKind::Company,
    ] {
        let event = EmailPolicySourceEvent {
            event_id: Uuid::now_v7(),
            team_id: team,
            source_kind: kind,
            source_id: source,
            after: None,
            traceparent: None,
        };
        let mut write = pool.begin().await?;
        assert!(
            CompaniesRepositoryImpl::record_email_policy_source_event(&mut write, &event).await?
        );
        assert!(
            !CompaniesRepositoryImpl::record_email_policy_source_event(&mut write, &event).await?
        );
        write.commit().await?;
        let mut seen = vec![];
        for expected_size in [100, 100, 5] {
            let mut tx = repo
                .next_email_policy_source_event()
                .await?
                .expect("pending event");
            assert_eq!(tx.event().event_id, event.event_id);
            let page = tx.references().await?;
            assert_eq!(page.len(), expected_size);
            seen.extend(page.iter().map(|r| r.revision));
            tx.advance(page.last()).await?;
            // An out-of-order acknowledgement cannot rewind either storage or
            // the same transaction's next page.
            tx.advance(Some(&EmailPolicySourceReference {
                user_id: OWNER.into(),
                revision: 1,
            }))
            .await?;
            assert_eq!(tx.event().after, page.last().cloned());
            tx.commit().await?;
        }
        assert_eq!(seen, (1..=205).collect::<Vec<_>>());
        let mut tx = repo
            .next_email_policy_source_event()
            .await?
            .expect("exhausted event");
        assert!(tx.references().await?.is_empty());
        tx.advance(None).await?;
        tx.commit().await?;
        assert!(repo.next_email_policy_source_event().await?.is_none());
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn source_claims_skip_locked_events_and_rollback_retries_the_same_page(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, _, repo) = setup(&pool).await?;
    let event = EmailPolicySourceEvent {
        event_id: Uuid::now_v7(),
        team_id: team,
        source_kind: EmailPolicySourceKind::Contact,
        source_id: Uuid::now_v7(),
        after: None,
        traceparent: None,
    };
    let mut write = pool.begin().await?;
    CompaniesRepositoryImpl::record_email_policy_source_event(&mut write, &event).await?;
    write.commit().await?;
    let first = repo
        .next_email_policy_source_event()
        .await?
        .expect("first claim");
    assert!(repo.next_email_policy_source_event().await?.is_none());
    drop(first);
    let second = repo
        .next_email_policy_source_event()
        .await?
        .expect("retry after rollback");
    assert_eq!(second.event().event_id, event.event_id);
    assert!(second.event().after.is_none());
    second.commit().await?;
    sqlx::query!("DELETE FROM team WHERE id = $1", team)
        .execute(&pool)
        .await?;
    assert!(repo.next_email_policy_source_event().await?.is_none());
    Ok(())
}
