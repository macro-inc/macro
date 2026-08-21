use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use async_graphql::dataloader::{DataLoader, Loader};
use email::domain::{
    models::{EmailThreadMetadata, Message, ParsedMessage},
    ports::{EmailContentService, EmailThreadMetadataService},
};
use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

pub(crate) const MAX_EMAIL_CONTENT_KEYS: usize = 20;
pub(crate) const MAX_EMAIL_CONTENT_MESSAGES: usize = 100;
const MAX_EMAIL_THREAD_METADATA_KEYS: usize = 500;

/// Canonical metadata loaded for one Soup email thread.
#[derive(Debug, Clone)]
pub enum EmailThreadMetadataLoad {
    /// The canonical thread metadata was found.
    Found(EmailThreadMetadata),
    /// The thread was absent or inaccessible.
    Missing,
    /// An internal failure occurred. Details are logged, never exposed.
    Failed,
}

/// Reader used by lazy Soup email-thread metadata fields.
pub trait SoupEmailThreadMetadataEdgeReader: Send + Sync + 'static {
    /// Load canonical metadata for authorized threads on behalf of `user_id`.
    fn get_email_thread_metadata<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> impl Future<Output = HashMap<Uuid, EmailThreadMetadataLoad>> + Send + 'a;
}

/// Combined reader capability required by the complete Soup email-thread edge.
pub trait SoupEmailEdgeReader:
    SoupEmailContentEdgeReader + SoupEmailThreadMetadataEdgeReader
{
}

impl<T> SoupEmailEdgeReader for T where
    T: SoupEmailContentEdgeReader + SoupEmailThreadMetadataEdgeReader
{
}

/// A message returned by the email-content edge.
#[derive(Debug, Clone)]
pub struct EmailContentMessage {
    parsed: ParsedMessage,
    full: Option<Message>,
}

impl EmailContentMessage {
    pub(crate) fn parsed(&self) -> &ParsedMessage {
        &self.parsed
    }

    pub(crate) fn full(&self) -> Option<&Message> {
        self.full.as_ref()
    }
}

impl From<ParsedMessage> for EmailContentMessage {
    fn from(parsed: ParsedMessage) -> Self {
        Self { parsed, full: None }
    }
}

impl From<Message> for EmailContentMessage {
    fn from(full: Message) -> Self {
        Self {
            parsed: ParsedMessage::from(&full),
            full: Some(full),
        }
    }
}

/// Result of loading content messages for one email thread.
#[derive(Debug, Clone)]
pub enum EmailContentLoad {
    /// The thread has a content-message page, which may be empty.
    Found(Vec<EmailContentMessage>),
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

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
enum EmailContentHydration {
    Parsed,
    Full,
}

/// A request for content messages belonging to an email thread.
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
pub struct EmailContentKey {
    /// Email thread ID.
    pub thread_id: Uuid,
    request: EmailContentRequest,
    hydration: EmailContentHydration,
}

impl EmailContentKey {
    /// Request the newest non-draft content message for a thread.
    pub fn latest(thread_id: Uuid) -> Self {
        Self {
            thread_id,
            request: EmailContentRequest::Latest,
            hydration: EmailContentHydration::Parsed,
        }
    }

    /// Request the newest fully hydrated non-draft content message for a thread.
    pub fn latest_full(thread_id: Uuid) -> Self {
        Self {
            thread_id,
            request: EmailContentRequest::Latest,
            hydration: EmailContentHydration::Full,
        }
    }

    /// Request a paginated lightweight content-message page for a thread.
    pub fn page(thread_id: Uuid, offset: u32, limit: u32) -> Self {
        Self {
            thread_id,
            request: EmailContentRequest::Page { offset, limit },
            hydration: EmailContentHydration::Parsed,
        }
    }

    /// Request a paginated fully hydrated content-message page for a thread.
    pub fn page_full(thread_id: Uuid, offset: u32, limit: u32) -> Self {
        Self {
            thread_id,
            request: EmailContentRequest::Page { offset, limit },
            hydration: EmailContentHydration::Full,
        }
    }

