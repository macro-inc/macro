use entity_access::domain::models::TeamRole;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use email::domain::{
    models::{EmailErr, EmailThreadMetadata},
    ports::EmailThreadMetadataService,
};
use entity_access::domain::{
    models::{
        AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt, EntityPermission,
        EntityType, RequiredPermission, UserTeamInfo, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};

use super::*;

#[derive(Clone, Default)]
struct RecordingReader {
    calls: Arc<AtomicUsize>,
    metadata_calls: Arc<AtomicUsize>,
    metadata_batches: Arc<Mutex<Vec<Vec<Uuid>>>>,
}

impl SoupEmailThreadMetadataEdgeReader for RecordingReader {
    async fn get_email_thread_metadata(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> HashMap<Uuid, EmailThreadMetadataLoad> {
        self.metadata_calls.fetch_add(1, Ordering::SeqCst);
        self.metadata_batches
            .lock()
            .unwrap()
            .push(thread_ids.clone());
        thread_ids
            .into_iter()
            .map(|thread_id| {
                (
                    thread_id,
                    EmailThreadMetadataLoad::Found(EmailThreadMetadata {
                        thread_id,
                        link_id: Uuid::from_u128(100 + thread_id.as_u128()),
                        latest_inbound_message_ts: None,
                    }),
                )
            })
            .collect()
    }
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

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
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
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
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
    metadata_calls: AtomicUsize,
    latest_calls: AtomicUsize,
    latest_full_calls: AtomicUsize,
    page_calls: AtomicUsize,
    page_full_calls: AtomicUsize,
    pagination: Mutex<Vec<(i64, i64)>>,
}

impl EmailThreadMetadataService for RecordingContentService {
    async fn get_email_thread_metadata(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<HashMap<Uuid, EmailThreadMetadata>, EmailErr> {
        self.metadata_calls.fetch_add(1, Ordering::SeqCst);
        Ok(receipts
            .into_iter()
            .map(|receipt| {
                let thread_id = Uuid::parse_str(&receipt.entity().entity_id).unwrap();
                (
                    thread_id,
                    EmailThreadMetadata {
                        thread_id,
                        link_id: Uuid::from_u128(500 + thread_id.as_u128()),
                        latest_inbound_message_ts: None,
                    },
                )
            })
            .collect())
    }
}

impl EmailContentService for RecordingContentService {
    async fn get_latest_messages_parsed(
        &self,
        _receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<HashMap<Uuid, ParsedMessage>, EmailErr> {
        self.latest_calls.fetch_add(1, Ordering::SeqCst);
        Ok(HashMap::new())
    }

    async fn get_latest_messages_full(
        &self,
        _receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<HashMap<Uuid, Message>, EmailErr> {
        self.latest_full_calls.fetch_add(1, Ordering::SeqCst);
        Ok(HashMap::new())
    }

    async fn get_messages_parsed(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> Result<Option<Vec<ParsedMessage>>, EmailErr> {
        self.page_calls.fetch_add(1, Ordering::SeqCst);
        self.pagination.lock().unwrap().push((offset, limit));
        Ok(Some(Vec::new()))
    }

    async fn get_messages_full(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> Result<Option<Vec<Message>>, EmailErr> {
        self.page_full_calls.fetch_add(1, Ordering::SeqCst);
        self.pagination.lock().unwrap().push((offset, limit));
        Ok(Some(Vec::new()))
    }
}

fn key(index: usize) -> EmailContentKey {
    EmailContentKey::latest(Uuid::from_u128(index as u128))
}

#[tokio::test]
async fn batches_distinct_threads_in_one_reader_call() {
    let reader = RecordingReader::default();
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let loader = email_content_loader(user_id, reader.clone());
    let first = key(1);
    let second = key(2);

    let loaded = loader.load_many(vec![first, second]).await.unwrap();

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
async fn batches_email_thread_metadata_in_one_reader_call() {
    let reader = RecordingReader::default();
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let loader = email_thread_metadata_loader(user_id, reader.clone());
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);

    let loaded = loader.load_many(vec![first, second]).await.unwrap();

    assert_eq!(reader.metadata_calls.load(Ordering::SeqCst), 1);
    let mut batches = reader.metadata_batches.lock().unwrap().clone();
    assert_eq!(batches.len(), 1);
    batches[0].sort();
    assert_eq!(batches[0], vec![first, second]);
    assert!(matches!(
        loaded.get(&first),
        Some(EmailThreadMetadataLoad::Found(metadata))
            if metadata.link_id == Uuid::from_u128(101)
    ));
    assert!(matches!(
        loaded.get(&second),
        Some(EmailThreadMetadataLoad::Found(metadata))
            if metadata.link_id == Uuid::from_u128(102)
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
    assert!(error.to_string().contains("at most 20 requests"));
}

#[tokio::test]
async fn rejects_excessive_requested_messages_without_calling_the_reader() {
    let reader = RecordingReader::default();
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let loader = EmailContentLoader::new(user_id, reader.clone());
    let keys = vec![
        EmailContentKey::page(Uuid::from_u128(1), 0, 51),
        EmailContentKey::page(Uuid::from_u128(2), 0, 50),
    ];

    let error = loader.load(&keys).await.unwrap_err();

    assert_eq!(reader.calls.load(Ordering::SeqCst), 0);
    assert!(error.to_string().contains("at most 100 requested messages"));
}

#[tokio::test]
async fn authorized_keys_reach_the_email_domain() {
    let content = Arc::new(RecordingContentService::default());
    let reader = EmailServiceEmailContentReader::new(
        content.clone(),
        Arc::new(TestAccessService { allow: true }),
    );
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let requested = key(1);

    let loaded = reader.get_email_content(&user_id, vec![requested]).await;

    assert_eq!(content.latest_calls.load(Ordering::SeqCst), 1);
    assert_eq!(content.latest_full_calls.load(Ordering::SeqCst), 0);
    assert!(matches!(
        loaded.get(&requested),
        Some(EmailContentLoad::Missing)
    ));
}

#[tokio::test]
async fn authorized_metadata_keys_reach_the_email_domain_in_bulk() {
    let content = Arc::new(RecordingContentService::default());
    let reader = EmailServiceEmailContentReader::new(
        content.clone(),
        Arc::new(TestAccessService { allow: true }),
    );
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);

    let loaded = reader
        .get_email_thread_metadata(&user_id, vec![first, second])
        .await;

    assert_eq!(content.metadata_calls.load(Ordering::SeqCst), 1);
    assert!(matches!(
        loaded.get(&first),
        Some(EmailThreadMetadataLoad::Found(metadata)) if metadata.thread_id == first
    ));
    assert!(matches!(
        loaded.get(&second),
        Some(EmailThreadMetadataLoad::Found(metadata)) if metadata.thread_id == second
    ));
}

#[tokio::test]
async fn unauthorized_metadata_keys_do_not_reach_the_email_domain() {
    let content = Arc::new(RecordingContentService::default());
    let reader = EmailServiceEmailContentReader::new(
        content.clone(),
        Arc::new(TestAccessService { allow: false }),
    );
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let requested = Uuid::from_u128(1);

    let loaded = reader
        .get_email_thread_metadata(&user_id, vec![requested])
        .await;

    assert_eq!(content.metadata_calls.load(Ordering::SeqCst), 0);
    assert!(matches!(
        loaded.get(&requested),
        Some(EmailThreadMetadataLoad::Missing)
    ));
}

#[tokio::test]
async fn paginated_keys_forward_offset_and_limit_to_the_email_domain() {
    let content = Arc::new(RecordingContentService::default());
    let reader = EmailServiceEmailContentReader::new(
        content.clone(),
        Arc::new(TestAccessService { allow: true }),
    );
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let requested = EmailContentKey::page(Uuid::from_u128(1), 7, 9);

    let loaded = reader.get_email_content(&user_id, vec![requested]).await;

    assert_eq!(content.latest_calls.load(Ordering::SeqCst), 0);
    assert_eq!(content.latest_full_calls.load(Ordering::SeqCst), 0);
    assert_eq!(content.page_calls.load(Ordering::SeqCst), 1);
    assert_eq!(content.page_full_calls.load(Ordering::SeqCst), 0);
    assert_eq!(*content.pagination.lock().unwrap(), vec![(7, 9)]);
    assert!(matches!(
        loaded.get(&requested),
        Some(EmailContentLoad::Found(messages)) if messages.is_empty()
    ));
}

#[tokio::test]
async fn full_keys_use_only_the_full_email_domain_path() {
    let content = Arc::new(RecordingContentService::default());
    let reader = EmailServiceEmailContentReader::new(
        content.clone(),
        Arc::new(TestAccessService { allow: true }),
    );
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let latest = EmailContentKey::latest_full(Uuid::from_u128(1));
    let page = EmailContentKey::page_full(Uuid::from_u128(2), 4, 6);

    let loaded = reader.get_email_content(&user_id, vec![latest, page]).await;

    assert_eq!(content.latest_calls.load(Ordering::SeqCst), 0);
    assert_eq!(content.latest_full_calls.load(Ordering::SeqCst), 1);
    assert_eq!(content.page_calls.load(Ordering::SeqCst), 0);
    assert_eq!(content.page_full_calls.load(Ordering::SeqCst), 1);
    assert_eq!(*content.pagination.lock().unwrap(), vec![(4, 6)]);
    assert!(matches!(
        loaded.get(&latest),
        Some(EmailContentLoad::Missing)
    ));
    assert!(matches!(
        loaded.get(&page),
        Some(EmailContentLoad::Found(messages)) if messages.is_empty()
    ));
}

#[tokio::test]
async fn unauthorized_keys_do_not_reach_the_email_domain() {
    let content = Arc::new(RecordingContentService::default());
    let reader = EmailServiceEmailContentReader::new(
        content.clone(),
        Arc::new(TestAccessService { allow: false }),
    );
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let requested = key(1);

    let loaded = reader.get_email_content(&user_id, vec![requested]).await;

    assert_eq!(content.metadata_calls.load(Ordering::SeqCst), 0);
    assert_eq!(content.latest_calls.load(Ordering::SeqCst), 0);
    assert_eq!(content.latest_full_calls.load(Ordering::SeqCst), 0);
    assert_eq!(content.page_calls.load(Ordering::SeqCst), 0);
    assert_eq!(content.page_full_calls.load(Ordering::SeqCst), 0);
    assert!(matches!(
        loaded.get(&requested),
        Some(EmailContentLoad::Missing)
    ));
}
