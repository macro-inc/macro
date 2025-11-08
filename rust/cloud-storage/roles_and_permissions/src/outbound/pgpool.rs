//! Implementation for repositories using pgpool

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_user_id::{
    cowlike::CowLike,
    email::{Email, ReadEmailParts},
    lowercased::Lowercase,
    user_id::MacroUserId,
};
use sqlx::PgPool;

use crate::domain::{
    model::{Permission, RoleId, UserRolesAndPermissionsError},
    port::{UserRepository, UserRolesAndPermissionsRepository},
};

/// The MacroDB struct is a wrapper around sqlx::PgPool connected to macrodb.
#[derive(Debug, Clone)]
pub struct MacroDB {
    /// The underlying sqlx::PgPool connected to macrodb.
    pool: PgPool,
}

impl MacroDB {
    /// Create a new instance of MacroDB
    pub fn new(pool: PgPool) -> MacroDB {
        MacroDB { pool }
    }

    /// Get the user id from the email
    async fn get_user_id_from_email<'a>(
        &self,
        email: &Email<Lowercase<'a>>,
    ) -> Result<MacroUserId<Lowercase<'a>>, anyhow::Error> {
        let email: &str = email.email_str();
        let user_id = sqlx::query!(
            r#"
                SELECT id FROM "User" WHERE email = $1
            "#,
            email
        )
        .map(|row| row.id)
        .fetch_one(&self.pool)
        .await?;

        Ok(MacroUserId::parse_from_str(user_id.as_str()).map(|id| id.into_owned().lowercase())?)
    }

    /// Add roles to the user
    async fn add_roles_to_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        roles: &[impl ToString],
    ) -> Result<(), UserRolesAndPermissionsError> {
        let roles = roles.iter().map(|r| r.to_string()).collect::<Vec<_>>();

        sqlx::query!(
            r#"
                INSERT INTO "RolesOnUsers" ("userId", "roleId")
                SELECT $1, unnest($2::text[])
                ON CONFLICT DO NOTHING
            "#,
            user_id.as_ref(),
            &roles
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Remove roles from the user
    async fn remove_roles_from_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        roles: &[impl ToString],
    ) -> Result<(), UserRolesAndPermissionsError> {
        let roles = roles.iter().map(|r| r.to_string()).collect::<Vec<_>>();
        sqlx::query!(
            r#"
                DELETE FROM "RolesOnUsers"
                WHERE "userId" = $1 AND "roleId" IN (SELECT unnest($2::text[]))
            "#,
            user_id.as_ref(),
            &roles
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get the current permissions for a user
    async fn get_user_permissions(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<HashSet<Permission>, UserRolesAndPermissionsError> {
        let user_permissions: Vec<Permission> = sqlx::query!(
            r#"
        SELECT
          rp."permissionId" AS id,
          p."description" AS description
        FROM
          "User" u
        INNER JOIN
          "RolesOnUsers" ru ON u.id = ru."userId"
        INNER JOIN
          "RolesOnPermissions" rp ON ru."roleId" = rp."roleId"
        INNER JOIN
          "Permission" p ON rp."permissionId" = p.id
        WHERE
          u.id = $1
        "#,
            user_id.as_ref(),
        )
        .map(|r| Permission::new(r.id.parse().unwrap(), r.description))
        .fetch_all(&self.pool)
        .await?;

        let user_permissions = user_permissions.into_iter().collect::<HashSet<_>>();

        Ok(user_permissions)
    }
}

impl From<sqlx::Error> for UserRolesAndPermissionsError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => Self::UserDoesNotExist,
            _ => Self::StorageLayerError(e.into()),
        }
    }
}

impl UserRolesAndPermissionsRepository for MacroDB {
    async fn get_user_permissions(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<HashSet<Permission>, UserRolesAndPermissionsError> {
        self.get_user_permissions(user_id).await
    }

    async fn add_roles_to_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        role_ids: &[RoleId],
    ) -> Result<(), UserRolesAndPermissionsError> {
        self.add_roles_to_user(user_id, role_ids).await
    }

    async fn remove_roles_from_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        role_ids: &[RoleId],
    ) -> Result<(), UserRolesAndPermissionsError> {
        self.remove_roles_from_user(user_id, role_ids).await
    }
}

impl UserRepository for MacroDB {
    /// Get the user id by email
    async fn get_user_id_by_email(
        &self,
        email: &Email<Lowercase<'_>>,
    ) -> Result<MacroUserId<Lowercase<'_>>, UserRolesAndPermissionsError> {
        self.get_user_id_from_email(email)
            .await
            .map(|id| id.into_owned())
            .map_err(UserRolesAndPermissionsError::from)
    }
}
