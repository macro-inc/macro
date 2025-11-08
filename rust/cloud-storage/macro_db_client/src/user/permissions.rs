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

    // Make it a hashset to filter out duplicates
    Ok(HashSet::from_iter(permissions))
}

use model::authentication::permission::Permission;
use sqlx::PgPool;

/// Gets all permissions and their descriptions
#[tracing::instrument(skip(db))]
pub async fn get_all_permissions(db: &PgPool) -> anyhow::Result<Vec<Permission>> {
    let permissions: Vec<Permission> = sqlx::query_as!(
        Permission,
        r#"
        SELECT 
            id,
            description 
        FROM "Permission"
        "#
    )
    .fetch_all(db)
    .await?;

    Ok(permissions)
}
