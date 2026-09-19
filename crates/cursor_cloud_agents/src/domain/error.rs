//! Errors the session service can produce.

use crate::domain::model::RepoUrl;
use agent_client_protocol::schema::v1::SessionId;
use thiserror::Error;

/// Why a session operation failed.
#[derive(Debug, Error)]
pub enum SessionError {
    /// The client referenced a session this agent never created.
    #[error("unknown session {0}")]
    UnknownSession(SessionId),
    /// A prompt arrived while the session's previous turn was still running.
    /// ACP turns are strictly sequential; the client must wait for the
    /// previous `session/prompt` to respond.
    #[error("session {0} already has an active turn")]
    TurnAlreadyActive(SessionId),
    /// Native capture or replay processing failed; never masked by cancellation.
    #[error("Cursor native journal failed: {0}")]
    Journal(rootcause::Report),
    /// The Cursor API or its stream failed.
    #[error("{0}")]
    Cursor(rootcause::Report),
    /// The provider refused the prompt for a reason the person who sent it
    /// can act on. Carries the message meant for them and nothing else: it is
    /// what the `session/prompt` error says, so a report's decorations (a
    /// bullet, a source location) would be read as part of the instruction.
    #[error("{0}")]
    Rejected(String),
}

impl From<rootcause::Report> for SessionError {
    fn from(report: rootcause::Report) -> Self {
        Self::Cursor(report)
    }
}

/// A provider response proving a prompt was rejected before execution.
#[derive(Debug, Error)]
#[error("{0}")]
pub struct PromptRejected(pub String);

/// A prompt rejected specifically because Cursor could not use the session's
/// repository.
///
/// A distinct context because it is the one rejection the user can act on,
/// and acting on it happens outside Macro. `detail` keeps Cursor's own body
/// for the logs; [`Self::user_message`] is what a person should read.
#[derive(Debug, Error)]
#[error("cursor cannot use {repo} ({reason}): {detail}")]
pub struct RepositoryUnavailable {
    /// The repository the session asked Cursor to work in.
    pub repo: RepoUrl,
    /// Which of Cursor's refusals this was.
    pub reason: RepositoryRejection,
    /// Cursor's own error body, verbatim.
    pub detail: String,
}

/// The ways Cursor has refused a repository, as seen in production.
///
/// Each maps to a different sentence for the user: an inaccessible repository
/// wants the GitHub app connected, while a branch Cursor could not verify is
/// usually Cursor's own verification flaking — the ref exists — so the
/// message must not send the user off to rename a branch that is fine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepositoryRejection {
    /// `repository_access` / `integration_not_connected`: the account cannot
    /// reach the repository at all.
    Inaccessible,
    /// `validation_error` "Failed to verify existence of branch …": Cursor's
    /// GitHub-side check could not confirm the starting ref. Observed to be
    /// intermittent for refs that exist, so the client retries it before
    /// surfacing it.
    BranchUnverifiable {
        /// The ref the request asked to start from.
        starting_ref: String,
    },
}

impl std::fmt::Display for RepositoryRejection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Inaccessible => formatter.write_str("inaccessible"),
            Self::BranchUnverifiable { starting_ref } => {
                write!(formatter, "could not verify branch {starting_ref}")
            }
        }
    }
}

impl RepositoryUnavailable {
    /// What to show the person who sent the prompt.
    #[must_use]
    pub fn user_message(&self) -> String {
        let repo = self
            .repo
            .github_owner_and_name()
            .unwrap_or_else(|| self.repo.as_str());
        match &self.reason {
            RepositoryRejection::Inaccessible => format!(
                "Cursor can't access {repo}. Connect the repository to Cursor's GitHub app, then prompt again."
            ),
            RepositoryRejection::BranchUnverifiable { starting_ref } => format!(
                "Cursor couldn't verify that branch '{starting_ref}' exists in {repo}, even after retrying. \
                 This is usually transient on Cursor's side; prompt again in a moment. \
                 If it keeps happening, check that {repo} is connected to Cursor's GitHub app."
            ),
        }
    }
}
