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
    #[error("memory rejected by judge: {0}")]
    Rejected(String),
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
    ) -> impl Future<Output = Result<Option<Memory>>> + Send;
}

use super::models::{Activity, ExplicitMemory};
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
    fn save_generation(
        &self,
        user: &MacroUserIdStr<'_>,
        expected: i64,
        date: NaiveDate,
        profile: &str,
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
    async fn judge(&self, user: MacroUserIdStr<'static>, content: &str) -> Result<()>;
}

/// A bounded lease prevents replicas from generating the same user's day.
#[derive(Debug)]
pub struct RefreshClaim {
    pub user: MacroUserIdStr<'static>,
    pub date: NaiveDate,
    pub token: Uuid,
}
