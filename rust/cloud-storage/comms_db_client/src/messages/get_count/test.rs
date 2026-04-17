use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE

async fn insert_channel(pool: &PgPool, channel_id: Uuid) {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
        VALUES ($1, 'test', 'public', NULL, 'owner')
        "#,
        channel_id
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_message(pool: &PgPool, channel_id: Uuid, deleted: bool, thread_id: Option<Uuid>) {
    sqlx::query!(
        r#"
        INSERT INTO comms_messages
            (id, channel_id, sender_id, content, thread_id, deleted_at)
        VALUES
            ($1, $2, 'sender', 'content', $3,
             CASE WHEN $4 THEN NOW() ELSE NULL END)
        "#,
        macro_uuid::generate_uuid_v7(),
        channel_id,
        thread_id,
        deleted
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_zero_for_empty_channel(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await;

    let count = get_channel_message_count(&pool, &channel_id).await?;
    assert_eq!(count, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_one_for_single_message(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await;
    insert_message(&pool, channel_id, false, None).await;

    let count = get_channel_message_count(&pool, &channel_id).await?;
    assert_eq!(count, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_full_count_not_capped_at_one(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await;
    for _ in 0..5 {
        insert_message(&pool, channel_id, false, None).await;
    }

    let count = get_channel_message_count(&pool, &channel_id).await?;
    assert_eq!(
        count, 5,
        "function should return the real row count, not a 0/1 flag"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn includes_deleted_messages(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await;
    insert_message(&pool, channel_id, false, None).await;
    insert_message(&pool, channel_id, true, None).await;
    insert_message(&pool, channel_id, true, None).await;

    let count = get_channel_message_count(&pool, &channel_id).await?;
    assert_eq!(
        count, 3,
        "soft-deleted messages are still counted by the underlying query"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_counts_matching_channel(pool: PgPool) -> anyhow::Result<()> {
    let channel_a = Uuid::new_v4();
    let channel_b = Uuid::new_v4();
    insert_channel(&pool, channel_a).await;
    insert_channel(&pool, channel_b).await;

    insert_message(&pool, channel_a, false, None).await;
    insert_message(&pool, channel_a, false, None).await;
    insert_message(&pool, channel_b, false, None).await;

    assert_eq!(get_channel_message_count(&pool, &channel_a).await?, 2);
    assert_eq!(get_channel_message_count(&pool, &channel_b).await?, 1);
    Ok(())
}
