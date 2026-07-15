use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use email::domain::{models::ParsedMessage, ports::EmailContentService};
use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

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
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
pub struct EmailContentKey {
    /// Email thread ID.
    pub thread_id: Uuid,
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
        let thread_ids = keys
            .iter()
            .map(|key| key.thread_id.to_string())
            .collect::<Vec<_>>();
        let mut receipts = self
            .entity_access_service
            .generate_email_thread_view_access_receipts(user_id, None, &thread_ids)
            .await;

        let mut loads = HashMap::with_capacity(keys.len());
        let mut authorized = Vec::with_capacity(keys.len());
        let mut authorized_keys = HashMap::with_capacity(keys.len());

        for key in keys {
            match receipts
                .remove(&key.thread_id.to_string())
                .unwrap_or(Err(AccessError::Internal))
            {
                Ok(receipt) => {
                    authorized.push(receipt);
                    authorized_keys.insert(key.thread_id, key);
                }
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => {
                    loads.insert(key, EmailContentLoad::Missing);
                }
                Err(error) => {
                    tracing::error!(thread_id = %key.thread_id, error = ?error, "email content access check failed");
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
                for (thread_id, key) in authorized_keys {
                    let load = messages
                        .remove(&thread_id)
                        .map_or(EmailContentLoad::Missing, |message| {
                            EmailContentLoad::Found(Box::new(message))
                        });
                    loads.insert(key, load);
                }
            }
            Err(error) => {
                tracing::error!(error = ?error, "bulk email content load failed");
                loads.extend(
                    authorized_keys
                        .into_values()
                        .map(|key| (key, EmailContentLoad::Failed)),
                );
            }
        }

        loads
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
mod test;
