use serde::{Deserialize, Serialize};
#[derive(Debug, Serialize, Deserialize)]
pub struct DeletedUserInfo {
    pub email: String,
    pub id: String,
    pub organization_id: Option<i32>,
}
/// Deletes a user from the database
#[tracing::instrument(skip(db))]
pub async fn delete_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> Result<DeletedUserInfo, sqlx::Error> {
    let info = sqlx::query!(
        r#"DELETE FROM "User" WHERE id = $1 RETURNING id, email, "organizationId" as organization_id"#,
        user_id
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
