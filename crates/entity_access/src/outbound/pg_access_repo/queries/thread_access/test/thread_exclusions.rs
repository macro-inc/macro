use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn private_thread_revokes_crm_grant_without_revoking_mailbox_ownership(pool: PgPool) {
    let team = setup_shared_team(&pool, true).await;
    let thread = create_thread(&pool, OWNER, "person@client.example.com", &[]).await;
    assert_eq!(
        access_as_requester(&pool, &thread).await,
        Some(AccessLevel::Comment)
    );
    sqlx::query!(
        "INSERT INTO crm_email_thread_exclusions (team_id, user_id, link_id, thread_id) SELECT $1, $2, link_id, id FROM email_threads WHERE id = $3",
        team, OWNER, thread
    ).execute(&pool).await.unwrap();
    assert_eq!(access_as_requester(&pool, &thread).await, None);
    assert_eq!(
        get_thread_access(&pool, &thread, Viewer::User(OWNER))
            .await
            .unwrap(),
        Some(AccessLevel::Owner)
    );
    sqlx::query!("DELETE FROM crm_email_thread_exclusions WHERE team_id = $1 AND user_id = $2 AND thread_id = $3", team, OWNER, thread).execute(&pool).await.unwrap();
    assert_eq!(
        access_as_requester(&pool, &thread).await,
        Some(AccessLevel::Comment)
    );
}
