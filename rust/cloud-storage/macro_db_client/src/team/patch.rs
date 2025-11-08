/// Updates a team.
#[tracing::instrument(skip(db))]
pub async fn patch_team(
    db: &sqlx::Pool<sqlx::Postgres>,
    team_id: &uuid::Uuid,
    req: &models_team::PatchTeamRequest,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;

    if let Some(name) = req.name.as_ref() {
        sqlx::query!(
            r#"
            UPDATE team
            SET name = $1
            WHERE id = $2
        "#,
            name,
            &team_id,
        )
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;

    Ok(())
}

pub async fn update_team_invite_last_sent_at(
    db: &sqlx::Pool<sqlx::Postgres>,
    team_invite_id: &uuid::Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE team_invite
        SET last_sent_at = NOW()
        WHERE id = $1
    "#,
        team_invite_id,
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("team")))]
    async fn test_patch_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;
        let req = models_team::PatchTeamRequest {
            name: Some("new name".to_string()),
        };

        patch_team(&pool, &team_id, &req).await?;

        let name = sqlx::query!(
            r#"
            SELECT
            name
            FROM team
            WHERE id = $1
        "#,
            &team_id,
        )
        .map(|row| row.name)
        .fetch_one(&pool)
        .await?;

        assert_eq!(name, "new name");

        Ok(())
    }
}
