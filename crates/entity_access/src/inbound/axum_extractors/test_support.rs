use std::sync::{Arc, Mutex};

use axum::extract::FromRef;
use macro_authorization::{
    BotActingUserClaims, BotAuthentication, BotScope, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
    MacroUserAuthentication,
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
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, Entity,
        EntityAccessReceipt, EntityPermission, EntityType, TeamRole, UserTeamInfo,
    },
    ports::EntityAccessService,
};

pub(super) const INTERNAL_KEY: &str = "valid-internal-key";
pub(super) const USER_ID: &str = "macro|user@example.com";
pub(super) const BOT_ACTING_USER_ID: &str = "macro|bot-acting-user@example.com";
pub(super) const BOT_ACTING_USER_ORGANIZATION_ID: i32 = 42;
pub(super) const BOT_ID: BotId = BotId::new_from_uuid(Uuid::from_u128(1));
pub(super) const BOT_TEAM_ID: Uuid = Uuid::from_u128(3);
pub(super) const VALID_BOT_TOKEN: &str = "valid-bot-token";
pub(super) const MALFORMED_SYSTEM_BOT_TOKEN: &str = "malformed-system-bot-token";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct AccessCall {
    pub(super) user_id: Option<String>,
    pub(super) entity_id: String,
    pub(super) entity_type: EntityType,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct BotAccessCall {
    pub(super) bot_id: BotId,
    pub(super) scope: BotAccessScope,
    pub(super) entity_id: String,
    pub(super) entity_type: EntityType,
}

#[derive(Clone, Debug)]
pub(super) struct FakeEntityAccessService {
    access_level: Option<AccessLevel>,
    bot_permission: Option<EntityPermission>,
    calls: Arc<Mutex<Vec<AccessCall>>>,
    bot_calls: Arc<Mutex<Vec<BotAccessCall>>>,
}

impl FakeEntityAccessService {
    pub(super) fn new(access_level: Option<AccessLevel>) -> Self {
        Self {
            access_level,
            bot_permission: access_level
                .map(|access_level| EntityPermission::AccessLevel { access_level }),
            calls: Arc::new(Mutex::new(Vec::new())),
            bot_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(super) fn with_bot_permission(mut self, permission: EntityPermission) -> Self {
        self.bot_permission = Some(permission);
        self
    }

    pub(super) fn calls(&self) -> Vec<AccessCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }

    pub(super) fn bot_calls(&self) -> Vec<BotAccessCall> {
        self.bot_calls
            .lock()
            .expect("bot calls lock poisoned")
            .clone()
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
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.bot_calls
            .lock()
            .expect("bot calls lock poisoned")
            .push(BotAccessCall {
                bot_id,
                scope: scope.clone(),
                entity_id: entity_id.to_string(),
                entity_type,
            });

        if matches!(
            entity_type,
            EntityType::User | EntityType::ChannelMessage | EntityType::StaticFile
        ) {
            return Err(AccessError::BadRequest("Unsupported bot entity type"));
        }

        let permission = self.bot_permission.ok_or(AccessError::Unauthorized)?;
        EntityAccessReceipt::try_new_bot(
            bot_id.into_storage_id(),
            (&scope).into(),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            permission,
        )
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
        match token {
            VALID_BOT_TOKEN => Ok(valid_bot_authentication(bot_scope)),
            MALFORMED_SYSTEM_BOT_TOKEN => Ok(malformed_system_bot_authentication(bot_scope)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
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
    match bot_scope {
        BotScope::User => user_scoped_bot_authentication(),
        BotScope::Team => team_scoped_bot_authentication(),
    }
}

pub(super) fn user_scoped_bot_authentication() -> BotAuthentication {
    BotAuthentication {
        bot_id: BOT_ID,
        token_id: Uuid::from_u128(2),
        bot_scope: BotScope::User,
        team_id: None,
        acting_user: Some(MacroUserAuthentication {
            macro_user_id: MacroUserIdStr::try_from(BOT_ACTING_USER_ID.to_string())
                .expect("valid bot acting user id"),
            user_context: user_context_with_organization(
                BOT_ACTING_USER_ID,
                Some(BOT_ACTING_USER_ORGANIZATION_ID),
            ),
        }),
    }
}

pub(super) fn team_scoped_bot_authentication() -> BotAuthentication {
    BotAuthentication {
        bot_id: BOT_ID,
        token_id: Uuid::from_u128(2),
        bot_scope: BotScope::Team,
        team_id: Some(BOT_TEAM_ID),
        acting_user: None,
    }
}

pub(super) fn malformed_system_bot_authentication(bot_scope: BotScope) -> BotAuthentication {
    BotAuthentication {
        bot_id: BOT_ID,
        token_id: Uuid::from_u128(2),
        bot_scope,
        team_id: None,
        acting_user: None,
    }
}

fn user_context(user_id: &str) -> UserContext {
    user_context_with_organization(user_id, None)
}

fn user_context_with_organization(user_id: &str, organization_id: Option<i32>) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        organization_id,
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
