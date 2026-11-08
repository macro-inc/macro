//! Queries for a team's shareable invite link.

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;

use crate::domain::model::{TeamError, TeamInviteLinkTeam, TeamInviteLinkToken};

pub(super) async fn get_team_invite_link(
    pool: &PgPool,
    team_id: &uuid::Uuid,
) -> Result<Option<TeamInviteLinkToken>, TeamError> {
    let token = sqlx::query_scalar!(
        r#"
        SELECT token
        FROM team_invite_link
        WHERE team_id = $1
        "#,
        team_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(token.map(TeamInviteLinkToken::from_uuid))
}

pub(super) async fn set_team_invite_link(
    pool: &PgPool,
    team_id: &uuid::Uuid,
    token: &TeamInviteLinkToken,
    created_by: &MacroUserIdStr<'_>,
) -> Result<(), TeamError> {
    sqlx::query!(
        r#"
        INSERT INTO team_invite_link (team_id, token, created_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (team_id) DO UPDATE
        SET token = EXCLUDED.token,
            created_by = EXCLUDED.created_by,
            created_at = now()
        "#,
        team_id,
        token.as_uuid(),
        created_by.as_ref(),
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub(super) async fn delete_team_invite_link(
    pool: &PgPool,
    team_id: &uuid::Uuid,
) -> Result<(), TeamError> {
    sqlx::query!(
        r#"
        DELETE FROM team_invite_link
        WHERE team_id = $1
        "#,
        team_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub(super) async fn get_team_by_invite_link(
    pool: &PgPool,
    token: &TeamInviteLinkToken,
) -> Result<Option<TeamInviteLinkTeam>, TeamError> {
    Ok(sqlx::query_as!(
        TeamInviteLinkTeam,
        r#"
        SELECT t.id AS team_id, t.name AS team_name
        FROM team_invite_link l
        JOIN team t ON t.id = l.team_id
        WHERE l.token = $1
        "#,
        token.as_uuid(),
    )
    .fetch_optional(pool)
    .await?)
}

pub(super) async fn get_team_invite_link_creator(
    pool: &PgPool,
    token: &TeamInviteLinkToken,
) -> Result<Option<MacroUserIdStr<'static>>, TeamError> {
    let created_by = sqlx::query_scalar!(
        r#"
        SELECT created_by
        FROM team_invite_link
        WHERE token = $1
        "#,
        token.as_uuid(),
    )
    .fetch_optional(pool)
    .await?
    .flatten();
    // A creator id that no longer parses is skipped, not an error: it only
    // decides who gets a reward.
    Ok(created_by.and_then(|id| {
        MacroUserIdStr::parse_from_str(&id)
            .ok()
            .map(|id| id.into_owned())
    }))
}
