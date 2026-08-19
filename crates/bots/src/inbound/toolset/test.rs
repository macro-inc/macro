use super::{BotOwnerSummary, BotSummary, BotToolContext, bot_tool_error};
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
    models::{EntityAccessReceipt, MemberParticipantRole},
    ports::NoOpEntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use uuid::Uuid;

use super::{
    get_bot_webhooks::GetBotWebhooks,
    manage_bot_channel_access::{BotChannelAccessAction, ManageBotChannelAccess},
};

const TEST_USER_ID: &str = "macro|bot-manager@example.com";

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(TEST_USER_ID.to_string()).expect("valid macro user id")
}

#[derive(Clone, Default)]
struct ToolTestBotService {
    channels: Vec<BotChannel>,
    remove_calls: Arc<AtomicUsize>,
}

impl BotService for ToolTestBotService {
    async fn create_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _req: CreateBotRequest,
    ) -> Result<Bot, BotError> {
        unimplemented!()
    }

    async fn create_channel_scoped_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _req: CreateChannelScopedBotRequest,
    ) -> Result<CreateChannelScopedBotResponse, BotError> {
        unimplemented!()
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

#[test]
fn bot_summary_preserves_team_scope_and_profile() {
    let bot_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let now = Utc::now();
    let summary = BotSummary::from(Bot {
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
    });

    assert_eq!(summary.bot_id, bot_id);
    assert!(matches!(
        summary.owner,
        BotOwnerSummary::Team { team_id: id } if id == team_id
    ));
    assert_eq!(
        summary.avatar_url.as_deref(),
        Some("https://static.example/bot.png")
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
    .expect("revoke should not consult the rejecting entity-access service");

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
