use crate::model::{Activity, ActivityType};
use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::{Executor, Postgres};
use uuid::Uuid;

/// Updates activity for the given channel or user
pub async fn upsert_activity<'e, E>(
    executor: E,
    user_id: &str,
    channel_id: &Uuid,
    activity_type: &ActivityType,
) -> Result<Activity, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    match activity_type {
        ActivityType::View => {
            sqlx::query_as!(
                Activity,
                r#"
                INSERT INTO comms_activity (
                    id,
                    user_id,
                    channel_id,
                    viewed_at
                )
                VALUES (
                    $1, $2, $3, NOW()
                )
                ON CONFLICT (user_id, channel_id) DO UPDATE 
                SET 
                    viewed_at = NOW(),
                    updated_at = NOW()
                RETURNING 
                    id as "id!: Uuid",
                    user_id as "user_id!: String",
                    channel_id as "channel_id!: Uuid",
                    created_at as "created_at!: DateTime<Utc>",
                    updated_at as "updated_at!: DateTime<Utc>",
                    viewed_at as "viewed_at?: DateTime<Utc>",
                    interacted_at as "interacted_at?: DateTime<Utc>"
                "#,
                macro_uuid::generate_uuid_v7(),
                user_id,
                channel_id,
            )
            .fetch_one(executor)
            .await
        }
        ActivityType::Interact => {
            sqlx::query_as!(
                Activity,
                r#"
                INSERT INTO comms_activity (
                    id,
                    user_id,
                    channel_id,
                    interacted_at
                )
                VALUES (
                    $1, $2, $3, NOW()
                )
                ON CONFLICT (user_id, channel_id) DO UPDATE 
                SET 
                    interacted_at = NOW(),
                    updated_at = NOW()
                RETURNING 
                    id as "id!: Uuid",
                    user_id as "user_id!: String",
                    channel_id as "channel_id!: Uuid",
                    created_at as "created_at!: DateTime<Utc>",
                    updated_at as "updated_at!: DateTime<Utc>",
                    viewed_at as "viewed_at?: DateTime<Utc>",
                    interacted_at as "interacted_at?: DateTime<Utc>"
                "#,
                macro_uuid::generate_uuid_v7(),
                user_id,
                channel_id,
            )
            .fetch_one(executor)
            .await
        }
    }
}
