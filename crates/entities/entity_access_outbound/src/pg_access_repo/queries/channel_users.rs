//! Query for users in a channel via comms_channel_participants.

#[cfg(not(test))]
use cached::proc_macro::cached;

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

/// Get all user IDs that are active participants in a channel.
#[tracing::instrument(err, skip(pool))]
#[cfg_attr(
    not(test),
    cached(
        time = 10,
        result = true,
        key = "String",
        convert = r#"{format!("{}", channel_id)}"#
    )
)]
pub async fn get_channel_users(
    pool: &PgPool,
    channel_id: &Uuid,
) -> Result<Vec<MacroUserIdStr<'static>>, sqlx::Error> {
    let users = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT cp.user_id
        FROM comms_channel_participants cp
        WHERE cp.channel_id = $1 AND cp.left_at IS NULL
        "#,
        channel_id
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .filter_map(|u| {
        MacroUserIdStr::parse_from_str(u.as_str())
            .ok()
            .map(|u| u.into_owned())
    })
    .collect();

    Ok(users)
}
