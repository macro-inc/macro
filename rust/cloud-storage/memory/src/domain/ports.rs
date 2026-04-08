use ai::types::AiError;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error(transparent)]
    AiError(#[from] AiError),
    #[error("Nothing was generated")]
    NoGeneration,
    #[error("memory rejected by judge: {0}")]
    Rejected(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
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
    fn get_or_generate_memory(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Memory>>> + Send;
}
