//! The links every pull request a session opens carries back to Macro: the
//! session itself, and the source that started it (the channel message, the
//! task, or the routine).
//!
//! The server derives both from the session's recorded origin, so an agent
//! never has to find them, and writes them into the pull request description
//! itself when the session owner's GitHub link allows it.

use std::pin::Pin;
use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::MessageParent;
use tracing::Instrument;
use trigger_context::TriggerOrigin;

use super::error::{AgentSessionError, Result};
use super::model::{AgentSession, AgentSessionId};
use super::ports::AgentSessionRepo;

#[cfg(test)]
mod test;

/// Opens the block of links Macro keeps in a pull request description.
pub const BLOCK_START: &str = "<!-- macro-agent-links -->";
/// Closes the block of links Macro keeps in a pull request description.
pub const BLOCK_END: &str = "<!-- /macro-agent-links -->";

/// What started a session, as a pull request names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, strum::AsRefStr)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PullRequestSourceKind {
    /// A channel message mentioned the agent, or someone wrote to it directly.
    ChannelMessage,
    /// The agent was assigned a task.
    Task,
    /// A routine fired.
    Routine,
    /// A person prompted the session itself.
    SessionPrompt,
}

impl PullRequestSourceKind {
    fn label(self) -> &'static str {
        match self {
            Self::ChannelMessage => "channel message",
            Self::Task => "task",
            Self::Routine => "routine",
            Self::SessionPrompt => "agent session prompt",
        }
    }
}

/// What started a session, and its link in Macro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestSource {
    /// What kind of thing it is.
    pub kind: PullRequestSourceKind,
    /// Its link in the Macro app.
    pub url: String,
}

/// The links a session's pull request carries back to Macro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestBacklinks {
    /// The session in the Macro app.
    pub session_url: String,
    /// What started the session.
    pub source: PullRequestSource,
}

impl PullRequestBacklinks {
    /// The links for `session`, from what its origin recorded. A session whose
    /// origin names nothing linkable falls back to the task it was linked to,
    /// the channel message that opened it, and finally its own prompt.
    #[must_use]
    pub fn for_session(session: &AgentSession, app_url: &str) -> Self {
        let app = app_url.trim_end_matches('/');
        let session_url = format!("{app}/app/agent/{}", session.id);
        let task = |task: &str| PullRequestSource {
            kind: PullRequestSourceKind::Task,
            url: format!("{app}/app/task/{task}"),
        };
        let message = |message_id: uuid::Uuid| {
            let Some(MessageParent::Channel(channel)) = &session.thread_parent else {
                return None;
            };
            let mut url = format!("{app}/app/channel/{channel}?channel_message_id={message_id}");
            if let Some(thread) = session.thread_id.filter(|thread| *thread != message_id) {
                url.push_str(&format!("&channel_thread_id={thread}"));
            }
            Some(PullRequestSource {
                kind: PullRequestSourceKind::ChannelMessage,
                url,
            })
        };
        let recorded = match &session.origin {
            TriggerOrigin::Mentioned { message_id, .. }
            | TriggerOrigin::Conversation { message_id, .. } => message(*message_id),
            TriggerOrigin::TaskAssigned { task: id, .. }
            | TriggerOrigin::ProjectInherited { task: id, .. } => Some(task(id)),
            TriggerOrigin::Routine { routine, .. } => Some(PullRequestSource {
                kind: PullRequestSourceKind::Routine,
                url: format!("{app}/app/routines/{routine}"),
            }),
            TriggerOrigin::Requested { .. } => Some(PullRequestSource {
                kind: PullRequestSourceKind::SessionPrompt,
                url: session_url.clone(),
            }),
            TriggerOrigin::Dispatched { .. } | TriggerOrigin::Unknown => None,
        };
        let source = recorded
            .or_else(|| session.task_id.as_deref().map(task))
            .or_else(|| session.originating_message_id.and_then(message))
            .unwrap_or_else(|| PullRequestSource {
                kind: PullRequestSourceKind::SessionPrompt,
                url: session_url.clone(),
            });
        Self {
            session_url,
            source,
        }
    }

    /// The block to put in a pull request description, markers included.
    #[must_use]
    pub fn block(&self) -> String {
        format!(
            "{BLOCK_START}\nMacro agent session: {}\nSource ({}): {}\n{BLOCK_END}",
            self.session_url,
            self.source.kind.label(),
            self.source.url
        )
    }

    /// Whether `description` already links both the session and the source.
    #[must_use]
    pub fn linked_in(&self, description: &str) -> bool {
        description.contains(&self.session_url) && description.contains(&self.source.url)
    }

    /// `description` with the block in it: replacing an earlier block, or
    /// appended after the rest of the text.
    #[must_use]
    pub fn applied_to(&self, description: &str) -> String {
        let block = self.block();
        if let Some(start) = description.find(BLOCK_START)
            && let Some(end) = description[start..].find(BLOCK_END)
        {
            let end = start + end + BLOCK_END.len();
            return format!("{}{block}{}", &description[..start], &description[end..]);
        }
        let text = description.trim_end();
        if text.is_empty() {
            block
        } else {
            format!("{text}\n\n{block}\n")
        }
    }
}

/// A GitHub pull request, by repository and number.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestNumber {
    /// The repository owner.
    pub owner: String,
    /// The repository name.
    pub repo: String,
    /// The pull request number.
    pub number: u64,
}

