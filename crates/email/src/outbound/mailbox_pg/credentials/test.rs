use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

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
