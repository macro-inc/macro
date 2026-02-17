//! Queries for channel role resolution.

use crate::domain::models::{ChannelRoleResult, ParticipantRole};
use sqlx::PgPool;
use uuid::Uuid;

/// Row returned from the channel role query.
#[derive(sqlx::FromRow)]
struct ChannelRoleRow {
    role: Option<String>,
    channel_type: String,
    org_id: Option<i64>,
}

/// Parse a participant role string from the database.
fn parse_role(s: &str) -> ParticipantRole {
    match s {
        "owner" => ParticipantRole::Owner,
        "admin" => ParticipantRole::Admin,
        _ => ParticipantRole::Member,
    }
}

/// Get the user's role in a channel, considering channel type rules.
///
/// Returns a [`ChannelRoleResult`] that distinguishes between:
/// - `Role(role)`: user has access with this role
/// - `NoAccess`: channel exists but user has no access
/// - `NotFound`: channel does not exist
///
/// Channel type rules:
/// - Public channels: non-participants default to Member
/// - Organization channels: default to Member only if user's org matches
/// - Private/DM: require explicit participation
#[tracing::instrument(err, skip(pool))]
pub async fn get_channel_role(
    pool: &PgPool,
    channel_id: &Uuid,
    user_id: &str,
    user_org_id: Option<i64>,
) -> Result<ChannelRoleResult, sqlx::Error> {
    let row = sqlx::query_as::<_, ChannelRoleRow>(
        r#"
        SELECT
            cp.role::text as role,
            c.channel_type::text as channel_type,
            c.org_id
        FROM comms_channels c
        LEFT JOIN comms_channel_participants cp
            ON cp.channel_id = c.id AND cp.user_id = $2 AND cp.left_at IS NULL
        WHERE c.id = $1
        "#,
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(ChannelRoleResult::NotFound);
    };

    let role = match row.channel_type.as_str() {
        "public" => Some(
            row.role
                .as_deref()
                .map_or(ParticipantRole::Member, parse_role),
        ),
        "organization" => {
            let org_match = user_org_id
                .zip(row.org_id)
                .is_some_and(|(user_org, ch_org)| user_org == ch_org);

            if org_match {
                Some(
                    row.role
                        .as_deref()
                        .map_or(ParticipantRole::Member, parse_role),
                )
            } else {
                row.role.as_deref().map(parse_role)
            }
        }
        _ => row.role.as_deref().map(parse_role),
    };

    Ok(match role {
        Some(role) => ChannelRoleResult::Role(role),
        None => ChannelRoleResult::NoAccess,
    })
}
