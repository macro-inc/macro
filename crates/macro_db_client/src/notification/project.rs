use sqlx::{Pool, Postgres};

/// Gets all users that need to be notified for a project
/// This does not include the owner of the project
#[tracing::instrument(skip(db))]
pub async fn get_project_notification_users(
    db: &Pool<Postgres>,
    project_id: &str,
) -> anyhow::Result<Vec<String>> {
    let users = sqlx::query!(
        r#"
        SELECT
            u."id" as id
            FROM "Project" p
            INNER JOIN "UserHistory" uh ON uh."itemId" = p."id" AND uh."itemType" = 'project'
            INNER JOIN "User" u ON u.id = uh."userId"
            WHERE p.id = $1
        "#,
        project_id
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(users)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("project-notifications")))]
    async fn test_get_project_notification_users(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut users = get_project_notification_users(&pool, "p1").await?;
        users.sort();

        assert_eq!(users, vec!["macro|user2@user.com", "macro|user@user.com"]);
        Ok(())
    }
}
