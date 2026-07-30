use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use async_graphql::dataloader::{DataLoader, Loader};
use email::domain::{models::ParsedMessage, ports::EmailContentService};
use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

pub(crate) const MAX_EMAIL_CONTENT_KEYS: usize = 20;
pub(crate) const MAX_EMAIL_CONTENT_MESSAGES: usize = 100;

/// Result of loading parsed content messages for one email thread.
#[derive(Debug, Clone)]
pub enum EmailContentLoad {
    /// The thread has a parsed content-message page, which may be empty.
    Found(Vec<ParsedMessage>),
    /// The thread is absent or inaccessible.
    Missing,
    /// An internal failure occurred. Details are logged, never exposed.
    Failed,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
enum EmailContentRequest {
    Latest,
    Page { offset: u32, limit: u32 },
}

/// A request for parsed content messages belonging to an email thread.
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
pub struct EmailContentKey {
    /// Email thread ID.
    pub thread_id: Uuid,
    request: EmailContentRequest,
}

impl EmailContentKey {
    /// Request the newest non-draft content message for a thread.
    pub fn latest(thread_id: Uuid) -> Self {
        Self {
            thread_id,
            request: EmailContentRequest::Latest,
        }
    }

    /// Request a paginated content-message page for a thread.
    pub fn page(thread_id: Uuid, offset: u32, limit: u32) -> Self {
        Self {
            thread_id,
            request: EmailContentRequest::Page { offset, limit },
        }
    }

    fn requested_message_count(self) -> usize {
        match self.request {
            EmailContentRequest::Latest => 1,
            EmailContentRequest::Page { limit, .. } => limit as usize,
        }
    }

    fn page_params(self) -> Option<(i64, i64)> {
        match self.request {
            EmailContentRequest::Latest => None,
            EmailContentRequest::Page { offset, limit } => {
                Some((i64::from(offset), i64::from(limit)))
            }
        }
    }
}

/// Reader used by the Soup email-content GraphQL edge.
pub trait SoupEmailContentEdgeReader: Send + Sync + 'static {
    /// Load content for authorized threads on behalf of `user_id`.
    fn get_email_content<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
        keys: Vec<EmailContentKey>,
    ) -> impl Future<Output = HashMap<EmailContentKey, EmailContentLoad>> + Send + 'a;
}

/// Schema-only reader that treats every thread as missing.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpSoupEmailContentEdgeReader;

impl SoupEmailContentEdgeReader for NoOpSoupEmailContentEdgeReader {
    async fn get_email_content(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        keys: Vec<EmailContentKey>,
    ) -> HashMap<EmailContentKey, EmailContentLoad> {
        keys.into_iter()
            .map(|key| (key, EmailContentLoad::Missing))
            .collect()
    }
}

/// GraphQL email-content reader backed by the email domain service and the
/// canonical entity-access service.
pub struct EmailServiceEmailContentReader<S, A> {
    email_service: Arc<S>,
    entity_access_service: Arc<A>,
}

impl<S, A> EmailServiceEmailContentReader<S, A> {
    /// Create an email-content reader from services supplied by the application
    /// composition root.
    pub fn new(email_service: Arc<S>, entity_access_service: Arc<A>) -> Self {
        Self {
            email_service,
            entity_access_service,
        }
    }
}

