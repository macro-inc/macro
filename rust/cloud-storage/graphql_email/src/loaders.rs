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
        let thread_ids = keys
            .iter()
            .map(|key| key.thread_id.clone())
            .collect::<Vec<_>>();
        let mut receipts = self
            .entity_access_service
            .generate_email_thread_view_access_receipts(user_id, None, &thread_ids)
            .await;
        let access_results = keys.into_iter().map(|key| {
            let result = receipts
                .remove(&key.thread_id)
                .unwrap_or(Err(AccessError::Internal));
            (key, result)
        });

        let mut loads = HashMap::with_capacity(access_results.len());
        let mut authorized = Vec::new();
        let mut keys_by_thread_id = HashMap::new();

        for (key, access_result) in access_results {
            match access_result {
                Ok(receipt) => match Uuid::parse_str(&key.thread_id) {
                    Ok(thread_id) => {
                        keys_by_thread_id.insert(thread_id, key);
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
                for (thread_id, key) in keys_by_thread_id {
                    let load = messages
                        .remove(&thread_id)
                        .map_or(EmailContentLoad::Missing, |message| {
                            EmailContentLoad::Found(Box::new(message))
                        });
                    loads.insert(key, load);
                }
            }
            Err(error) => {
                tracing::error!(?error, "bulk email content load failed");
                for key in keys_by_thread_id.into_values() {
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

    use email::domain::models::EmailErr;
    use entity_access::domain::models::{
        AccessLevel, CallChannelInfo, EntityAccessReceipt, EntityPermission, EntityType,
        RequiredPermission, UserTeamInfo, ViewAccessLevel,
    };
    use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

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

    #[derive(Clone)]
    struct TestAccessService {
        allow: bool,
    }

    impl EntityAccessService for TestAccessService {
        async fn generate_entity_access_receipt<T: RequiredPermission>(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
            _user_org_id: Option<i64>,
            entity_id: &str,
            entity_type: EntityType,
        ) -> Result<EntityAccessReceipt<T>, AccessError> {
            if !self.allow {
                return Err(AccessError::Unauthorized);
            }
            Ok(EntityAccessReceipt::dangerously_assert_authenticated_user(
                MacroUserIdStr::try_from_email("reader@example.com").unwrap(),
                entity_id,
                entity_type,
            ))
        }

        async fn get_access_level(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<Option<AccessLevel>, AccessError> {
            Err(AccessError::Internal)
        }

        async fn check_access(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> Result<AccessLevel, AccessError> {
            Err(AccessError::Internal)
        }

        async fn check_public_access(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> Result<AccessLevel, AccessError> {
            Err(AccessError::Internal)
        }

        async fn get_entity_permission(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _user_org_id: Option<i64>,
        ) -> Result<EntityPermission, AccessError> {
            Err(AccessError::Internal)
        }

        async fn get_crm_entity_permission_with_team(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<(EntityPermission, Uuid), AccessError> {
            Err(AccessError::Internal)
        }

        async fn get_users_by_entity(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
            Err(AccessError::Internal)
        }

        async fn get_call_channel(
            &self,
            _call_id: &Uuid,
        ) -> Result<Option<CallChannelInfo>, AccessError> {
            Err(AccessError::Internal)
        }

        async fn get_call_channel_by_channel_id(
            &self,
            _channel_id: &Uuid,
        ) -> Result<Option<CallChannelInfo>, AccessError> {
            Err(AccessError::Internal)
        }

        async fn get_user_team(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
        ) -> Result<Option<UserTeamInfo>, AccessError> {
            Err(AccessError::Internal)
        }
    }

    #[derive(Default)]
    struct RecordingContentService {
        calls: AtomicUsize,
    }

    impl EmailContentService for RecordingContentService {
        async fn get_latest_messages_parsed(
            &self,
            _receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
        ) -> Result<HashMap<Uuid, ParsedMessage>, EmailErr> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(HashMap::new())
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

    #[tokio::test]
    async fn authorized_keys_reach_the_email_domain() {
        let content = Arc::new(RecordingContentService::default());
        let service = EmailContentEdgeService::new(
            content.clone(),
            Arc::new(TestAccessService { allow: true }),
        );
        let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
        let requested = key(1);

        let loaded = service
            .get_email_content(&user_id, vec![requested.clone()])
            .await;

        assert_eq!(content.calls.load(Ordering::SeqCst), 1);
        assert!(matches!(
            loaded.get(&requested),
            Some(EmailContentLoad::Missing)
        ));
    }

    #[tokio::test]
    async fn unauthorized_keys_do_not_reach_the_email_domain() {
        let content = Arc::new(RecordingContentService::default());
        let service = EmailContentEdgeService::new(
            content.clone(),
            Arc::new(TestAccessService { allow: false }),
        );
        let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
        let requested = key(1);

        let loaded = service
            .get_email_content(&user_id, vec![requested.clone()])
            .await;

        assert_eq!(content.calls.load(Ordering::SeqCst), 0);
        assert!(matches!(
            loaded.get(&requested),
            Some(EmailContentLoad::Missing)
        ));
    }
}
