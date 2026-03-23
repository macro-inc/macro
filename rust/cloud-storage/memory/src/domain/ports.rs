use ai::types::AiError;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error("not implemented")]
    Todo,
    #[error("ai error")]
    AiError(#[from] AiError),
    #[error("memory message was not generated")]
    NoMemory,
    #[error("memory rejected by judge: {0}")]
    Rejected(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type Result<T> = std::result::Result<T, MemoryError>;

pub type Memory = String;

pub trait MemoryRepo: Send + Sync + 'static {
    fn save_memory(
        &self,
        memory: &Memory,
        user: MacroUserIdStr,
    ) -> impl Future<Output = Result<Uuid>> + Send;
    fn get_latest_memory(
        &self,
        user: MacroUserIdStr,
    ) -> impl Future<Output = Result<Memory>> + Send;
    fn get_memory_by_id(
        &self,
        user: MacroUserIdStr,
        id: Uuid,
    ) -> impl Future<Output = Result<Memory>> + Send;
}

pub trait MemoryService {
    fn generate_memory(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Memory>>;
    fn get_latest_memory(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Memory>>;
}
