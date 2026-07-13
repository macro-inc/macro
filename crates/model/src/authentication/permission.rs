use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct Permission {
    /// The permission
    pub id: String,
    /// The description of the permission
    pub description: String,
}
