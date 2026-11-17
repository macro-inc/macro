//! Requests an agent's program makes, as opposed to a person in the app.

use ::axum::http::HeaderMap;

use crate::domain::models::CredentialAttribution;

#[cfg(test)]
mod test;

/// Set by the code-mode runtime (`code_execution`'s `bootstrap.mjs`) on every
/// SDK request a program makes, in agent sessions and for public MCP clients
/// alike.
pub const CODE_EXECUTION_HEADER: &str = "x-macro-code-execution";

/// Whether a request comes from an agent's program rather than a person in
/// the app: a code-mode run, or a credential signed for an agent. A routine
/// step running as its owner is not one, so routes that only ask a program
/// to confirm (sending email, creating events) keep serving owner routines.
pub fn is_agent_run(attribution: CredentialAttribution, headers: &HeaderMap) -> bool {
    attribution == CredentialAttribution::Agent || headers.contains_key(CODE_EXECUTION_HEADER)
}

/// Whether any program sent the request: everything [`is_agent_run`] counts,
/// and a credential signed for a routine's run. Routes where only a person may
/// decide, answer or approve (review decisions, elicitation and permission
/// answers, held tool-call approvals) refuse it.
pub fn is_program_run(attribution: CredentialAttribution, headers: &HeaderMap) -> bool {
    attribution != CredentialAttribution::Person || headers.contains_key(CODE_EXECUTION_HEADER)
}

/// The refusal a sign-in route gives a program: one that reads the code from
/// the user's inbox would hold the account.
pub const PROGRAM_SIGN_IN_REFUSAL: &str = "An agent's program cannot sign in to Macro: the sign-in code would give it the account. Tell the user to sign in themselves.";
