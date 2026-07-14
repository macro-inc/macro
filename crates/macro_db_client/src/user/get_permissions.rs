use std::collections::HashSet;

use sqlx::{Pool, Postgres};

use model::user::UserPermission;

/// Creates a hashset of the users permissions to be checked against later
#[tracing::instrument(fields(user_id=?user_id), err)]
pub async fn get_user_permissions(
    db: &Pool<Postgres>,
    user_id: &str,
) -> anyhow::Result<HashSet<String>> {
    let user_permissions: Vec<UserPermission> = sqlx::query_as!(
        UserPermission,
        r#"
        SELECT
          rp."roleId" AS role_id,
          rp."permissionId" AS permission_id
        FROM
          "User" u
        INNER JOIN
          "RolesOnUsers" ru ON u.id = ru."userId"
        INNER JOIN
          "RolesOnPermissions" rp ON ru."roleId" = rp."roleId"
        WHERE
          u.id = $1
        "#,
        user_id,
    )
    .fetch_all(db)
    .await?;

    let mut result: HashSet<String> = HashSet::new();

    for user_permission in user_permissions {
        result.insert(user_permission.permission_id);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_permissions")))]
    async fn test_get_user_permissions(pool: Pool<Postgres>) {
        let permissions = get_user_permissions(&pool, "macro|user@user.com")
            .await
            .unwrap();

        assert_eq!(permissions.len(), 2);
        assert!(permissions.contains(&String::from("permission-one")));
        assert!(permissions.contains(&String::from("permission-three")));

        let permissions = get_user_permissions(&pool, "macro|user2@user.com")
            .await
            .unwrap();

        assert_eq!(permissions.len(), 1);
        assert!(permissions.contains(&String::from("permission-two")));
    }
}
