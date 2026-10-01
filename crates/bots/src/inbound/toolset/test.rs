use super::{
    AgentChannelScopeSummary, AgentMcpScopeSummary, AgentMcpServerSummary, BotOwnerSummary,
    BotSummary, BotToolContext, bot_tool_error,
    configure_agent::{AgentHarnessOption, ConfigureAgent},
    create_bot::CreateBot,
    get_bot_webhooks::GetBotWebhooks,
    issue_bot_credential::IssueBotCredential,
    list_agents::ListAgents,
    manage_bot_channel_access::{BotChannelAccessAction, ManageBotChannelAccess},
};
use crate::domain::models::{
    Agent, AgentChannelScope, AgentChannelSelection, AgentHarnessSelection, AgentMcpServer,
    AgentMcpServers, AuthenticatedBot, BotChannel, BotChannelListCaller, BotChannelType,
    BotOwnerProfile, BotToken, CreateAgentRequest, CreateBotRequest, CreateBotTokenRequest,
    CreateBotTokenResponse, CreateChannelScopedBotRequest, CreateChannelScopedBotResponse,
    HarnessId, PatchAgentRequest, PatchBotRequest, UpdateAgentRequest,
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
        token_prefix: "mbot_secret".to_string(),
        label,
        last_used_at: None,
        expires_at: None,
        revoked_at: None,
        created_at: Utc::now(),
    }
}

fn sample_agent(handle: &str) -> Agent {
    Agent {
        bot: sample_bot(handle),
        instructions: "Fix the root cause and add tests.".to_string(),
        harness: "cursor".to_string(),
        harness_id: None,
        default_model: "cursor-small".to_string(),
        channel_scope: AgentChannelScope::All,
        channel_ids: Vec::new(),
        mcp: AgentMcpServers::OwnerConnections,
        auto_accept_permissions: None,
        is_coding: true,
    }
}

#[derive(Clone, Default)]
struct ToolTestBotService {
    channels: Vec<BotChannel>,
    remove_calls: Arc<AtomicUsize>,
    created: Arc<Mutex<Option<CreateBotRequest>>>,
    scoped: Arc<Mutex<Option<(Uuid, CreateChannelScopedBotRequest)>>>,
    added: Arc<Mutex<Option<BotId>>>,
    deleted: Arc<Mutex<Option<BotId>>>,
    patched: Arc<Mutex<Option<(BotId, PatchAgentRequest)>>>,
    add_error: Option<String>,
    patch_error: Option<String>,
}

impl BotService for ToolTestBotService {
    async fn create_agent(
        &self,
        _caller: MacroUserIdStr<'static>,
        _req: CreateAgentRequest,
    ) -> Result<Agent, BotError> {
        unimplemented!()
    }

    async fn update_agent(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _req: UpdateAgentRequest,
    ) -> Result<Agent, BotError> {
        unimplemented!()
    }

    async fn patch_agent(
        &self,
        _caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        req: PatchAgentRequest,
    ) -> Result<Agent, BotError> {
        if let Some(message) = &self.patch_error {
            return Err(BotError::BadRequest(message.clone()));
        }
        let mut agent = sample_agent("bug-fixer");
        agent.bot.id = bot_id;
        let update = req.clone().apply_to(&agent);
        *self.patched.lock().expect("patch lock") = Some((bot_id, req));
        agent.instructions = update.instructions;
        agent.harness = update.harness;
        agent.harness_id = update.harness_id;
        agent.default_model = update.default_model;
        agent.channel_scope = update.channel_scope;
        agent.channel_ids = update.channel_ids;
        agent.mcp = update.mcp;
        agent.auto_accept_permissions = update.auto_accept_permissions;
        agent.is_coding = update.is_coding;
        Ok(agent)
    }

