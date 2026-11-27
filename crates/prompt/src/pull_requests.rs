//! How a coding agent finishes a pull request and links to code.
//!
//! Shared by the instructions external MCP clients receive and the internal
//! MCP instructions coding agents receive, so both say the same thing.

use crate::types::StaticPrompt;

/// Standing instruction for opening a pull request a person can merge.
pub const READY_PULL_REQUEST: &str = "When you open a pull request, open it ready for review, not as a draft, and get CI passing before you hand it off. A draft, or a pull request whose checks are failing or still running, is not finished. If it was created as a draft, mark it ready for review.";

/// Back-link from a pull request to the session that opened it.
pub const SESSION_BACKLINK: &str = "macro_internal.set_pull_request returns this session's session_url; link it in the pull request description (for example, \"Macro agent session: <session_url>\") so reviewers can see how the change was made. Edit the description to add it if the pull request already exists.";

/// How to link to lines of a file in a GitHub repository, so a reader lands
/// on the code being discussed.
pub const GITHUB_FILE_LINKS: &str = "When you point at code in a GitHub repository, link to the lines on GitHub: https://github.com/<owner>/<repo>/blob/<commit-sha>/<path>#L<start>-L<end>, or #L<line> for one line. Take <owner>/<repo> from `git remote get-url origin` (the part after the github.com host, SSH or HTTPS, without a trailing `.git`), <path> relative to the repository root, and <commit-sha> as the full hash from `git rev-parse HEAD` of a commit that has been pushed; line numbers are those of the file at that commit. Use a commit, not a branch name, so the link keeps showing the same lines after the branch moves; link a branch only when the reader wants its latest version. For a file GitHub renders (Markdown, notebooks, CSV) add ?plain=1 before the anchor (blob/<commit-sha>/README.md?plain=1#L10), because the rendered view ignores line anchors. Link a directory as https://github.com/<owner>/<repo>/tree/<commit-sha>/<path>. Never link a local file path: the reader cannot open it.";

/// The GitHub file-link section of the instructions for external MCP clients.
pub static GITHUB_FILE_LINKS_PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "GitHub file links",
    GITHUB_FILE_LINKS,
    "Links to code in a GitHub repository name a pushed commit, the path and the line range.",
);

/// The pull-request section of the instructions for external MCP clients,
/// which may be coding agents. In-app hosts have no repository to work in.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Pull Requests",
    READY_PULL_REQUEST,
    "Pull requests are opened ready for review with CI passing, never left as drafts.",
);

/// Instructions advertised by Macro Internal MCP to coding agents.
pub fn internal_mcp_instructions() -> String {
    format!(
        "When you create or start working on a pull request, register its URL with Macro using macro_internal.set_pull_request. \
         {SESSION_BACKLINK} \
         {READY_PULL_REQUEST} \
         {GITHUB_FILE_LINKS} \
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
        assert!(instructions.contains(SESSION_BACKLINK));
        assert!(instructions.contains(READY_PULL_REQUEST));
        assert!(instructions.contains("artifacts directory"));
        assert!(instructions.contains(GITHUB_FILE_LINKS));
    }

    #[test]
    fn github_file_links_pin_a_commit_and_a_line_range() {
        assert!(GITHUB_FILE_LINKS.contains(
            "https://github.com/<owner>/<repo>/blob/<commit-sha>/<path>#L<start>-L<end>"
        ));
        assert!(GITHUB_FILE_LINKS.contains("git rev-parse HEAD"));
        assert!(GITHUB_FILE_LINKS.contains("?plain=1"));
        assert!(GITHUB_FILE_LINKS.contains("/tree/<commit-sha>/<path>"));
    }
}
