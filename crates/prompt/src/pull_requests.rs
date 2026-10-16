//! How a coding agent finishes a pull request.
//!
//! Shared by the Macro system prompt and the internal MCP instructions coding
//! agents receive, so both say the same thing.

/// Standing instruction for opening a pull request a person can merge.
pub const READY_PULL_REQUEST: &str = "When you open a pull request, open it ready for review, not as a draft, and get CI passing before you hand it off. A draft, or a pull request whose checks are failing or still running, is not finished. If it was created as a draft, mark it ready for review.";

/// Instructions advertised by Macro Internal MCP to coding agents.
pub fn internal_mcp_instructions() -> String {
    format!(
        "When you create or start working on a pull request, register its URL with Macro using macro_internal.set_pull_request. \
         {READY_PULL_REQUEST} \
         Save any screenshot or screen recording meant for the user into your artifacts directory and refer to it in prose by file name only, never by a sandbox path: Macro re-hosts uploaded artifacts and cannot reach files anywhere else."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_mcp_instructions_include_registration_and_a_ready_pull_request() {
        let instructions = internal_mcp_instructions();
        assert!(instructions.contains("macro_internal.set_pull_request"));
        assert!(instructions.contains("register its URL"));
        assert!(instructions.contains(READY_PULL_REQUEST));
        assert!(instructions.contains("artifacts directory"));
    }
}