    /// Whether this request requires fully hydrated messages.
    pub fn requires_full_payload(self) -> bool {
        self.hydration == EmailContentHydration::Full
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
pub trait SoupEmailContentEdgeReader:
    SoupEmailThreadMetadataEdgeReader + Send + Sync + 'static
{
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

impl SoupEmailThreadMetadataEdgeReader for NoOpSoupEmailContentEdgeReader {
    async fn get_email_thread_metadata(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> HashMap<Uuid, EmailThreadMetadataLoad> {
        thread_ids
            .into_iter()
            .map(|thread_id| (thread_id, EmailThreadMetadataLoad::Missing))
            .collect()
    }
}

/// GraphQL email-content reader backed by the email domain service and the
/// canonical entity-access service.
#[derive(Clone)]
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

impl<S, A> SoupEmailThreadMetadataEdgeReader for EmailServiceEmailContentReader<S, A>
where
    S: EmailThreadMetadataService,
    A: EntityAccessService,
{
    async fn get_email_thread_metadata(
        &self,
        user_id: &MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> HashMap<Uuid, EmailThreadMetadataLoad> {
        let thread_ids = thread_ids.into_iter().collect::<HashSet<_>>();
        let thread_id_strings = thread_ids.iter().map(Uuid::to_string).collect::<Vec<_>>();
        let mut access_results = self
            .entity_access_service
            .generate_email_thread_view_access_receipts(user_id, None, &thread_id_strings)
            .await;
        let mut loads = HashMap::with_capacity(thread_ids.len());
        let mut authorized = Vec::new();
        let mut authorized_ids = Vec::new();

        for thread_id in thread_ids {
            match access_results
                .remove(&thread_id.to_string())
                .unwrap_or(Err(AccessError::Internal))
            {
                Ok(receipt) => {
                    authorized.push(receipt);
                    authorized_ids.push(thread_id);
                }
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => {
                    loads.insert(thread_id, EmailThreadMetadataLoad::Missing);
                }
                Err(error) => {
                    tracing::error!(%thread_id, error = ?error, "email thread metadata access check failed");
                    loads.insert(thread_id, EmailThreadMetadataLoad::Failed);
                }
            }
        }

        if authorized.is_empty() {
            return loads;
        }

        match self
            .email_service
            .get_email_thread_metadata(authorized)
            .await
        {
            Ok(mut metadata) => {
                for thread_id in authorized_ids {
                    let load = metadata.remove(&thread_id).map_or(
                        EmailThreadMetadataLoad::Missing,
                        EmailThreadMetadataLoad::Found,
                    );
                    loads.insert(thread_id, load);
                }
            }
            Err(error) => {
                tracing::error!(error = ?error, "bulk email thread metadata load failed");
                loads.extend(
                    authorized_ids
                        .into_iter()
                        .map(|thread_id| (thread_id, EmailThreadMetadataLoad::Failed)),
                );
            }
        }

        loads
    }
}

impl<S, A> SoupEmailContentEdgeReader for EmailServiceEmailContentReader<S, A>
where
    S: EmailContentService + EmailThreadMetadataService,
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
        let mut latest_parsed_requests = Vec::new();
        let mut latest_full_requests = Vec::new();
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

            match (key.request, key.hydration) {
                (EmailContentRequest::Latest, EmailContentHydration::Parsed) => {
                    latest_parsed_requests.push((key, receipt));
                }
                (EmailContentRequest::Latest, EmailContentHydration::Full) => {
                    latest_full_requests.push((key, receipt));
                }
                (EmailContentRequest::Page { .. }, _) => page_requests.push((key, receipt)),
            }
        }

        if !latest_parsed_requests.is_empty() {
            let receipts = latest_parsed_requests
                .iter()
                .map(|(_, receipt)| receipt.clone())
                .collect();
            match self
                .email_service
                .get_latest_messages_parsed(receipts)
                .await
            {
                Ok(mut messages) => {
                    for (key, _) in latest_parsed_requests {
                        let load = messages
                            .remove(&key.thread_id)
                            .map_or(EmailContentLoad::Missing, |message| {
                                EmailContentLoad::Found(vec![message.into()])
                            });
                        loads.insert(key, load);
                    }
                }
                Err(error) => {
                    tracing::error!(error = ?error, "bulk latest parsed email content load failed");
                    loads.extend(
                        latest_parsed_requests
                            .into_iter()
                            .map(|(key, _)| (key, EmailContentLoad::Failed)),
                    );
                }
            }
        }

        if !latest_full_requests.is_empty() {
            let receipts = latest_full_requests
                .iter()
                .map(|(_, receipt)| receipt.clone())
                .collect();
            match self.email_service.get_latest_messages_full(receipts).await {
                Ok(mut messages) => {
                    for (key, _) in latest_full_requests {
                        let load = messages
                            .remove(&key.thread_id)
                            .map_or(EmailContentLoad::Missing, |message| {
                                EmailContentLoad::Found(vec![message.into()])
                            });
                        loads.insert(key, load);
                    }
                }
                Err(error) => {
                    tracing::error!(error = ?error, "bulk latest full email content load failed");
                    loads.extend(
                        latest_full_requests
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
                let result = match key.hydration {
                    EmailContentHydration::Parsed => email_service
                        .get_messages_parsed(receipt, offset, limit)
                        .await
                        .map(|messages| {
                            messages.map(|messages| {
                                messages
                                    .into_iter()
                                    .map(EmailContentMessage::from)
                                    .collect()
                            })
                        }),
                    EmailContentHydration::Full => email_service
                        .get_messages_full(receipt, offset, limit)
                        .await
                        .map(|messages| {
                            messages.map(|messages| {
                                messages
                                    .into_iter()
                                    .map(EmailContentMessage::from)
                                    .collect()
                            })
                        }),
                };
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

/// DataLoader for canonical metadata attached to Soup email threads.
pub struct EmailThreadMetadataLoader<R> {
    user_id: MacroUserIdStr<'static>,
    reader: R,
}

impl<R> EmailThreadMetadataLoader<R> {
    /// Create a metadata DataLoader scoped to the requesting user.
    pub fn new(user_id: MacroUserIdStr<'static>, reader: R) -> Self {
        Self { user_id, reader }
    }
}

impl<R> Loader<Uuid> for EmailThreadMetadataLoader<R>
where
    R: SoupEmailThreadMetadataEdgeReader,
{
    type Value = EmailThreadMetadataLoad;
    type Error = std::convert::Infallible;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Self::Value>, Self::Error> {
        Ok(self
            .reader
            .get_email_thread_metadata(&self.user_id, keys.to_vec())
            .await)
    }
}

/// Build a canonical email-thread metadata DataLoader scoped to the requesting user.
pub fn email_thread_metadata_loader<R>(
    user_id: MacroUserIdStr<'static>,
    reader: R,
) -> DataLoader<EmailThreadMetadataLoader<R>>
where
    R: SoupEmailThreadMetadataEdgeReader,
{
    let loader = DataLoader::new(
        EmailThreadMetadataLoader::new(user_id, reader),
        tokio::spawn,
    )
    .max_batch_size(MAX_EMAIL_THREAD_METADATA_KEYS);
    // Subscription connection data outlives one payload. Coalesce concurrent
    // fields, but do not retain mutable timestamps across update events.
    loader.enable_all_cache(false);
    loader
}

/// DataLoader for adaptively hydrated content messages attached to Soup email threads.
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
