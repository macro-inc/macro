/// A user's GitHub access token from their Macro account link.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct GithubAccessToken {
    /// The linked account's access token
    pub access_token: String,
}

impl std::fmt::Debug for GithubAccessToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GithubAccessToken")
            .field("access_token", &"[redacted]")
            .finish()
    }
}
