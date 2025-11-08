use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct SsoRequiredResponse {
    /// The idp_id you need to perform sso login with.
    pub idp_id: String,
}
