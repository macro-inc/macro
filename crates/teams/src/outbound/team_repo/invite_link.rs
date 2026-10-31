//! Queries for a team's shareable invite link.

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
) -> Result<(), TeamError> {
    sqlx::query!(
        r#"
        INSERT INTO team_invite_link (team_id, token)
        VALUES ($1, $2)
        ON CONFLICT (team_id) DO UPDATE
        SET token = EXCLUDED.token,
            created_at = now()
        "#,
        team_id,
        token.as_uuid(),
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
