//! Requests an agent's program makes, as opposed to a person in the app.

use ::axum::http::{HeaderMap, StatusCode};

use super::{MacroAuthorizationRejection, status_rejection};

#[cfg(test)]
mod test;

/// Set by the code-mode runtime (`code_execution`'s `bootstrap.mjs`) on every
/// authenticated SDK request a program makes, in agent sessions and for
/// public MCP clients alike.
pub const CODE_EXECUTION_HEADER: &str = "x-macro-code-execution";

/// Whether a request comes from an agent's program rather than a person in
/// the app: a code-mode run, or a token carrying an agent's attribution
/// (`MacroUserAuthentication::agent_id`).
pub fn is_agent_run(agent_attributed: bool, headers: &HeaderMap) -> bool {
    agent_attributed || headers.contains_key(CODE_EXECUTION_HEADER)
}

/// Refuse an agent's program ([`is_agent_run`]) on a route only a person in
/// the app may use: one that mints a credential, hands someone access to the
/// account, or reaches people outside the workspace. A program injected by
/// what it read must not be able to do these, so the 403 carries `refusal`,
/// which tells the program to leave it to the user in the app.
pub fn refuse_agent_run(
    agent_attributed: bool,
    headers: &HeaderMap,
    refusal: &'static str,
) -> Result<(), MacroAuthorizationRejection> {
    if is_agent_run(agent_attributed, headers) {
        return Err(status_rejection(StatusCode::FORBIDDEN, refusal));
    }
    Ok(())
}
