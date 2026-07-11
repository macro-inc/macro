use serde::{Deserialize, Serialize};
#[derive(Debug, Serialize, Deserialize)]
pub struct DeletedUserInfo {
    pub email: String,
    pub id: String,
    pub organization_id: Option<i32>,
}
/// Deletes a user from the database
#[tracing::instrument(skip(db), err)]
pub async fn delete_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    macro_user_id: &uuid::Uuid,
) -> Result<DeletedUserInfo, sqlx::Error> {
    let info = sqlx::query!(
        r#"DELETE FROM "User" WHERE id = $1 AND macro_user_id = $2 RETURNING id, email, "organizationId" as organization_id"#,
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
