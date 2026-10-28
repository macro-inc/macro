//! Cloud task commands, observations, and conversation provider ports.

use super::{CredentialStore, Credentials, OAuth, Probe};
use serde::Serialize;

/// Provider identifier validated before it can become a URL segment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct CloudId(String);

impl<'de> serde::Deserialize<'de> for CloudId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(<String as serde::Deserialize>::deserialize(deserializer)?)
            .map_err(serde::de::Error::custom)
    }
}

impl CloudId {
    /// Accept only an opaque alphanumeric identifier with hyphens/underscores.
    pub fn new(value: String) -> Result<Self, rootcause::Report> {
        if value.is_empty()
            || value.len() > 256
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err(rootcause::report!("invalid cloud identifier"));
        }
        Ok(Self(value))
    }
    /// The validated provider identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A single explicitly requested cloud execution.
pub struct Launch {
    /// Existing cloud environment.
    pub environment: CloudId,
    /// Explicit branch; never inferred from the probe repository.
    pub branch: String,
    /// Text to send once to OpenAI.
    pub prompt: String,
}

impl Launch {
    /// Reject empty/oversized input before credential use or provider writes.
    pub fn validate(&self) -> Result<(), rootcause::Report> {
        validate_branch(&self.branch)?;
        if self.prompt.trim().is_empty() || self.prompt.len() > 64 * 1024 {
            return Err(rootcause::report!(
                "provide a branch and nonempty prompt (maximum 64 KiB)"
            ));
        }
        Ok(())
    }
}

/// Validate a branch or full Git ref before selecting a remote execution target.
pub fn validate_branch(branch: &str) -> Result<(), rootcause::Report> {
    if branch.is_empty()
        || branch.len() > 1024
        || branch.starts_with('-')
        || branch == "@"
        || branch.contains("..")
        || branch.contains("@{")
        || branch
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
        || branch.split('/').any(|part| {
            part.is_empty()
                || part.starts_with('.')
                || part.ends_with('.')
                || part.ends_with(".lock")
        })
    {
        return Err(rootcause::report!("invalid cloud Git branch"));
    }
    Ok(())
}

/// Task creation receipt; losing this response must never trigger an automatic retry.
#[derive(Debug, Clone, Serialize)]
pub struct CreatedTask {
    /// Initial assistant turn, when returned by the provider.
    pub assistant_turn_id: Option<TurnId>,
    /// Provider task identity.
    pub task_id: CloudId,
    /// Codex web task URL.
    pub url: String,
}

/// A projected task-details snapshot, not a complete conversation history.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct TaskSnapshot {
    /// Original successful provider response for native journaling; omitted from CLI output.
    #[serde(skip)]
    pub native: Option<String>,
    /// Exact requested task.
    pub task_id: CloudId,
    /// Provider title, when present.
    pub title: Option<String>,
    /// Status from the current assistant turn, unmodified; unknown values stay unknown.
    pub assistant_status: Option<String>,
    /// Selected current turns only, preserving which field each observation came from.
    pub turns: Vec<TurnSnapshot>,
    /// Verified provider PR associations, independent of proposed diffs or assistant text.
    pub pull_requests: Vec<ExternalPullRequest>,
}

/// A real GitHub pull request associated by the provider with an assistant turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct ExternalPullRequest {
    /// Provider turn association; never inferred from the current turn.
    pub assistant_turn_id: TurnId,
    /// Canonical credential-free GitHub pull request URL.
    pub url: String,
}

impl TaskSnapshot {
    /// Only explicit known assistant terminal statuses terminate observation.
    pub fn terminal(&self) -> bool {
        matches!(
            self.assistant_status.as_deref(),
            Some("completed" | "failed" | "cancelled")
        )
    }
}

/// Output available in one current turn at the time of a read.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct TurnSnapshot {
    /// Source field, such as `current_assistant_turn`.
    pub source: String,
    /// Provider turn ID, if returned.
    pub id: Option<String>,
    /// Text blocks in message output items; no invented tool/thought events.
    pub messages: Vec<String>,
    /// Output item kinds, useful for discovering provider vocabulary.
    pub output_types: Vec<String>,
    /// Whether the turn exposes a diff, without printing file contents implicitly.
    pub has_diff: bool,
}

/// Independently testable task transport, separate from OAuth.
pub trait CloudTasks: Send + Sync {
    /// Send a creation request exactly once.
    fn create(
        &self,
        auth: &Credentials,
        request: &Launch,
    ) -> impl Future<Output = Result<CreatedTask, rootcause::Report>> + Send;
    /// Fetch the current snapshot for one task.
    fn snapshot(
        &self,
        auth: &Credentials,
        task: &CloudId,
    ) -> impl Future<Output = Result<TaskSnapshot, rootcause::Report>> + Send;
}

