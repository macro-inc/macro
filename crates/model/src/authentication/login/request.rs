use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct PasswordlessRequest {
    /// The email to initiate passwordless authentication for
    pub email: String,
    /// The redirect uri to redirect to after login
    pub redirect_uri: String,
    /// The referral code
    pub referral_code: Option<String>,
    /// Create an agent account if this address has no account yet. Otherwise
    /// `true` has no effect, and `false` reverts an agent flag nobody has proven:
    /// see `revert_unconfirmed_agent`.
    #[serde(default)]
    pub is_agent: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct PasswordRequest {
    /// The email to login with
    pub email: String,
    // The password to login with
    pub password: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct AppleLoginRequest {
    pub id_token: String,
    pub code: String,
}
