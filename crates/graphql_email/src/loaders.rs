use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use email::domain::models::ParsedMessage;
use macro_user_id::user_id::MacroUserIdStr;

pub(crate) const MAX_EMAIL_CONTENT_KEYS: usize = 20;

/// Result of loading the newest non-draft content message for one email thread.
#[derive(Debug, Clone)]
pub enum EmailContentLoad {
    /// The thread has a non-draft content message.
    Found(Box<ParsedMessage>),
    /// The thread is absent, inaccessible, or has no content messages.
    Missing,
    /// An internal failure occurred. Details are logged, never exposed.
    Failed,
}

/// A request for the newest non-draft content message belonging to an email thread.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EmailContentKey {
    /// Email thread ID.
    pub thread_id: String,
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

/// DataLoader for the newest non-draft content message attached to Soup email threads.
pub struct EmailContentLoader<R> {
    user_id: MacroUserIdStr<'static>,
    reader: R,
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
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use macro_user_id::user_id::MacroUserIdStr;

    use super::*;

    #[derive(Clone, Default)]
    struct RecordingReader {
        calls: Arc<AtomicUsize>,
    }

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
        let reader = RecordingReader::default();
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
        let reader = RecordingReader::default();
        let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
        let loader = EmailContentLoader::new(user_id, reader.clone());
        let keys = (0..=MAX_EMAIL_CONTENT_KEYS).map(key).collect::<Vec<_>>();

        let error = loader.load(&keys).await.unwrap_err();

        assert_eq!(reader.calls.load(Ordering::SeqCst), 0);
        assert!(error.to_string().contains("at most 20 threads"));
    }
}
