//! Storage for team-sharing changes awaiting the other participants' approval.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{CallError, TeamShareChange};

#[tracing::instrument(err, skip(pool))]
pub(super) async fn get(
    pool: &PgPool,
    call_id: &Uuid,
) -> Result<Option<TeamShareChange>, CallError> {
    let change = sqlx::query_as!(
        TeamShareChange,
        r#"
        SELECT shared, requested_by, approved_by
        FROM call_team_share_change_requests
        WHERE call_id = $1
        "#,
        call_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(change)
}

/// People only: `call_participants` keeps its rows after someone leaves, and
/// archiving copies them to `call_record_participants`. A DM's other member
/// counts before joining, so nobody shares a conversation they have yet to
/// enter.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn approvers(pool: &PgPool, call_id: &Uuid) -> Result<Vec<String>, CallError> {
    let approvers = sqlx::query_scalar!(
        r#"
        SELECT user_id AS "user_id!" FROM (
            SELECT user_id FROM call_participants WHERE call_id = $1
            UNION
            SELECT user_id FROM call_record_participants WHERE call_record_id = $1
            UNION
            SELECT member.user_id
            FROM call_entities call
            JOIN comms_channels channel ON channel.id = call.channel_id
            JOIN comms_channel_participants member ON member.channel_id = channel.id
            WHERE call.id = $1
              AND channel.channel_type = 'direct_message'
              AND member.left_at IS NULL
        ) people
        WHERE user_id LIKE 'macro|%'
        ORDER BY 1
        "#,
        call_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(approvers)
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn approve(
    pool: &PgPool,
    call_id: &Uuid,
    shared: bool,
    user_id: MacroUserIdStr<'_>,
) -> Result<Option<TeamShareChange>, CallError> {
    let change = sqlx::query_as!(
        TeamShareChange,
        r#"
        INSERT INTO call_team_share_change_requests (call_id, shared, requested_by, approved_by)
        VALUES ($1, $2, $3, ARRAY[$3])
        ON CONFLICT (call_id) DO UPDATE
            SET approved_by = CASE
                WHEN $3 = ANY(call_team_share_change_requests.approved_by)
                    THEN call_team_share_change_requests.approved_by
                ELSE array_append(call_team_share_change_requests.approved_by, $3)
            END
            WHERE call_team_share_change_requests.shared = $2
        RETURNING shared, requested_by, approved_by
        "#,
        call_id,
        shared,
        user_id.as_ref(),
    )
    .fetch_optional(pool)
    .await?;
    Ok(change)
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn clear(pool: &PgPool, call_id: &Uuid) -> Result<(), CallError> {
    sqlx::query!(
        "DELETE FROM call_team_share_change_requests WHERE call_id = $1",
        call_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}
