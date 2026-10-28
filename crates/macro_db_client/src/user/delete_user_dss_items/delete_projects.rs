use model_entity::EntityType;

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

    let project_uuids = user_projects
        .iter()
        .filter_map(|id| macro_uuid::string_to_uuid(id).ok())
        .collect::<Vec<_>>();
    crate::item_access::delete::delete_user_entity_access_bulk(
        transaction,
        &project_uuids,
        EntityType::Project,
    )
    .await?;

    // Delete projects
    sqlx::query!(
        r#"
        DELETE FROM "Project" 
        WHERE id = ANY($1)
        "#,
        &user_projects
    )
    .execute(transaction.as_mut())
    .await?;

    for project_uuid in project_uuids {
        entity_registry_db_utils::delete_entity(transaction, project_uuid).await?;
    }

    Ok(user_projects)
}
