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
use super::session_task::{SessionTaskError, TaskDirectory, TaskDocumentId};

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
    /// A message in a task's thread mentioned the agent; the link is the task.
    TaskThread,
    /// A message in a project's thread mentioned the agent; the link is the project.
    ProjectThread,
    /// A routine fired.
    Routine,
    /// A person prompted the session itself.
    SessionPrompt,
    /// A message in a document's thread, which has no link Macro puts in pull
    /// requests; the link is the session.
    DocumentThread,
    /// A message in a CRM record's thread; the link is the session.
    CrmThread,
    /// A message in a call's thread; the link is the session.
    CallThread,
    /// Another agent dispatched the session and did not record what started
    /// its own work; the link is the session.
    Dispatched,
    /// Nothing recorded what started the session; the link is the session.
    NotRecorded,
}

impl PullRequestSourceKind {
    fn label(self) -> &'static str {
        match self {
            Self::ChannelMessage => "channel message",
            Self::Task => "task",
            Self::TaskThread => "task thread",
            Self::ProjectThread => "project thread",
            Self::Routine => "routine",
            Self::SessionPrompt => "agent session prompt",
            Self::DocumentThread => "a document thread, see the session",
            Self::CrmThread => "a CRM thread, see the session",
            Self::CallThread => "a call thread, see the session",
            Self::Dispatched => "dispatched by another agent, see the session",
            Self::NotRecorded => "not recorded, see the session",
        }
    }
}