impl<Provider: OAuth + CloudTasks, Store: CredentialStore> Probe<Provider, Store> {
    /// Launch only into an environment visible to this connection; never retry a write.
    pub async fn launch(
        &self,
        request: &Launch,
        now: u64,
    ) -> Result<CreatedTask, rootcause::Report> {
        request.validate()?;
        let auth = self.credentials(now).await?;
        let environments = self.provider.environments(&auth).await?;
        if !environments
            .iter()
            .any(|env| env.id == request.environment.as_str())
        {
            return Err(rootcause::report!(
                "environment is not visible to this connected account; no task submitted"
            ));
        }
        self.provider.create(&auth, request).await
    }

    /// Observe a task without starting, continuing or cancelling work.
    pub async fn snapshot(
        &self,
        task: &CloudId,
        now: u64,
    ) -> Result<TaskSnapshot, rootcause::Report> {
        let auth = self.credentials(now).await?;
        self.provider.snapshot(&auth, task).await
    }
}

/// Provider turn identity, including its task-qualified `~` separator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct TurnId(String);

impl<'de> serde::Deserialize<'de> for TurnId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(<String as serde::Deserialize>::deserialize(deserializer)?)
            .map_err(serde::de::Error::custom)
    }
}

impl TurnId {
    /// Validate an opaque turn ID before placing it in a URL.
    pub fn new(value: String) -> Result<Self, rootcause::Report> {
        if value.is_empty()
            || value.len() > 512
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-~".contains(&b))
        {
            return Err(rootcause::report!("invalid cloud turn identifier"));
        }
        Ok(Self(value))
    }
    /// Borrow the validated identity.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Identified provider event; unknown methods remain available for reconciliation.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct CloudEvent {
    /// Stable outer provider event identity for replay deduplication.
    pub id: String,
    /// Provider event method, or `log` for a setup log.
    pub method: String,
    /// Structured event fields, translated by the consuming protocol adapter.
    pub params: serde_json::Value,
}

mod native;
mod snapshot;
pub use native::NativeRecord;

/// Owned event subscription; dropping it stops local observation only.
pub type CloudEventStream =
    std::pin::Pin<Box<dyn futures::Stream<Item = Result<NativeRecord, rootcause::Report>> + Send>>;

/// Continuation and observation capabilities evidenced by the official desktop client.
pub trait CloudConversation: CloudTasks {
    /// Submit one continuation, without retrying an ambiguous provider write.
    fn follow_up(
        &self,
        auth: &Credentials,
        task: &CloudId,
        turn: &TurnId,
        prompt: &str,
    ) -> impl Future<Output = Result<CreatedTask, rootcause::Report>> + Send;
    /// Request remote cancellation; callers must still verify terminal state.
    fn cancel(
        &self,
        auth: &Credentials,
        task: &CloudId,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
    /// Read a particular assistant turn, independent of the task's current selection.
    fn turn(
        &self,
        auth: &Credentials,
        task: &CloudId,
        turn: &TurnId,
    ) -> impl Future<Output = Result<TaskSnapshot, rootcause::Report>> + Send;
    /// Open a replay/live event subscription with bounded parsing and no assumed cursor.
    fn stream(
        &self,
        auth: &Credentials,
        task: &CloudId,
        turn: &TurnId,
    ) -> impl Future<Output = Result<CloudEventStream, rootcause::Report>> + Send;
}

impl<Provider: OAuth + CloudConversation, Store: CredentialStore> Probe<Provider, Store> {
    /// Continue a task using saved credentials, refreshing them before submission.
    pub async fn follow_up(
        &self,
        task: &CloudId,
        turn: &TurnId,
        prompt: &str,
        now: u64,
    ) -> Result<CreatedTask, rootcause::Report> {
        if prompt.trim().is_empty() || prompt.len() > 64 * 1024 {
            return Err(rootcause::report!(
                "provide a nonempty prompt (maximum 64 KiB)"
            ));
        }
        let auth = self.credentials(now).await?;
        self.provider.follow_up(&auth, task, turn, prompt).await
    }
    /// Request remote cancellation, without claiming it is already complete.
    pub async fn cancel(&self, task: &CloudId, now: u64) -> Result<(), rootcause::Report> {
        let auth = self.credentials(now).await?;
        self.provider.cancel(&auth, task).await
    }
    /// Read the authoritative state and final output of a particular turn.
    pub async fn turn(
        &self,
        task: &CloudId,
        turn: &TurnId,
        now: u64,
    ) -> Result<TaskSnapshot, rootcause::Report> {
        let auth = self.credentials(now).await?;
        self.provider.turn(&auth, task, turn).await
    }
    /// Subscribe using current credentials; stream EOF does not imply completion.
    pub async fn stream(
        &self,
        task: &CloudId,
        turn: &TurnId,
        now: u64,
    ) -> Result<CloudEventStream, rootcause::Report> {
        let auth = self.credentials(now).await?;
        self.provider.stream(&auth, task, turn).await
    }
}
