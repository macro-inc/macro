use super::{
    BotOwnerSummary, BotSummary, BotToolContext, bot_tool_error,
    create_bot::CreateBot,
    get_bot_webhooks::GetBotWebhooks,
    manage_bot_channel_access::{BotChannelAccessAction, ManageBotChannelAccess},
};
use crate::domain::models::{
    AuthenticatedBot, BotChannel, BotChannelListCaller, BotChannelType, BotToken, CreateBotRequest,
    CreateBotTokenRequest, CreateBotTokenResponse, CreateChannelScopedBotRequest,
    CreateChannelScopedBotResponse, PatchBotRequest,
};
use crate::domain::{
    models::{Bot, BotKind, BotOwner},
    ports::{BotError, BotService},
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use bot_id::BotId;
use chrono::Utc;
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, CallChannelInfo, EntityAccessReceipt,
        EntityPermission, EntityType, MemberParticipantRole, RequiredPermission, TeamRole,
        UserTeamInfo,
    },
    ports::{EntityAccessService, NoOpEntityAccessService},
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use uuid::Uuid;

const TEST_USER_ID: &str = "macro|bot-manager@example.com";

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(TEST_USER_ID.to_string()).expect("valid macro user id")
}

fn sample_bot(handle: &str) -> Bot {
    let now = Utc::now();
    Bot {
        id: BotId::new_from_uuid(Uuid::new_v4()),
        kind: BotKind::Owned,
        owner: Some(BotOwner::User {
            user_id: TEST_USER_ID.to_string(),
        }),
        name: "Build Bot".to_string(),
        handle: handle.to_string(),
        description: Some("Builds things".to_string()),
        avatar_url: Some("https://static.example/bot.png".to_string()),
        created_by: Some(TEST_USER_ID.to_string()),
        created_at: now,
        updated_at: now,
        deleted_at: None,
        has_agent: false,
    }
}

fn sample_token(bot_id: BotId, label: Option<String>) -> BotToken {
    BotToken {
        id: Uuid::new_v4(),
        bot_id,
        token: "secret-token".to_string(),
        label,
        last_used_at: None,
        expires_at: None,
        revoked_at: None,
        created_at: Utc::now(),
    }
}

#[derive(Clone, Default)]
struct ToolTestBotService {
    channels: Vec<BotChannel>,
    remove_calls: Arc<AtomicUsize>,
    created: Arc<Mutex<Option<CreateBotRequest>>>,
    scoped: Arc<Mutex<Option<(Uuid, CreateChannelScopedBotRequest)>>>,
}

impl BotService for ToolTestBotService {
    async fn create_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        req: CreateBotRequest,
    ) -> Result<Bot, BotError> {
        *self.created.lock().expect("create lock") = Some(req.clone());
        Ok(sample_bot(&req.handle))
    }

    async fn create_channel_scoped_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: CreateChannelScopedBotRequest,
    ) -> Result<CreateChannelScopedBotResponse, BotError> {
        *self.scoped.lock().expect("scoped lock") = Some((channel_id, req.clone()));
        let bot = sample_bot(&req.handle);
        let token = sample_token(bot.id, req.token_label.clone());
        Ok(CreateChannelScopedBotResponse {
            bot,
            token,
            bot_token: "secret-token".to_string(),
        })
    }

    async fn list_bots(&self, _caller: MacroUserIdStr<'static>) -> Result<Vec<Bot>, BotError> {
        unimplemented!()
    }

    async fn get_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<Bot, BotError> {
        unimplemented!()
    }

    async fn get_self(&self, _bot_id: BotId) -> Result<Bot, BotError> {
        unimplemented!()
    }

    async fn patch_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _req: PatchBotRequest,
    ) -> Result<Bot, BotError> {
        unimplemented!()
    }

    async fn delete_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        unimplemented!()
    }

    async fn add_bot_to_channel(
        &self,
        _access: EntityAccessReceipt<MemberParticipantRole>,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        unimplemented!()
    }

    async fn remove_bot_from_channel(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        self.remove_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn list_bot_channels(
        &self,
        _caller: BotChannelListCaller,
        _bot_id: BotId,
    ) -> Result<Vec<BotChannel>, BotError> {
        Ok(self.channels.clone())
    }

    async fn list_channel_bots(&self, _channel_id: Uuid) -> Result<Vec<Bot>, BotError> {
        unimplemented!()
    }

    async fn create_token(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _req: CreateBotTokenRequest,
    ) -> Result<CreateBotTokenResponse, BotError> {
        unimplemented!()
    }

    async fn list_tokens(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<Vec<BotToken>, BotError> {
        unimplemented!()
    }

    async fn revoke_token(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _token_id: Uuid,
    ) -> Result<(), BotError> {
        unimplemented!()
    }

    async fn ensure_bot_in_channel(
        &self,
        _bot_id: BotId,
        _channel_id: Uuid,
    ) -> Result<(), BotError> {
        unimplemented!()
    }

    async fn authenticate_token(&self, _token: &str) -> Result<AuthenticatedBot, BotError> {
        unimplemented!()
    }

    async fn authenticate_channel_token(
        &self,
        _channel_id: Uuid,
        _token: &str,
    ) -> Result<AuthenticatedBot, BotError> {
        unimplemented!()
    }
}

#[derive(Clone, Default)]
struct AllowingEntityAccessService {
    calls: Arc<AtomicUsize>,
}

impl EntityAccessService for AllowingEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(EntityAccessReceipt::dangerously_assert_authenticated_user(
            user_id(),
            entity_id,
            entity_type,
        ))
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: entity_access::domain::models::BotId,
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
        Ok(None)
    }
}

