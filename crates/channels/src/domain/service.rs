use crate::domain::{
    dm::{DmPair, EnsureDms, EnsureDmsSummary},
    events::ChannelEvent,
    models::{
        Activity, ActivityType, AddParticipantsRequest, AttachmentEntityReference, BotId,
        ChannelAttachmentType, ChannelJoinCodeResponse, ChannelMetadata, ChannelParticipant,
        ChannelPreview, ChannelPreviewData, ChannelType, CreateEntityMentionOptions, EntityMention,
        GetOrCreateAction, GetOrCreateChannelResponse, GetOrCreateDmRequest,
        GetOrCreatePrivateRequest, ParticipantRole, PatchChannelRequest, ReferencedShareItem,
        RemoveParticipantsRequest, Sender, WithChannelId,
    },
    ports::{
        ChannelAttachmentsPage, ChannelEventDispatcher, ChannelMessagesErr, ChannelMutationErr,
        ChannelReferenceSharePermissions, ChannelRepo, ChannelService,
    },
};
use bot_id::cowlike::CowLike;
use channel_sender::ChannelSender;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, MemberParticipantRole};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, PaginateOn, Query};
use std::collections::HashSet;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Service implementation backed by a [`ChannelRepo`].
#[derive(Clone)]
pub struct ChannelServiceImpl<R, E = NoopChannelEventDispatcher> {
    repo: R,
    events: E,
}

/// No-op event dispatcher used by read-only contexts.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopChannelEventDispatcher;

impl ChannelEventDispatcher for NoopChannelEventDispatcher {
    fn dispatch(&self, _event: ChannelEvent) {}
}

/// No-op reference-sharing service used by read-only contexts.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopChannelReferenceSharePermissions;

impl ChannelReferenceSharePermissions for NoopChannelReferenceSharePermissions {
    type Err = anyhow::Error;

    async fn update_channel_share_permissions_for_referenced_items(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _items: Vec<ReferencedShareItem>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}

impl<R> ChannelServiceImpl<R, NoopChannelEventDispatcher>
where
    R: ChannelRepo,
{
    /// Create a new read-only service with no-op side-effect dependencies.
    pub fn new(repo: R) -> Self {
        Self {
            repo,
            events: NoopChannelEventDispatcher,
        }
    }
}

impl<R, E> ChannelServiceImpl<R, E> {
    /// Create a new service with outbound dependencies wired.
    pub fn with_dependencies(repo: R, events: E) -> Self {
        Self { repo, events }
    }
}

impl<R, E> ChannelServiceImpl<R, E>
where
    R: ChannelRepo,
    anyhow::Error: From<R::Err>,
{
}

fn require_user_actor(actor: &Sender) -> Result<MacroUserIdStr<'static>, ChannelMutationErr> {
    actor
        .as_user()
        .cloned()
        .ok_or_else(|| ChannelMutationErr::BadRequest("authenticated user required".to_string()))
}

fn participant_ids(participants: &[ChannelParticipant]) -> Vec<MacroUserIdStr<'static>> {
    participants
        .iter()
        .filter_map(|p| MacroUserIdStr::try_from(p.user_id.clone()).ok())
        .collect()
}

