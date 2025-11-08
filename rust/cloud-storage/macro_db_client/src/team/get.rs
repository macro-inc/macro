use models_team::{Team, TeamInvite, TeamRole, TeamUser, TeamWithUsers};

/// Gets the name of a team by ID
#[tracing::instrument(skip(db))]
pub async fn get_team_name(
    db: &sqlx::Pool<sqlx::Postgres>,
    team_id: &uuid::Uuid,
) -> anyhow::Result<String> {
    let team_name = sqlx::query!(
        r#"
            SELECT name
            FROM team
            WHERE id = $1
        "#,
        team_id,
    )
    .map(|row| row.name)
    .fetch_one(db)
    .await?;

    Ok(team_name)
}

pub async fn get_user_team_invites(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<TeamInvite>> {
    let email = user_id.replace("macro|", "");

    let invites = sqlx::query_as!(
        TeamInvite,
        r#"
            SELECT
                id,
                email,
                team_id,
                team_role as "team_role!: TeamRole",
                invited_by,
                created_at as "created_at!: chrono::DateTime<chrono::Utc>",
                last_sent_at as "last_sent_at!: chrono::DateTime<chrono::Utc>"
            FROM team_invite
            WHERE email = $1
        "#,
        &email,
    )
    .fetch_all(db)
    .await?;

    Ok(invites)
}

pub async fn get_user_teams(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<Team>> {
    let teams = sqlx::query_as!(
        Team,
        r#"
            SELECT
                t.id,
                t.name,
                t.owner_id
            FROM team t
            JOIN team_user tu ON t.id = tu.team_id
            WHERE tu.user_id = $1
        "#,
        &user_id,
    )
    .fetch_all(db)
    .await?;

    Ok(teams)
}

/// Gets a team and it's users by ID
#[tracing::instrument(skip(db))]
pub async fn get_team_by_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    team_id: &uuid::Uuid,
) -> anyhow::Result<TeamWithUsers> {
    let team = sqlx::query_as!(
        Team,
        r#"
            SELECT
                id,
                name,
                owner_id
            FROM team
            WHERE id = $1
        "#,
        &team_id,
    )
    .fetch_one(db)
    .await?;

    let users = sqlx::query_as!(
        TeamUser,
        r#"
            SELECT
                user_id,
                team_id,
                team_role as "team_role!: TeamRole"
            FROM team_user
            WHERE team_id = $1
        "#,
        &team_id,
    )
    .fetch_all(db)
    .await?;

    let team_with_users = TeamWithUsers { team, users };

    Ok(team_with_users)
}

/// Gets the team role of a user
#[tracing::instrument(skip(db))]
pub async fn get_team_role(
    db: &sqlx::Pool<sqlx::Postgres>,
    team_id: &uuid::Uuid,
    user_id: &str,
) -> anyhow::Result<Option<TeamRole>> {
    let team_role = sqlx::query!(
        r#"
            SELECT team_role as "team_role!: TeamRole"
            FROM team_user
            WHERE team_id = $1 AND user_id = $2
        "#,
        &team_id,
        user_id,
    )
    .map(|r| r.team_role)
    .fetch_optional(db)
    .await?;

    Ok(team_role)
}

/// Gets all invites for a team.
#[tracing::instrument(skip(db))]
pub async fn get_team_invites(
    db: &sqlx::Pool<sqlx::Postgres>,
    team_id: &uuid::Uuid,
) -> anyhow::Result<Vec<TeamInvite>> {
    let invites = sqlx::query_as!(
        TeamInvite,
        r#"
            SELECT
                id,
                email,
                team_id,
                team_role as "team_role!: TeamRole",
                invited_by,
                created_at as "created_at!: chrono::DateTime<chrono::Utc>",
                last_sent_at as "last_sent_at!: chrono::DateTime<chrono::Utc>"
            FROM team_invite
            WHERE team_id = $1
        "#,
        &team_id,
    )
    .fetch_all(db)
    .await?;

    Ok(invites)
}

#[tracing::instrument(skip(db))]
pub async fn get_team_invite_by_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    team_invite_id: &uuid::Uuid,
) -> anyhow::Result<TeamInvite> {
    let team_invite = sqlx::query_as!(
        TeamInvite,
        r#"
            SELECT
                id,
                email,
                team_id,
                team_role as "team_role!: TeamRole",
                invited_by,
                created_at as "created_at!: chrono::DateTime<chrono::Utc>",
                last_sent_at as "last_sent_at!: chrono::DateTime<chrono::Utc>"
            FROM team_invite
            WHERE id = $1
        "#,
        &team_invite_id,
    )
    .fetch_one(db)
    .await?;

    Ok(team_invite)
}
