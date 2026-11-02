use entity_access::domain::models::TeamRole;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use email::domain::{
    models::{
        EmailErr, EmailThreadMailCacheFacts, EmailThreadMailPreviews, EmailThreadMailProjection,
        EmailThreadMetadata,
    },
    ports::{EmailThreadMailProjectionService, EmailThreadMetadataService},
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
    mail_projection_calls: Arc<AtomicUsize>,
}

fn mail_projection(thread_id: Uuid) -> EmailThreadMailProjection {
    EmailThreadMailProjection {
        thread_id,
        cache_facts: EmailThreadMailCacheFacts {
            latest_non_spam_message_ts: None,
            latest_outbound_message_ts: None,
            has_calendar_attachment: false,
            has_thread_share: false,
        },
        draft_state: None,
        previews: EmailThreadMailPreviews {
            all: None,
            draft: None,
            sent: None,
        },
    }
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
                        has_received_mail: true,
                        latest_inbound_message_ts: None,
                        latest_outbound_message_ts: None,
                        latest_non_spam_message_ts: None,
                        reminder_returned_at: None,
                    }),
                )
            })
            .collect()
    }
}

impl SoupEmailThreadMailProjectionEdgeReader for RecordingReader {
    async fn get_email_thread_mail_projections(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> HashMap<Uuid, EmailThreadMailProjectionLoad> {
        self.mail_projection_calls.fetch_add(1, Ordering::SeqCst);
        thread_ids
            .into_iter()
            .map(|thread_id| {
                (
                    thread_id,
                    EmailThreadMailProjectionLoad::Found(Arc::new(mail_projection(thread_id))),
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
        Err(AccessError::internal("test access failure"))
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }
}

#[derive(Default)]
struct RecordingContentService {
    metadata_calls: AtomicUsize,
    mail_projection_calls: AtomicUsize,
    latest_calls: AtomicUsize,
    latest_full_calls: AtomicUsize,
    page_calls: AtomicUsize,
    page_full_calls: AtomicUsize,
    pagination: Mutex<Vec<(i64, i64)>>,
    /// Return no metadata rows, as for an authorized thread the email
    /// service has no row for.
    no_metadata_rows: bool,
}

impl EmailThreadMetadataService for RecordingContentService {
    async fn get_email_thread_metadata(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<HashMap<Uuid, EmailThreadMetadata>, EmailErr> {
        self.metadata_calls.fetch_add(1, Ordering::SeqCst);
        if self.no_metadata_rows {
            return Ok(HashMap::new());
        }
        Ok(receipts
            .into_iter()
            .map(|receipt| {
                let thread_id = Uuid::parse_str(&receipt.entity().entity_id).unwrap();
                (
                    thread_id,
                    EmailThreadMetadata {
                        thread_id,
                        link_id: Uuid::from_u128(500 + thread_id.as_u128()),
                        has_received_mail: true,
                        latest_inbound_message_ts: None,
                        latest_outbound_message_ts: None,
                        latest_non_spam_message_ts: None,
                        reminder_returned_at: None,
                    },
                )
            })
            .collect())
    }
}

impl EmailThreadMailProjectionService for RecordingContentService {
    async fn get_email_thread_mail_projections(
        &self,
        _viewer: MacroUserIdStr<'static>,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<HashMap<Uuid, EmailThreadMailProjection>, EmailErr> {
        self.mail_projection_calls.fetch_add(1, Ordering::SeqCst);
        Ok(receipts
            .into_iter()
            .map(|receipt| {
                let thread_id = Uuid::parse_str(&receipt.entity().entity_id).unwrap();
                (thread_id, mail_projection(thread_id))
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
    let loader = email_thread_metadata_loader(user_id, None, reader.clone());
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
async fn batches_email_thread_mail_projections_in_one_reader_call() {
    let reader = RecordingReader::default();
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let loader = email_thread_mail_projection_loader(user_id, None, reader.clone());
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);

    let loaded = loader.load_many(vec![first, second]).await.unwrap();

    assert_eq!(reader.mail_projection_calls.load(Ordering::SeqCst), 1);
    assert!(matches!(
        loaded.get(&first),
        Some(EmailThreadMailProjectionLoad::Found(projection))
            if projection.thread_id == first
    ));
    assert!(matches!(
        loaded.get(&second),
        Some(EmailThreadMailProjectionLoad::Found(projection))
            if projection.thread_id == second
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
async fn authorized_mail_projection_keys_reach_the_email_domain_in_bulk() {
    let content = Arc::new(RecordingContentService::default());
    let reader = EmailServiceEmailContentReader::new(
        content.clone(),
        Arc::new(TestAccessService { allow: true }),
    );
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);

    let loaded = reader
        .get_email_thread_mail_projections(&user_id, vec![first, second])
        .await;

    assert_eq!(content.mail_projection_calls.load(Ordering::SeqCst), 1);
    assert!(matches!(
        loaded.get(&first),
        Some(EmailThreadMailProjectionLoad::Found(projection)) if projection.thread_id == first
    ));
    assert!(matches!(
        loaded.get(&second),
        Some(EmailThreadMailProjectionLoad::Found(projection)) if projection.thread_id == second
    ));
}

#[tokio::test]
async fn unauthorized_mail_projection_keys_do_not_reach_the_email_domain() {
    let content = Arc::new(RecordingContentService::default());
    let reader = EmailServiceEmailContentReader::new(
        content.clone(),
        Arc::new(TestAccessService { allow: false }),
    );
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let requested = Uuid::from_u128(1);

    let loaded = reader
        .get_email_thread_mail_projections(&user_id, vec![requested])
        .await;

    assert_eq!(content.mail_projection_calls.load(Ordering::SeqCst), 0);
    assert!(matches!(
        loaded.get(&requested),
        Some(EmailThreadMailProjectionLoad::Unavailable(
            EmailThreadUnavailable::NoAccess
        ))
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
        Some(EmailThreadMetadataLoad::Unavailable(
            EmailThreadUnavailable::NoAccess
        ))
    ));
}

#[tokio::test]
async fn authorized_threads_without_a_metadata_row_report_no_row() {
    let content = Arc::new(RecordingContentService {
        no_metadata_rows: true,
        ..Default::default()
    });
    let reader =
        EmailServiceEmailContentReader::new(content, Arc::new(TestAccessService { allow: true }));
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let requested = Uuid::from_u128(1);

    let loaded = reader
        .get_email_thread_metadata(&user_id, vec![requested])
        .await;

    assert!(matches!(
        loaded.get(&requested),
        Some(EmailThreadMetadataLoad::Unavailable(
            EmailThreadUnavailable::NoRow
        ))
    ));
}

#[derive(Clone, Default)]
struct CapturedLogs(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for CapturedLogs {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl CapturedLogs {
    fn text(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

#[tokio::test]
async fn unavailable_threads_are_logged_in_the_request_span_with_the_reason_and_opaque_viewer() {
    let logs = CapturedLogs::default();
    let writer = logs.clone();
    let _guard = tracing::subscriber::set_default(
        tracing_subscriber::fmt()
            .with_ansi(false)
            .with_writer(move || writer.clone())
            .finish(),
    );
    tracing::callsite::rebuild_interest_cache();
    let denying_reader = || {
        EmailServiceEmailContentReader::new(
            Arc::new(RecordingContentService::default()),
            Arc::new(TestAccessService { allow: false }),
        )
    };
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let viewer_id = Uuid::from_u128(77);
    let thread_id = Uuid::from_u128(1);
    let metadata_loader =
        email_thread_metadata_loader(user_id.clone(), Some(viewer_id), denying_reader());
    let projection_loader =
        email_thread_mail_projection_loader(user_id, Some(viewer_id), denying_reader());

    let (metadata, projection) = async {
        (
            metadata_loader.load_one(thread_id).await.unwrap(),
            projection_loader.load_one(thread_id).await.unwrap(),
        )
    }
    .instrument(tracing::info_span!("graphql_request"))
    .await;

    assert!(matches!(
        metadata,
        Some(EmailThreadMetadataLoad::Unavailable(
            EmailThreadUnavailable::NoAccess
        ))
    ));
    assert!(matches!(
        projection,
        Some(EmailThreadMailProjectionLoad::Unavailable(
            EmailThreadUnavailable::NoAccess
        ))
    ));
    let logs = logs.text();
    for message in [
        "email thread metadata unavailable",
        "email thread Mail projection unavailable",
    ] {
        let line = logs
            .lines()
            .find(|line| line.contains(message))
            .unwrap_or_else(|| panic!("no {message:?} warning in {logs}"));
        assert!(line.contains("WARN"), "{line}");
        // The fmt subscriber prefixes an event with the spans it fired in.
        assert!(line.contains("graphql_request:"), "{line}");
        assert!(line.contains(&format!("thread_id={thread_id}")), "{line}");
        assert!(line.contains(&format!("viewer_id={viewer_id}")), "{line}");
        assert!(line.contains("reason=NoAccess"), "{line}");
    }
    assert!(!logs.contains("reader@example.com"), "{logs}");
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
