//! Which kind of caller a search came from, as far as its credential says.

use crate::domain::search_lanes::{SearchActor, SearchCaller};
use macro_authorization::{CredentialOrigin, MacroUserAuthentication};

/// The credential a search arrived with, as a span value. A session is one of
/// the apps, an API JWT the SDK or MCP, and an internal caller another service
/// searching for the user, such as the AI tools.
pub(in crate::api::search) fn caller_label(user: &MacroUserAuthentication) -> &'static str {
    match user.origin {
        CredentialOrigin::Session => "session",
        CredentialOrigin::MacroApiJwt => "macro_api_jwt",
        CredentialOrigin::ScopedMacroApiJwt => "scoped_macro_api_jwt",
        CredentialOrigin::UserApiKey => "user_api_key",
        CredentialOrigin::AccountManager(_) => "account_manager",
        CredentialOrigin::Bot => "bot",
        CredentialOrigin::Harness => "harness",
        CredentialOrigin::Internal => "internal",
    }
}

/// Whose lane a search waits in: the user's own, or the agent's or routine's
/// that the credential is signed for, so a person never waits behind a
/// program acting for them.
pub(in crate::api::search) fn search_caller(user: &MacroUserAuthentication) -> SearchCaller {
    let actor = match (user.agent_id, user.routine_id) {
        (Some(agent), _) => SearchActor::Agent(agent.as_uuid()),
        (None, Some(routine)) => SearchActor::Routine(routine),
        (None, None) => SearchActor::Person,
    };
    SearchCaller::new(&user.user_context.user_id, actor)
}