    async fn list_agents(&self, _caller: MacroUserIdStr<'static>) -> Result<Vec<Agent>, BotError> {
        Ok(vec![sample_agent("bug-fixer")])
    }

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
        bot_id: BotId,
    ) -> Result<Bot, BotError> {
        let mut bot = sample_bot("build-bot");
        bot.id = bot_id;
        Ok(bot)
    }

    async fn get_owner_profiles(&self, _ids: &[BotId]) -> Result<Vec<BotOwnerProfile>, BotError> {
        Ok(Vec::new())
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
        bot_id: BotId,
    ) -> Result<(), BotError> {
        *self.deleted.lock().expect("delete lock") = Some(bot_id);
        Ok(())
    }

    async fn add_bot_to_channel(
        &self,
        _access: EntityAccessReceipt<MemberParticipantRole>,
        bot_id: BotId,
    ) -> Result<(), BotError> {
        if let Some(message) = &self.add_error {
            return Err(BotError::Repo(anyhow::anyhow!(message.clone())));
        }
        *self.added.lock().expect("add lock") = Some(bot_id);
        Ok(())
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

    async fn channel_message_access(
        &self,
        _bot_id: BotId,
        _channel_id: Uuid,
    ) -> Result<
        entity_access::domain::models::EntityAccessReceipt<messages::domain::service::MessageWrite>,
        BotError,
    > {
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
async fn create_bot_for_channel_returns_webhook_and_credential_proposal() {
    let channel_id = Uuid::new_v4();
    let service = ToolTestBotService::default();
    let created = service.created.clone();
    let scoped = service.scoped.clone();
    let added = service.added.clone();
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
    assert_eq!(setup.credential_label.as_deref(), Some("github-webhook"));
    assert_eq!(
        setup.webhook.webhook_url,
        format!("https://storage.example.com/channels/{channel_id}/webhook")
    );
    assert_eq!(setup.credential_header, "x-macro-bot-token");
    assert_eq!(access_calls.load(Ordering::SeqCst), 1);
    assert!(created.lock().expect("create lock").is_some());
    assert!(added.lock().expect("add lock").is_some());
    assert!(scoped.lock().expect("scoped lock").is_none());
}

#[tokio::test]
async fn issue_bot_credential_returns_proposal_without_minting() {
    let bot_id = Uuid::new_v4();
    let service = ToolTestBotService::default();
    let context = BotToolContext::new(
        service,
        NoOpEntityAccessService,
        "https://storage.example.com".to_string(),
    );

    let response = IssueBotCredential {
        bot_id,
        label: Some("github-webhook".to_string()),
        expires_at: None,
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("manageable bot can receive a credential proposal");

    assert_eq!(response.bot_id, bot_id);
    assert_eq!(response.label.as_deref(), Some("github-webhook"));
    assert!(response.summary.contains("ready to mint"));
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
async fn create_bot_for_channel_deletes_bot_when_grant_fails() {
    let service = ToolTestBotService {
        add_error: Some("channel grant failed".to_string()),
        ..ToolTestBotService::default()
    };
    let deleted = service.deleted.clone();
    let created = service.created.clone();
    let context = BotToolContext::new(
        service,
        AllowingEntityAccessService::default(),
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
    .expect_err("failed channel grant should not leave a channel-ready bot");

    assert_eq!(error.description, "failed to grant bot channel access");
    assert!(created.lock().expect("create lock").is_some());
    assert!(deleted.lock().expect("delete lock").is_some());
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

#[tokio::test]
async fn list_agents_returns_instructions_and_settings() {
    let context = BotToolContext::new(
        ToolTestBotService::default(),
        NoOpEntityAccessService,
        "https://storage.example.com".to_string(),
    );

    let response = ListAgents {}
        .call(ServiceContext(context), RequestContext::new(user_id()))
        .await
        .expect("listing needs no entity access");

    assert_eq!(response.summary, "Found 1 manageable agent.");
    let agent = &response.agents[0];
    assert_eq!(agent.bot.handle, "bug-fixer");
    assert_eq!(agent.instructions, "Fix the root cause and add tests.");
    assert_eq!(agent.harness, "cursor");
    assert_eq!(agent.default_model, "cursor-small");
    assert_eq!(agent.channel_scope, AgentChannelScopeSummary::All);
    assert_eq!(agent.mcp_scope, AgentMcpScopeSummary::OwnerConnections);
    assert!(agent.mcp_servers.is_empty());
    assert_eq!(agent.auto_accept_permissions, None);
    assert!(agent.is_coding);
}

#[tokio::test]
async fn configure_agent_patches_only_named_fields() {
    let service = ToolTestBotService::default();
    let patched = service.patched.clone();
    let context = BotToolContext::new(
        service,
        NoOpEntityAccessService,
        "https://storage.example.com".to_string(),
    );
    let bot_id = Uuid::new_v4();

    let response = ConfigureAgent {
        bot_id,
        instructions: Some("Diagnose first, then make the smallest tested fix.".to_string()),
        default_model: Some("claude-sonnet-4-5".to_string()),
        ..ConfigureAgent::default()
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("instructions and model are a valid patch");

    let (patched_id, patch) = patched
        .lock()
        .expect("patch lock")
        .clone()
        .expect("service should receive the patch");
    assert_eq!(patched_id, BotId::new_from_uuid(bot_id));
    assert_eq!(
        patch,
        PatchAgentRequest {
            instructions: Some("Diagnose first, then make the smallest tested fix.".to_string()),
            default_model: Some("claude-sonnet-4-5".to_string()),
            ..PatchAgentRequest::default()
        }
    );
    assert_eq!(
        response.agent.instructions,
        "Diagnose first, then make the smallest tested fix."
    );
    assert_eq!(response.agent.default_model, "claude-sonnet-4-5");
    assert_eq!(response.agent.harness, "cursor");
    assert!(
        response
            .summary
            .starts_with("Updated @bug-fixer: instructions, model.")
    );
}

#[tokio::test]
async fn configure_agent_translates_scoped_selections() {
    let service = ToolTestBotService::default();
    let patched = service.patched.clone();
    let context = BotToolContext::new(
        service,
        NoOpEntityAccessService,
        "https://storage.example.com".to_string(),
    );
    let channel_id = Uuid::new_v4();
    let harness_id = Uuid::new_v4();

    let response = ConfigureAgent {
        bot_id: Uuid::new_v4(),
        harness: Some(AgentHarnessOption::Macrod),
        harness_id: Some(harness_id),
        channel_ids: Some(vec![channel_id]),
        mcp_servers: Some(vec![AgentMcpServerSummary {
            app_slug: "linear".to_string(),
            server_name: "Linear".to_string(),
        }]),
        auto_accept_permissions: Some(true),
        is_coding: Some(false),
        ..ConfigureAgent::default()
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("ids alone select the `selected` scopes");

    let (_, patch) = patched
        .lock()
        .expect("patch lock")
        .clone()
        .expect("service should receive the patch");
    assert_eq!(
        patch.harness,
        Some(AgentHarnessSelection {
            harness: "macrod".to_string(),
            harness_id: Some(HarnessId::new_from_uuid(harness_id)),
        })
    );
    assert_eq!(
        patch.channels,
        Some(AgentChannelSelection {
            channel_scope: AgentChannelScope::Selected,
            channel_ids: vec![channel_id],
        })
    );
    assert_eq!(
        patch.mcp,
        Some(AgentMcpServers::Selected {
            servers: vec![AgentMcpServer {
                app_slug: "linear".to_string(),
                server_name: "Linear".to_string(),
            }],
        })
    );
    assert_eq!(patch.auto_accept_permissions, Some(true));
    assert_eq!(patch.is_coding, Some(false));
    assert_eq!(
        response.agent.channel_scope,
        AgentChannelScopeSummary::Selected
    );
    assert_eq!(response.agent.channel_ids, vec![channel_id]);
    assert_eq!(response.agent.mcp_scope, AgentMcpScopeSummary::Selected);
    assert_eq!(response.agent.harness_id, Some(harness_id));
}

#[tokio::test]
async fn configure_agent_rejects_incoherent_arguments() {
    let cases = [
        (
            ConfigureAgent {
                bot_id: Uuid::new_v4(),
                ..ConfigureAgent::default()
            },
            "nothing to change",
        ),
        (
            ConfigureAgent {
                bot_id: Uuid::new_v4(),
                harness_id: Some(Uuid::new_v4()),
                ..ConfigureAgent::default()
            },
            "pass harness too",
        ),
        (
            ConfigureAgent {
                bot_id: Uuid::new_v4(),
                channel_scope: Some(AgentChannelScopeSummary::All),
                channel_ids: Some(vec![Uuid::new_v4()]),
                ..ConfigureAgent::default()
            },
            "omit them for `all`",
        ),
        (
            ConfigureAgent {
                bot_id: Uuid::new_v4(),
                mcp_scope: Some(AgentMcpScopeSummary::OwnerConnections),
                mcp_servers: Some(vec![AgentMcpServerSummary {
                    app_slug: "linear".to_string(),
                    server_name: "Linear".to_string(),
                }]),
                ..ConfigureAgent::default()
            },
            "omit them for `owner_connections`",
        ),
    ];

    for (call, expected) in cases {
        let service = ToolTestBotService::default();
        let patched = service.patched.clone();
        let context = BotToolContext::new(
            service,
            NoOpEntityAccessService,
            "https://storage.example.com".to_string(),
        );
        let error = call
            .call(ServiceContext(context), RequestContext::new(user_id()))
            .await
            .expect_err("incoherent arguments never reach the service");
        assert!(
            error.description.contains(expected),
            "{expected:?} not in {:?}",
            error.description
        );
        assert!(patched.lock().expect("patch lock").is_none());
    }
}

#[tokio::test]
async fn configure_agent_surfaces_domain_rejections() {
    let context = BotToolContext::new(
        ToolTestBotService {
            patch_error: Some("channel-specific agents require at least one channel".to_string()),
            ..ToolTestBotService::default()
        },
        NoOpEntityAccessService,
        "https://storage.example.com".to_string(),
    );

    let error = ConfigureAgent {
        bot_id: Uuid::new_v4(),
        channel_scope: Some(AgentChannelScopeSummary::Selected),
        ..ConfigureAgent::default()
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("the domain's validation message reaches the model");

    assert_eq!(
        error.description,
        "channel-specific agents require at least one channel"
    );
}
