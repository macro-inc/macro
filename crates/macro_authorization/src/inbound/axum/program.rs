//! Requests an agent's program makes, as opposed to a person in the app.

use ::axum::http::HeaderMap;

use crate::domain::models::CredentialAttribution;

#[cfg(test)]
mod test;

/// Set by the code-mode runtime (`code_execution`'s `bootstrap.mjs`) on every
/// authenticated SDK request a program makes, in agent sessions and for
/// public MCP clients alike.
pub const CODE_EXECUTION_HEADER: &str = "x-macro-code-execution";

/// Whether a request comes from an agent's program rather than a person in
/// the app: a code-mode run, or a credential signed for a program
/// ([`MacroUserAuthentication::attribution`](crate::MacroUserAuthentication::attribution)).
pub fn is_agent_run(attribution: CredentialAttribution, headers: &HeaderMap) -> bool {
    attribution != CredentialAttribution::Person || headers.contains_key(CODE_EXECUTION_HEADER)
}
