//! Bot service implementation.

use super::{
    events::{BotCreatedMetadata, BotDeletedMetadata, BotMacroEvent, BotUpdatedMetadata},
    models::{
        AuthenticatedBot, Bot, BotChannel, BotId, BotKind, BotOwner, BotToken, BotTokenCandidate,
        CreateBotRequest, CreateBotTokenRequest, CreateChannelScopedBotRequest,
        CreateChannelScopedBotResponse, PatchBotRequest,
    },
    ports::{BotError, BotRepo, BotService},
    tokens,
};
use chrono::{DateTime, Utc};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Bot service implementation.
#[derive(Debug, Clone)]
pub struct BotServiceImpl<R, B> {
    repo: R,
    event_broker: B,
}

impl<R, B> BotServiceImpl<R, B> {
    /// Create a bot service.
    pub fn new(repo: R, event_broker: B) -> Self {
        Self { repo, event_broker }
    }
}

fn validate_handle(handle: &str) -> Result<(), BotError> {
    if handle.is_empty()
        || handle.len() > 64
        || !handle
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
    {
        return Err(BotError::BadRequest(
            "handle must be lowercase ascii, digits, '-' or '_'".to_string(),
        ));
    }
    Ok(())
}

fn token_candidate_is_valid(candidate: &BotTokenCandidate, now: &DateTime<Utc>) -> bool {
    candidate.token.revoked_at.is_none()
        && candidate
            .token
            .expires_at
            .as_ref()
            .is_none_or(|expires_at| expires_at > now)
}

