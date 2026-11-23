use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn thread_exclusion_is_retroactive_and_population_cannot_restore_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let thread =
        insert_interaction(&pool, link, "person@client.example.com", Utc::now(), true).await?;
    deliver(&repo, team, link, "person@client.example.com").await?;
    let company = fetch_company_for_domain(&pool, team, "client.example.com")
        .await?
        .unwrap();
    let history = fetch_company_interactions(&pool, company).await?;
    assert!(allowed(&pool, team, thread).await?);
    for _ in 0..2 {
        repo.change_email_privacy(
            team,
            OWNER,
            EmailPrivacyChange::SetThreadExclusion {
                thread_id: thread,
                excluded: true,
            },
        )
        .await?;
    }
    assert!(!allowed(&pool, team, thread).await?);
    assert_eq!(
        interaction_parity::scan(&pool, team, link, "person@client.example.com").await?,
        (None, None, None)
    );
    deliver(&repo, team, link, "person@client.example.com").await?;
    assert!(!allowed(&pool, team, thread).await?);
    assert_eq!(count_contacts(&pool, company).await?, 1);
    assert_eq!(fetch_company_hidden(&pool, company).await?, Some(false));
    assert_eq!(fetch_company_interactions(&pool, company).await?, history);
    let listed = repo.excluded_email_threads(team, OWNER, None, None).await?;
    assert_eq!(listed.threads.len(), 1);
    assert_eq!(listed.threads[0].thread_id, thread);
    assert_eq!(listed.threads[0].link_id, link);
    assert!(listed.next_cursor.is_none());
    assert!(
        repo.excluded_email_threads(team, OWNER, Some(thread), None)
            .await?
            .threads
            .is_empty()
    );
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetThreadExclusion {
            thread_id: thread,
            excluded: false,
        },
    )
    .await?;
    assert!(allowed(&pool, team, thread).await?);
    assert!(
        repo.excluded_email_threads(team, OWNER, None, None)
            .await?
            .threads
            .is_empty()
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_backfill_outbox WHERE team_id = $1 AND user_id = $2",
            team,
            OWNER
        )
        .fetch_one(&pool)
        .await?,
        Some(1)
    );
    // Restoration does not override other privacy rules.
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::AddDomain {
            scope: EmailBlockScope::Personal,
            domain: "client.example.com".into(),
        },
    )
    .await?;
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetThreadExclusion {
            thread_id: thread,
            excluded: false,
        },
    )
    .await?;
    assert!(!allowed(&pool, team, thread).await?);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn thread_exclusion_does_not_affect_teammates_copy_and_is_owner_only(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let other = "macro|member@example.com";
    interaction_parity::insert_member(&pool, team, other).await?;
    let other_link = insert_email_link(&pool, other, "member@example.com").await?;
    consent_to_mailbox(&pool, team, other_link).await?;
    let mine =
        insert_interaction(&pool, link, "person@client.example.com", Utc::now(), true).await?;
    let theirs = insert_interaction(
        &pool,
        other_link,
        "person@client.example.com",
        Utc::now(),
        true,
    )
    .await?;
    // Matching provider IDs do not combine independently owned mailbox copies.
    sqlx::query!(
        "UPDATE email_threads SET provider_id = 'same-conversation' WHERE id = ANY($1)",
        &[mine, theirs]
    )
    .execute(&pool)
    .await?;
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetThreadExclusion {
            thread_id: mine,
            excluded: true,
        },
    )
    .await?;
    assert!(!allowed(&pool, team, mine).await?);
    assert!(allowed(&pool, team, theirs).await?);
    assert!(
        repo.excluded_email_threads(team, other, None, None)
            .await?
            .threads
            .is_empty()
    );
    for excluded in [true, false] {
        assert!(
            repo.change_email_privacy(
                team,
                other,
                EmailPrivacyChange::SetThreadExclusion {
                    thread_id: mine,
                    excluded
                }
            )
            .await
            .is_err()
        );
        assert!(
            repo.change_email_privacy(
                team,
                OWNER,
                EmailPrivacyChange::SetThreadExclusion {
                    thread_id: theirs,
                    excluded
                }
            )
            .await
            .is_err()
        );
    }
    assert!(!allowed(&pool, team, mine).await?);
    assert!(allowed(&pool, team, theirs).await?);
    sqlx::query!("DELETE FROM email_threads WHERE id = $1", mine)
        .execute(&pool)
        .await?;
    assert!(
        repo.excluded_email_threads(team, OWNER, None, None)
            .await?
            .threads
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn excluded_threads_are_paged_by_id_and_removed_with_membership(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    let ids: Vec<Uuid> = (0..55).map(|_| Uuid::now_v7()).collect();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) SELECT id, $2 FROM unnest($1::uuid[]) id",
        &ids,
        link
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO crm_email_thread_exclusions (team_id, user_id, link_id, thread_id) SELECT $1, $2, $3, id FROM unnest($4::uuid[]) id", team, OWNER, link, &ids).execute(&pool).await?;
    let first = repo.excluded_email_threads(team, OWNER, None, None).await?;
    assert_eq!(first.threads.len(), 50);
    let second = repo
        .excluded_email_threads(team, OWNER, first.next_cursor, None)
        .await?;
    assert_eq!(second.threads.len(), 5);
    let target = second.threads[4].thread_id;
    let exact = repo
        .excluded_email_threads(team, OWNER, None, Some(target))
        .await?;
    assert_eq!(exact.threads.len(), 1);
    assert_eq!(exact.threads[0].thread_id, target);
    assert!(exact.next_cursor.is_none());
    let foreign = repo
        .excluded_email_threads(Uuid::now_v7(), OWNER, None, Some(target))
        .await?;
    assert!(foreign.threads.is_empty());
    assert!(second.next_cursor.is_none());
    let listed: Vec<_> = first
        .threads
        .into_iter()
        .chain(second.threads)
        .map(|thread| thread.thread_id)
        .collect();
    let mut expected = ids;
    expected.sort();
    assert_eq!(listed, expected);
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.excluded_email_threads(team, OWNER, None, None)
            .await?
            .threads
            .is_empty()
    );
    Ok(())
}
