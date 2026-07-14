use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use email::domain::{
    models::{EmailErr, ParsedMessage},
    ports::EmailContentService,
};
use entity_access::domain::{
    models::{
        AccessLevel, BotId, CallChannelInfo, EntityAccessReceipt, EntityPermission, EntityType,
        RequiredPermission, UserTeamInfo, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};

use super::*;

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
async fn authorized_keys_reach_the_email_domain() {
    let content = Arc::new(RecordingContentService::default());
    let service =
        DssEmailContentReader::new(content.clone(), Arc::new(TestAccessService { allow: true }));
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
    let service = DssEmailContentReader::new(
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
