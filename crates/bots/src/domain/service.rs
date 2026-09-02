//! Bot service implementation.

use super::{
    events::{BotCreatedMetadata, BotDeletedMetadata, BotMacroEvent, BotUpdatedMetadata},
    models::{
        Agent, AgentChannelScope, AuthenticatedBot, Bot, BotChannel, BotChannelListCaller, BotId,
        BotKind, BotOwner, BotToken, BotTokenCandidate, CreateAgentRequest, CreateBotRequest,
        CreateBotTokenRequest, CreateChannelScopedBotRequest, CreateChannelScopedBotResponse,
        HarnessId, HarnessOwner, PatchBotRequest, UpdateAgentRequest,
    },
    ports::{BotError, BotRepo, BotService},
    tokens,
};
use bot_token::HashedBotToken;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, MemberParticipantRole};
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

/// The fields create and update requests share, borrowed for validation so
/// both paths run the exact same checks without repeating the field list.
struct AgentFields<'a> {
    name: &'a str,
    handle: &'a str,
    harness: &'a str,
    harness_id: Option<HarnessId>,
    default_model: &'a str,
    channel_scope: AgentChannelScope,
    channel_ids: &'a [Uuid],
}

impl<'a> From<&'a CreateAgentRequest> for AgentFields<'a> {
    fn from(req: &'a CreateAgentRequest) -> Self {
        Self {
            name: &req.name,
            handle: &req.handle,
            harness: &req.harness,
            harness_id: req.harness_id,
            default_model: &req.default_model,
            channel_scope: req.channel_scope,
            channel_ids: &req.channel_ids,
        }
    }
}

impl<'a> From<&'a UpdateAgentRequest> for AgentFields<'a> {
    fn from(req: &'a UpdateAgentRequest) -> Self {
        Self {
            name: &req.name,
            handle: &req.handle,
            harness: &req.harness,
            harness_id: req.harness_id,
            default_model: &req.default_model,
            channel_scope: req.channel_scope,
            channel_ids: &req.channel_ids,
        }
    }
}

fn validate_agent_fields(
    AgentFields {
        name,
        handle,
        harness,
        harness_id,
        default_model,
        channel_scope,
        channel_ids,
    }: AgentFields<'_>,
) -> Result<(), BotError> {
    validate_handle(handle)?;
    if name.trim().is_empty() {
        return Err(BotError::BadRequest(
            "agent name must not be empty".to_string(),
        ));
    }
    if harness.trim().is_empty() {
        return Err(BotError::BadRequest(
            "agent harness must not be empty".to_string(),
        ));
    }
    // The `macrod` slug and a registered harness travel together: the slug
    // selects the external runtime path, the id says whose daemon serves it.
    match (harness == harness_id::MACROD_HARNESS_SLUG, harness_id) {
        (true, None) => {
            return Err(BotError::BadRequest(
                "agents on the macrod harness must reference a registered harness".to_string(),
            ));
        }
        (false, Some(_)) => {
            return Err(BotError::BadRequest(
                "harness_id applies only to the macrod harness".to_string(),
            ));
        }
        _ => {}
    }
    if default_model.trim().is_empty() {
        return Err(BotError::BadRequest(
            "agent default model must not be empty".to_string(),
        ));
    }

    match channel_scope {
        AgentChannelScope::All if !channel_ids.is_empty() => Err(BotError::BadRequest(
            "global agents must not include channel ids".to_string(),
        )),
        AgentChannelScope::Selected if channel_ids.is_empty() => Err(BotError::BadRequest(
            "channel-specific agents require at least one channel".to_string(),
        )),
        AgentChannelScope::Selected
            if channel_ids
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != channel_ids.len() =>
        {
            Err(BotError::BadRequest(
                "agent channel ids must be unique".to_string(),
            ))
        }
        _ => Ok(()),
    }
}

fn validate_agent_request(req: &CreateAgentRequest) -> Result<(), BotError> {
    validate_agent_fields(req.into())
}

fn validate_update_agent_request(req: &UpdateAgentRequest) -> Result<(), BotError> {
    validate_agent_fields(req.into())
}

fn token_candidate_is_valid(candidate: &BotTokenCandidate, now: &DateTime<Utc>) -> bool {
    candidate.token.revoked_at.is_none()
        && candidate
            .token
            .expires_at
            .as_ref()
            .is_none_or(|expires_at| expires_at > now)
}

struct ValidatedBotToken {
    bot: AuthenticatedBot,
    token_id: Uuid,
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
                .user_can_administer_team(caller.clone(), team_id)
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

