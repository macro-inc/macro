use agent::AgentError;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error(transparent)]
    AgentError(#[from] AgentError),
    #[error("memory changed; read it again before retrying the edit")]
    Conflict,
    #[error("line must refer to an existing one-based line (or the next line for insert)")]
    InvalidLine,
    #[error("memory content must be one nonempty line and the document must fit in 32000 bytes")]
    InvalidContent,
    #[error("activity date must be a completed UTC day after the last generated day")]
    InvalidDate,
    #[error("activity is only available to its owner or a current teammate")]
    Forbidden,
    #[error("Nothing was generated")]
    NoGeneration,
    #[error("memory rejected by privacy review: {0}")]
    Rejected(String),
    /// The privacy review could not run, so nothing was saved.
    #[error("memory privacy review is unavailable; try again later")]
    ReviewUnavailable,
    #[error("database error: {0}")]
    Db(rootcause::Report),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type Result<T> = std::result::Result<T, MemoryError>;

pub type Memory = String;

/// A memory record with its latest refresh timestamp.
#[derive(Debug)]
pub struct MemoryRecord {
    /// The memory text.
    pub memory: Memory,
    /// When this memory was last generated or refreshed.
    pub updated_at: DateTime<Utc>,
}

pub trait MemoryRepo: Send + Sync + 'static {
    fn save_memory(
        &self,
        memory: &Memory,
        user: MacroUserIdStr,
    ) -> impl Future<Output = Result<Uuid>> + Send;
    fn get_latest_memory(
        &self,
        user: MacroUserIdStr,
    ) -> impl Future<Output = Result<Option<MemoryRecord>>> + Send;
    fn get_memory_by_id(
        &self,
        user: MacroUserIdStr,
        id: Uuid,
    ) -> impl Future<Output = Result<Memory>> + Send;
}

pub trait MemoryService: Send + Sync + 'static {
    fn get_memory(
        &self,
        user: MacroUserIdStr<'static>,
        reader: MemoryReader,
    ) -> impl Future<Output = Result<Option<Memory>>> + Send;

    /// Private explicit memory, always read as the authenticated caller.
    fn explicit(
        &self,
        user: &MacroUserIdStr<'_>,
        reader: MemoryReader,
    ) -> impl Future<Output = Result<ExplicitMemory>> + Send;

    /// Apply one explicit edit at the caller's current revision.
    fn update_memory(
        &self,
        user: MacroUserIdStr<'static>,
        revision: i64,
        edit: &MemoryEdit,
    ) -> impl Future<Output = Result<ExplicitMemory>> + Send;

    /// Professional activity of the caller or a current teammate, inclusive dates.
    fn get_user_activity(
        &self,
        caller: MacroUserIdStr<'static>,
        user: MacroUserIdStr<'static>,
        start: NaiveDate,
        end: NaiveDate,
    ) -> impl Future<Output = Result<Vec<Activity>>> + Send;
}

use super::models::{
    Activity, ExplicitMemory, MemoryEdit, MemoryKind, MemoryReader, Piece, StagedPieces,
};
use chrono::NaiveDate;

/// A consistent generation input; profile revision guards every generated write.
#[derive(Debug, Clone, Default)]
pub struct MemorySnapshot {
    pub revision: i64,
    pub through_date: Option<NaiveDate>,
    pub first_date: Option<NaiveDate>,
    pub profile: String,
    pub activity: Vec<Activity>,
}

