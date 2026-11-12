use super::*;
async fn create_root(pool: &PgPool, call_id: Uuid, channel_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content, kind) VALUES ($1, 'channel', $2, $3, 'Call', 'call_root')",
        call_id,
        channel_id.to_string(),
        USER_B.as_ref(),
    ).execute(pool).await?;
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_and_delete_record_log_the_channel_call_root(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let id = Uuid::now_v7();
    repo.create_call(
        &id,
        &CH2,
        "channel-sequence-call",
        USER_B.deref().copied(),
        true,
    )
    .await?
    .expect("call created");
    create_root(&pool, id, CH2).await?;
    repo.archive_call(&id).await?;
    let ended = sqlx::query_scalar!(
        r#"SELECT seq FROM channel_change_log WHERE channel_id = $1 AND message_id = $2 ORDER BY seq"#,
        CH2, id,
    ).fetch_all(&pool).await?;
    assert_eq!(ended, vec![1]);

    repo.delete_call_record(&id).await?;
    let removed = sqlx::query_scalar!(
        r#"SELECT seq FROM channel_change_log WHERE channel_id = $1 AND message_id = $2 ORDER BY seq"#,
        CH2, id,
    ).fetch_all(&pool).await?;
    assert_eq!(removed, vec![1, 2]);
    repo.delete_call_record(&id).await?;
    let seq = sqlx::query_scalar!(
        "SELECT seq FROM channel_change_counters WHERE channel_id = $1",
        CH2
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(seq, 2);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn delete_live_call_logs_its_retained_channel_root(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let id = Uuid::now_v7();
    repo.create_call(
        &id,
        &CH2,
        "channel-sequence-delete",
        USER_B.deref().copied(),
        true,
    )
    .await?
    .expect("call created");
    create_root(&pool, id, CH2).await?;
    repo.delete_call(&id).await?;
    let changed = sqlx::query_scalar!(
        r#"SELECT seq FROM channel_change_log WHERE channel_id = $1 AND message_id = $2 ORDER BY seq"#,
        CH2, id,
    ).fetch_all(&pool).await?;
    assert_eq!(changed, vec![1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn legacy_call_chat_does_not_take_a_channel_sequence(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    create_root(&pool, CALL1, CH1).await?;
    repo.archive_call(&CALL1).await?;
    repo.delete_call_record(&CALL1).await?;
    let changes = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM channel_change_log"#)
        .fetch_one(&pool)
        .await?;
    assert_eq!(changes, 0);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_thread_call_without_a_root_still_logs_status_changes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let id = Uuid::now_v7();
    repo.create_call(
        &id,
        &CH2,
        "channel-sequence-missing-root",
        USER_B.deref().copied(),
        true,
    )
    .await?
    .expect("call created");
    repo.archive_call(&id).await?;
    repo.delete_call_record(&id).await?;
    let logged = sqlx::query!(
        "SELECT seq, message_id FROM channel_change_log WHERE channel_id = $1 ORDER BY seq",
        CH2,
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(logged.len(), 2);
    assert_eq!(logged[0].seq, 1);
    assert_eq!(logged[1].seq, 2);
    assert!(logged.iter().all(|row| row.message_id == Some(id)));
    Ok(())
}
