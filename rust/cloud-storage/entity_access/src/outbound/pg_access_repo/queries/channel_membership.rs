//! Query for channel membership check.

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use uuid::Uuid;

/// Check if a user is a member of the specified channels.
///
/// Returns the subset of channel_ids that the user is a participant of.
#[tracing::instrument(err, skip(pool))]
pub async fn check_user_channel_membership(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
    channel_ids: &[Uuid],
) -> Result<Vec<Uuid>, sqlx::Error> {
    let user_id = user_id.as_ref();
    let channels = sqlx::query_scalar!(
        r#"
        SELECT c.id
        FROM comms_channels c
        INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id
        WHERE cp.user_id = $1 AND cp.left_at IS NULL
        AND c.id = ANY($2::uuid[])
        "#,
        user_id,
        channel_ids
    )
    .fetch_all(pool)
    .await?;

    Ok(channels)
}
