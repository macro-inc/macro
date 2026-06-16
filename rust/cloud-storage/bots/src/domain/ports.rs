//! Bot ports.

use super::models::{
    AuthenticatedBot, Bot, BotId, BotOwner, BotToken, BotTokenCandidate, CreateBotRequest,
    CreateBotTokenRequest, CreateBotTokenResponse, CreateChannelScopedBotRequest,
    CreateChannelScopedBotResponse, PatchBotRequest,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use uuid::Uuid;

/// Bot repository.
pub trait BotRepo: Clone + Send + Sync + 'static {
    /// Repository error.
    type Err: Into<anyhow::Error> + Send;

    /// Create an owned bot.
    fn create_owned_bot(
        &self,
        owner: BotOwner,
        created_by: MacroUserIdStr<'static>,
        req: CreateBotRequest,
    ) -> impl Future<Output = Result<Bot, Self::Err>> + Send;

    /// Create an owned bot, add it to a channel, and create a token atomically.
    fn create_channel_scoped_bot(
        &self,
        owner: BotOwner,
        created_by: MacroUserIdStr<'static>,
        channel_id: Uuid,
        token: String,
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

    /// Check team membership.
    fn user_has_team(
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

    /// List active bots in a channel.
    fn list_channel_bots(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<Bot>, Self::Err>> + Send;

    /// Create a token.
    fn create_token(
        &self,
        bot_id: BotId,
        token: String,
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

    /// Lookup a token candidate by exact raw token value.
    fn token_candidate(
        &self,
        token: &str,
    ) -> impl Future<Output = Result<Option<BotTokenCandidate>, Self::Err>> + Send;

    /// Lookup a channel-scoped token candidate by exact raw token value.
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
pub trait BotService: Clone + Send + Sync + 'static {
    /// Create a bot owned by the caller or one of their teams.
    fn create_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        req: CreateBotRequest,
    ) -> impl Future<Output = Result<Bot, BotError>> + Send;

    /// Create a bot owned by the caller and scoped to a channel.
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
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<(), BotError>> + Send;

    /// Remove a bot from a channel.
    fn remove_bot_from_channel(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<(), BotError>> + Send;

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