/// Persistent component storage. Every write is atomic and safe to retry.
pub trait ComposedMemoryRepo: MemoryRepo {
    fn enroll(&self, user: &MacroUserIdStr<'_>) -> impl Future<Output = Result<()>> + Send;
    fn claim_refresh(
        &self,
        yesterday: NaiveDate,
    ) -> impl Future<Output = Result<Option<RefreshClaim>>> + Send;
    fn release_refresh(&self, claim: &RefreshClaim) -> impl Future<Output = Result<()>> + Send;
    /// Give the claim back and keep the user out of claims for `after`.
    fn retry_refresh(
        &self,
        claim: &RefreshClaim,
        after: chrono::Duration,
    ) -> impl Future<Output = Result<()>> + Send;
    /// Reviewed pieces of `date`'s generation that a failed attempt left behind.
    fn staged(
        &self,
        user: &MacroUserIdStr<'_>,
        date: NaiveDate,
    ) -> impl Future<Output = Result<StagedPieces>> + Send;
    /// Keep one reviewed piece of `date`'s generation until it is committed.
    fn stage(
        &self,
        user: &MacroUserIdStr<'_>,
        date: NaiveDate,
        piece: &Piece,
    ) -> impl Future<Output = Result<()>> + Send;
    fn latest_activity(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Activity>>> + Send;
    fn explicit(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<ExplicitMemory>> + Send;
    fn save_explicit(
        &self,
        user: &MacroUserIdStr<'_>,
        expected: i64,
        content: &str,
    ) -> impl Future<Output = Result<ExplicitMemory>> + Send;
    fn snapshot(
        &self,
        user: &MacroUserIdStr<'_>,
        since: NaiveDate,
    ) -> impl Future<Output = Result<MemorySnapshot>> + Send;
    /// Commit `date` and drop its staged pieces. A `None` profile keeps the
    /// current one; empty `activity` moves past the day without a report.
    fn save_generation(
        &self,
        user: &MacroUserIdStr<'_>,
        expected: i64,
        date: NaiveDate,
        profile: Option<&str>,
        activity: &[Activity],
        teams: &[Uuid],
    ) -> impl Future<Output = Result<()>> + Send;
    fn profiles(
        &self,
        users: &[String],
    ) -> impl Future<Output = Result<Vec<(String, String)>>> + Send;
    fn activity(
        &self,
        user: &MacroUserIdStr<'_>,
        start: NaiveDate,
        end: NaiveDate,
    ) -> impl Future<Output = Result<Vec<Activity>>> + Send;
}

/// Current team membership; never a cached membership snapshot.
/// Object-safe because hosts inject their configured team service.
#[async_trait::async_trait]
pub trait MemoryTeams: Send + Sync {
    async fn members(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<(Uuid, Vec<String>)>>;
}

/// Whether the user did anything on a UTC day that a daily report could
/// describe; viewing alone does not count. A day without it needs no research.
/// Object-safe because hosts inject their configured activity store.
#[async_trait::async_trait]
pub trait MemoryActivity: Send + Sync {
    async fn acted_on(&self, user: &MacroUserIdStr<'_>, date: NaiveDate) -> Result<bool>;
}

/// Model calls live in an outbound adapter. Research is limited to read tools.
/// Object-safe so the service is independent of a host's tool context type.
#[async_trait::async_trait]
pub trait MemoryGenerator: Send + Sync {
    async fn research(&self, user: MacroUserIdStr<'static>, instructions: &str) -> Result<String>;
    async fn summarize(
        &self,
        user: MacroUserIdStr<'static>,
        instructions: &str,
        sources: &str,
    ) -> Result<String>;
}

/// Privacy review of content before it is saved. It fails closed: content is
/// saved only when the review returns `Ok`.
/// Object-safe because hosts inject their configured classifier.
#[async_trait::async_trait]
pub trait MemoryJudge: Send + Sync {
    async fn review(
        &self,
        user: MacroUserIdStr<'static>,
        kind: MemoryKind,
        content: &str,
    ) -> Result<()>;
}

/// A bounded lease prevents replicas from generating the same user's day.
#[derive(Debug)]
pub struct RefreshClaim {
    pub user: MacroUserIdStr<'static>,
    pub date: NaiveDate,
    pub token: Uuid,
    /// Which claim of `date` this is, starting at 1.
    pub attempt: u8,
}
