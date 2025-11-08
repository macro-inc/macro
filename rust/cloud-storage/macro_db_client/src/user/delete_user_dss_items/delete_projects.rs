/// Deletes all projects for a user
/// Does not commit the transaction
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_projects(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<String>> {
    let user_projects = sqlx::query!(
        r#"
        SELECT id FROM "Project" WHERE "userId" = $1
    "#,
        user_id
    )
    .map(|row| row.id)
    .fetch_all(transaction.as_mut())
    .await?;

    // Delete pins
    sqlx::query!(
        r#"
        DELETE FROM "Pin" 
        WHERE "pinnedItemId" = ANY($1) AND "pinnedItemType" = $2
        "#,
        &user_projects,
        "project"
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete user history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" 
        WHERE "itemId" = ANY($1) AND "itemType" = $2
        "#,
        &user_projects,
        "project"
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete permissions
    sqlx::query!(
        r#"
        DELETE FROM "SharePermission" sp
        USING "ProjectPermission" pp 
        WHERE pp."sharePermissionId" = sp.id
        AND pp."projectId" = ANY($1)
    "#,
        &user_projects
    )
    .execute(transaction.as_mut())
    .await?;

    crate::item_access::delete::delete_user_item_access_bulk(
        transaction,
        &user_projects,
        "project",
    )
    .await?;

    // Delete chats
    sqlx::query!(
        r#"
        DELETE FROM "Project" 
        WHERE id = ANY($1)
        "#,
        &user_projects
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(user_projects)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(
        path = "../../../fixtures",
        scripts("basic_user_with_lots_of_documents")
    ))]
    async fn test_delete_user_projects(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        delete_user_projects(&mut transaction, "macro|user@user.com").await?;
        transaction.commit().await?;

        let project_ids = sqlx::query!(
            r#"
            SELECT
                p.id
            FROM
                "Project" p
            WHERE
                p."userId" = $1
            "#,
            "macro|user@user.com"
        )
        .fetch_all(&pool)
        .await?;

        assert_eq!(project_ids.len(), 0);

        Ok(())
    }
}
