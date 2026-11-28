//! Query for users in a channel via comms_channel_participants.

#[cfg(not(test))]
use cached::proc_macro::cached;

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

const CHANNEL_ROSTER_PAGE_SIZE: usize = 500;

/// Get all user IDs that are active participants in a channel, as of up to
/// ten seconds ago.
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
    .await?;
    Ok(users
        .iter()
        .filter_map(|user| parse_channel_user(user))
        .collect())
}

/// Get the active roster at one fresh snapshot, past the audience cache.
/// Each page walks the active-membership index even when its statistics lag.
#[tracing::instrument(err, skip(pool))]
pub async fn read_channel_users(
    pool: &PgPool,
    channel_id: &Uuid,
) -> Result<Vec<MacroUserIdStr<'static>>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;

    let mut after = String::new();
    let mut users = Vec::new();
    loop {
        let page = sqlx::query_scalar!(
            r#"SELECT cp.user_id
FROM comms_channel_participants cp
WHERE cp.channel_id = $1 AND cp.left_at IS NULL AND cp.user_id > $2
ORDER BY cp.user_id
LIMIT 500"#,
            channel_id,
            &after,
        )
        .fetch_all(&mut *tx)
        .await?;
        let next = if page.len() == CHANNEL_ROSTER_PAGE_SIZE {
            page.last().cloned()
        } else {
            None
        };
        users.extend(page.iter().filter_map(|user| parse_channel_user(user)));
        let Some(next) = next else { break };
        after = next;
    }
    tx.commit().await?;
    Ok(users)
}

fn parse_channel_user(user_id: &str) -> Option<MacroUserIdStr<'static>> {
    MacroUserIdStr::parse_from_str(user_id)
        .ok()
        .map(|user| user.into_owned())
}