    async fn agent_owner_for_request(
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

    /// Ensure the resolved agent owner may run agents on a registered harness.
    ///
    /// A team agent must run on its own team's harness - never on a private
    /// one, so a teammate's mention can never execute on a machine only one
    /// person controls. A private agent may run on the caller's own harness
    /// or on a team harness of a team the caller belongs to.
    async fn ensure_harness_usable(
        &self,
        caller: MacroUserIdStr<'static>,
        owner: &BotOwner,
        harness_id: Option<HarnessId>,
    ) -> Result<(), BotError> {
        let Some(harness_id) = harness_id else {
            return Ok(());
        };
        let harness_owner = self
            .repo
            .get_harness_owner(harness_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))?
            .ok_or_else(|| BotError::BadRequest("unknown harness".to_string()))?;

        let usable = match (owner, harness_owner) {
            (
                BotOwner::Team { team_id },
                HarnessOwner::Team {
                    team_id: harness_team,
                },
            ) => *team_id == harness_team,
            (BotOwner::Team { .. }, HarnessOwner::User { .. }) => false,
            (
                BotOwner::User { user_id },
                HarnessOwner::User {
                    user_id: harness_user,
                },
            ) => *user_id == harness_user,
            (
                BotOwner::User { .. },
                HarnessOwner::Team {
                    team_id: harness_team,
                },
            ) => self
                .repo
                .user_has_team(caller, harness_team)
                .await
                .map_err(|err| BotError::Repo(err.into()))?,
        };
        if !usable {
            return Err(BotError::Unauthorized);
        }
        Ok(())
    }

