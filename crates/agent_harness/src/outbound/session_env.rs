//! The environment a session's sandbox is created with.
//!
//! One definition shared by every container provider, because the sandbox-side
//! bootstrap (`ensureReadyCommand` in the coding-agent-worker) reads these
//! names and there is nowhere else the contract is written down.

use crate::domain::model::SpawnContainer;

#[cfg(test)]
mod test;

/// Repository to clone. Absent entirely when the persona named none, which is
/// what tells the bootstrap to skip the clone and leave an empty workspace.
const REPO_URL: &str = "REPO_URL";

/// Token the sandbox authenticates to GitHub with.
const GITHUB_TOKEN: &str = "GITHUB_TOKEN";

/// The persona's markdown instructions. Always set, empty when the persona has
/// none: the bootstrap writes it to a file the baked `opencode.json` already
/// names in `instructions`, so the file has to exist either way.
const PERSONA_PROMPT: &str = "MACRO_PERSONA_PROMPT";

/// Build the environment for one session's sandbox.
pub(crate) fn session_env(command: &SpawnContainer, github_token: &str) -> Vec<(String, String)> {
    let mut env = vec![
        (GITHUB_TOKEN.to_owned(), github_token.to_owned()),
        (
            PERSONA_PROMPT.to_owned(),
            command.system_prompt.clone().unwrap_or_default(),
        ),
    ];

    if let Some(repo_url) = &command.repo_url {
        env.push((REPO_URL.to_owned(), repo_url.clone()));
    }

    env
}
