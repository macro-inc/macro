use utoipa::ToSchema;

/// The last place a user viewed a particular document at
#[derive(sqlx::FromRow, Debug, ToSchema)]
pub struct UserDocumentViewLocation {
    pub user_id: String,
    pub document_id: String,
    pub location: String,
}