impl<S, A> SoupEmailContentEdgeReader for EmailServiceEmailContentReader<S, A>
where
    S: EmailContentService,
    A: EntityAccessService,
{
    async fn get_email_content(
        &self,
        user_id: &MacroUserIdStr<'static>,
        keys: Vec<EmailContentKey>,
    ) -> HashMap<EmailContentKey, EmailContentLoad> {
        let thread_ids = keys.iter().map(|key| key.thread_id).collect::<HashSet<_>>();
        let thread_id_strings = thread_ids.iter().map(Uuid::to_string).collect::<Vec<_>>();
        let mut access_results = self
            .entity_access_service
            .generate_email_thread_view_access_receipts(user_id, None, &thread_id_strings)
            .await;

        let mut authorized = HashMap::with_capacity(thread_ids.len());
        let mut missing = HashSet::new();
        let mut failed = HashSet::new();

        for thread_id in thread_ids {
            match access_results
                .remove(&thread_id.to_string())
                .unwrap_or(Err(AccessError::Internal))
            {
                Ok(receipt) => {
                    authorized.insert(thread_id, receipt);
                }
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => {
                    missing.insert(thread_id);
                }
                Err(error) => {
                    tracing::error!(%thread_id, error = ?error, "email content access check failed");
                    failed.insert(thread_id);
                }
            }
        }

        let mut loads = HashMap::with_capacity(keys.len());
        let mut latest_requests = Vec::new();
        let mut page_requests = Vec::new();

        for key in keys {
            let Some(receipt) = authorized.get(&key.thread_id).cloned() else {
                let load = if missing.contains(&key.thread_id) {
                    EmailContentLoad::Missing
                } else {
                    debug_assert!(failed.contains(&key.thread_id));
                    EmailContentLoad::Failed
                };
                loads.insert(key, load);
                continue;
            };

            match key.request {
                EmailContentRequest::Latest => latest_requests.push((key, receipt)),
                EmailContentRequest::Page { .. } => page_requests.push((key, receipt)),
            }
        }

        if !latest_requests.is_empty() {
            let receipts = latest_requests
                .iter()
                .map(|(_, receipt)| receipt.clone())
                .collect();
            match self
                .email_service
                .get_latest_messages_parsed(receipts)
                .await
            {
                Ok(mut messages) => {
                    for (key, _) in latest_requests {
                        let load = messages
                            .remove(&key.thread_id)
                            .map_or(EmailContentLoad::Missing, |message| {
                                EmailContentLoad::Found(vec![message])
                            });
                        loads.insert(key, load);
                    }
                }
                Err(error) => {
                    tracing::error!(error = ?error, "bulk latest email content load failed");
                    loads.extend(
                        latest_requests
                            .into_iter()
                            .map(|(key, _)| (key, EmailContentLoad::Failed)),
                    );
                }
            }
        }

        let page_results = join_all(page_requests.into_iter().map(|(key, receipt)| {
            let email_service = Arc::clone(&self.email_service);
            async move {
                let (offset, limit) = key
                    .page_params()
                    .expect("page requests always have pagination parameters");
                let result = email_service
                    .get_messages_parsed(receipt, offset, limit)
                    .await;
                (key, offset, limit, result)
            }
        }))
        .await;

        for (key, offset, limit, result) in page_results {
            let load = match result {
                Ok(Some(messages)) => EmailContentLoad::Found(messages),
                Ok(None) => EmailContentLoad::Missing,
                Err(error) => {
                    tracing::error!(
                        thread_id = %key.thread_id,
                        offset,
                        limit,
                        error = ?error,
                        "paginated email content load failed"
                    );
                    EmailContentLoad::Failed
                }
            };
            loads.insert(key, load);
        }

        loads
    }
}

/// DataLoader for parsed content messages attached to Soup email threads.
pub struct EmailContentLoader<R> {
    user_id: MacroUserIdStr<'static>,
    reader: R,
}

/// Error returned when a GraphQL operation exceeds the email-content cost cap.
#[derive(Debug)]
pub struct EmailContentLoaderError {
    key_count: usize,
    message_count: usize,
}

impl std::fmt::Display for EmailContentLoaderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.key_count > MAX_EMAIL_CONTENT_KEYS {
            return write!(
                formatter,
                "email content edge supports at most {MAX_EMAIL_CONTENT_KEYS} requests per operation (received {})",
                self.key_count
            );
        }

        write!(
            formatter,
            "email content edge supports at most {MAX_EMAIL_CONTENT_MESSAGES} requested messages per operation (received {})",
            self.message_count
        )
    }
}

impl std::error::Error for EmailContentLoaderError {}

impl<R> EmailContentLoader<R> {
    /// Create a DataLoader scoped to the requesting user.
    pub fn new(user_id: MacroUserIdStr<'static>, reader: R) -> Self {
        Self { user_id, reader }
    }
}

impl<R> Loader<EmailContentKey> for EmailContentLoader<R>
where
    R: SoupEmailContentEdgeReader,
{
    type Value = EmailContentLoad;
    type Error = Arc<EmailContentLoaderError>;

    async fn load(
        &self,
        keys: &[EmailContentKey],
    ) -> Result<HashMap<EmailContentKey, Self::Value>, Self::Error> {
        let message_count = keys.iter().map(|key| key.requested_message_count()).sum();
        if keys.len() > MAX_EMAIL_CONTENT_KEYS || message_count > MAX_EMAIL_CONTENT_MESSAGES {
            tracing::warn!(
                key_count = keys.len(),
                message_count,
                max_key_count = MAX_EMAIL_CONTENT_KEYS,
                max_message_count = MAX_EMAIL_CONTENT_MESSAGES,
                "rejecting oversized Soup email content batch"
            );
            return Err(Arc::new(EmailContentLoaderError {
                key_count: keys.len(),
                message_count,
            }));
        }

        Ok(self
            .reader
            .get_email_content(&self.user_id, keys.to_vec())
            .await)
    }
}

/// Build an email-content DataLoader scoped to the requesting user.
pub fn email_content_loader<R>(
    user_id: MacroUserIdStr<'static>,
    reader: R,
) -> DataLoader<EmailContentLoader<R>>
where
    R: SoupEmailContentEdgeReader,
{
    DataLoader::new(EmailContentLoader::new(user_id, reader), tokio::spawn)
}

#[cfg(test)]
mod test;
