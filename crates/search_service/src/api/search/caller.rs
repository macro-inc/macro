//! Which kind of caller a search came from, as far as its credential says.

use macro_authorization::{CredentialOrigin, MacroUserAuthentication};

/// The credential a search arrived with, as a span value. A session is one of
/// the apps, an API JWT the SDK or MCP, and an internal caller another service
/// searching for the user, such as the AI tools.
pub(in crate::api::search) fn caller_label(user: &MacroUserAuthentication) -> &'static str {
    match user.origin {
        CredentialOrigin::Session => "session",
        CredentialOrigin::MacroApiJwt => "macro_api_jwt",
        CredentialOrigin::UserApiKey => "user_api_key",
        CredentialOrigin::AccountManager(_) => "account_manager",
        CredentialOrigin::Bot => "bot",
        CredentialOrigin::Harness => "harness",
        CredentialOrigin::Internal => "internal",
    }
}
