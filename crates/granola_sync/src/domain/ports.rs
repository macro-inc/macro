use super::models::*;
use async_trait::async_trait;
use call::domain::imports::ImportedCall;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, rootcause::Report>;

/// Storage owns atomic registration, durable delivery deduplication, and leases.
#[async_trait]
pub trait SyncRepository: Send + Sync {
    async fn by_user(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Connection>>;
    async fn by_id(&self, id: Uuid) -> Result<Option<Connection>>;
    async fn reserve(&self, connection: &Connection) -> Result<bool>;
    async fn activate(&self, id: Uuid, webhook: Webhook) -> Result<bool>;
    async fn stop(&self, id: Uuid) -> Result<()>;
    async fn failed_setup(&self, id: Uuid) -> Result<()>;
    async fn enqueue(&self, id: Uuid, event: Event) -> Result<()>;
    async fn claim(&self) -> Result<Option<Job>>;
    async fn finish(&self, job: &Job, success: bool) -> Result<()>;
}

/// Provider I/O uses the user's already-verified Pipedream account.
#[async_trait]
pub trait Granola: Send + Sync {
    async fn register(&self, connection: &Connection, url: &str) -> Result<Webhook>;
    async fn unregister(&self, connection: &Connection) -> Result<()>;
    async fn meeting(&self, connection: &Connection, note: &NoteId)
    -> Result<Option<ImportedCall>>;
}

/// A credential connection is rechecked before ingesting, including after fetch.
#[async_trait]
pub trait Accounts: Send + Sync {
    async fn account(&self, user: &MacroUserIdStr<'static>) -> Result<Option<String>>;
}

pub trait DeliveryVerifier: Send + Sync {
    fn verify(&self, secret: &SigningSecret, delivery: &Delivery<'_>) -> bool;
}
