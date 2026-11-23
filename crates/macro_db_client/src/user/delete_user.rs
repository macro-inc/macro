use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

#[derive(Debug, Serialize, Deserialize)]
pub struct DeletedUserInfo {
    pub email: String,
    pub id: String,
    pub organization_id: Option<i32>,
}

/// Deletes one of an account's profiles.
///
/// `user_id` is the canonical lowercase profile id. Some older profiles were
/// stored with capitals (`macro|Name@Example.com`), so the account's profiles
/// are matched case-insensitively. An account has only a few profiles, so
/// `User_macro_user_id_idx` bounds the rows compared.
#[tracing::instrument(skip(db), err)]
pub async fn delete_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    macro_user_id: &uuid::Uuid,
) -> Result<DeletedUserInfo, sqlx::Error> {
    let info = sqlx::query!(
        r#"DELETE FROM "User" WHERE macro_user_id = $2 AND lower(id) = lower($1) RETURNING id, email, "organizationId" as organization_id"#,
        user_id,
        macro_user_id,
    )
    .map(|r| DeletedUserInfo {
        email: r.email,
        id: r.id,
        organization_id: r.organization_id,
    })
    .fetch_one(db)
    .await?;

    Ok(info)
}