impl PullRequestNumber {
    /// The pull request a GitHub link points at.
    pub fn parse(url: &str) -> Result<Self> {
        let canonical = super::pull_request::canonical_url(url)?;
        let (_, owner, repo, number) = lazy_regex::regex_captures!(
            r"\Ahttps://github\.com/([^/]+)/([^/]+)/pull/([0-9]+)\z",
            &canonical
        )
        .ok_or(AgentSessionError::InvalidPullRequestUrl)?;
        Ok(Self {
            owner: owner.to_owned(),
            repo: repo.to_owned(),
            number: number
                .parse()
                .map_err(|_| AgentSessionError::InvalidPullRequestUrl)?,
        })
    }
}

/// Why a pull request description could not be read or written.
#[derive(Debug, thiserror::Error)]
pub enum PullRequestDescriptionError {
    /// The session owner has not linked a GitHub account, or its token stopped working.
    #[error("the session owner has no working GitHub link")]
    NotLinked,
    /// GitHub refused: the owner cannot see or edit the pull request.
    #[error("GitHub refused: {0}")]
    Refused(String),
    /// GitHub could not be reached or failed.
    #[error("GitHub failed: {0}")]
    Upstream(String),
}

/// A pull request's description, as GitHub holds it, read and written as the session owner.
pub trait PullRequestDescriptions: Send + Sync {
    /// The current description; empty when it has none.
    fn read<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        pull_request: &'a PullRequestNumber,
    ) -> Pin<
        Box<
            dyn Future<Output = std::result::Result<String, PullRequestDescriptionError>>
                + Send
                + 'a,
        >,
    >;

    /// Replace the description.
    fn write<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        pull_request: &'a PullRequestNumber,
        description: &'a str,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<(), PullRequestDescriptionError>> + Send + 'a>,
    >;
}

/// Whether the pull request description carries the links.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DescriptionLinks {
    /// The description already linked both.
    AlreadyLinked,
    /// Macro added them to the description.
    Added,
    /// Macro could not edit the description; the agent must add them.
    NotWritten {
        /// Why not.
        reason: String,
    },
}

impl DescriptionLinks {
    fn outcome(&self) -> &'static str {
        match self {
            Self::AlreadyLinked => "already_linked",
            Self::Added => "added",
            Self::NotWritten { .. } => "not_written",
        }
    }
}

/// The links a pull request carries, and whether its description has them now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedDescription {
    /// The links.
    pub backlinks: PullRequestBacklinks,
    /// Whether the description has them.
    pub description: DescriptionLinks,
}

/// Put a session's links in its pull request description.
pub trait SessionPullRequestBacklinks: Send + Sync {
    /// Make `url`'s description link the owner's session and what started it.
    /// Only a session that cannot be read, or one the caller does not own, is
    /// an error; a description Macro cannot edit is [`DescriptionLinks::NotWritten`].
    fn link_description<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        url: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<LinkedDescription>> + Send + 'a>>;
}

/// [`SessionPullRequestBacklinks`] over the session store and GitHub.
pub struct PullRequestBacklinkService<R> {
    repo: R,
    descriptions: Arc<dyn PullRequestDescriptions>,
    app_url: String,
}

impl<R> PullRequestBacklinkService<R> {
    /// Links point into the Macro app at `app_url`.
    pub fn new(repo: R, descriptions: Arc<dyn PullRequestDescriptions>, app_url: &str) -> Self {
        Self {
            repo,
            descriptions,
            app_url: app_url.to_owned(),
        }
    }

    async fn ensure(
        &self,
        owner: &MacroUserIdStr<'static>,
        url: &str,
        backlinks: &PullRequestBacklinks,
    ) -> std::result::Result<DescriptionLinks, PullRequestDescriptionError> {
        let pull_request = PullRequestNumber::parse(url)
            .map_err(|error| PullRequestDescriptionError::Refused(error.to_string()))?;
        let current = self.descriptions.read(owner, &pull_request).await?;
        if backlinks.linked_in(&current) {
            return Ok(DescriptionLinks::AlreadyLinked);
        }
        self.descriptions
            .write(owner, &pull_request, &backlinks.applied_to(&current))
            .await?;
        Ok(DescriptionLinks::Added)
    }
}

impl<R: AgentSessionRepo> SessionPullRequestBacklinks for PullRequestBacklinkService<R> {
    fn link_description<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        url: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<LinkedDescription>> + Send + 'a>> {
        let span = tracing::info_span!(
            "agent.session.pull_request_backlinks",
            agent.session.id = %session,
            source_kind = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        Box::pin(
            async move {
                let stored = self.repo.get(session).await?;
                if !stored.owner_id.is_user(owner) {
                    return Err(AgentSessionError::Forbidden);
                }
                let backlinks = PullRequestBacklinks::for_session(&stored, &self.app_url);
                tracing::Span::current().record("source_kind", backlinks.source.kind.as_ref());
                let description =
                    self.ensure(owner, url, &backlinks)
                        .await
                        .unwrap_or_else(|error| {
                            tracing::warn!(error = ?error, "could not write pull request links");
                            DescriptionLinks::NotWritten {
                                reason: error.to_string(),
                            }
                        });
                tracing::Span::current().record("outcome", description.outcome());
                Ok(LinkedDescription {
                    backlinks,
                    description,
                })
            }
            .instrument(span),
        )
    }
}
