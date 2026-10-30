use super::*;
use email_db_client::messages::{
    delete::{MessageDeletion, delete_message_with_tx, reconcile_deferred_deletion},
    get_simple_messages::get_simple_message_by_provider_and_link_for_update,
};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn provider_delete_lookup_locks_the_snapshot_until_deletion_is_deferred(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!(
        "UPDATE email_messages SET provider_id='provider-draft' WHERE id=$1",
        message(),
    )
    .execute(&pool)
    .await?;

    let mut deletion = pool.begin().await?;
    let snapshot = get_simple_message_by_provider_and_link_for_update(
        &mut deletion,
        "provider-draft",
        &link(),
    )
    .await?
    .expect("provider draft exists");
    // Completion and cancellation acquire this same row lock. NOWAIT proves
    // they cannot change the captured identity/lifetime before DELETE, without
    // timing-dependent sleeps or polling for a blocked worker.
    let blocked = sqlx::query!(
        "SELECT id FROM email_messages WHERE id=$1 FOR UPDATE NOWAIT",
        message(),
    )
    .fetch_one(&pool)
    .await
    .expect_err("the provider lookup must retain the row lock");
    assert_eq!(
        blocked
            .as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("55P03")
    );
    assert_eq!(
        delete_message_with_tx(&mut deletion, &snapshot).await?,
        MessageDeletion::Deferred
    );
    deletion.commit().await?;

    // Undo can now advance the lifetime while retaining the provider identity.
    // Cleanup of the earlier deletion must preserve the restored draft.
    repo.cancel_send(&actor(), link(), attempt).await?;
    assert!(
        reconcile_deferred_deletion(&pool, link(), message())
            .await?
            .is_none()
    );
    let restored = repo.send_message_row(link(), message()).await?.unwrap();
    assert!(restored.is_draft);
    assert_eq!(restored.provider_id.as_deref(), Some("provider-draft"));
    assert_eq!(restored.draft_generation, 2);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn provider_delete_lookup_does_not_adopt_a_replacement_sent_identity(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!(
        "UPDATE email_messages SET provider_id='provider-draft' WHERE id=$1",
        message(),
    )
    .execute(&pool)
    .await?;
    email_db_client::messages::update::mark_message_as_sent(
        &mut *pool.acquire().await?,
        "provider-sent",
        "provider-thread-1",
        link(),
        message(),
    )
    .await?;

    let mut deletion = pool.begin().await?;
    assert!(
        get_simple_message_by_provider_and_link_for_update(
            &mut deletion,
            "provider-draft",
            &link(),
        )
        .await?
        .is_none()
    );
    deletion.commit().await?;
    let sent = repo.send_message_row(link(), message()).await?.unwrap();
    assert!(sent.is_sent);
    assert_eq!(sent.provider_id.as_deref(), Some("provider-sent"));
    Ok(())
}
