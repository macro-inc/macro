/// Creates a new team
pub async fn create_team(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    name: &str,
) -> anyhow::Result<models_team::Team> {
    let mut transaction = db.begin().await?;

    let id = macro_uuid::generate_uuid_v7();

    let team = sqlx::query_as!(
        models_team::Team,
        r#"
            INSERT INTO team (id, name, owner_id)
            VALUES ($1, $2, $3)
            RETURNING id, name, owner_id
        "#,
        &id,
        name,
        user_id,
    )
    .fetch_one(&mut *transaction)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO team_user (team_id, user_id, team_role)
        VALUES ($1, $2, 'owner')
    "#,
        &team.id,
        user_id,
    )
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(team)
}

pub async fn join_team(
    db: &sqlx::Pool<sqlx::Postgres>,
    team_invite_id: &uuid::Uuid,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;

    // lookup if invite exists
    let (team_id, email, team_role) = sqlx::query!(
        r#"
            SELECT team_id, email, team_role as "team_role!: models_team::TeamRole"
            FROM team_invite 
            WHERE id = $1
        "#,
        &team_invite_id,
    )
    .map(|r| (r.team_id, r.email, r.team_role))
    .fetch_one(&mut *transaction)
    .await?;

    let macro_user_profile_id = format!("macro|{email}");

    // Create team user
    sqlx::query!(
        r#"
            INSERT INTO team_user (team_id, user_id, team_role)
            VALUES ($1, $2, $3)
        "#,
        &team_id,
        &macro_user_profile_id,
        &team_role as _,
    )
    .execute(&mut *transaction)
    .await?;

    // Delete invite
    sqlx::query!(
        r#"
            DELETE FROM team_invite
            WHERE id = $1
        "#,
        &team_invite_id,
    )
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(())
}

/// Creates a new team invite
#[tracing::instrument(skip(db))]
pub async fn create_team_invite(
    db: &sqlx::Pool<sqlx::Postgres>,
    team_id: &str,
    email: &str,
    team_role: &models_team::TeamRole,
    user_id: &str,
) -> anyhow::Result<models_team::TeamInvite> {
    let id = macro_uuid::generate_uuid_v7();

    let team_id = macro_uuid::string_to_uuid(team_id)?;

    let team_invite = sqlx::query_as!(
        models_team::TeamInvite,
        r#"
            INSERT INTO team_invite (id, team_id, email, team_role, invited_by, created_at, last_sent_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING id, email, team_id, team_role as "team_role!: models_team::TeamRole", invited_by, created_at as "created_at!: chrono::DateTime<chrono::Utc>", last_sent_at as "last_sent_at!: chrono::DateTime<chrono::Utc>"
        "#,
        &id,
        &team_id,
        email,
        team_role as _,
        user_id,
    )
    .fetch_one(db)
    .await?;

    Ok(team_invite)
}
