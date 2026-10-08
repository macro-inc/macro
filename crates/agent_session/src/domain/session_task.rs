//! The Macro task a coding session works on, and keeping the session's pull request linked to it.
//!
//! A session has at most one task: the one its agent linked, else the task whose thread
//! started it. Whenever a session has both a task and a pull request, the pull request is
//! linked to the task the same way the GitHub webhook links pull requests that reference one.

use std::pin::Pin;

use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::MessageParent;
use tracing::Instrument;

use super::error::AgentSessionError;
use super::model::AgentSessionId;
use super::ports::AgentSessionRepo;

#[cfg(test)]
mod test;

/// Why a session's task could not be linked or read.
#[derive(Debug, thiserror::Error)]
pub enum SessionTaskError {
    /// The input names no task in a form this accepts.
    #[error(
        "expected a Macro task id, a MACRO-<id> reference, or a task link like https://macro.com/app/task/<id>"
    )]
    InvalidTaskReference,
    /// The task does not exist, or the session owner cannot view it.
    #[error("no task found that the session owner can view")]
    TaskNotFound,
    /// The document exists but is not a task.
    #[error("this document is not a task")]
    NotATask,
    /// The session could not be read or written.
    #[error(transparent)]
    Session(#[from] AgentSessionError),
    /// A task or pull request service failed.
    #[error("{0}")]
    Unavailable(rootcause::Report),
}

type Result<T, E = SessionTaskError> = std::result::Result<T, E>;

/// A task document id, parsed from what an agent was given.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TaskDocumentId(String);

impl TaskDocumentId {
    /// Accept a task document id, a `MACRO-{short id}` reference, or a link whose path is
    /// `/app/task/{id}`.
    pub fn parse(input: &str) -> Result<Self> {
        let input = input.trim();
        if let Some((_, id)) = lazy_regex::regex_captures!(
            r"\A(?i:https?)://[^/\s?#]+/app/task/([^/\s?#]+)/*(?:[?#]\S*)?\z",
            input
        ) {
            return Self::from_uuid(id);
        }
        if let Some((_, short)) =
            lazy_regex::regex_captures!(r"\A(?i:macro)-([1-9A-HJ-NP-Za-km-z]+)\z", input)
        {
            return macro_uuid::ShortUuidConverter::default()
                .to_uuid(short)
                .map(|uuid| Self(uuid.to_string()))
                .map_err(|_| SessionTaskError::InvalidTaskReference);
        }
        Self::from_uuid(input)
    }

    fn from_uuid(input: &str) -> Result<Self> {
        uuid::Uuid::parse_str(input)
            .map(|uuid| Self(uuid.to_string()))
            .map_err(|_| SessionTaskError::InvalidTaskReference)
    }

    /// Wrap an id already stored as a task document id.
    pub fn from_stored(id: String) -> Self {
        Self(id)
    }

    /// The document id.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A task as its viewer sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskFacts {
    /// The task document id.
    pub id: TaskDocumentId,
    /// The task title.
    pub title: String,
    /// The short id GitHub links key the task by.
    pub short_id: String,
    /// The text that links a pull request to the task when its description contains it.
    pub reference: String,
}

/// The task a session was linked to.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
pub struct LinkedTask {
    /// The task document id.
    pub task_id: String,
    /// The task title.
    pub title: String,
    /// Link to the task in Macro.
    pub url: String,
    /// Put this in the pull request description so GitHub activity reaches the task.
    pub reference: String,
    /// The session's pull request, now linked to the task, if it has one.
    pub pull_request: Option<String>,
}

/// Where a pull request is in its lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum PullRequestState {
    /// Open.
    Open,
    /// Closed without merging.
    Closed,
    /// Merged.
    Merged,
}

/// A pull request linked to a task.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
pub struct TaskPullRequest {
    /// The pull request's GitHub URL.
    pub url: String,
    /// The pull request title, once Macro has indexed it.
    pub title: Option<String>,
    /// The pull request state, once Macro has indexed it.
    pub state: Option<PullRequestState>,
}

/// The pull requests linked to a task.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
pub struct TaskPullRequests {
    /// The task document id.
    pub task_id: String,
    /// Linked pull requests, oldest link first.
    pub pull_requests: Vec<TaskPullRequest>,
}