/// What started a session, and its link in Macro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestSource {
    /// What kind of thing it is.
    pub kind: PullRequestSourceKind,
    /// Its link in the Macro app: the session itself when the source has no
    /// link of its own.
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
    /// The links for `session`, from what its origin recorded. A message in a
    /// thread links where the thread lives: the channel message, or the task
    /// or project whose thread it is (`thread_task` is the session's thread
    /// document when that document is a task). A session a person prompted
    /// directly is its own source. A session whose origin names nothing
    /// linkable (dispatched by a tool, or not recorded) falls back to the
    /// message that opened it, then the task it was linked to.
    #[must_use]
    pub fn for_session(session: &AgentSession, app_url: &str, thread_task: Option<&str>) -> Self {
        let app = app_url.trim_end_matches('/');
        let session_url = format!("{app}/app/agent/{}", session.id);
        let source = |kind, url| PullRequestSource { kind, url };
        let unlinked = |kind| source(kind, session_url.clone());
        let task = |task: &str| {
            source(
                PullRequestSourceKind::Task,
                format!("{app}/app/task/{task}"),
            )
        };
        let message = |message_id: uuid::Uuid| {
            Some(match session.thread_parent.as_ref()? {
                MessageParent::Channel(channel) => {
                    let mut url =
                        format!("{app}/app/channel/{channel}?channel_message_id={message_id}");
                    if let Some(thread) = session.thread_id.filter(|thread| *thread != message_id) {
                        url.push_str(&format!("&channel_thread_id={thread}"));
                    }
                    source(PullRequestSourceKind::ChannelMessage, url)
                }
                MessageParent::Document(_) => match thread_task {
                    Some(task) => source(
                        PullRequestSourceKind::TaskThread,
                        format!("{app}/app/task/{task}"),
                    ),
                    None => unlinked(PullRequestSourceKind::DocumentThread),
                },
                MessageParent::Initiative(project) => source(
                    PullRequestSourceKind::ProjectThread,
                    format!("{app}/app/tasks/projects/{project}/overview"),
                ),
                MessageParent::CrmCompany(_) | MessageParent::CrmContact(_) => {
                    unlinked(PullRequestSourceKind::CrmThread)
                }
                MessageParent::Call(_) => unlinked(PullRequestSourceKind::CallThread),
            })
        };
        let fallback = |kind| {
            session
                .originating_message_id
                .and_then(message)
                .or_else(|| session.task_id.as_deref().map(task))
                .unwrap_or_else(|| unlinked(kind))
        };
        let source = match &session.origin {
            TriggerOrigin::Mentioned { message_id, .. }
            | TriggerOrigin::Conversation { message_id, .. } => {
                message(*message_id).unwrap_or_else(|| fallback(PullRequestSourceKind::NotRecorded))
            }
            TriggerOrigin::TaskAssigned { task: id, .. }
            | TriggerOrigin::ProjectInherited { task: id, .. } => task(id),
            TriggerOrigin::Routine { routine, .. } => source(
                PullRequestSourceKind::Routine,
                format!("{app}/app/routines/{routine}"),
            ),
            TriggerOrigin::Requested { .. } => unlinked(PullRequestSourceKind::SessionPrompt),
            TriggerOrigin::Dispatched { .. } => fallback(PullRequestSourceKind::Dispatched),
            TriggerOrigin::Unknown => fallback(PullRequestSourceKind::NotRecorded),
        };
        Self {
            session_url,
            source,
        }
    }

    /// The block to put in a pull request description, markers included. The
    /// links are separate paragraphs so GitHub renders them on their own lines.
    #[must_use]
    pub fn block(&self) -> String {
        format!(
            "{BLOCK_START}\nMacro agent session: {}\n\nSource ({}): {}\n{BLOCK_END}",
            self.session_url,
            self.source.kind.label(),
            self.source.url
        )
    }

    /// Whether `description` already has a block linking both the session and
    /// the source. Links outside a block do not count: the privacy check
    /// allows a channel or routine link only inside one.
    #[must_use]
    pub fn linked_in(&self, description: &str) -> bool {
        self.own_block(description)
            .is_some_and(|(start, end)| description[start..end].contains(&self.source.url))
    }

    /// `description` with this session's block in it. A block of this
    /// session's (markers alone on their lines) is replaced in place; any
    /// other text, including another session's block or a marker quoted in
    /// prose, is kept, and the block is appended after it.
    #[must_use]
    pub fn applied_to(&self, description: &str) -> String {
        let block = self.block();
        if let Some((start, end)) = self.own_block(description) {
            return format!("{}{block}{}", &description[..start], &description[end..]);
        }
        let text = description.trim_end();
        if text.is_empty() {
            block
        } else {
            format!("{text}\n\n{block}\n")
        }
    }

    /// The byte range of the last block in `description` that links this
    /// session, from the start of its opening marker line to the end of its
    /// closing marker.
    fn own_block(&self, description: &str) -> Option<(usize, usize)> {
        let mut lines = Vec::new();
        let mut offset = 0;
        for line in description.split_inclusive('\n') {
            lines.push((offset, line.trim_end_matches(['\r', '\n'])));
            offset += line.len();
        }
        let mut found = None;
        for (index, (start, line)) in lines.iter().enumerate() {
            if *line != BLOCK_START {
                continue;
            }
            let Some((end, end_line)) = lines[index + 1..]
                .iter()
                .find(|(_, line)| *line == BLOCK_END || *line == BLOCK_START)
            else {
                break;
            };
            if *end_line != BLOCK_END {
                continue;
            }
            if description[*start..*end].contains(&self.session_url) {
                found = Some((*start, end + BLOCK_END.len()));
            }
        }
        found
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

/// [`SessionPullRequestBacklinks`] over the session store, the task
/// directory (to tell a task's thread from another document's), and GitHub.
pub struct PullRequestBacklinkService<R, D> {
    repo: R,
    tasks: D,
    descriptions: Arc<dyn PullRequestDescriptions>,
    app_url: String,
}

impl<R, D: TaskDirectory> PullRequestBacklinkService<R, D> {
    /// Links point into the Macro app at `app_url`.
    pub fn new(
        repo: R,
        tasks: D,
        descriptions: Arc<dyn PullRequestDescriptions>,
        app_url: &str,
    ) -> Self {
        Self {
            repo,
            tasks,
            descriptions,
            app_url: app_url.to_owned(),
        }
    }

    /// The session's thread document, when it is a task the owner can view.
    async fn thread_task(
        &self,
        session: &AgentSession,
        owner: &MacroUserIdStr<'static>,
    ) -> Option<String> {
        let Some(MessageParent::Document(document)) = &session.thread_parent else {
            return None;
        };
        let task = TaskDocumentId::from_stored(String::from(document.clone()));
        match self.tasks.task(owner, &task).await {
            Ok(facts) => Some(facts.id.as_str().to_owned()),
            Err(SessionTaskError::NotATask | SessionTaskError::TaskNotFound) => None,
            Err(error) => {
                tracing::warn!(error = ?error, "could not tell whether the session's thread is a task");
                None
            }
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

impl<R: AgentSessionRepo, D: TaskDirectory> SessionPullRequestBacklinks
    for PullRequestBacklinkService<R, D>
{
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
                let thread_task = self.thread_task(&stored, owner).await;
                let backlinks = PullRequestBacklinks::for_session(
                    &stored,
                    &self.app_url,
                    thread_task.as_deref(),
                );
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
