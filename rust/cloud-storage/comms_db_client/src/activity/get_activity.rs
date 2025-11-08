use crate::model::Activity;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use model::comms::{ChannelHistoryInfo, UserActivityForChannel};
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

#[tracing::instrument(skip(db), err)]
pub async fn get_activities(db: &Pool<Postgres>, user_id: &str) -> Result<Vec<Activity>> {
    sqlx::query_as!(
        Activity,
        r#"
        SELECT 
            a.id as "id!: Uuid",
            a.user_id as "user_id!: String",
            a.channel_id as "channel_id!: Uuid",
            a.viewed_at as "viewed_at?: DateTime<Utc>",
            a.interacted_at as "interacted_at?: DateTime<Utc>",
            a.created_at as "created_at!: DateTime<Utc>",
            a.updated_at as "updated_at!: DateTime<Utc>"
        FROM comms_activity a
        WHERE a.user_id = $1
        ORDER BY 
            GREATEST(
                COALESCE(a.viewed_at, '1970-01-01'::timestamp),
                COALESCE(a.interacted_at, '1970-01-01'::timestamp)
            ) DESC,
            a.created_at DESC
        LIMIT 100
        "#,
        user_id
    )
    .fetch_all(db)
    .await
    .context("failed to get activities")
}

#[tracing::instrument(skip(db))]
pub async fn get_activity_for_channel(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
    user_id: &str,
) -> Result<Option<Activity>> {
    let activity = sqlx::query_as!(
        Activity,
        r#"
        SELECT 
            a.id as "id!: Uuid",
            a.user_id as "user_id!: String",
            a.channel_id as "channel_id!: Uuid",
            a.viewed_at as "viewed_at?: DateTime<Utc>",
            a.interacted_at as "interacted_at?: DateTime<Utc>",
            a.created_at as "created_at!: DateTime<Utc>",
            a.updated_at as "updated_at!: DateTime<Utc>"
        FROM comms_activity a
        WHERE channel_id = $1 AND user_id = $2
        "#,
        channel_id,
        user_id
    )
    .fetch_optional(db)
    .await
    .context("failed to get activity for channel")?;

    Ok(activity)
}

#[tracing::instrument(skip(db))]
pub async fn get_activity_for_channel_bulk(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
    user_id: &[String],
) -> Result<Vec<UserActivityForChannel>> {
    let activities = sqlx::query_as!(
        UserActivityForChannel,
        r#"
        SELECT 
            a.user_id as "user_id!: String",
            a.updated_at
        FROM comms_activity a
        WHERE channel_id = $1 AND user_id = ANY($2)
        "#,
        channel_id,
        user_id
    )
    .fetch_all(db)
    .await
    .context("failed to get activity for channel")?;

    Ok(activities)
}

#[tracing::instrument(skip(db))]
pub async fn get_channel_history_info(
    db: &Pool<Postgres>,
    user_id: &str,
    channel_ids: &[Uuid],
) -> Result<HashMap<Uuid, ChannelHistoryInfo>, sqlx::Error> {
    if channel_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let results = sqlx::query!(
        r#"
        SELECT
            c."id" as "item_id!",
            c.created_at as "created_at!",
            c.updated_at as "updated_at!",
            uh.viewed_at as "viewed_at?",
            uh.interacted_at as "interacted_at?"
        FROM
            comms_channels c
        LEFT JOIN
            comms_activity uh ON uh.channel_id = c.id
                AND uh.user_id = $1
        WHERE
            c.id = ANY($2)
        ORDER BY
            c.updated_at DESC
        "#,
        user_id,
        channel_ids,
    )
    .fetch_all(db)
    .await?;

    let channel_history_map = results
        .into_iter()
        .map(|row| {
            let info = ChannelHistoryInfo {
                item_id: row.item_id,
                created_at: row.created_at,
                updated_at: row.updated_at,
                viewed_at: row.viewed_at.map(|dt| dt.and_utc()),
                interacted_at: row.interacted_at.map(|dt| dt.and_utc()),
            };
            (row.item_id, info)
        })
        .collect();

    Ok(channel_history_map)
}