/// Tasks as a user sees them.
pub trait TaskDirectory: Send + Sync {
    /// The task, if `viewer` can view it. Fails with [`SessionTaskError::TaskNotFound`] when
    /// it does not exist or is hidden, and [`SessionTaskError::NotATask`] for other documents.
    fn task(
        &self,
        viewer: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> impl Future<Output = Result<TaskFacts>> + Send;

    /// The pull requests linked to a task `viewer` can view.
    fn pull_requests(
        &self,
        viewer: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> impl Future<Output = Result<Vec<TaskPullRequest>>> + Send;
}

/// Links pull requests to tasks where the GitHub integration keeps those links.
pub trait TaskPullRequestLinker: Send + Sync {
    /// Link the pull request `owner/repo/pull/number` to the task. Additive and idempotent.
    fn link(&self, github_key: &str, task: &TaskFacts) -> impl Future<Output = Result<()>> + Send;
}

/// Persist a session's task.
pub trait SessionTaskRepo: Send + Sync {
    /// Replace the owner's session task, returning the session's pull request URL as of the
    /// write so a pull request recorded concurrently is never missed.
    fn set_task(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> impl Future<Output = Result<Option<String>, AgentSessionError>> + Send;

    /// The task the session was explicitly linked to.
    fn task(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Option<TaskDocumentId>, AgentSessionError>> + Send;
}

type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Session task operations used by the session MCP tools and by pull request recording.
pub trait SessionTasks: Send + Sync {
    /// Link the owner's session to a task, replacing any earlier one, and link the session's
    /// pull request to it.
    fn link_task<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        task: &'a str,
    ) -> BoxFuture<'a, Result<LinkedTask>>;

    /// The pull requests linked to a task the owner can view.
    fn task_pull_requests<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        task: &'a str,
    ) -> BoxFuture<'a, Result<TaskPullRequests>>;

    /// Link the session's pull request to the session's task, when it has both.
    fn link_session_pull_request<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
    ) -> BoxFuture<'a, Result<()>>;
}

/// [`SessionTasks`] over the session store and the task and GitHub domains.
pub struct SessionTaskService<Sessions, Links, Directory, Linker> {
    sessions: Sessions,
    links: Links,
    directory: Directory,
    linker: Linker,
    task_url_base: String,
}

impl<Sessions, Links, Directory, Linker> SessionTaskService<Sessions, Links, Directory, Linker> {
    /// Build the service. Task links are `{app_url}/app/task/{id}`.
    pub fn new(
        sessions: Sessions,
        links: Links,
        directory: Directory,
        linker: Linker,
        app_url: &str,
    ) -> Self {
        Self {
            sessions,
            links,
            directory,
            linker,
            task_url_base: format!("{}/app/task", app_url.trim_end_matches('/')),
        }
    }
}

impl<Sessions, Links, Directory, Linker> SessionTaskService<Sessions, Links, Directory, Linker>
where
    Sessions: AgentSessionRepo,
    Linker: TaskPullRequestLinker,
{
    async fn owned_session(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<super::model::AgentSession> {
        let stored = self.sessions.get(session).await?;
        if !stored.owner_id.is_user(owner) {
            return Err(AgentSessionError::Forbidden.into());
        }
        Ok(stored)
    }

    async fn link_pull_request(&self, pull_request_url: &str, task: &TaskFacts) -> Result<()> {
        let github_key = pull_request_url
            .strip_prefix("https://github.com/")
            .ok_or(AgentSessionError::InvalidPullRequestUrl)?;
        self.linker.link(github_key, task).await
    }
}

impl<Sessions, Links, Directory, Linker> SessionTasks
    for SessionTaskService<Sessions, Links, Directory, Linker>
where
    Sessions: AgentSessionRepo,
    Links: SessionTaskRepo,
    Directory: TaskDirectory,
    Linker: TaskPullRequestLinker,
{
    fn link_task<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        task: &'a str,
    ) -> BoxFuture<'a, Result<LinkedTask>> {
        let span = tracing::info_span!("agent.session.link_task", agent.session.id = %session);
        Box::pin(
            async move {
                self.owned_session(session, owner).await?;
                let task = TaskDocumentId::parse(task)?;
                let facts = self.directory.task(owner, &task).await?;
                let pull_request = self.links.set_task(session, owner, &facts.id).await?;
                if let Some(url) = &pull_request {
                    self.link_pull_request(url, &facts).await?;
                }
                Ok(LinkedTask {
                    url: format!("{}/{}", self.task_url_base, facts.id.as_str()),
                    task_id: facts.id.0,
                    title: facts.title,
                    reference: facts.reference,
                    pull_request,
                })
            }
            .instrument(span),
        )
    }

    fn task_pull_requests<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        task: &'a str,
    ) -> BoxFuture<'a, Result<TaskPullRequests>> {
        Box::pin(async move {
            let task = TaskDocumentId::parse(task)?;
            let pull_requests = self.directory.pull_requests(owner, &task).await?;
            Ok(TaskPullRequests {
                task_id: task.0,
                pull_requests,
            })
        })
    }

    fn link_session_pull_request<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
    ) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            let stored = self.owned_session(session, owner).await?;
            let Some(url) = stored.pull_request_url else {
                return Ok(());
            };
            if let Some(task) = self.links.task(session).await? {
                let facts = self.directory.task(owner, &task).await?;
                return self.link_pull_request(&url, &facts).await;
            }
            // A session started from a task's thread works on that task unless linked elsewhere.
            let Some(MessageParent::Document(document)) = stored.thread_parent else {
                return Ok(());
            };
            let Ok(task) = TaskDocumentId::from_uuid(&String::from(document)) else {
                return Ok(());
            };
            match self.directory.task(owner, &task).await {
                Ok(facts) => self.link_pull_request(&url, &facts).await,
                Err(SessionTaskError::NotATask | SessionTaskError::TaskNotFound) => Ok(()),
                Err(error) => Err(error),
            }
        })
    }
}
