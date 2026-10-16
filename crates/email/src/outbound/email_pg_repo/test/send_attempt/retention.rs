use super::*;

async fn assert_compacted(pool: &Pool<Postgres>, attempt: SendAttemptId) -> anyhow::Result<()> {
    let row = sqlx::query!(
        "SELECT request, prepared_content, restore_body_html, restore_body_text, restore_body_macro FROM email_send_attempts WHERE attempt_id = $1",
        attempt.0,
    ).fetch_one(pool).await?;
    let request = row
        .request
        .expect("admitted attempt retains its approval digest");
    assert_eq!(request.as_object().unwrap().len(), 1);
    assert_eq!(request["_send_approval"]["version"], 1);
    assert!(row.prepared_content.is_none());
    assert!(row.restore_body_html.is_none());
    assert!(row.restore_body_text.is_none());
    assert!(row.restore_body_macro.is_none());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn cancellation_and_delivery_clear_content_without_losing_replay_identity(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let cancelled = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), cancelled, prepared())
        .await?;
    repo.cancel_send(&actor(), link(), cancelled).await?;
    assert_compacted(&pool, cancelled).await?;
    let body = sqlx::query_scalar!(
        "SELECT body_text FROM email_messages WHERE id = $1",
        message()
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(body.as_deref(), Some("Editable body"));
    assert_eq!(
        repo.admit_send(&actor(), link(), cancelled, prepared())
            .await?
            .status,
        SendAttemptStatus::Cancelled
    );

    let sent = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), sent, prepared()).await?;
    email_db_client::messages::update::mark_message_as_sent(
        &mut *pool.acquire().await?,
        "provider-message",
        "provider-thread-1",
        link(),
        message(),
    )
    .await?;
    assert_compacted(&pool, sent).await?;
    assert_eq!(
        repo.admit_send(&actor(), link(), sent, prepared())
            .await?
            .status,
        SendAttemptStatus::Sent
    );
    for attempt in [cancelled, sent] {
        let mut changed = prepared();
        changed.snapshot.message.body_text = Some("Changed content".into());
        assert!(matches!(
            repo.admit_send(&actor(), link(), attempt, changed).await,
            Err(EmailErr::SendAttemptConflict)
        ));
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn deleting_an_active_message_clears_ledger_content_and_preserves_the_tombstone(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    email_db_client::messages::delete::delete_db_message(&pool, message()).await?;
    assert_compacted(&pool, attempt).await?;
    let replay = repo
        .admit_send(&actor(), link(), attempt, prepared())
        .await?;
    assert!(!replay.transitioned);
    assert!(repo.send_message_row(link(), message()).await?.is_none());
    let mut changed = prepared();
    changed.snapshot.message.subject.push('!');
    assert!(matches!(
        repo.admit_send(&actor(), link(), attempt, changed).await,
        Err(EmailErr::SendAttemptConflict)
    ));
    Ok(())
}
