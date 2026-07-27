use entity_access::domain::models::TeamRole;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use email::domain::models::EmailErr;
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
        thread_id: Uuid::from_u128(index as u128),
    }
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
async fn rejects_oversized_batches_without_calling_the_reader() {
    let reader = RecordingReader::default();
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
    let reader = EmailServiceEmailContentReader::new(
        content.clone(),
        Arc::new(TestAccessService { allow: true }),
    );
    let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
    let requested = key(1);

    let loaded = reader.get_email_content(&user_id, vec![requested]).await;

    assert_eq!(content.calls.load(Ordering::SeqCst), 1);
    assert!(matches!(
        loaded.get(&requested),
        Some(EmailContentLoad::Missing)
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

    assert_eq!(content.calls.load(Ordering::SeqCst), 0);
    assert!(matches!(
        loaded.get(&requested),
        Some(EmailContentLoad::Missing)
    ));
}
