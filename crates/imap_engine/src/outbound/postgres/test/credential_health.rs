use super::*;

#[sqlx::test(migrations = false)]
async fn recovery_notification_is_scheduled_after_restart_but_completed_parking_is_not(
    pool: PgPool,
) {
    schema(&pool).await;
    let link = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
        VALUES ($1, 'owner', 'IMAP')
        "#,
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    let state = serde_json::to_value(AccountState {
        needs_reauth: true,
        notification_pending: true,
        mailbox_issue: Some(models_email::service::link::MailboxIssue::CredentialsUnreadable),
        ..Default::default()
    })
    .unwrap();
    sqlx::query!(r#"
        INSERT INTO imap_accounts (link_id, user_id, sync_generation, grant_generation, credential_ciphertext, state)
        VALUES ($1, 'owner', 1, 1, decode('01', 'hex'), $2)
        "#, link, state).execute(&pool).await.unwrap();
    let binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    let restarted = PgRepository::new(pool.clone());
    assert_eq!(restarted.bindings(2000, &[]).await.unwrap(), vec![binding]);
    let mut account = restarted
        .acquire_scoped(binding, StateSelection::Catalog)
        .await
        .unwrap();
    account.state.notification_pending = false;
    restarted.save_health(&mut account).await.unwrap();
    restarted.release(&account).await.unwrap();
    let next_restart = PgRepository::new(pool);
    assert!(next_restart.bindings(2000, &[]).await.unwrap().is_empty());
}
