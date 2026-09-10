//! Bot ports.

use super::models::{
    Agent, AuthenticatedBot, Bot, BotChannel, BotChannelListCaller, BotId, BotOwner, BotToken,
    BotTokenCandidate, CreateAgentRequest, CreateBotRequest, CreateBotTokenRequest,
    CreateBotTokenResponse, CreateChannelScopedBotRequest, CreateChannelScopedBotResponse,
    HarnessId, HarnessOwner, PatchBotRequest, UpdateAgentRequest,
};
use bot_token::HashedBotToken;
use entity_access::domain::models::{EntityAccessReceipt, MemberParticipantRole};
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use uuid::Uuid;

/// Bot repository.
#[cfg_attr(feature = "test-utils", mockall::automock(type Err = anyhow::Error;))]
pub trait BotRepo: Send + Sync + 'static {
    /// Repository error.
    type Err: Into<anyhow::Error> + Send;

    /// Create an owned agent and its selected channel memberships atomically.
    fn create_agent(
        &self,
        owner: BotOwner,
        created_by: MacroUserIdStr<'static>,
        req: CreateAgentRequest,
    ) -> impl Future<Output = Result<Agent, Self::Err>> + Send;

    /// Replace an owned agent and its selected channel memberships atomically.
    fn update_agent(
        &self,
        bot_id: BotId,
        owner: BotOwner,
        req: UpdateAgentRequest,
    ) -> impl Future<Output = Result<Option<Agent>, Self::Err>> + Send;

    /// List active agents manageable by a caller.
    fn list_manageable_agents(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Agent>, Self::Err>> + Send;

    /// Check whether the caller is an active member of every supplied channel.
    fn user_has_channels(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_ids: &[Uuid],
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Create an owned bot.
    fn create_owned_bot(
        &self,
        owner: BotOwner,
        created_by: MacroUserIdStr<'static>,
        req: CreateBotRequest,
    ) -> impl Future<Output = Result<Bot, Self::Err>> + Send;

    /// Create an owned bot, add it to a channel, and persist a hashed token atomically.
    fn create_channel_scoped_bot(
        &self,
        owner: BotOwner,
        created_by: MacroUserIdStr<'static>,
        channel_id: Uuid,
        token: HashedBotToken,
        req: CreateChannelScopedBotRequest,
    ) -> impl Future<Output = Result<(Bot, BotToken), Self::Err>> + Send;

    /// List active bots manageable by a caller.
    fn list_manageable_bots(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Bot>, Self::Err>> + Send;

    /// Get an active bot by id.
    fn get_bot(&self, bot_id: BotId)
    -> impl Future<Output = Result<Option<Bot>, Self::Err>> + Send;

    /// Get an active persisted agent by bot id.
    fn get_agent(
        &self,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Option<Agent>, Self::Err>> + Send;

    /// Check team membership.
    fn user_has_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Get the owner of an active registered harness.
    fn get_harness_owner(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Option<HarnessOwner>, Self::Err>> + Send;

    /// Check whether a bot is an active channel participant.
    fn bot_active_in_channel(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Check whether a user is an administrator or owner of a team.
    fn user_can_administer_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Check whether a user owns a team.
    fn user_owns_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Patch an active bot.
    fn patch_bot(
        &self,
        bot_id: BotId,
        req: PatchBotRequest,
    ) -> impl Future<Output = Result<Option<Bot>, Self::Err>> + Send;

    /// Soft-delete an active bot.
    fn delete_bot(&self, bot_id: BotId) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Add bot reach to a channel.
    fn add_bot_to_channel(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Remove bot reach from a channel.
    fn remove_bot_from_channel(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// List active channels containing a bot.
    fn list_bot_channels(
        &self,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Vec<BotChannel>, Self::Err>> + Send;

    /// List active bots in a channel.
    fn list_channel_bots(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<Bot>, Self::Err>> + Send;

    /// Persist a hashed token. The raw secret must not be passed here.
    fn create_token(
        &self,
        bot_id: BotId,
        token: HashedBotToken,
        req: CreateBotTokenRequest,
    ) -> impl Future<Output = Result<BotToken, Self::Err>> + Send;

    /// List active token metadata.
    fn list_tokens(
        &self,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Vec<BotToken>, Self::Err>> + Send;

    /// Revoke a token.
    fn revoke_token(
        &self,
        bot_id: BotId,
        token_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Lookup a token candidate by hashing the presented raw token.
    fn token_candidate(
        &self,
        token: &str,
    ) -> impl Future<Output = Result<Option<BotTokenCandidate>, Self::Err>> + Send;

    /// Lookup a channel-scoped token candidate by hashing the presented raw token.
    fn channel_token_candidate(
        &self,
        channel_id: Uuid,
        token: &str,
    ) -> impl Future<Output = Result<Option<BotTokenCandidate>, Self::Err>> + Send;

    /// Mark a token as used.
    fn mark_token_used(&self, token_id: Uuid)
    -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Bot service.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait BotService: Send + Sync + 'static {
    /// Create an agent owned by the caller or a team they administer.
    fn create_agent(
        &self,
        caller: MacroUserIdStr<'static>,
        req: CreateAgentRequest,
    ) -> impl Future<Output = Result<Agent, BotError>> + Send;

    /// Replace the editable configuration of a manageable agent.
    fn update_agent(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        req: UpdateAgentRequest,
    ) -> impl Future<Output = Result<Agent, BotError>> + Send;

    /// List agents manageable by the caller.
    fn list_agents(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Agent>, BotError>> + Send;

    /// Create a bot owned by the caller or a team they administer.
    fn create_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        req: CreateBotRequest,
    ) -> impl Future<Output = Result<Bot, BotError>> + Send;

    /// Create a bot owned by the caller or a team they administer and scoped to a channel.
    fn create_channel_scoped_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: CreateChannelScopedBotRequest,
    ) -> impl Future<Output = Result<CreateChannelScopedBotResponse, BotError>> + Send;

    /// List bots manageable by the caller.
    fn list_bots(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Bot>, BotError>> + Send;

    /// Get a manageable bot.
    fn get_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Bot, BotError>> + Send;

    /// Get the authenticated bot's own record.
    fn get_self(&self, bot_id: BotId) -> impl Future<Output = Result<Bot, BotError>> + Send;

    /// Patch a manageable bot.
    fn patch_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        req: PatchBotRequest,
    ) -> impl Future<Output = Result<Bot, BotError>> + Send;

    /// Delete a manageable bot.
    fn delete_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> impl Future<Output = Result<(), BotError>> + Send;

    /// Add an owned/team-available bot to a channel.
    fn add_bot_to_channel(
        &self,
        access: EntityAccessReceipt<MemberParticipantRole>,
        bot_id: BotId,
    ) -> impl Future<Output = Result<(), BotError>> + Send;

    /// Remove a bot from a channel.
    fn remove_bot_from_channel(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<(), BotError>> + Send;

    /// List active channels containing a manageable bot, the calling bot itself,
    /// or a bot requested by an authenticated internal service.
    fn list_bot_channels(
        &self,
        caller: BotChannelListCaller,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Vec<BotChannel>, BotError>> + Send;

    /// List channel bots.
    fn list_channel_bots(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<Bot>, BotError>> + Send;

    /// Create a token for a manageable bot.
    fn create_token(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        req: CreateBotTokenRequest,
    ) -> impl Future<Output = Result<CreateBotTokenResponse, BotError>> + Send;

    /// List token metadata for a manageable bot.
    fn list_tokens(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Vec<BotToken>, BotError>> + Send;

    /// Revoke a token for a manageable bot.
    fn revoke_token(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        token_id: Uuid,
    ) -> impl Future<Output = Result<(), BotError>> + Send;

    /// Ensure that a bot is an active participant in a channel.
    fn ensure_bot_in_channel(
        &self,
        bot_id: BotId,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<(), BotError>> + Send;

    /// Authenticate a raw bearer token.
    fn authenticate_token(
        &self,
        token: &str,
    ) -> impl Future<Output = Result<AuthenticatedBot, BotError>> + Send;

    /// Authenticate a raw bot token scoped to a channel.
    fn authenticate_channel_token(
        &self,
        channel_id: Uuid,
        token: &str,
    ) -> impl Future<Output = Result<AuthenticatedBot, BotError>> + Send;
}

/// Bot service error.
#[derive(Debug, thiserror::Error)]
pub enum BotError {
    /// Bad request.
    #[error("{0}")]
    BadRequest(String),
    /// Not found.
    #[error("{0}")]
    NotFound(String),
    /// Unauthorized.
    #[error("unauthorized")]
    Unauthorized,
    /// Repository error.
    #[error(transparent)]
    Repo(#[from] anyhow::Error),
}