#[test]
fn bot_summary_preserves_team_scope_and_profile() {
    let bot_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let now = Utc::now();
    let summary = BotSummary::try_from(Bot {
        id: BotId::new_from_uuid(bot_id),
        kind: BotKind::Owned,
        owner: Some(BotOwner::Team { team_id }),
        name: "Build Bot".to_string(),
        handle: "build-bot".to_string(),
        description: Some("Builds things".to_string()),
        avatar_url: Some("https://static.example/bot.png".to_string()),
        created_by: Some("macro|owner@example.com".to_string()),
        created_at: now,
        updated_at: now,
        deleted_at: None,
        has_agent: false,
    })
    .expect("owned bot has an owner");

    assert_eq!(summary.bot_id, bot_id);
    assert!(matches!(
        summary.owner,
        BotOwnerSummary::Team { team_id: id } if id == team_id
    ));
    assert_eq!(
        summary.avatar_url.as_deref(),
        Some("https://static.example/bot.png")
    );
    assert!(!summary.has_agent);
}

#[test]
fn bot_summary_rejects_ownerless_bots() {
    let now = Utc::now();
    let error = BotSummary::try_from(Bot {
        id: BotId::new_from_uuid(Uuid::new_v4()),
        kind: BotKind::System,
        owner: None,
        name: "Macro".to_string(),
        handle: "macro".to_string(),
        description: None,
        avatar_url: None,
        created_by: None,
        created_at: now,
        updated_at: now,
        deleted_at: None,
        has_agent: false,
    })
    .expect_err("system bots are not manageable");

    assert_eq!(
        error.description,
        "bot is missing an owner and cannot be managed"
    );
}

#[test]
fn bot_errors_are_actionable_without_exposing_repository_details() {
    let missing = bot_tool_error(
        "configure bot",
        BotError::NotFound("bot not found".to_string()),
    );
    assert_eq!(missing.description, "bot not found");

    let repository = bot_tool_error(
        "configure bot",
        BotError::Repo(anyhow::anyhow!("database password leaked")),
    );
    assert_eq!(repository.description, "failed to configure bot");
}

