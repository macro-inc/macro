//! Queries for channel role resolution.

#[cfg(test)]
mod test;

use crate::domain::models::{ChannelRoleResult, ParticipantRole};
use bot_id::BotIdStr;
use sqlx::PgPool;
use uuid::Uuid;

/// Row returned from the channel role query.
struct ChannelRoleRow {
    role: Option<String>,
    channel_type: String,
    org_id: Option<i64>,
    is_team_member: bool,
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
/// - `ViewOnly`: user belongs to the team that owns the team channel
/// - `NoAccess`: channel exists but user has no access
/// - `NotFound`: channel does not exist
///
/// Channel type rules:
/// - Public channels: non-participants default to Member
/// - Organization channels: default to Member only if user's org matches
/// - Team channels: matching team members receive ViewOnly
/// - Private/DM: require explicit participation
#[tracing::instrument(err, skip(pool))]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn get_channel_role(
    pool: &PgPool,
    channel_id: &Uuid,
    user_id: &str,
    user_org_id: Option<i64>,
) -> Result<ChannelRoleResult, sqlx::Error> {
    let row = sqlx::query_as!(
        ChannelRoleRow,
        r#"
        SELECT
            cp.role::text as "role?",
            c.channel_type::text as "channel_type!",
            c.org_id as "org_id?",
            EXISTS (
                SELECT 1
                FROM team_user tu
                WHERE tu.user_id = $2 AND tu.team_id = c.team_id
            ) as "is_team_member!"
        FROM comms_channels c
        LEFT JOIN comms_channel_participants cp
            ON cp.channel_id = c.id AND cp.user_id = $2 AND cp.left_at IS NULL
        WHERE c.id = $1
        "#,
        channel_id,
        user_id,
    )
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

    if let Some(role) = role {
        return Ok(ChannelRoleResult::Role(role));
    }

    if row.channel_type == "team" && row.is_team_member {
        return Ok(ChannelRoleResult::ViewOnly);
    }

    Ok(ChannelRoleResult::NoAccess)
}

/// Get a bot's explicit role in a channel.
///
/// Unlike [`get_channel_role`], public and organization channels do not grant a
/// default role. The bot must exist, not be soft-deleted, and have an active
/// participant row.
#[tracing::instrument(err, skip(pool))]
pub async fn get_bot_channel_role(
    pool: &PgPool,
    channel_id: &Uuid,
    bot_principal: &BotIdStr<'_>,
) -> Result<ChannelRoleResult, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT cp.role::text as "role?"
        FROM comms_channels c
        LEFT JOIN comms_channel_participants cp
            ON cp.channel_id = c.id
            AND cp.user_id = $2
            AND cp.left_at IS NULL
            AND EXISTS (
                SELECT 1
                FROM bots b
                WHERE b.id = $3 AND b.deleted_at IS NULL
            )
        WHERE c.id = $1
        "#,
        channel_id,
        bot_principal.as_ref(),
        bot_principal.as_uuid(),
    )
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(ChannelRoleResult::NotFound);
    };

    Ok(match row.role.as_deref() {
        Some(role) => ChannelRoleResult::Role(parse_role(role)),
        None => ChannelRoleResult::NoAccess,
    })
}
