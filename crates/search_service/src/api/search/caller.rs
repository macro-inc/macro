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

/// Whose lane a search waits in. A signed agent or routine is its own
/// caller; otherwise the credential's kind decides, so the person's app
/// searches never wait behind a service's or an API client's searches for
/// them, which carry no agent even when an agent's tool sent them.
pub(in crate::api::search) fn search_caller(user: &MacroUserAuthentication) -> SearchCaller {
    let actor = match (user.agent_id, user.routine_id, &user.origin) {
        (Some(agent), _, _) => SearchActor::Agent(agent.as_uuid()),
        (None, Some(routine), _) => SearchActor::Routine(routine),
        (None, None, CredentialOrigin::Session) => SearchActor::App,
        (None, None, CredentialOrigin::Internal) => SearchActor::Service,
        (
            None,
            None,
            CredentialOrigin::MacroApiJwt
            | CredentialOrigin::ScopedMacroApiJwt
            | CredentialOrigin::UserApiKey
            | CredentialOrigin::AccountManager(_)
            | CredentialOrigin::Bot
            | CredentialOrigin::Harness,
        ) => SearchActor::Api,
    };
    SearchCaller::new(&user.user_context.user_id, actor)
}

/// Whether a search draws on its account's search allowance. Only a user API
/// key does, so all of one account's keys share one allowance, and app
/// sessions, agents, routines, services and account managers keep the lanes
/// alone.
pub(in crate::api::search) fn draws_api_key_allowance(user: &MacroUserAuthentication) -> bool {
    user.origin == CredentialOrigin::UserApiKey
}
