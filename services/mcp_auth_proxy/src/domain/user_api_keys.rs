//! Adapt the existing revocable user-key authorizer for MCP composition.
use macro_authorization::domain::ports::UserApiKeyAuthorizer;
use macro_user_id::user_id::MacroUserIdStr;
use std::{future::Future, pin::Pin};

/// Authenticated key owner; request arguments never select another account.
pub trait McpUserApiKeys: Send + Sync {
    /// Verify the key with the same authorizer used by API-key routes.
    fn user<'a>(
        &'a self,
        key: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<MacroUserIdStr<'static>>> + Send + 'a>>;
}
impl<A: UserApiKeyAuthorizer> McpUserApiKeys for A {
    fn user<'a>(
        &'a self,
        key: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<MacroUserIdStr<'static>>> + Send + 'a>> {
        Box::pin(async move {
            let authorized = self.authorize_user_api_key(key).await.ok()?;
            // MCP execution tokens cannot carry delegated grant restrictions.
            // Accept only the user's own credential, never widen a managed key.
            if authorized.account_manager.is_some() {
                return None;
            }
            MacroUserIdStr::try_from(authorized.user_context.user_id).ok()
        })
    }
}
