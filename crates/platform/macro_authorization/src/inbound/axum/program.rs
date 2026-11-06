//! Requests an agent's program makes, as opposed to a person in the app.

use ::axum::http::HeaderMap;

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
