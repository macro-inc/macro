use anyhow::Result;
use cached::proc_macro::cached;
use model::comms::ChannelType;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelInfo {
    pub channel_type: ChannelType,
    pub org_id: Option<i64>,
    pub name: Option<String>,
}

#[tracing::instrument(skip(db))]
#[cached(
    time = 20,
    result = true,
    key = "String",
    convert = r#"{ channel_id.to_string() }"#
)]
pub async fn get_channel_info(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
) -> Result<ChannelInfo, sqlx::Error> {
    let res = sqlx::query_as!(
        ChannelInfo,
        r#"
        SELECT
            channel_type AS "channel_type: ChannelType",
            name,
            org_id
        FROM comms_channels
        WHERE id = $1
        "#,
        channel_id
    )
    .fetch_one(db)
    .await?;

    Ok(res)
}