impl<R, B> BotServiceImpl<R, B>
where
    R: BotRepo,
    B: MacroEventBroker,
{
    fn publish_bot_event(&self, event: &BotMacroEvent) {
        drop(self.event_broker.send_event(event).inspect_err(|error| {
            tracing::error!(error=?error, "failed to schedule bot lifecycle event");
        }));
    }

    async fn owner_for_request(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Option<Uuid>,
    ) -> Result<BotOwner, BotError> {
        if let Some(team_id) = team_id {
            if !self
                .repo
                .user_has_team(caller.clone(), team_id)
                .await
                .map_err(|err| BotError::Repo(err.into()))?
            {
                return Err(BotError::Unauthorized);
            }
            return Ok(BotOwner::Team { team_id });
        }

        Ok(BotOwner::User {
            user_id: caller.as_ref().to_string(),
        })
    }

    async fn ensure_manageable(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<Bot, BotError> {
        let bot = self
            .repo
            .get_bot(bot_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))?
            .ok_or_else(|| BotError::NotFound("bot not found".to_string()))?;

        if bot.kind == BotKind::System {
            return Err(BotError::Unauthorized);
        }

        let Some(owner) = &bot.owner else {
            return Err(BotError::Unauthorized);
        };

        match owner {
            BotOwner::User { user_id } if user_id == caller.as_ref() => Ok(bot),
            BotOwner::Team { team_id }
                if self
                    .repo
                    .user_has_team(caller, *team_id)
                    .await
                    .map_err(|err| BotError::Repo(err.into()))? =>
            {
                Ok(bot)
            }
            _ => Err(BotError::Unauthorized),
        }
    }

    async fn authenticate_candidate(
        &self,
        candidate: Option<BotTokenCandidate>,
    ) -> Result<AuthenticatedBot, BotError> {
        let Some(candidate) = candidate else {
            return Err(BotError::Unauthorized);
        };

        let now = Utc::now();
        if !token_candidate_is_valid(&candidate, &now) {
            return Err(BotError::Unauthorized);
        }

        let token_id = candidate.token.id;
        let bot = candidate.bot;
        self.repo
            .mark_token_used(token_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;
        Ok(bot)
    }
}

impl<R, B> BotService for BotServiceImpl<R, B>
where
    R: BotRepo,
    B: MacroEventBroker + Clone,
{
    async fn create_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        req: CreateBotRequest,
    ) -> Result<Bot, BotError> {
        validate_handle(&req.handle)?;
        let owner = self.owner_for_request(caller.clone(), req.team_id).await?;
        let created_by_user_id = caller.clone();

        let bot = self
            .repo
            .create_owned_bot(owner, caller, req)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;

        self.publish_bot_event(&BotMacroEvent::created(BotCreatedMetadata {
            bot_id: bot.id,
            kind: bot.kind,
            owner: bot.owner.clone().expect("owned bot must have an owner"),
            name: bot.name.clone(),
            handle: bot.handle.clone(),
            description: bot.description.clone(),
            avatar_url: bot.avatar_url.clone(),
            created_by_user_id,
            channel_id: None,
            created_at: bot.created_at,
        }));

        Ok(bot)
    }

    async fn create_channel_scoped_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: CreateChannelScopedBotRequest,
    ) -> Result<CreateChannelScopedBotResponse, BotError> {
        validate_handle(&req.handle)?;
        let owner = self.owner_for_request(caller.clone(), req.team_id).await?;
        let created_by_user_id = caller.clone();
        let generated_token = tokens::generate_token();
        let (bot, token) = self
            .repo
            .create_channel_scoped_bot(owner, caller, channel_id, generated_token, req)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;
        let bot_token = token.token.clone();

        self.publish_bot_event(&BotMacroEvent::created(BotCreatedMetadata {
            bot_id: bot.id,
            kind: bot.kind,
            owner: bot.owner.clone().expect("owned bot must have an owner"),
            name: bot.name.clone(),
            handle: bot.handle.clone(),
            description: bot.description.clone(),
            avatar_url: bot.avatar_url.clone(),
            created_by_user_id,
            channel_id: Some(channel_id),
            created_at: bot.created_at,
        }));

        Ok(CreateChannelScopedBotResponse {
            bot,
            token,
            bot_token,
        })
    }

    async fn list_bots(&self, caller: MacroUserIdStr<'static>) -> Result<Vec<Bot>, BotError> {
        self.repo
            .list_manageable_bots(caller)
            .await
            .map_err(|err| BotError::Repo(err.into()))
    }

    async fn get_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<Bot, BotError> {
        self.ensure_manageable(caller, bot_id).await
    }

    async fn patch_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        req: PatchBotRequest,
    ) -> Result<Bot, BotError> {
        self.ensure_manageable(caller.clone(), bot_id).await?;
        if let Some(handle) = &req.handle {
            validate_handle(handle)?;
        }
        let requested_name = req.name.clone();
        let requested_handle = req.handle.clone();
        let requested_description = req.description.clone();
        let requested_avatar_url = req.avatar_url.clone();
        let bot = self
            .repo
            .patch_bot(bot_id, req)
            .await
            .map_err(|err| BotError::Repo(err.into()))?
            .ok_or_else(|| BotError::NotFound("bot not found".to_string()))?;

        self.publish_bot_event(&BotMacroEvent::updated(BotUpdatedMetadata {
            bot_id: bot.id,
            owner: bot.owner.clone().expect("owned bot must have an owner"),
            actor_user_id: caller,
            name: requested_name,
            handle: requested_handle,
            description: requested_description,
            avatar_url: requested_avatar_url,
            updated_at: bot.updated_at,
        }));

        Ok(bot)
    }

    async fn delete_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<(), BotError> {
        let bot = self.ensure_manageable(caller.clone(), bot_id).await?;
        if !self
            .repo
            .delete_bot(bot_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))?
        {
            return Err(BotError::NotFound("bot not found".to_string()));
        }

        self.publish_bot_event(&BotMacroEvent::deleted(BotDeletedMetadata {
            bot_id: bot.id,
            owner: bot.owner.expect("owned bot must have an owner"),
            actor_user_id: caller,
        }));

        Ok(())
    }

    async fn add_bot_to_channel(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> Result<(), BotError> {
        self.ensure_manageable(caller, bot_id).await?;
        self.repo
            .add_bot_to_channel(channel_id, bot_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))
    }

    async fn remove_bot_from_channel(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> Result<(), BotError> {
        self.ensure_manageable(caller, bot_id).await?;
        if self
            .repo
            .remove_bot_from_channel(channel_id, bot_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))?
        {
            Ok(())
        } else {
            Err(BotError::NotFound("channel bot not found".to_string()))
        }
    }

    async fn list_bot_channels(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<Vec<BotChannel>, BotError> {
        self.ensure_manageable(caller, bot_id).await?;
        self.repo
            .list_bot_channels(bot_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))
    }

    async fn list_channel_bots(&self, channel_id: Uuid) -> Result<Vec<Bot>, BotError> {
        self.repo
            .list_channel_bots(channel_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))
    }

    async fn create_token(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        req: CreateBotTokenRequest,
    ) -> Result<super::models::CreateBotTokenResponse, BotError> {
        self.ensure_manageable(caller, bot_id).await?;
        let generated_token = tokens::generate_token();
        let token = self
            .repo
            .create_token(bot_id, generated_token, req)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;
        let bearer_token = token.token.clone();

        Ok(super::models::CreateBotTokenResponse {
            token,
            bearer_token,
        })
    }

    async fn list_tokens(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<Vec<BotToken>, BotError> {
        self.ensure_manageable(caller, bot_id).await?;
        self.repo
            .list_tokens(bot_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))
    }

    async fn revoke_token(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        token_id: Uuid,
    ) -> Result<(), BotError> {
        self.ensure_manageable(caller, bot_id).await?;
        if self
            .repo
            .revoke_token(bot_id, token_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))?
        {
            Ok(())
        } else {
            Err(BotError::NotFound("token not found".to_string()))
        }
    }

    async fn authenticate_token(&self, token: &str) -> Result<AuthenticatedBot, BotError> {
        let candidate = self
            .repo
            .token_candidate(token)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;
        self.authenticate_candidate(candidate).await
    }

    async fn authenticate_channel_token(
        &self,
        channel_id: Uuid,
        token: &str,
    ) -> Result<AuthenticatedBot, BotError> {
        let candidate = self
            .repo
            .channel_token_candidate(channel_id, token)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;
        self.authenticate_candidate(candidate).await
    }
}
