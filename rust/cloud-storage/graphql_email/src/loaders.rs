use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use email::domain::{models::ParsedMessage, ports::EmailContentService};
use entity_access::domain::{
    models::{AccessError, AccessLevel, EntityPermission, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use futures::{StreamExt, stream};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

const MAX_CONCURRENT_ACCESS_CHECKS: usize = 8;
pub(crate) const MAX_EMAIL_CONTENT_KEYS: usize = 20;

/// Result of loading the newest non-draft content message for one email thread.
#[derive(Debug, Clone)]
pub enum EmailContentLoad {
    /// The thread has a non-draft content message.
    Found(Box<LoadedEmailContent>),
    /// The thread is absent, inaccessible, or has no content messages.
    Missing,
    /// An internal failure occurred. Details are logged, never exposed.
    Failed,
}

/// Authorized email content plus the caller's actual thread access level.
#[derive(Debug, Clone)]
pub struct LoadedEmailContent {
    pub(crate) message: ParsedMessage,
    pub(crate) access_level: AccessLevel,
}

/// A request for the newest non-draft content message belonging to an email thread.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EmailContentKey {
    /// Email thread ID.
    pub thread_id: String,
}

/// Object-safe reader used by the Soup email-content GraphQL edge.
#[async_trait::async_trait]
pub trait SoupEmailContentEdgeReader: Send + Sync + 'static {
    /// Load content for authorized threads on behalf of `user_id`.
    async fn get_email_content(
        &self,
        user_id: &MacroUserIdStr<'static>,
        keys: Vec<EmailContentKey>,
    ) -> HashMap<EmailContentKey, EmailContentLoad>;
}

/// Inbound adapter that mints view receipts and delegates content policy to
/// the email domain service.
pub struct EmailContentEdgeService<S, EAS> {
    email_service: Arc<S>,
    entity_access_service: Arc<EAS>,
}

impl<S, EAS> EmailContentEdgeService<S, EAS> {
    /// Create an email-content edge adapter from the domain services.
    pub fn new(email_service: Arc<S>, entity_access_service: Arc<EAS>) -> Self {
        Self {
            email_service,
            entity_access_service,
        }
    }
}

#[async_trait::async_trait]
impl<S, EAS> SoupEmailContentEdgeReader for EmailContentEdgeService<S, EAS>
where
    S: EmailContentService,
    EAS: EntityAccessService,
{
    async fn get_email_content(
        &self,
        user_id: &MacroUserIdStr<'static>,
        keys: Vec<EmailContentKey>,
    ) -> HashMap<EmailContentKey, EmailContentLoad> {
        let access_results = stream::iter(keys.into_iter().map(|key| async move {
            let result = self
                .entity_access_service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    user_id,
                    None,
                    &key.thread_id,
                    EntityType::EmailThread,
                )
                .await;
            (key, result)
        }))
        .buffer_unordered(MAX_CONCURRENT_ACCESS_CHECKS)
        .collect::<Vec<_>>()
        .await;

        let mut loads = HashMap::with_capacity(access_results.len());
        let mut authorized = Vec::new();
        let mut keys_by_thread_id = HashMap::new();

        for (key, access_result) in access_results {
            match access_result {
                Ok(receipt) => match Uuid::parse_str(&key.thread_id) {
                    Ok(thread_id) => {
                        let access_level = match receipt.entity_permission() {
                            EntityPermission::AccessLevel { access_level } => *access_level,
                            EntityPermission::ChannelRole { .. }
                            | EntityPermission::TeamRole { .. } => {
                                tracing::error!(thread_id = %key.thread_id, "email thread receipt carried a non-item role");
                                loads.insert(key, EmailContentLoad::Failed);
                                continue;
                            }
                        };
                        keys_by_thread_id.insert(thread_id, (key, access_level));
                        authorized.push(receipt);
                    }
                    Err(error) => {
                        tracing::error!(thread_id = %key.thread_id, ?error, "invalid authorized email thread ID");
                        loads.insert(key, EmailContentLoad::Failed);
                    }
                },
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => {
                    loads.insert(key, EmailContentLoad::Missing);
                }
                Err(error) => {
                    tracing::error!(thread_id = %key.thread_id, ?error, "email content access check failed");
                    loads.insert(key, EmailContentLoad::Failed);
                }
            }
        }

        if authorized.is_empty() {
            return loads;
        }

        match self
            .email_service
            .get_latest_messages_parsed(authorized)
            .await
        {
            Ok(mut messages) => {
                for (thread_id, (key, access_level)) in keys_by_thread_id {
                    let load =
                        messages
                            .remove(&thread_id)
                            .map_or(EmailContentLoad::Missing, |message| {
                                EmailContentLoad::Found(Box::new(LoadedEmailContent {
                                    message,
                                    access_level,
                                }))
                            });
                    loads.insert(key, load);
                }
            }
            Err(error) => {
                tracing::error!(?error, "bulk email content load failed");
                for (key, _) in keys_by_thread_id.into_values() {
                    loads.insert(key, EmailContentLoad::Failed);
                }
            }
        }

        loads
    }
}

