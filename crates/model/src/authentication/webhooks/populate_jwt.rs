#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PopulateJwtWebhook {
    /// The email to get user information with
    pub email: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PopulateJwtWebhookResponse {
    /// The user id
    pub user_id: String,
    /// The organization id
    pub organization_id: Option<i32>,
    /// The root macro_user id (FusionAuth user id). This may not be the same as the FusionAuth user id
    /// that logs in. This is due to supporting multi-account linking.
    /// The UUID that is returned here is should be the source of truth for the user.
    pub root_macro_id: Option<uuid::Uuid>,
}
