use crate::model::Activity;
use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::{Executor, Postgres};
use uuid::Uuid;

/// Creates a new activity for the given channel and user
pub async fn create_activity<'e, E>(executor: E, channel_id: &Uuid, user_id: &str) -> Result<Uuid>
where
    E: Executor<'e, Database = Postgres>,
{
    let id = macro_uuid::generate_uuid_v7();

    let activity = sqlx::query_as!(
        Activity,
        r#"
        INSERT INTO comms_activity (
            id,
            user_id,
            channel_id,
            created_at,
            updated_at
        )
        VALUES (
            $1, $2, $3, NOW(), NOW()
        )
        RETURNING 
            id as "id!: Uuid",
            user_id as "user_id!: String",
            channel_id as "channel_id!: Uuid",
            created_at as "created_at!: DateTime<Utc>",
            updated_at as "updated_at!: DateTime<Utc>",
            viewed_at as "viewed_at?: DateTime<Utc>",
            interacted_at as "interacted_at?: DateTime<Utc>"
        "#,
        id,
        user_id,
        channel_id,
    )
    .fetch_one(executor)
    .await?;

    Ok(activity.id)
}
