use anyhow::Context;
use model_entity::EntityType;
use sqlx::{Pool, Postgres, Transaction};

#[tracing::instrument(skip(db))]
pub async fn delete_projects_bulk(
    db: &Pool<Postgres>,
    project_ids: &[String],
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await.context("unable to begin transaction")?;

    delete_projects_bulk_tsx(&mut transaction, project_ids).await?;

    transaction
        .commit()
        .await
        .context("unable to commit transaction")?;

    Ok(())
}

#[tracing::instrument(skip(transaction))]
pub async fn delete_projects_bulk_tsx(
    transaction: &mut Transaction<'_, Postgres>,
    project_ids: &[String],
) -> anyhow::Result<()> {
    if project_ids.is_empty() {
        return Ok(());
    }
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = ANY($1) AND "pinnedItemType" = $2
        "#,
        project_ids,
        "project",
    )
    .execute(transaction.as_mut())
    .await?;

    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" WHERE "itemId" = ANY($1) AND "itemType" = $2
        "#,
        project_ids,
        "project",
    )
    .execute(transaction.as_mut())
    .await?;

    sqlx::query!(
        r#"
            DELETE FROM "SharePermission"
            WHERE id IN (
                SELECT "sharePermissionId"
                FROM "ProjectPermission"
                WHERE "projectId" = ANY($1)
            )
        "#,
        project_ids
    )
    .execute(transaction.as_mut())
    .await
    .context("unable to delete share permissions")?;

    let project_uuids = project_ids
        .iter()
        .map(|p| macro_uuid::string_to_uuid(p).unwrap())
        .collect::<Vec<uuid::Uuid>>();
    crate::item_access::delete::delete_user_entity_access_bulk(
        transaction,
        &project_uuids,
        EntityType::Project,
    )
    .await?;

    for project_uuid in project_uuids {
        entity_registry_db_utils::delete_entity(transaction, project_uuid).await?;
    }

    sqlx::query!(
        r#"
        DELETE FROM "Project"
        WHERE id = ANY($1)"#,
        project_ids
    )
    .execute(transaction.as_mut())
    .await
    .context("unable to delete projects")?;

    Ok(())
}
