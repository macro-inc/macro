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

/// Row returned from the team-scoped channel role query.
struct TeamChannelRoleRow {
    role: Option<String>,
    is_matching_team_channel: bool,
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

/// Get a bot's channel role while operating in its owning team's scope.
///
/// An active participant row grants its stored role in any channel. Without an
/// active participant row, only a team channel owned by the supplied team
/// grants view-only access. The bot must be active and owned by that team.
#[tracing::instrument(err, skip(pool))]
pub async fn get_team_channel_role(
    pool: &PgPool,
    channel_id: &Uuid,
    team_id: &Uuid,
    bot_principal: &BotIdStr<'_>,
) -> Result<ChannelRoleResult, sqlx::Error> {
    let row = sqlx::query_as!(
        TeamChannelRoleRow,
        r#"
        SELECT
            cp.role::text AS "role?",
            (
                b.id IS NOT NULL
                AND c.channel_type = 'team'
                AND c.team_id = $3
            ) AS "is_matching_team_channel!"
        FROM comms_channels c
        LEFT JOIN bots b
          ON b.id = $4
         AND b.team_id = $3
         AND b.deleted_at IS NULL
        LEFT JOIN comms_channel_participants cp
          ON cp.channel_id = c.id
         AND cp.user_id = $2
         AND cp.left_at IS NULL
         AND b.id IS NOT NULL
        WHERE c.id = $1
        "#,
        channel_id,
        bot_principal.as_ref(),
        team_id,
        bot_principal.as_uuid(),
    )
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(ChannelRoleResult::NotFound);
    };

    if let Some(role) = row.role.as_deref() {
        return Ok(ChannelRoleResult::Role(parse_role(role)));
    }

    if row.is_matching_team_channel {
        return Ok(ChannelRoleResult::ViewOnly);
    }

    Ok(ChannelRoleResult::NoAccess)
}
