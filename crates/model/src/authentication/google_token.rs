#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct GoogleAccessToken {
    /// The user's email address
    // pub email: String,
    /// The user's access token
    pub access_token: String,
}
