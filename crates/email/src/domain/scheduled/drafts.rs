//! Reads a bounded page of drafts from the caller's selected accessible inbox.

use models_email::service::message::Message;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Largest accepted scheduled-draft page.
pub const MAX_SCHEDULED_LIMIT: u32 = 1000;
/// Scheduled-draft page size when the caller omits it.
pub const DEFAULT_SCHEDULED_LIMIT: u32 = 100;

/// Stored drafts for an inbox already selected by the caller's access boundary.
pub trait ScheduledDraftRepository: Send + Sync + 'static {
    /// Original persistence failure.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Read a page in the existing creation-time order.
    fn scheduled(
        &self,
        link: Uuid,
        offset: u32,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<Message>, Self::Err>> + Send;
}

/// A scheduled page failed validation or could not be loaded.
#[derive(Debug, thiserror::Error)]
pub enum ScheduledDraftError<E> {
    /// A page must permit at least one draft.
    #[error("scheduled draft limit must be positive")]
    NonPositiveLimit,
    /// The requested page is larger than the supported maximum.
    #[error("scheduled draft limit exceeds {0}")]
    ExcessiveLimit(u32),
    /// The original query failed.
    #[error("Failed to fetch scheduled messages")]
    Query(#[source] E),
}

/// Lists scheduled drafts after validating the page size.
pub struct ScheduledDraftService<R> {
    /// Reads drafts scoped to the selected inbox.
    pub repository: R,
}

impl<R: ScheduledDraftRepository> ScheduledDraftService<R> {
    /// Read the selected accessible inbox; never expand a page to another inbox.
    pub async fn list(
        &self,
        link: Uuid,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<Message>, ScheduledDraftError<R::Err>> {
        if limit == 0 {
            return Err(ScheduledDraftError::NonPositiveLimit);
        }
        if limit > MAX_SCHEDULED_LIMIT {
            return Err(ScheduledDraftError::ExcessiveLimit(MAX_SCHEDULED_LIMIT));
        }
        self.repository
            .scheduled(link, offset, limit)
            .await
            .map_err(ScheduledDraftError::Query)
    }
}

/// Raw page reads and the existing concurrent expansion capability.
pub trait ScheduledDraftQueries: Sync {
    /// Storage rows, kept opaque to page validation and sequencing.
    type Stored: Send;
    /// Read the original page in storage order.
    fn scheduled_rows(
        &self,
        link: Uuid,
        offset: u32,
        limit: u32,
    ) -> impl Future<Output = anyhow::Result<Vec<Self::Stored>>> + Send;
    /// Use the existing message-expansion implementation.
    fn expand_rows(
        &self,
        rows: Vec<Self::Stored>,
    ) -> impl Future<Output = anyhow::Result<Vec<Message>>> + Send;
}

/// Validate and expand the stored scheduled page without changing its SQL or expansion.
#[tracing::instrument(target = "email_db_client::messages::scheduled::get", skip(pool), err)]
pub async fn get_scheduled_messages_by_link_id(
    pool: &impl ScheduledDraftQueries,
    link_id: Uuid,
    offset: u32,
    limit: u32,
) -> anyhow::Result<Vec<Message>> {
    if limit == 0 {
        anyhow::bail!("limit must be positive");
    }
    let db_messages = pool.scheduled_rows(link_id, offset, limit).await?;
    pool.expand_rows(db_messages).await
}
