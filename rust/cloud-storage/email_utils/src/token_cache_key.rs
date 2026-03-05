/// A key for caching OAuth tokens in Redis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenCacheKey {
    /// The FusionAuth user ID.
    pub fusion_user_id: String,
    /// The Macro user ID.
    pub macro_id: String,
    /// The provider name (e.g. "GMAIL").
    pub provider: String,
}

impl TokenCacheKey {
    /// Create a new TokenCacheKey.
    pub fn new(
        fusion_user_id: impl Into<String>,
        macro_id: impl Into<String>,
        provider: impl Into<String>,
    ) -> Self {
        Self {
            fusion_user_id: fusion_user_id.into(),
            macro_id: macro_id.into(),
            provider: provider.into(),
        }
    }

    /// Convert the key to a Redis-compatible string.
    pub fn to_redis_key(&self) -> String {
        format!(
            "gmail_token:{}:{}:{}",
            self.provider, self.fusion_user_id, self.macro_id
        )
    }
}
