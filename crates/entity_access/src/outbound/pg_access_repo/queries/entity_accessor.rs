//! Bounded membership checks for one principal against an entity's accessors.
//!
//! Each query answers "is this principal in the set the matching
//! `get_*_users` query lists" without listing the set. They start from the
//! entity (or channel) key, so the rows read are that entity's grants and the
//! granting channels' or teams' members, never the principal's other grants.
//!
//! The principal is a canonical, lowercased `macro|<email>`. Listing parses
//! each stored id with `MacroUserIdStr`, which lowercases it, so a stored
//! `macro|` id matches when its lowercase equals the principal; the exact
//! comparison comes first because stored ids are normally already lowercase.
//! The case-folded comparison runs as a filter after the entity or channel
//! index narrows the rows, which is why no expression index is needed.
//! Nothing here goes through a process cache: callers see changes at once.

use model_entity::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Whether `principal_id` holds a direct `user` grant, is an active
/// participant of a granting channel, or is a member of a granting team.
#[tracing::instrument(err, skip(pool))]
pub async fn is_entity_user(
    pool: &PgPool,
    entity_id: &Uuid,
    entity_type: EntityType,
    principal_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT (
            EXISTS (
                SELECT 1 FROM entity_access ea
                WHERE ea.entity_id = $1 AND ea.entity_type = $2 AND ea.source_type = 'user'
                  AND (ea.source_id = $3
                       OR (ea.source_id LIKE 'macro|%' AND lower(ea.source_id) = $3))
            )
            OR EXISTS (
                SELECT 1 FROM entity_access ea
                JOIN comms_channel_participants cp ON cp.channel_id = ea.source_id::uuid
                WHERE ea.entity_id = $1 AND ea.entity_type = $2 AND ea.source_type = 'channel'
                  AND cp.left_at IS NULL
                  AND (cp.user_id = $3
                       OR (cp.user_id LIKE 'macro|%' AND lower(cp.user_id) = $3))
            )
            OR EXISTS (
                SELECT 1 FROM entity_access ea
                JOIN team_user tu ON tu.team_id = ea.source_id::uuid
                WHERE ea.entity_id = $1 AND ea.entity_type = $2 AND ea.source_type = 'team'
                  AND (tu.user_id = $3
                       OR (tu.user_id LIKE 'macro|%' AND lower(tu.user_id) = $3))
            )
        ) AS "is_user!"
        "#,
        entity_id,
        entity_type.as_ref(),
        principal_id,
    )
    .fetch_one(pool)
    .await
}

/// Whether `principal_id` holds a direct `user` grant that was not inherited
/// from a project.
#[tracing::instrument(err, skip(pool))]
pub async fn is_direct_entity_user(
    pool: &PgPool,
    entity_id: &Uuid,
    entity_type: EntityType,
    principal_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM entity_access ea
            WHERE ea.entity_id = $1 AND ea.entity_type = $2 AND ea.source_type = 'user'
              AND ea.granted_from_project_id IS NULL
              AND (ea.source_id = $3
                   OR (ea.source_id LIKE 'macro|%' AND lower(ea.source_id) = $3))
        ) AS "is_user!"
        "#,
        entity_id,
        entity_type.as_ref(),
        principal_id,
    )
    .fetch_one(pool)
    .await
}

/// Whether `principal_id` is an active participant of a channel.
#[tracing::instrument(err, skip(pool))]
pub async fn is_channel_user(
    pool: &PgPool,
    channel_id: &Uuid,
    principal_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM comms_channel_participants cp
            WHERE cp.channel_id = $1 AND cp.left_at IS NULL
              AND (cp.user_id = $2
                   OR (cp.user_id LIKE 'macro|%' AND lower(cp.user_id) = $2))
        ) AS "is_user!"
        "#,
        channel_id,
        principal_id,
    )
    .fetch_one(pool)
    .await
}
