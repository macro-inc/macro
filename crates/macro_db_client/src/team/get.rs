use models_team::Team;

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
