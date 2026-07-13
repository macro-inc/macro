/// A key for caching OAuth tokens in Redis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenCacheKey {
    /// The FusionAuth user ID.
    pub fusion_user_id: String,
    /// The linked email address — what FusionAuth stores as `display_name` on
    /// the IdP link. This is what discriminates one Gmail account from
    /// another when a single FA user has multiple Google IdP links (e.g. a
    /// macro user who linked a secondary inbox via `/link/gmail`).
    pub email_address: String,
    /// The provider name (e.g. "GMAIL").
    pub provider: String,
}

impl TokenCacheKey {
    /// Create a new TokenCacheKey.
    pub fn new(
        fusion_user_id: impl Into<String>,
        email_address: impl Into<String>,
        provider: impl Into<String>,
    ) -> Self {
        Self {
            fusion_user_id: fusion_user_id.into(),
            email_address: email_address.into(),
            provider: provider.into(),
        }
    }

    /// Convert the key to a Redis-compatible string.
    pub fn to_redis_key(&self) -> String {
        format!(
            "gmail_token:{}:{}:{}",
            self.provider, self.fusion_user_id, self.email_address
        )
    }
}
