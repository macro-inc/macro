use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imap_health_without_microsoft_scopes_does_not_lock_and_rejects_retired_generations(
    db: sqlx::PgPool,
) {
    let (_, link) =
        super::super::test::fixture_for_provider(&db, crate::domain::models::UserProvider::Imap)
            .await;

    let repo =
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap);
    let mailbox = MailboxAccess {
        sync_generation: 1,
        link_id: link,
        grant_generation: 1,
    };
    let mut population = db.begin().await.unwrap();
    sqlx::query!(
        r#"
        SELECT
            id
        FROM
            email_links
        WHERE
            id = $1 FOR SHARE
        "#,
        link,
    )
    .fetch_one(&mut *population)
    .await
    .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        repo.record(mailbox, CredentialHealth::Available(vec![])),
    )
    .await
    .unwrap()
    .unwrap();
    population.rollback().await.unwrap();
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            sync_generation = sync_generation + 1
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.record(mailbox, CredentialHealth::Available(vec![]))
            .await,
        Err(TokenError::ReauthRequired)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reauthorization_is_edge_triggered_and_commits_with_its_notification(db: sqlx::PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    let mailbox = MailboxAccess {
        sync_generation: 1,
        link_id: link,
        grant_generation: 1,
    };
    repo.record(mailbox, CredentialHealth::ReauthorizationRequired)
        .await
        .unwrap();
    repo.record(mailbox, CredentialHealth::ReauthorizationRequired)
        .await
        .unwrap();
    assert!(
        sqlx::query_scalar!("SELECT needs_reauth FROM email_links WHERE id = $1", link)
            .fetch_one(&db)
            .await
            .unwrap()
    );
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_projection_outbox WHERE link_id = $1 AND payload->>'kind' = 'reauthorization_required' ",link).fetch_one(&db).await.unwrap(),Some(1));
    repo.record(mailbox, CredentialHealth::Available(vec![]))
        .await
        .unwrap();
    assert!(
        !sqlx::query_scalar!("SELECT needs_reauth FROM email_links WHERE id = $1", link)
            .fetch_one(&db)
            .await
            .unwrap()
    );
    repo.record(mailbox, CredentialHealth::ReauthorizationRequired)
        .await
        .unwrap();
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_projection_outbox WHERE link_id = $1 AND payload->>'kind' = 'reauthorization_required' ",link).fetch_one(&db).await.unwrap(),Some(2));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn old_credential_failures_cannot_revoke_a_reconnected_mailbox(db: sqlx::PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    sqlx::query!(
        "UPDATE email_links SET grant_generation = 2 WHERE id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.record(
            MailboxAccess {
                sync_generation: 1,
                link_id: link,
                grant_generation: 1
            },
            CredentialHealth::ReauthorizationRequired
        )
        .await,
        Err(TokenError::ReauthRequired)
    ));
    assert!(
        !sqlx::query_scalar!("SELECT needs_reauth FROM email_links WHERE id = $1", link)
            .fetch_one(&db)
            .await
            .unwrap()
    );
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_projection_outbox WHERE link_id = $1 AND payload->>'kind' = 'reauthorization_required' ",link).fetch_one(&db).await.unwrap(),Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn health_behind_a_share_locked_link_fails_fast_as_a_transient_token_error(db: sqlx::PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;

    // A CRM contact population holds the link this way for its whole transaction.
    let mut population = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id=$1 FOR SHARE", link)
        .fetch_one(&mut *population)
        .await
        .unwrap();

    let recorded = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        repo.record(
            MailboxAccess {
                sync_generation: 1,
                link_id: link,
                grant_generation: 1,
            },
            CredentialHealth::ReauthorizationRequired,
        ),
    )
    .await;
    assert!(
        matches!(
            &recorded,
            Ok(Err(TokenError::Transient { message })) if message.ends_with("sqlstate 55P03")
        ),
        "{recorded:?}"
    );
    population.rollback().await.unwrap();
    assert!(
        !sqlx::query_scalar!("SELECT needs_reauth FROM email_links WHERE id = $1", link)
            .fetch_one(&db)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn health_already_stored_is_reported_without_waiting_on_the_link(db: sqlx::PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    let mailbox = MailboxAccess {
        sync_generation: 1,
        link_id: link,
        grant_generation: 1,
    };
    repo.record(
        mailbox,
        CredentialHealth::Available(vec!["Mail.Read".into()]),
    )
    .await
    .unwrap();

    // A CRM contact population holds the link this way for its whole transaction.
    let mut population = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id=$1 FOR SHARE", link)
        .fetch_one(&mut *population)
        .await
        .unwrap();

    // Every Graph call's token fetch reports this; it must not queue.
    let unchanged = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        repo.record(
            mailbox,
            CredentialHealth::Available(vec!["Mail.Read".into()]),
        ),
    )
    .await;
    assert!(matches!(unchanged, Ok(Ok(()))), "{unchanged:?}");

    // New scopes are a change, which waits on the link and times out.
    let changed = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        repo.record(
            mailbox,
            CredentialHealth::Available(vec!["Mail.Read".into(), "Mail.Send".into()]),
        ),
    )
    .await;
    assert!(
        matches!(
            &changed,
            Ok(Err(TokenError::Transient { message })) if message.ends_with("sqlstate 55P03")
        ),
        "{changed:?}"
    );
    population.rollback().await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT granted_scopes FROM email_link_microsoft_scopes WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        vec!["Mail.Read".to_string()]
    );
}