/// DataLoader for the newest non-draft content message attached to Soup email threads.
pub struct EmailContentLoader {
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupEmailContentEdgeReader>,
}

/// Error returned when a GraphQL operation exceeds the email-content cost cap.
#[derive(Debug)]
pub struct EmailContentLoaderError {
    key_count: usize,
}

impl std::fmt::Display for EmailContentLoaderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "email content edge supports at most {MAX_EMAIL_CONTENT_KEYS} threads per operation (received {})",
            self.key_count
        )
    }
}

impl std::error::Error for EmailContentLoaderError {}

impl EmailContentLoader {
    /// Create a DataLoader scoped to the requesting user.
    pub fn new(
        user_id: MacroUserIdStr<'static>,
        reader: Arc<dyn SoupEmailContentEdgeReader>,
    ) -> Self {
        Self { user_id, reader }
    }
}

impl Loader<EmailContentKey> for EmailContentLoader {
    type Value = EmailContentLoad;
    type Error = Arc<EmailContentLoaderError>;

    async fn load(
        &self,
        keys: &[EmailContentKey],
    ) -> Result<HashMap<EmailContentKey, Self::Value>, Self::Error> {
        if keys.len() > MAX_EMAIL_CONTENT_KEYS {
            tracing::warn!(
                key_count = keys.len(),
                max_key_count = MAX_EMAIL_CONTENT_KEYS,
                "rejecting oversized Soup email content batch"
            );
            return Err(Arc::new(EmailContentLoaderError {
                key_count: keys.len(),
            }));
        }

        Ok(self
            .reader
            .get_email_content(&self.user_id, keys.to_vec())
            .await)
    }
}

/// Build an email-content DataLoader scoped to the requesting user.
pub fn email_content_loader(
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupEmailContentEdgeReader>,
) -> DataLoader<EmailContentLoader> {
    DataLoader::new(EmailContentLoader::new(user_id, reader), tokio::spawn)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[derive(Default)]
    struct RecordingReader {
        calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl SoupEmailContentEdgeReader for RecordingReader {
        async fn get_email_content(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            keys: Vec<EmailContentKey>,
        ) -> HashMap<EmailContentKey, EmailContentLoad> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            keys.into_iter()
                .map(|key| (key, EmailContentLoad::Missing))
                .collect()
        }
    }

    fn key(index: usize) -> EmailContentKey {
        EmailContentKey {
            thread_id: format!("00000000-0000-0000-0000-{index:012}"),
        }
    }

    #[tokio::test]
    async fn batches_distinct_threads_in_one_reader_call() {
        let reader = Arc::new(RecordingReader::default());
        let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
        let loader = email_content_loader(user_id, reader.clone());
        let first = key(1);
        let second = key(2);

        let loaded = loader
            .load_many(vec![first.clone(), second.clone()])
            .await
            .unwrap();

        assert_eq!(reader.calls.load(Ordering::SeqCst), 1);
        assert!(matches!(
            loaded.get(&first),
            Some(EmailContentLoad::Missing)
        ));
        assert!(matches!(
            loaded.get(&second),
            Some(EmailContentLoad::Missing)
        ));
    }

    #[tokio::test]
    async fn rejects_oversized_batches_without_calling_the_reader() {
        let reader = Arc::new(RecordingReader::default());
        let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
        let loader = EmailContentLoader::new(user_id, reader.clone());
        let keys = (0..=MAX_EMAIL_CONTENT_KEYS).map(key).collect::<Vec<_>>();

        let error = loader.load(&keys).await.unwrap_err();

        assert_eq!(reader.calls.load(Ordering::SeqCst), 0);
        assert!(error.to_string().contains("at most 20 threads"));
    }
}
