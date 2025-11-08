use std::collections::HashSet;

/// Gets the user's permissions
#[tracing::instrument(skip(db))]
pub async fn get_user_permissions(
    db: sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> Result<HashSet<String>, sqlx::Error> {
    let permissions = sqlx::query!(
        r#"
        SELECT
        rop."permissionId" as permission_id
        FROM "User" u
        JOIN "RolesOnUsers" ru ON ru."userId" = u.id
        JOIN "RolesOnPermissions" rop ON rop."roleId" = ru."roleId"
        WHERE u.id = $1
    "#,
        user_id
    )
    .map(|r| r.permission_id)
    .fetch_all(&db)
    .await?;

    Ok(HashSet::from_iter(permissions))
}
