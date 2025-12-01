use crate::email::service::link::UserProvider;

/// A key for caching OAuth tokens in Redis
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenCacheKey {
    pub fusion_user_id: String,
    pub macro_id: String,
    pub provider: UserProvider,
}

impl TokenCacheKey {
    /// Create a new TokenCacheKey
    pub fn new(
        fusion_user_id: impl Into<String>,
        macro_id: impl Into<String>,
        provider: UserProvider,
    ) -> Self {
        Self {
            fusion_user_id: fusion_user_id.into(),
            macro_id: macro_id.into(),
            provider,
        }
    }

    /// Convert the key to a Redis-compatible string
    pub fn to_redis_key(&self) -> String {
        format!(
            "gmail_token:{}:{}:{}",
            self.provider.as_str(),
            self.fusion_user_id,
            self.macro_id
        )
    }
}