impl<R, E> ChannelServiceImpl<R, E>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
{
    #[tracing::instrument(err, skip(self, req))]
    async fn create_channel(
        &self,
        actor: Sender,
        _actor_org_id: Option<i64>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreateChannelResponse, ChannelMutationErr> {
        let owner = require_user_actor(&actor)?;
        self.create_owned_channel(owner.clone(), Sender::new_from_user(owner), None, req)
            .await
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn create_system_channel(
        &self,
        owner: MacroUserIdStr<'static>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreateChannelResponse, ChannelMutationErr> {
        self.create_channel_on_behalf(owner, bot_id::MACRO_SYSTEM_BOT_ID, req)
            .await
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn create_channel_on_behalf(
        &self,
        owner: MacroUserIdStr<'static>,
        actor: BotId,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreateChannelResponse, ChannelMutationErr> {
        self.create_owned_channel(owner.clone(), Sender::new_from_bot(actor), Some(owner), req)
            .await
    }

    async fn create_owned_channel(
        &self,
        owner: MacroUserIdStr<'static>,
        activity_actor: Sender,
        on_behalf_of: Option<MacroUserIdStr<'static>>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreateChannelResponse, ChannelMutationErr> {
        if req.auto_join_team && req.channel_type != ChannelType::Team {
            return Err(ChannelMutationErr::BadRequest(
                "auto-join is only available for team channels".to_string(),
            ));
        }
        if req.channel_type == ChannelType::Team {
            let team_id = req.team_id.ok_or_else(|| {
                ChannelMutationErr::BadRequest("team id missing for team channel type".to_string())
            })?;
            let has_team = self
                .repo
                .user_has_team(owner.as_ref().to_string(), team_id)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
            if !has_team {
                return Err(ChannelMutationErr::Unauthorized(
                    "you do not have access to that team".to_string(),
                ));
            }
        }

        if req.team_id.is_some() && req.channel_type != ChannelType::Team {
            return Err(ChannelMutationErr::BadRequest(
                "team channels need team channel type".to_string(),
            ));
        }

        let org_id = None;
        if req.participants.is_empty() && req.channel_type != ChannelType::Private {
            return Err(ChannelMutationErr::BadRequest(
                "participants must be a non-empty list of 'macro|<email>'".to_string(),
            ));
        }

        let channel_type = req.channel_type;
        let channel_name = req.name.clone();

        let created_channel = self
            .create_channel_record(owner.copied(), org_id, req)
            .await?;

        self.events.dispatch(ChannelEvent::ChannelCreated {
            channel_id: created_channel.id,
            actor: activity_actor,
            on_behalf_of,
            channel_type,
            channel_name,
            participant_user_ids: created_channel.participant_user_ids,
        });

        Ok(crate::domain::models::CreateChannelResponse {
            id: created_channel.id.to_string(),
        })
    }

    #[tracing::instrument(err, skip(self, command))]
    async fn ensure_dms(&self, command: EnsureDms) -> Result<EnsureDmsSummary, ChannelMutationErr> {
        let mut summary = EnsureDmsSummary::default();
        for request in command.into_requests() {
            let user_lo = request.pair.lo().as_ref().to_string();
            let user_hi = request.pair.hi().as_ref().to_string();
            match self.ensure_one_dm(request.pair, request.owner).await {
                Ok(GetOrCreateChannelResponse {
                    action: GetOrCreateAction::Create,
                    ..
                }) => summary.created += 1,
                Ok(GetOrCreateChannelResponse {
                    action: GetOrCreateAction::Get,
                    ..
                }) => summary.existing += 1,
                Err(error) => {
                    summary.failed += 1;
                    tracing::error!(
                        error=?error,
                        user_lo,
                        user_hi,
                        "unable to ensure teammate direct message"
                    );
                }
            }
        }
        Ok(summary)
    }

    #[tracing::instrument(err, skip(self, recipient_id))]
    async fn get_or_create_dm(
        &self,
        actor: Sender,
        GetOrCreateDmRequest { recipient_id }: GetOrCreateDmRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        let actor = require_user_actor(&actor)?;
        let pair = DmPair::new(actor.clone(), recipient_id).map_err(|_| {
            ChannelMutationErr::BadRequest(
                "recipient_id cannot be the same as the user_id".to_string(),
            )
        })?;
        self.ensure_one_dm(pair, actor).await
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn get_or_create_private(
        &self,
        actor: Sender,
        req: GetOrCreatePrivateRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        let actor = require_user_actor(&actor)?;
        if req.recipients.is_empty() {
            return Err(ChannelMutationErr::BadRequest(
                "recipients must be a non-empty list of 'macro|<email>'".to_string(),
            ));
        }

        let mut lookup = req.recipients.clone();
        lookup.insert(actor.clone());
        let existing_channel_id = self
            .repo
            .maybe_get_private_channel(lookup)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        self.get_or_create_channel(
            existing_channel_id,
            actor,
            None,
            crate::domain::models::CreateChannelRequest {
                name: None,
                channel_type: ChannelType::Private,
                team_id: None,
                auto_join_team: false,
                participants: req.recipients,
            },
        )
        .await
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn patch_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
        mut req: PatchChannelRequest,
    ) -> Result<(), ChannelMutationErr> {
        if req.channel_name.is_none()
            && req.convert_to_team_channel.is_none()
            && req.auto_join_team.is_none()
        {
            return Ok(());
        }

        let actor = require_user_actor(&actor)?;
        let info = self
            .repo
            .get_channel_info(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        if matches!(info.channel_type, ChannelType::DirectMessage) && req.channel_name.is_some() {
            return Err(ChannelMutationErr::BadRequest(
                "cannot change channel_name for direct message channels".to_string(),
            ));
        }

        let converting_to_team =
            req.convert_to_team_channel == Some(true) && info.channel_type != ChannelType::Team;
        let converting_to_private =
            req.convert_to_team_channel == Some(false) && info.channel_type == ChannelType::Team;
        let team_id = if converting_to_team {
            Some(
                self.repo
                    .get_user_team_id(&actor)
                    .await
                    .map_err(|e| ChannelMutationErr::Repo(e.into()))?
                    .ok_or_else(|| {
                        ChannelMutationErr::BadRequest(
                            "cannot convert channel because the user does not belong to a team"
                                .to_string(),
                        )
                    })?,
            )
        } else if converting_to_private {
            req.auto_join_team = Some(false);
            None
        } else {
            info.team_id
        };

        let is_team_channel =
            info.channel_type == ChannelType::Team && !converting_to_private || converting_to_team;
        if req.auto_join_team == Some(true) && (!is_team_channel || team_id.is_none()) {
            return Err(ChannelMutationErr::BadRequest(
                "auto-join is only available for team channels".to_string(),
            ));
        }

        if converting_to_team {
            let requested_name = req
                .channel_name
                .as_deref()
                .filter(|name| !name.trim().is_empty());
            let stored_name = info.name.as_deref().filter(|name| !name.trim().is_empty());
            if requested_name.is_none() {
                req.channel_name = if stored_name.is_some() {
                    None
                } else {
                    Some(
                        self.repo
                            .resolve_channel_name(&info, actor.clone())
                            .await
                            .map_err(|e| ChannelMutationErr::Repo(e.into()))?,
                    )
                };
            }
        }

        let channel_name = req.channel_name.clone();
        self.repo
            .patch_channel(channel_id, actor.as_ref().to_string(), team_id, req)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        if channel_name.is_some() {
            self.events.dispatch(ChannelEvent::ChannelUpdated {
                channel_id,
                actor,
                previous_name: info.name,
                channel_name,
            });
        }
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        let actor = require_user_actor(&actor)?;
        self.repo
            .delete_channel(channel_id, actor.as_ref().to_string())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        self.events.dispatch(ChannelEvent::ChannelDeleted {
            channel_id,
            actor: Sender::new_from_user(actor),
        });
        Ok(())
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn add_participants(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: AddParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        let actor_user = require_user_actor(&actor)?;
        let info = self
            .repo
            .get_channel_info(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        if info.channel_type == ChannelType::DirectMessage {
            return Err(ChannelMutationErr::BadRequest(
                "cannot add/remove participants from direct message channels".to_string(),
            ));
        }

        let mut membership_changed = false;
        for participant in &req.participants {
            let participant_changed = self
                .repo
                .add_participant(channel_id, participant.copied(), ParticipantRole::Member)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
            membership_changed |= participant_changed;
        }
        if membership_changed {
            self.repo
                .touch_channel_updated_at(channel_id)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        }

        let active_participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        let channel_metadata = self
            .repo
            .get_channel_metadata(channel_id, actor_user.clone())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        let active_participant_user_ids = participant_ids(&active_participants);
        self.events.dispatch(ChannelEvent::ParticipantsAdded {
            channel_id,
            channel_type: info.channel_type,
            active_participant_user_ids,
            invited_by: Sender::new_from_user(actor_user),
            recipient_user_ids: req.participants.into_iter().collect(),
            metadata: channel_metadata,
            message_content: None,
        });

        Ok(())
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn remove_participants(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: RemoveParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        let actor_user = require_user_actor(&actor)?;
        let info = self
            .repo
            .get_channel_info(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        if info.channel_type == ChannelType::DirectMessage {
            return Err(ChannelMutationErr::BadRequest(
                "cannot add or remove participants from direct message channel".to_string(),
            ));
        }
        let active_participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        let targets_owner = active_participants
            .iter()
            .any(|p| p.role == ParticipantRole::Owner && req.participants.contains(&p.user_id));
        if targets_owner {
            return Err(ChannelMutationErr::Unauthorized(
                "cannot remove the channel owner".to_string(),
            ));
        }
        for participant in &req.participants {
            self.repo
                .remove_participant(channel_id, participant.clone())
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        }
        self.events.dispatch(ChannelEvent::ParticipantsRemoved {
            channel_id,
            channel_type: info.channel_type,
            actor: actor_user,
            removed_user_ids: req
                .participants
                .into_iter()
                .filter_map(|id| MacroUserIdStr::try_from(id).ok())
                .collect(),
        });
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_join_code(
        &self,
        channel_id: Uuid,
    ) -> Result<ChannelJoinCodeResponse, ChannelMutationErr> {
        let info = self
            .repo
            .get_channel_info(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        if info.channel_type != ChannelType::Private {
            return Err(ChannelMutationErr::Forbidden(
                "join links are only available for private channels".to_string(),
            ));
        }

        let join_code = self
            .repo
            .get_or_create_channel_join_code(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        Ok(ChannelJoinCodeResponse { join_code })
    }

    #[tracing::instrument(err, skip(self))]
    async fn join_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        let info = self
            .repo
            .get_channel_info(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        if info.channel_type == ChannelType::DirectMessage {
            return Err(ChannelMutationErr::BadRequest(
                "cannot join direct message channel".to_string(),
            ));
        }
        self.join_channel_with_info(actor, info).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn join_channel_by_code(
        &self,
        actor: Sender,
        join_code: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        let info = self
            .repo
            .get_channel_info_by_join_code(join_code)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?
            .ok_or_else(|| {
                ChannelMutationErr::NotFound("channel join code not found".to_string())
            })?;
        if info.channel_type != ChannelType::Private {
            return Err(ChannelMutationErr::Forbidden(
                "join links are only valid for private channels".to_string(),
            ));
        }
        self.join_channel_with_info(actor, info).await
    }

    async fn join_channel_with_info(
        &self,
        actor: Sender,
        info: crate::domain::models::ChannelInfo,
    ) -> Result<(), ChannelMutationErr> {
        let actor_user = require_user_actor(&actor)?;
        let before = self
            .repo
            .get_participants(info.id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        let mut active_participant_user_ids = participant_ids(&before);
        let changed = self
            .repo
            .add_participant(info.id, actor_user.copied(), ParticipantRole::Member)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        if !changed {
            return Ok(());
        }

        self.repo
            .touch_channel_updated_at(info.id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        active_participant_user_ids.push(actor_user.clone());
        self.events.dispatch(ChannelEvent::ParticipantJoined {
            channel_id: info.id,
            channel_type: info.channel_type,
            user_id: Sender::new_from_user(actor_user),
            active_participant_user_ids,
        });
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn leave_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        let actor_user = require_user_actor(&actor)?;
        let info = self
            .repo
            .get_channel_info(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        // Bots can be channel participants; only user participants count
        // toward the minimum-membership guard.
        let user_participant_count = participants
            .iter()
            .filter(|participant| MacroUserIdStr::try_from(participant.user_id.as_str()).is_ok())
            .count();
        match (info.channel_type, user_participant_count) {
            (ChannelType::Private, 2) | (ChannelType::DirectMessage, _) => {
                return Err(ChannelMutationErr::BadRequest(
                    "cannot leave channel with only 2 participants".to_string(),
                ));
            }
            _ => {}
        }
        self.repo
            .remove_participant(channel_id, actor_user.as_ref().to_string())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        self.events.dispatch(ChannelEvent::ParticipantsRemoved {
            channel_id,
            channel_type: info.channel_type,
            actor: actor_user.clone(),
            removed_user_ids: vec![actor_user],
        });
        Ok(())
    }
}

impl<R, E> ChannelServiceImpl<R, E>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
{
    async fn ensure_one_dm(
        &self,
        pair: DmPair,
        owner: MacroUserIdStr<'static>,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        let existing_channel_id = self
            .repo
            .maybe_get_dm(pair.lo().clone(), pair.hi().clone())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        self.get_or_create_channel(
            existing_channel_id,
            owner,
            None,
            crate::domain::models::CreateChannelRequest {
                name: None,
                channel_type: ChannelType::DirectMessage,
                team_id: None,
                auto_join_team: false,
                participants: HashSet::from([pair.lo().clone(), pair.hi().clone()]),
            },
        )
        .await
    }

    async fn create_channel_record<'a>(
        &self,
        owner_id: MacroUserIdStr<'a>,
        org_id: Option<i64>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreatedChannel, ChannelMutationErr> {
        self.repo
            .create_channel(owner_id, org_id, req)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))
    }

    async fn get_or_create_channel(
        &self,
        existing_channel_id: Option<Uuid>,
        owner_id: MacroUserIdStr<'static>,
        org_id: Option<i64>,
        create_req: crate::domain::models::CreateChannelRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        if let Some(channel_id) = existing_channel_id {
            return Ok(GetOrCreateChannelResponse {
                channel_id: channel_id.to_string(),
                action: GetOrCreateAction::Get,
            });
        }

        let channel_type = create_req.channel_type;
        let channel_name = create_req.name.clone();
        let owner_sender = ChannelSender::new_from_user(owner_id.clone());
        let created_channel = self
            .create_channel_record(owner_id, org_id, create_req)
            .await?;
        self.events.dispatch(ChannelEvent::ChannelCreated {
            channel_id: created_channel.id,
            actor: owner_sender,
            on_behalf_of: None,
            channel_type,
            channel_name,
            participant_user_ids: created_channel.participant_user_ids,
        });
        Ok(GetOrCreateChannelResponse {
            channel_id: created_channel.id.to_string(),
            action: GetOrCreateAction::Create,
        })
    }
}

impl<R, E> ChannelService for ChannelServiceImpl<R, E>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    anyhow::Error: From<R::Err>,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_channel_attachments(
        &self,
        channel_id: Uuid,
        query: Query<Uuid, CreatedAt, ()>,
        limit: u16,
        attachment_type: Option<ChannelAttachmentType>,
    ) -> Result<ChannelAttachmentsPage, ChannelMessagesErr> {
        let limit = limit.clamp(1, 500);

        let attachments = self
            .repo
            .get_channel_attachments(channel_id, &query, limit, attachment_type)
            .await
            .map_err(anyhow::Error::from)?;

        let page = attachments
            .into_iter()
            .paginate_on(limit.into(), CreatedAt)
            .filter_on(())
            .into_page();

        Ok(page)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_participants(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, ChannelMessagesErr> {
        let participants = self
            .repo
            .get_channel_participants(channel_id)
            .await
            .map_err(anyhow::Error::from)?;

        Ok(participants)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_metadata(
        &self,
        channel_id: Uuid,
        viewer_user_id: MacroUserIdStr<'static>,
    ) -> Result<ChannelMetadata, ChannelMessagesErr> {
        let metadata = self
            .repo
            .get_channel_metadata(channel_id, viewer_user_id)
            .await
            .map_err(anyhow::Error::from)?;

        Ok(metadata)
    }

    #[tracing::instrument(err, skip(self, channel_ids))]
    async fn batch_get_channel_previews(
        &self,
        viewer_user_id: MacroUserIdStr<'static>,
        org_id: Option<i64>,
        channel_ids: Vec<String>,
    ) -> Result<Vec<ChannelPreview>, ChannelMessagesErr> {
        let rows = self
            .repo
            .batch_get_channel_previews(&channel_ids, viewer_user_id.as_ref(), org_id)
            .await
            .map_err(anyhow::Error::from)?;

        let mut previews: Vec<ChannelPreview> = Vec::with_capacity(channel_ids.len());
        let mut found: std::collections::HashSet<String> = std::collections::HashSet::new();

        for row in rows {
            let channel_id_str = row.info.id.to_string();
            found.insert(channel_id_str.clone());
            let channel_type = row.info.channel_type;
            let channel_name = self
                .repo
                .resolve_channel_name(&row.info, viewer_user_id.clone())
                .await
                .map_err(anyhow::Error::from)?;
            previews.push(ChannelPreview::Access(ChannelPreviewData {
                channel_id: channel_id_str,
                channel_name,
                channel_type,
            }));
        }

        for id in channel_ids {
            if !found.contains(&id) {
                previews.push(ChannelPreview::DoesNotExist(WithChannelId {
                    channel_id: id,
                }));
            }
        }

        Ok(previews)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_activities(&self, user_id: String) -> Result<Vec<Activity>, ChannelMessagesErr> {
        let activities = self
            .repo
            .get_activities(user_id)
            .await
            .map_err(anyhow::Error::from)?;

        Ok(activities)
    }

    #[tracing::instrument(err, skip(self))]
    async fn post_activity(
        &self,
        access: EntityAccessReceipt<MemberParticipantRole>,
        activity_type: ActivityType,
    ) -> Result<Activity, ChannelMutationErr> {
        if access.entity().entity_type != EntityType::Channel {
            return Err(ChannelMutationErr::BadRequest(
                "channel access receipt required".to_string(),
            ));
        }
        let channel_id = Uuid::parse_str(&access.entity().entity_id)
            .map_err(|error| ChannelMutationErr::BadRequest(error.to_string()))?;
        let actor = access.get_authenticated_user().map_err(|_| {
            ChannelMutationErr::Unauthorized("authenticated user required".to_string())
        })?;

        let activity = self
            .repo
            .set_activity(actor.as_ref().to_string(), channel_id, activity_type)
            .await
            .map_err(anyhow::Error::from)?;

        Ok(activity)
    }

    #[tracing::instrument(err, skip(self, user_id))]
    async fn get_attachment_references(
        &self,
        entity_type: String,
        entity_id: String,
        user_id: String,
    ) -> Result<Vec<AttachmentEntityReference>, ChannelMessagesErr> {
        self.repo
            .get_attachment_references(&entity_type, &entity_id, &user_id)
            .await
            .map_err(anyhow::Error::from)
            .map_err(ChannelMessagesErr::Repo)
    }

    async fn create_channel(
        &self,
        actor: Sender,
        _actor_org_id: Option<i64>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreateChannelResponse, ChannelMutationErr> {
        ChannelServiceImpl::create_channel(self, actor, None, req).await
    }

    async fn create_system_channel(
        &self,
        owner: MacroUserIdStr<'static>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreateChannelResponse, ChannelMutationErr> {
        ChannelServiceImpl::create_system_channel(self, owner, req).await
    }

    async fn create_channel_on_behalf(
        &self,
        owner: MacroUserIdStr<'static>,
        actor: BotId,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreateChannelResponse, ChannelMutationErr> {
        ChannelServiceImpl::create_channel_on_behalf(self, owner, actor, req).await
    }

    #[tracing::instrument(err, skip(self, user_id))]
    async fn auto_join_by_team_id(
        &self,
        team_id: &Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), ChannelMutationErr> {
        self.repo
            .auto_join_by_team_id(team_id, user_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))
    }

    #[tracing::instrument(err, skip(self, user_id))]
    async fn leave_by_team_id(
        &self,
        team_id: &Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<Uuid>, ChannelMutationErr> {
        self.repo
            .leave_by_team_id(team_id, user_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))
    }

    #[tracing::instrument(err, skip(self, user_id, channel_ids))]
    async fn restore_by_channel_ids(
        &self,
        user_id: &MacroUserIdStr<'_>,
        channel_ids: &[Uuid],
    ) -> Result<(), ChannelMutationErr> {
        self.repo
            .restore_by_channel_ids(user_id, channel_ids)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))
    }

    async fn ensure_dms(&self, command: EnsureDms) -> Result<EnsureDmsSummary, ChannelMutationErr> {
        ChannelServiceImpl::ensure_dms(self, command).await
    }

    async fn get_or_create_dm(
        &self,
        actor: Sender,
        req: GetOrCreateDmRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        ChannelServiceImpl::get_or_create_dm(self, actor, req).await
    }

    async fn get_or_create_private(
        &self,
        actor: Sender,
        req: GetOrCreatePrivateRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        ChannelServiceImpl::get_or_create_private(self, actor, req).await
    }

    async fn patch_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PatchChannelRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::patch_channel(self, actor, channel_id, req).await
    }

    async fn delete_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::delete_channel(self, actor, channel_id).await
    }

    async fn add_participants(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: AddParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::add_participants(self, actor, channel_id, req).await
    }

    async fn remove_participants(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: RemoveParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::remove_participants(self, actor, channel_id, req).await
    }

    async fn get_channel_join_code(
        &self,
        channel_id: Uuid,
    ) -> Result<ChannelJoinCodeResponse, ChannelMutationErr> {
        ChannelServiceImpl::get_channel_join_code(self, channel_id).await
    }

    async fn join_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::join_channel(self, actor, channel_id).await
    }

    async fn join_channel_by_code(
        &self,
        actor: Sender,
        join_code: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::join_channel_by_code(self, actor, join_code).await
    }

    async fn leave_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::leave_channel(self, actor, channel_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn create_entity_mention(
        &self,
        options: CreateEntityMentionOptions,
    ) -> Result<EntityMention, ChannelMutationErr> {
        let mention = self
            .repo
            .create_entity_mention(options)
            .await
            .map_err(anyhow::Error::from)
            .map_err(ChannelMutationErr::Repo)?;
        self.events.dispatch(ChannelEvent::EntityMentionCreated {
            mention: mention.clone(),
        });
        Ok(mention)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_entity_mention(
        &self,
        id: Uuid,
    ) -> Result<Option<EntityMention>, ChannelMutationErr> {
        self.repo
            .get_entity_mention_by_id(id)
            .await
            .map_err(anyhow::Error::from)
            .map_err(ChannelMutationErr::Repo)
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_entity_mention(&self, id: Uuid) -> Result<bool, ChannelMutationErr> {
        let mention = self
            .repo
            .delete_entity_mention_by_id(id)
            .await
            .map_err(anyhow::Error::from)
            .map_err(ChannelMutationErr::Repo)?;
        let deleted = mention.is_some();
        if let Some(mention) = mention {
            self.events
                .dispatch(ChannelEvent::EntityMentionDeleted { mention });
        }
        Ok(deleted)
    }
}
