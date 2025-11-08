use anyhow::Context;

use crate::projects::get_project::{
    get_project_chats::get_deleted_chats_from_project_ids,
    get_project_documents::get_deleted_documents_from_project_ids,
};

use super::get_project::get_sub_items::get_all_deleted_sub_project_ids;

/// Reverts a project deletion
/// Reverts all sub-items of the project as well
/// Adds all items back to the users history as well
#[tracing::instrument(skip(db))]
pub async fn revert_delete_project(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_id: &str,
    project_parent_id: Option<&str>,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await.context("unable to begin transaction")?;

    let project_ids = get_all_deleted_sub_project_ids(&mut transaction, project_id)
        .await
        .context("unable to get all deleted sub project ids")?;
    let (project_ids_vec, project_user_ids_vec): (Vec<String>, Vec<String>) =
        project_ids.into_iter().unzip();

    let chat_ids = get_deleted_chats_from_project_ids(db, &project_ids_vec)
        .await
        .context("unable to get deleted chats")?;
    let (chat_ids_vec, chat_user_ids_vec): (Vec<String>, Vec<String>) =
        chat_ids.into_iter().unzip();

    let document_ids = get_deleted_documents_from_project_ids(db, &project_ids_vec)
        .await
        .context("unable to get deleted documents")?;
    let (document_ids_vec, document_user_ids_vec): (Vec<String>, Vec<String>) =
        document_ids.into_iter().unzip();

    tracing::trace!("reverted deleted chats");
    sqlx::query!(
        r#"
        UPDATE "Chat" SET "deletedAt" = NULL WHERE id = ANY($1);
        "#,
        &chat_ids_vec,
    )
    .execute(&mut *transaction)
    .await
    .context("unable to revert deleted chats")?;

    tracing::trace!("set all chats user history");
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT u.user_id, u.item_id, 'chat', NOW(), NOW()
        FROM UNNEST($1::text[], $2::text[]) AS u(item_id, user_id)
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = NOW();
    "#,
        &chat_ids_vec,
        &chat_user_ids_vec,
    )
    .execute(&mut *transaction)
    .await
    .context("unable to set chats user history")?;

    tracing::trace!("reverted deleted documents");
    sqlx::query!(
        r#"
        UPDATE "Document" SET "deletedAt" = NULL WHERE id = ANY($1);
        "#,
        &document_ids_vec,
    )
    .execute(&mut *transaction)
    .await
    .context("unable to revert deleted documents")?;

    tracing::trace!("set all documents user history");
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT u.user_id, u.item_id, 'document', NOW(), NOW()
        FROM UNNEST($1::text[], $2::text[]) AS u(item_id, user_id)
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = NOW();
    "#,
        &document_ids_vec,
        &document_user_ids_vec,
    )
    .execute(&mut *transaction)
    .await
    .context("unable to set documents user history")?;

    tracing::trace!("reverted deleted sub-projects");
    sqlx::query!(
        r#"
        UPDATE "Project" SET "deletedAt" = NULL WHERE id = ANY($1);
        "#,
        &project_ids_vec
    )
    .execute(&mut *transaction)
    .await
    .context("unable to revert deleted sub-projects")?;

    tracing::trace!("set all projects user history");
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT u.user_id, u.item_id, 'project', NOW(), NOW()
        FROM UNNEST($1::text[], $2::text[]) AS u(item_id, user_id)
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = NOW();
    "#,
        &project_ids_vec,
        &project_user_ids_vec,
    )
    .execute(&mut *transaction)
    .await
    .context("unable to set projects user history")?;

    if let Some(parent_id) = project_parent_id {
        tracing::trace!("project was in nested");
        let is_deleted = sqlx::query!(
            r#"
            SELECT "deletedAt" as deleted_at FROM "Project" WHERE "id" = $1
            "#,
            parent_id
        )
        .map(|row| row.deleted_at)
        .fetch_one(&mut *transaction)
        .await?;

        if is_deleted.is_some() {
            tracing::trace!("parent is deleted, removing parent id from project");

            sqlx::query!(
                r#"
                UPDATE "Project" SET "parentId" = NULL WHERE "id" = $1
                "#,
                project_id
            )
            .execute(&mut *transaction)
            .await?;
        }
    }

    transaction
        .commit()
        .await
        .context("unable to commit transaction")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("revert_project_delete")))]
    async fn test_revert_delete_project(pool: Pool<Postgres>) -> anyhow::Result<()> {
        revert_delete_project(&pool, "p1", None).await?;

        let mut history: Vec<(String, String)> = sqlx::query!(
            r#"
            SELECT "itemId" as item_id, "userId" as user_id
            FROM "UserHistory"
        "#,
        )
        .map(|row| (row.item_id, row.user_id))
        .fetch_all(&pool)
        .await?;

        history.sort();

        assert_eq!(
            history,
            vec![
                ("c1".to_string(), "macro|user@user.com".to_string()),
                ("c2".to_string(), "macro|user2@user.com".to_string()),
                ("d1".to_string(), "macro|user@user.com".to_string()),
                ("d2".to_string(), "macro|user2@user.com".to_string()),
                ("p1".to_string(), "macro|user@user.com".to_string()),
                ("p2".to_string(), "macro|user@user.com".to_string()),
                ("p3".to_string(), "macro|user2@user.com".to_string()),
            ]
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("revert_project_delete")))]
    async fn test_revert_delete_project_nested_deleted_parent(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // insert new parent for p1 that is deleted
        sqlx::query!(
            r#"
            INSERT INTO "Project" ("id", "name", "userId", "deletedAt")
            VALUES ('p4', 'd', 'macro|user@user.com', '2019-10-16 00:00:00')
            "#
        )
        .execute(&pool)
        .await?;

        // update p1 to have parent p4
        sqlx::query!(
            r#"
            UPDATE "Project" SET "parentId" = 'p4' WHERE "id" = 'p1'
            "#
        )
        .execute(&pool)
        .await?;

        revert_delete_project(&pool, "p1", Some("p4")).await?;

        let mut history: Vec<(String, String)> = sqlx::query!(
            r#"
            SELECT "itemId" as item_id, "userId" as user_id
            FROM "UserHistory"
        "#,
        )
        .map(|row| (row.item_id, row.user_id))
        .fetch_all(&pool)
        .await?;

        history.sort();

        assert_eq!(
            history,
            vec![
                ("c1".to_string(), "macro|user@user.com".to_string()),
                ("c2".to_string(), "macro|user2@user.com".to_string()),
                ("d1".to_string(), "macro|user@user.com".to_string()),
                ("d2".to_string(), "macro|user2@user.com".to_string()),
                ("p1".to_string(), "macro|user@user.com".to_string()),
                ("p2".to_string(), "macro|user@user.com".to_string()),
                ("p3".to_string(), "macro|user2@user.com".to_string()),
            ]
        );

        let parent_id = sqlx::query!(
            r#"
            SELECT "parentId" as parent_id FROM "Project" WHERE "id" = 'p1'
            "#
        )
        .map(|row| row.parent_id)
        .fetch_one(&pool)
        .await?;

        assert!(parent_id.is_none());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("revert_project_delete")))]
    async fn test_revert_delete_project_nested_not_deleted_parent(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // insert new parent for p1 that is deleted
        sqlx::query!(
            r#"
            INSERT INTO "Project" ("id", "name", "userId")
            VALUES ('p4', 'd', 'macro|user@user.com')
            "#
        )
        .execute(&pool)
        .await?;

        // update p1 to have parent p4
        sqlx::query!(
            r#"
            UPDATE "Project" SET "parentId" = 'p4' WHERE "id" = 'p1'
            "#
        )
        .execute(&pool)
        .await?;

        revert_delete_project(&pool, "p1", Some("p4")).await?;

        let mut history: Vec<(String, String)> = sqlx::query!(
            r#"
            SELECT "itemId" as item_id, "userId" as user_id
            FROM "UserHistory"
        "#,
        )
        .map(|row| (row.item_id, row.user_id))
        .fetch_all(&pool)
        .await?;

        history.sort();

        assert_eq!(
            history,
            vec![
                ("c1".to_string(), "macro|user@user.com".to_string()),
                ("c2".to_string(), "macro|user2@user.com".to_string()),
                ("d1".to_string(), "macro|user@user.com".to_string()),
                ("d2".to_string(), "macro|user2@user.com".to_string()),
                ("p1".to_string(), "macro|user@user.com".to_string()),
                ("p2".to_string(), "macro|user@user.com".to_string()),
                ("p3".to_string(), "macro|user2@user.com".to_string()),
            ]
        );

        let parent_id = sqlx::query!(
            r#"
            SELECT "parentId" as parent_id FROM "Project" WHERE "id" = 'p1'
            "#
        )
        .map(|row| row.parent_id)
        .fetch_one(&pool)
        .await?;

        assert!(parent_id.is_some());

        Ok(())
    }
}