    async fn owner_for_agent_update(
        &self,
        caller: MacroUserIdStr<'static>,
        current: &Bot,
        requested_team_id: Option<Uuid>,
    ) -> Result<BotOwner, BotError> {
        match (current.owner.as_ref(), requested_team_id) {
            (Some(BotOwner::User { .. }), team_id) => {
                self.agent_owner_for_request(caller, team_id).await
            }
            (
                Some(BotOwner::Team {
                    team_id: current_team_id,
                }),
                Some(requested_team_id),
            ) if *current_team_id == requested_team_id => Ok(BotOwner::Team {
                team_id: requested_team_id,
            }),
            (Some(BotOwner::Team { .. }), None)
                if current.created_by.as_deref() == Some(caller.as_ref()) =>
            {
                Ok(BotOwner::User {
                    user_id: caller.as_ref().to_string(),
                })
            }
            _ => Err(BotError::Unauthorized),
        }
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
    ) -> Result<ValidatedBotToken, BotError> {
        let Some(candidate) = candidate else {
            return Err(BotError::Unauthorized);
        };

        let now = Utc::now();
        if !token_candidate_is_valid(&candidate, &now) {
            return Err(BotError::Unauthorized);
        }

        let authenticated = ValidatedBotToken {
            bot: candidate.bot,
            token_id: candidate.token.id,
        };
        self.repo
            .mark_token_used(authenticated.token_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;
        Ok(authenticated)
    }
}

impl<R, B> BotService for BotServiceImpl<R, B>
where
    R: BotRepo,
    B: MacroEventBroker + Clone,
{
    async fn create_agent(
        &self,
        caller: MacroUserIdStr<'static>,
        req: CreateAgentRequest,
    ) -> Result<Agent, BotError> {
        validate_agent_request(&req)?;
        if req.channel_scope == AgentChannelScope::Selected
            && !self
                .repo
                .user_has_channels(caller.clone(), &req.channel_ids)
                .await
                .map_err(|err| BotError::Repo(err.into()))?
        {
            return Err(BotError::Unauthorized);
        }

        let owner = self
            .agent_owner_for_request(caller.clone(), req.team_id)
            .await?;
        self.ensure_harness_usable(caller.clone(), &owner, req.harness_id)
            .await?;
        let created_by_user_id = caller.clone();
        let agent = self
            .repo
            .create_agent(owner, caller, req)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;

        self.publish_bot_event(&BotMacroEvent::created(BotCreatedMetadata {
            bot_id: agent.bot.id,
            kind: agent.bot.kind,
            owner: agent
                .bot
                .owner
                .clone()
                .expect("owned agent bot must have an owner"),
            name: agent.bot.name.clone(),
            handle: agent.bot.handle.clone(),
            description: agent.bot.description.clone(),
            avatar_url: agent.bot.avatar_url.clone(),
            created_by_user_id,
            channel_id: None,
            created_at: agent.bot.created_at,
        }));

        Ok(agent)
    }

    async fn update_agent(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        req: UpdateAgentRequest,
    ) -> Result<Agent, BotError> {
        let current = self.ensure_manageable(caller.clone(), bot_id).await?;

        validate_update_agent_request(&req)?;
        if req.channel_scope == AgentChannelScope::Selected
            && !self
                .repo
                .user_has_channels(caller.clone(), &req.channel_ids)
                .await
                .map_err(|err| BotError::Repo(err.into()))?
        {
            return Err(BotError::Unauthorized);
        }

        let owner = self
            .owner_for_agent_update(caller.clone(), &current, req.team_id)
            .await?;
        self.ensure_harness_usable(caller.clone(), &owner, req.harness_id)
            .await?;
        let requested_name = req.name.clone();
        let requested_handle = req.handle.clone();
        let requested_description = req.description.clone();
        let requested_avatar_url = req.avatar_url.clone();
        let agent = self
            .repo
            .update_agent(bot_id, owner, req)
            .await
            .map_err(|err| BotError::Repo(err.into()))?
            .ok_or_else(|| BotError::NotFound("agent not found".to_string()))?;

        self.publish_bot_event(&BotMacroEvent::updated(BotUpdatedMetadata {
            bot_id: agent.bot.id,
            owner: agent
                .bot
                .owner
                .clone()
                .expect("owned agent bot must have an owner"),
            actor_user_id: caller,
            name: Some(requested_name),
            handle: Some(requested_handle),
            description: requested_description,
            avatar_url: requested_avatar_url,
            updated_at: agent.bot.updated_at,
        }));

        Ok(agent)
    }

    async fn list_agents(&self, caller: MacroUserIdStr<'static>) -> Result<Vec<Agent>, BotError> {
        self.repo
            .list_manageable_agents(caller)
            .await
            .map_err(|err| BotError::Repo(err.into()))
    }

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
            .create_channel_scoped_bot(
                owner,
                caller,
                channel_id,
                HashedBotToken::from_raw(&generated_token),
                req,
            )
            .await
            .map_err(|err| BotError::Repo(err.into()))?;
        let bot_token = generated_token;

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

    async fn get_self(&self, bot_id: BotId) -> Result<Bot, BotError> {
        // A bot may always read itself; no manageability check.
        self.repo
            .get_bot(bot_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))?
            .ok_or_else(|| BotError::NotFound("bot not found".to_string()))
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
        if let Some(BotOwner::Team { team_id }) = &bot.owner
            && bot.created_by.as_deref() != Some(caller.as_ref())
            && !self
                .repo
                .user_owns_team(caller.clone(), *team_id)
                .await
                .map_err(|err| BotError::Repo(err.into()))?
        {
            return Err(BotError::Unauthorized);
        }
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
        access: EntityAccessReceipt<MemberParticipantRole>,
        bot_id: BotId,
    ) -> Result<(), BotError> {
        if access.entity().entity_type != EntityType::Channel {
            return Err(BotError::BadRequest(
                "channel access receipt required".to_string(),
            ));
        }
        let channel_id = Uuid::parse_str(&access.entity().entity_id)
            .map_err(|error| BotError::BadRequest(error.to_string()))?;
        let caller = access
            .get_authenticated_user()
            .cloned()
            .map_err(|_| BotError::Unauthorized)?;
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
        caller: BotChannelListCaller,
        bot_id: BotId,
    ) -> Result<Vec<BotChannel>, BotError> {
        match caller {
            BotChannelListCaller::User(user_id) => {
                self.ensure_manageable(user_id, bot_id).await?;
            }
            BotChannelListCaller::Bot(caller_id) if caller_id == bot_id => {}
            BotChannelListCaller::Internal => {}
            BotChannelListCaller::Bot(_) => {
                return Err(BotError::Unauthorized);
            }
        }
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
            .create_token(bot_id, HashedBotToken::from_raw(&generated_token), req)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;

        Ok(super::models::CreateBotTokenResponse {
            token,
            bearer_token: generated_token,
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

    async fn ensure_bot_in_channel(&self, bot_id: BotId, channel_id: Uuid) -> Result<(), BotError> {
        if self
            .repo
            .bot_active_in_channel(channel_id, bot_id)
            .await
            .map_err(|err| BotError::Repo(err.into()))?
        {
            Ok(())
        } else {
            Err(BotError::Unauthorized)
        }
    }

    async fn authenticate_token(&self, token: &str) -> Result<AuthenticatedBot, BotError> {
        let candidate = self
            .repo
            .token_candidate(token)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;
        Ok(self.authenticate_candidate(candidate).await?.bot)
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
        Ok(self.authenticate_candidate(candidate).await?.bot)
    }
}
