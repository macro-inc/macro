use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct PatchOrganizationSettingsRequest {
    /// Removes the retention policy you currently have set
    pub remove_retention_days: Option<bool>,
    /// Removes the default share permission you currently have set
    pub remove_default_share_permission: Option<bool>,
    /// The new retention policy you want to set
    ///
    ///  Note: This will get ignored if you have pass in **any value** for remove_retention_days
    pub retention_days: Option<i32>,
}