#[tokio::test]
async fn create_bot_without_channel_does_not_mint_a_credential() {
    let service = ToolTestBotService::default();
    let created = service.created.clone();
    let scoped = service.scoped.clone();
    let context = BotToolContext::new(
        service,
        NoOpEntityAccessService,
        "https://storage.example.com".to_string(),
    );

    let response = CreateBot {
        team_id: None,
        name: "Build Bot".to_string(),
        handle: "build-bot".to_string(),
        description: None,
        avatar_url: None,
        channel_id: None,
        credential_label: None,
        credential_expires_at: None,
        has_agent: None,
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("standalone create should not consult entity access");

    assert_eq!(response.bot.handle, "build-bot");
    assert!(response.channel_setup.is_none());
    assert!(created.lock().expect("create lock").is_some());
    assert!(scoped.lock().expect("scoped lock").is_none());
}

#[tokio::test]
async fn create_bot_rejects_credential_fields_without_channel() {
    let context = BotToolContext::new(
        ToolTestBotService::default(),
        NoOpEntityAccessService,
        "https://storage.example.com".to_string(),
    );

    let error = CreateBot {
        team_id: None,
        name: "Build Bot".to_string(),
        handle: "build-bot".to_string(),
        description: None,
        avatar_url: None,
        channel_id: None,
        credential_label: Some("github-webhook".to_string()),
        credential_expires_at: None,
        has_agent: None,
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("credential label requires channelId");

    assert!(error.description.contains("require channelId"));
}

#[tokio::test]
async fn create_bot_for_channel_returns_credential_and_webhook() {
    let channel_id = Uuid::new_v4();
    let service = ToolTestBotService::default();
    let scoped = service.scoped.clone();
    let access = AllowingEntityAccessService::default();
    let access_calls = access.calls.clone();
    let context = BotToolContext::new(service, access, "https://storage.example.com/".to_string());

    let response = CreateBot {
        team_id: None,
        name: "Build Bot".to_string(),
        handle: "build-bot".to_string(),
        description: None,
        avatar_url: None,
        channel_id: Some(channel_id),
        credential_label: Some("github-webhook".to_string()),
        credential_expires_at: None,
        has_agent: None,
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("channel member can create a channel-ready bot");

    let setup = response.channel_setup.expect("channel setup");
    assert_eq!(setup.channel_id, channel_id);
    assert_eq!(setup.bearer_token, "secret-token");
    assert_eq!(
        setup.webhook.webhook_url,
        format!("https://storage.example.com/channels/{channel_id}/webhook")
    );
    assert_eq!(setup.credential_header, "x-macro-bot-token");
    assert_eq!(access_calls.load(Ordering::SeqCst), 1);
    let (scoped_channel, scoped_req) = scoped.lock().expect("scoped lock").clone().expect("scoped");
    assert_eq!(scoped_channel, channel_id);
    assert_eq!(scoped_req.token_label.as_deref(), Some("github-webhook"));
}

#[tokio::test]
async fn create_bot_for_channel_requires_membership() {
    let context = BotToolContext::new(
        ToolTestBotService::default(),
        NoOpEntityAccessService,
        "https://storage.example.com".to_string(),
    );

    let error = CreateBot {
        team_id: None,
        name: "Build Bot".to_string(),
        handle: "build-bot".to_string(),
        description: None,
        avatar_url: None,
        channel_id: Some(Uuid::new_v4()),
        credential_label: None,
        credential_expires_at: None,
        has_agent: None,
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("NoOp entity access rejects membership");

    assert_eq!(error.description, "failed to verify channel membership");
}

#[tokio::test]
async fn revoke_does_not_require_current_channel_membership() {
    let service = ToolTestBotService::default();
    let remove_calls = service.remove_calls.clone();
    let context = BotToolContext::new(
        service,
        NoOpEntityAccessService,
        "https://storage.example.com".to_string(),
    );

    let response = ManageBotChannelAccess {
        bot_id: Uuid::new_v4(),
        channel_id: Uuid::new_v4(),
        action: BotChannelAccessAction::Revoke,
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("revoke skips entity-access because NoOp would have failed");

    assert_eq!(response.action, BotChannelAccessAction::Revoke);
    assert_eq!(remove_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn webhook_response_uses_preferred_bot_authentication_headers() {
    let channel_id = Uuid::new_v4();
    let service = ToolTestBotService {
        channels: vec![BotChannel {
            channel_id,
            name: Some("Alerts".to_string()),
            channel_type: BotChannelType::Private,
            joined_at: Utc::now(),
        }],
        ..ToolTestBotService::default()
    };
    let context = BotToolContext::new(
        service,
        NoOpEntityAccessService,
        "https://storage.example.com/".to_string(),
    );

    let response = GetBotWebhooks {
        bot_id: Uuid::new_v4(),
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("manageable bot channels should produce webhook metadata");

    assert_eq!(response.credential_header, "x-macro-bot-token");
    assert_eq!(response.credential_scope_header, "x-macro-bot-scope");
    assert_eq!(response.credential_scope, "user");
    assert_eq!(
        response.webhooks[0].webhook_url,
        format!("https://storage.example.com/channels/{channel_id}/webhook")
    );
}
