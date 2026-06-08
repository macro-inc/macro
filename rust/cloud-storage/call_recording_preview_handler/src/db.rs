use sqlx::{Pool, Postgres};

/// Persist the generated preview image object key/path for a recording.
///
/// `recording_key` is the MP4 key without the `calls/` prefix. `preview_key`
/// is the stable S3 object key/path for the preview image, for example
/// `calls/{room}/{recording_file_name}/PREVIEW.jpg`. Returns the total number
/// of active and archived rows updated so callers can retry when no matching
/// recording row exists yet.
#[tracing::instrument(skip(db), err)]
pub async fn update_preview_key(
    db: &Pool<Postgres>,
    recording_key: &str,
    preview_key: &str,
) -> anyhow::Result<u64> {
    let mut tx = db.begin().await?;

    let active = sqlx::query!(
        r#"
        UPDATE calls
        SET preview_url = $2
        WHERE recording_key = $1
        "#,
        recording_key,
        preview_key,
    )
    .execute(tx.as_mut())
    .await?;

    let archived = sqlx::query!(
        r#"
        UPDATE call_records
        SET preview_url = $2
        WHERE recording_key = $1
        "#,
        recording_key,
        preview_key,
    )
    .execute(tx.as_mut())
    .await?;

    tx.commit().await?;

    Ok(active.rows_affected() + archived.rows_affected())
}

#[cfg(test)]
mod test {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};
    use uuid::Uuid;

    const CHANNEL_ID: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000c411);
    const ACTIVE_CALL_ID: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000ca11);
    const ARCHIVED_CALL_ID: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000ca12);
    const MATCHING_RECORDING_KEY: &str = "room/recording.mp4";
    const OTHER_RECORDING_KEY: &str = "room/other.mp4";
    const PREVIEW_KEY: &str = "calls/room/recording.mp4/PREVIEW.jpg";

    async fn insert_channel(pool: &Pool<Postgres>) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
            VALUES ($1, 'preview-test-channel', 'public', 'macro|owner@test.com', NOW(), NOW())
            "#,
        )
        .bind(CHANNEL_ID)
        .execute(pool)
        .await?;

        Ok(())
    }

    async fn insert_share_permission(pool: &Pool<Postgres>, id: &str) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO "SharePermission" (id, "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
            VALUES ($1, FALSE, NULL, NOW(), NOW())
            "#,
        )
        .bind(id)
        .execute(pool)
        .await?;

        Ok(())
    }

    async fn insert_active_call(pool: &Pool<Postgres>, recording_key: &str) -> anyhow::Result<()> {
        insert_share_permission(pool, "preview-test-active-share").await?;
        sqlx::query(
            r#"
            INSERT INTO calls (id, channel_id, room_name, created_by, recording_key, share_permission_id)
            VALUES ($1, $2, 'preview-active-room', 'macro|owner@test.com', $3, 'preview-test-active-share')
            "#,
        )
        .bind(ACTIVE_CALL_ID)
        .bind(CHANNEL_ID)
        .bind(recording_key)
        .execute(pool)
        .await?;

        Ok(())
    }

    async fn insert_archived_call(
        pool: &Pool<Postgres>,
        recording_key: &str,
    ) -> anyhow::Result<()> {
        insert_share_permission(pool, "preview-test-archived-share").await?;
        sqlx::query(
            r#"
            INSERT INTO call_records (
                id,
                channel_id,
                room_name,
                created_by,
                started_at,
                ended_at,
                duration_ms,
                recording_key,
                share_permission_id
            )
            VALUES (
                $1,
                $2,
                'preview-archived-room',
                'macro|owner@test.com',
                NOW(),
                NOW(),
                0,
                $3,
                'preview-test-archived-share'
            )
            "#,
        )
        .bind(ARCHIVED_CALL_ID)
        .bind(CHANNEL_ID)
        .bind(recording_key)
        .execute(pool)
        .await?;

        Ok(())
    }

    async fn preview_url_for_active_call(pool: &Pool<Postgres>) -> anyhow::Result<Option<String>> {
        let preview_url = sqlx::query_scalar(
            r#"
            SELECT preview_url
            FROM calls
            WHERE id = $1
            "#,
        )
        .bind(ACTIVE_CALL_ID)
        .fetch_one(pool)
        .await?;

        Ok(preview_url)
    }

    async fn preview_url_for_archived_call(
        pool: &Pool<Postgres>,
    ) -> anyhow::Result<Option<String>> {
        let preview_url = sqlx::query_scalar(
            r#"
            SELECT preview_url
            FROM call_records
            WHERE id = $1
            "#,
        )
        .bind(ARCHIVED_CALL_ID)
        .fetch_one(pool)
        .await?;

        Ok(preview_url)
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn update_preview_key_updates_active_and_archived_rows(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        insert_channel(&pool).await?;
        insert_active_call(&pool, MATCHING_RECORDING_KEY).await?;
        insert_archived_call(&pool, MATCHING_RECORDING_KEY).await?;

        let rows = update_preview_key(&pool, MATCHING_RECORDING_KEY, PREVIEW_KEY).await?;

        assert_eq!(rows, 2);
        assert_eq!(
            preview_url_for_active_call(&pool).await?.as_deref(),
            Some(PREVIEW_KEY)
        );
        assert_eq!(
            preview_url_for_archived_call(&pool).await?.as_deref(),
            Some(PREVIEW_KEY)
        );
        Ok(())
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn update_preview_key_updates_only_matching_recording_key(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        insert_channel(&pool).await?;
        insert_active_call(&pool, MATCHING_RECORDING_KEY).await?;
        insert_archived_call(&pool, OTHER_RECORDING_KEY).await?;

        let rows = update_preview_key(&pool, MATCHING_RECORDING_KEY, PREVIEW_KEY).await?;

        assert_eq!(rows, 1);
        assert_eq!(
            preview_url_for_active_call(&pool).await?.as_deref(),
            Some(PREVIEW_KEY)
        );
        assert!(preview_url_for_archived_call(&pool).await?.is_none());
        Ok(())
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn update_preview_key_returns_zero_when_no_rows_match(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        insert_channel(&pool).await?;
        insert_active_call(&pool, OTHER_RECORDING_KEY).await?;
        insert_archived_call(&pool, OTHER_RECORDING_KEY).await?;

        let rows = update_preview_key(&pool, MATCHING_RECORDING_KEY, PREVIEW_KEY).await?;

        assert_eq!(rows, 0);
        assert!(preview_url_for_active_call(&pool).await?.is_none());
        assert!(preview_url_for_archived_call(&pool).await?.is_none());
        Ok(())
    }
}
