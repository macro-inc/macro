use crate::domain::models::TeamRole;
use std::sync::{Arc, Mutex};

use axum::extract::FromRef;
use macro_authorization::{
    BotActingUserClaims, BotAuthentication, BotScope, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_user::UserContext;
use rootcause::Report;
use uuid::Uuid;

use super::RequiredPermission;
use crate::domain::{
    models::{
        AccessError, AccessLevel, BotId, CallChannelInfo, EntityAccessReceipt, EntityPermission,
        EntityType, UserTeamInfo,
    },
    ports::EntityAccessService,
};

pub(super) const INTERNAL_KEY: &str = "valid-internal-key";
pub(super) const USER_ID: &str = "macro|user@example.com";
pub(super) const VALID_BOT_TOKEN: &str = "valid-bot-token";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct AccessCall {
    pub(super) user_id: Option<String>,
    pub(super) entity_id: String,
    pub(super) entity_type: EntityType,
}

#[derive(Clone, Debug)]
pub(super) struct FakeEntityAccessService {
    access_level: Option<AccessLevel>,
    calls: Arc<Mutex<Vec<AccessCall>>>,
}

impl FakeEntityAccessService {
    pub(super) fn new(access_level: Option<AccessLevel>) -> Self {
        Self {
            access_level,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(super) fn calls(&self) -> Vec<AccessCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_entity_access_receipt call")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_bot_entity_access_receipt call")
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AccessCall {
                user_id: user_id.map(|user_id| user_id.as_ref().to_string()),
                entity_id: entity_id.to_string(),
                entity_type,
            });

        Ok(self.access_level)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_access call")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_public_access call")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected get_entity_permission call")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        panic!("unexpected get_crm_entity_permission_with_team call")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        panic!("unexpected get_users_by_entity call")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel call")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel_by_channel_id call")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        panic!("unexpected get_user_team call")
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            "valid" => Ok(user_context(USER_ID)),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_bot(
        &self,
        token: &str,
        bot_scope: BotScope,
        _claims: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        if token != VALID_BOT_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(valid_bot_authentication(bot_scope))
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims.user_id.as_deref().map(user_context))
    }
}

pub(super) fn valid_bot_authentication(bot_scope: BotScope) -> BotAuthentication {
    BotAuthentication {
        bot_id: BotId::new_from_uuid(Uuid::from_u128(1)),
        token_id: Uuid::from_u128(2),
        bot_scope,
        team_id: (bot_scope == BotScope::Team).then_some(Uuid::from_u128(3)),
        acting_user: None,
    }
}

fn user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        organization_id: None,
        permissions: None,
    }
}

#[derive(Clone)]
pub(super) struct TestState {
    pub(super) entity_access: Arc<FakeEntityAccessService>,
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
}

impl TestState {
    pub(super) fn new(access_level: Option<AccessLevel>) -> Self {
        Self {
            entity_access: Arc::new(FakeEntityAccessService::new(access_level)),
            authorization: MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
        }
    }
}

impl FromRef<TestState> for Arc<FakeEntityAccessService> {
    fn from_ref(state: &TestState) -> Self {
        state.entity_access.clone()
    }
}

impl FromRef<TestState> for MacroAuthorizationState<FakeAuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}
