//! Errors the session service can produce.

use crate::domain::model::RepoUrl;
use agent_client_protocol::schema::v1::SessionId;
pub use agent_runtime_protocol::domain::turn::{FailureLink, FailureNotice, FailureNoticeKind};
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
    /// can act on. Carries what is meant for them and nothing else: it is
    /// what the `session/prompt` error says, so a report's decorations (a
    /// bullet, a source location) would be read as part of the instruction.
    #[error("{0}")]
    Rejected(PromptRefusal),
}

impl From<rootcause::Report> for SessionError {
    fn from(report: rootcause::Report) -> Self {
        Self::Cursor(report)
    }
}

/// What a refused prompt tells the person who sent it.
///
/// `message` is the `session/prompt` error's message and is always present.
/// `notice` is the same refusal in the shape a reader renders as an
/// instruction with somewhere to go; it exists only for the refusals a
/// person can resolve outside Macro, and travels as the error's `data`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptRefusal {
    /// One plain sentence or two, no report decorations.
    pub message: String,
    /// The refusal as a rendered notice, when there is more to say than a line.
    pub notice: Option<FailureNotice>,
}

impl PromptRefusal {
    /// A refusal that is only its message.
    #[must_use]
    pub fn plain(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            notice: None,
        }
    }
}

impl std::fmt::Display for PromptRefusal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

/// A prompt Cursor refused because the account behind the API key has no
/// background-agent budget left.
///
/// Seen in production as a 400 with code `usage_limit_exceeded`: "You need
/// to increase your hard limit. Background Agent requires at least $2
/// remaining until your hard limit." A fact about the person's own Cursor
/// account, fixed on Cursor's dashboard, so it is the person's to read - not
/// an internal error, which is how the raw report presented it.
#[derive(Debug, Error)]
#[error("cursor refused the prompt ({code}): {detail}")]
pub struct UsageLimitExceeded {
    /// Cursor's error code, one of [`Self::CODES`].
    pub code: String,
    /// Cursor's own error body, verbatim, for the logs.
    pub detail: String,
}

impl UsageLimitExceeded {
    /// Cursor's error codes for an exhausted budget.
    ///
    /// Matched on the structured `error.code`, never the message: Cursor's
    /// wording (and the dollar figure in it) is theirs to change.
    pub const CODES: [&'static str; 1] = ["usage_limit_exceeded"];

    /// Where the limit is raised.
    pub const DASHBOARD_URL: &'static str = "https://www.cursor.com/dashboard?tab=settings";

    /// What to show the person who sent the prompt.
    #[must_use]
    pub fn notice(&self) -> FailureNotice {
        FailureNotice {
            kind: FailureNoticeKind::ProviderUsageLimit,
            title: "Cursor usage limit reached".to_owned(),
            body: "Your Cursor account has no background-agent budget left, so this message \
                   wasn't sent. Raise the spending limit in your Cursor dashboard, then send \
                   it again."
                .to_owned(),
            link: Some(FailureLink {
                label: "Manage Cursor usage".to_owned(),
                url: Self::DASHBOARD_URL.to_owned(),
            }),
        }
    }

    /// The refusal as the `session/prompt` error carries it.
    #[must_use]
    pub fn refusal(&self) -> PromptRefusal {
        let notice = self.notice();
        PromptRefusal {
            message: format!("{} {}", notice.title, notice.body),
            notice: Some(notice),
        }
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
