use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct SsoRequiredResponse {
    /// The idp_id you need to perform sso login with.
    pub idp_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Default, ToSchema)]
pub struct PasswordlessStartedResponse {
    /// The one-time login code, returned only by local environments so dev
    /// tooling can complete the flow without reading the email.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}
