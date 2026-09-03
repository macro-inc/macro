use crate::domain::{
    dm::{DmPair, EnsureDms, EnsureDmsSummary},
    events::ChannelEvent,
    models::{
        Activity, ActivityType, AddParticipantsRequest, AttachmentEntityReference, BotId,
        BotSenderProfile, ChannelAttachmentType, ChannelContextMessage, ChannelJoinCodeResponse,
        ChannelMessage, ChannelMessageFilters, ChannelMetadata, ChannelParticipant, ChannelPreview,
        ChannelPreviewData, ChannelType, CreateEntityMentionOptions, DeleteMessageQuery,
        EntityMention, GetOrCreateAction, GetOrCreateChannelResponse, GetOrCreateDmRequest,
        GetOrCreatePrivateRequest, MessagePageDirection, NewChannelAttachment, ParticipantRole,
        PatchChannelRequest, PatchMessageNotificationPolicy, PatchMessageRequest,
        PostMessageRequest, PostMessageResponse, PostReactionRequest, PostTypingRequest,
        ReactionAction, ReferencedShareItem, RemoveParticipantsRequest, ResolvedChannelMessage,
        Sender, SimpleMention, ThreadInfo, ThreadReply, ThreadReplyRow, TopLevelMessageRow,
        WithChannelId,
    },
    ports::{
        ChannelAttachmentsPage, ChannelEventDispatcher, ChannelMentionExtractor,
        ChannelMessagesErr, ChannelMessagesQueryResult, ChannelMutationErr,
        ChannelReferenceSharePermissions, ChannelRepo, ChannelService,
    },
    side_effects::bot_mention_ids,
};
use bot_id::BotIdStr;
use bot_id::cowlike::CowLike;
use channel_sender::ChannelSender;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, MemberParticipantRole};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, PaginateOn, Query};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Default number of preview replies per thread.
const THREAD_PREVIEW_COUNT: u16 = 3;

/// Service implementation backed by a [`ChannelRepo`].
#[derive(Clone)]
pub struct ChannelServiceImpl<
    R,
    E = NoopChannelEventDispatcher,
    P = NoopChannelReferenceSharePermissions,
    M = NoopChannelMentionExtractor,
> {
    repo: R,
    events: E,
    reference_share_permissions: P,
    mention_extractor: M,
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

/// No-op mention extractor used by contexts that don't derive mentions from
/// message content.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopChannelMentionExtractor;

impl ChannelMentionExtractor for NoopChannelMentionExtractor {
    type Err = anyhow::Error;

    async fn extract_mentions(&self, _content: &str) -> Result<Vec<SimpleMention>, Self::Err> {
        Ok(Vec::new())
    }
}

impl<R> ChannelServiceImpl<R, NoopChannelEventDispatcher, NoopChannelReferenceSharePermissions>
where
    R: ChannelRepo,
{
    /// Create a new read-only service with no-op side-effect dependencies.
    pub fn new(repo: R) -> Self {
        Self {
            repo,
            events: NoopChannelEventDispatcher,
            reference_share_permissions: NoopChannelReferenceSharePermissions,
            mention_extractor: NoopChannelMentionExtractor,
        }
    }
}

impl<R, E, P> ChannelServiceImpl<R, E, P> {
    /// Create a new service with outbound dependencies wired.
    pub fn with_dependencies(repo: R, events: E, reference_share_permissions: P) -> Self {
        Self {
            repo,
            events,
            reference_share_permissions,
            mention_extractor: NoopChannelMentionExtractor,
        }
    }
}

impl<R, E, P, M> ChannelServiceImpl<R, E, P, M> {
    /// Replace the mention extractor used to derive mentions from
    /// bot-authored message content.
    pub fn with_mention_extractor<M2>(
        self,
        mention_extractor: M2,
    ) -> ChannelServiceImpl<R, E, P, M2> {
        ChannelServiceImpl {
            repo: self.repo,
            events: self.events,
            reference_share_permissions: self.reference_share_permissions,
            mention_extractor,
        }
    }
}

impl<R, E, P, M> ChannelServiceImpl<R, E, P, M>
where
    R: ChannelRepo,
    anyhow::Error: From<R::Err>,
{
    /// Hydrate top-level message rows with thread data, reactions, and attachments.
    async fn hydrate_messages(
        &self,
        rows: Vec<TopLevelMessageRow>,
    ) -> Result<Vec<ChannelMessage>, ChannelMessagesErr> {
        let parent_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();

        let thread_data = self
            .repo
            .get_thread_data(&parent_ids, THREAD_PREVIEW_COUNT)
            .await
            .map_err(anyhow::Error::from)?;

        let mut all_ids: Vec<Uuid> = parent_ids.clone();
        let mut sender_ids: Vec<&str> = rows.iter().map(|r| r.sender_id.as_str()).collect();
        for td in thread_data.values() {
            for reply in &td.preview_replies {
                all_ids.push(reply.id);
                sender_ids.push(reply.sender_id.as_str());
            }
        }

        let (reactions, attachments, bot_profiles) = tokio::join!(
            self.repo.get_reactions_batch(&all_ids),
            self.repo.get_attachments_batch(&all_ids),
            self.get_bot_profiles_for_senders(sender_ids),
        );

        let reactions = reactions.map_err(anyhow::Error::from)?;
        let attachments = attachments.map_err(anyhow::Error::from)?;
        let bot_profiles = bot_profiles?;

        let messages: Vec<ChannelMessage> = rows
            .into_iter()
            .map(|row| {
                let td = thread_data.get(&row.id);
                let preview_replies = td
                    .map(|td| {
                        td.preview_replies
                            .iter()
                            .map(|r| ThreadReply {
                                id: r.id,
                                bot_profile: bot_profile_for(&bot_profiles, &r.sender_id),
                                sender_id: r.sender_id.clone(),
                                triggered_by: r.triggered_by.clone(),
                                content: r.content.clone(),
                                created_at: r.created_at,
                                updated_at: r.updated_at,
                                edited_at: r.edited_at,
                                reactions: reactions.get(&r.id).cloned().unwrap_or_default(),
                                attachments: attachments.get(&r.id).cloned().unwrap_or_default(),
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                ChannelMessage {
                    id: row.id,
                    channel_id: row.channel_id,
                    bot_profile: bot_profile_for(&bot_profiles, &row.sender_id),
                    sender_id: row.sender_id,
                    triggered_by: row.triggered_by,
                    content: row.content,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    edited_at: row.edited_at,
                    deleted_at: row.deleted_at,
                    thread: ThreadInfo {
                        reply_count: td.map_or(0, |td| td.reply_count),
                        latest_reply_at: td.and_then(|td| td.latest_reply_at),
                        preview: preview_replies,
                    },
                    reactions: reactions.get(&row.id).cloned().unwrap_or_default(),
                    attachments: attachments.get(&row.id).cloned().unwrap_or_default(),
                }
            })
            .collect();

        Ok(messages)
    }

    /// Hydrate thread reply rows with reactions, attachments, and bot profiles.
    async fn hydrate_thread_replies(
        &self,
        reply_rows: Vec<ThreadReplyRow>,
    ) -> Result<Vec<ThreadReply>, ChannelMessagesErr> {
        if reply_rows.is_empty() {
            return Ok(Vec::new());
        }

        let reply_ids: Vec<Uuid> = reply_rows.iter().map(|row| row.id).collect();
        let (reactions, attachments, bot_profiles) = tokio::join!(
            self.repo.get_reactions_batch(&reply_ids),
            self.repo.get_attachments_batch(&reply_ids),
            self.get_bot_profiles_for_senders(reply_rows.iter().map(|row| row.sender_id.as_str())),
        );

        let reactions = reactions.map_err(anyhow::Error::from)?;
        let attachments = attachments.map_err(anyhow::Error::from)?;
        let bot_profiles = bot_profiles?;

        Ok(reply_rows
            .into_iter()
            .map(|row| ThreadReply {
                id: row.id,
                bot_profile: bot_profile_for(&bot_profiles, &row.sender_id),
                sender_id: row.sender_id,
                triggered_by: row.triggered_by,
                content: row.content,
                created_at: row.created_at,
                updated_at: row.updated_at,
                edited_at: row.edited_at,
                reactions: reactions.get(&row.id).cloned().unwrap_or_default(),
                attachments: attachments.get(&row.id).cloned().unwrap_or_default(),
            })
            .collect())
    }

    /// Batch-fetch public bot profiles for any bot senders among `sender_ids`.
    async fn get_bot_profiles_for_senders(
        &self,
        sender_ids: impl IntoIterator<Item = &str>,
    ) -> Result<HashMap<BotId, BotSenderProfile>, ChannelMessagesErr> {
        let bot_ids: HashSet<BotId> = sender_ids
            .into_iter()
            .filter_map(|id| BotIdStr::parse_from_str(id).ok())
            .map(|x| x.bot_id())
            .collect();
        if bot_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let bot_ids: Vec<BotId> = bot_ids.into_iter().collect();
        self.repo
            .get_bot_profiles(&bot_ids)
            .await
            .map_err(anyhow::Error::from)
            .map_err(ChannelMessagesErr::Repo)
    }
}

/// Resolve the bot profile for a sender id, if the sender is a known bot.
fn bot_profile_for(
    profiles: &HashMap<BotId, BotSenderProfile>,
    sender_id: &str,
) -> Option<BotSenderProfile> {
    let bot_id = BotIdStr::parse_from_str(sender_id).ok()?.bot_id();
    profiles.get(&bot_id).cloned()
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

fn extract_share_items(
    attachments: &[NewChannelAttachment],
    mentions: &[SimpleMention],
) -> Vec<ReferencedShareItem> {
    attachments
        .iter()
        .filter_map(|a| ReferencedShareItem::from_raw(a.entity_id.clone(), &a.entity_type))
        .chain(
            mentions
                .iter()
                .filter_map(|m| ReferencedShareItem::from_raw(m.entity_id.clone(), &m.entity_type)),
        )
        .collect()
}

fn is_admin_or_owner(role: ParticipantRole) -> bool {
    matches!(role, ParticipantRole::Owner | ParticipantRole::Admin)
}

impl<R, E, P, M> ChannelServiceImpl<R, E, P, M>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
    M: ChannelMentionExtractor,
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
        self.create_owned_channel(
            owner.clone(),
            Sender::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID),
            Some(owner),
            req,
        )
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

    /// Best-effort extraction of the mentions embedded in message content;
    /// extraction failure yields no mentions rather than failing the send.
    async fn extract_content_mentions(&self, content: &str) -> Vec<SimpleMention> {
        match self.mention_extractor.extract_mentions(content).await {
            Ok(mentions) => mentions,
            Err(err) => {
                tracing::error!(error=?err.into(), "unable to extract mentions from message content");
                Vec::new()
            }
        }
    }

    #[tracing::instrument(
        err,
        skip(self, req),
        fields(
            channel.id = %channel_id,
            channel.message.scope = tracing::field::Empty,
            channel.message.mention_count = tracing::field::Empty,
            agent.mention.bot_count = tracing::field::Empty,
        )
    )]
    async fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> Result<PostMessageResponse, ChannelMutationErr> {
        // Bots send raw macro markdown without a tracked mention list (the web
        // editor builds that list for user-authored messages), so derive it
        // from the content to keep bot-created references tracked.
        let mut req = req;
        if actor.as_bot().is_some() && req.mentions.is_empty() {
            req.mentions = self.extract_content_mentions(&req.content).await;
        }
        tracing::Span::current().record(
            "channel.message.scope",
            if req.thread_id.is_some() {
                "thread"
            } else {
                "channel_top_level"
            },
        );
        tracing::Span::current().record("channel.message.mention_count", req.mentions.len());
        tracing::Span::current().record(
            "agent.mention.bot_count",
            bot_mention_ids(&req.mentions).len(),
        );

        let message = self
            .repo
            .create_message(
                channel_id,
                actor.clone(),
                req.triggered_by.clone(),
                req.content.clone(),
                req.thread_id,
            )
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        if let Err(err) = self.repo.touch_channel_updated_at(channel_id).await {
            tracing::error!(error=?err.into(), "unable to update channel updated_at");
        }

        if let Err(err) = self
            .repo
            .create_message_mentions(message.id, req.mentions.clone())
            .await
        {
            tracing::error!(error=?err.into(), "unable to create mentions");
        }

        let items = extract_share_items(&req.attachments, &req.mentions);
        if !items.is_empty()
            && let Some(user_actor) = actor.as_user()
            && let Err(err) = self
                .reference_share_permissions
                .update_channel_share_permissions_for_referenced_items(
                    user_actor.clone(),
                    channel_id,
                    items,
                )
                .await
        {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to update channel share permissions");
        }

        let channel_metadata = if let Some(user_actor) = actor.as_user() {
            self.repo
                .get_channel_metadata(channel_id, user_actor.clone())
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?
        } else {
            let info = self
                .repo
                .get_channel_info(channel_id)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
            ChannelMetadata {
                channel_type: info.channel_type,
                channel_name: info.name.unwrap_or_default(),
            }
        };
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        if actor.as_user().is_some()
            && let Err(err) = self.repo.upsert_activity(actor, channel_id).await
        {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to upsert activity for message");
        }

        let has_attachments = !req.attachments.is_empty();
        let attachments = self
            .repo
            .add_attachments(message.id, channel_id, req.attachments.clone())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        self.events.dispatch(ChannelEvent::MessagePosted {
            channel_id,
            metadata: channel_metadata,
            participants,
            message: message.clone(),
            mentions: req.mentions,
            has_attachments,
            attachments,
            nonce: req.nonce.clone(),
            notification_policy: req.notification_policy,
        });

        Ok(PostMessageResponse {
            id: message.id.to_string(),
            nonce: req.nonce,
        })
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn patch_message(
        &self,
        actor: Sender,
        actor_role: ParticipantRole,
        channel_id: Uuid,
        message_id: Uuid,
        req: PatchMessageRequest,
    ) -> Result<(), ChannelMutationErr> {
        let PatchMessageRequest {
            content,
            mentions: replacement_mentions,
            attachment_ids_to_delete,
            attachments_to_add,
            nonce,
            notification_policy,
        } = req;

        // As in post_message: bots don't track a mention list, so when a bot
        // replaces message content (e.g. Macro AI swapping its "thinking"
        // placeholder for the reply), derive the mentions from the new content.
        let replacement_mentions = match (replacement_mentions, &content) {
            (None, Some(content)) if actor.as_bot().is_some() => {
                Some(self.extract_content_mentions(content).await)
            }
            (mentions, _) => mentions,
        };

        let owner = self
            .repo
            .get_message_owner(channel_id, message_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?
            .ok_or_else(|| ChannelMutationErr::NotFound("message not found".to_string()))?;
        if owner != actor && !is_admin_or_owner(actor_role) {
            return Err(ChannelMutationErr::Unauthorized(
                "user is not authorized to edit this message".to_string(),
            ));
        }

        let attachments_to_delete = attachment_ids_to_delete.clone().unwrap_or_default();
        let attachments_to_add = attachments_to_add.clone().unwrap_or_default();
        let attachments_changed =
            !attachments_to_delete.is_empty() || !attachments_to_add.is_empty();

        if attachments_changed {
            self.patch_message_attachments(
                actor.clone(),
                channel_id,
                message_id,
                attachments_to_delete,
                attachments_to_add,
                nonce.clone(),
            )
            .await?;
        }

        if let Some(content) = content.as_ref() {
            let message = self
                .repo
                .patch_message(channel_id, message_id, content.clone())
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

            if let Some(mentions) = replacement_mentions.clone() {
                self.repo
                    .sync_message_mentions(message_id, mentions.clone())
                    .await
                    .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

                let items = extract_share_items(&[], &mentions);
                if !items.is_empty()
                    && let Some(user_actor) = actor.as_user()
                    && let Err(err) = self
                        .reference_share_permissions
                        .update_channel_share_permissions_for_referenced_items(
                            user_actor.clone(),
                            channel_id,
                            items,
                        )
                        .await
                {
                    let err: anyhow::Error = err.into();
                    tracing::error!(error=?err, "unable to update channel share permissions");
                }
            }

            let channel_participants = self
                .repo
                .get_participants(channel_id)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
            let recipients = participant_ids(&channel_participants);

            let posted_notification =
                if notification_policy == PatchMessageNotificationPolicy::NotifyAsPostedMessage {
                    let metadata = if let Some(user_actor) = actor.as_user() {
                        self.repo
                            .get_channel_metadata(channel_id, user_actor.clone())
                            .await
                            .map_err(|e| ChannelMutationErr::Repo(e.into()))?
                    } else {
                        let info = self
                            .repo
                            .get_channel_info(channel_id)
                            .await
                            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
                        ChannelMetadata {
                            channel_type: info.channel_type,
                            channel_name: info.name.unwrap_or_default(),
                        }
                    };
                    let has_attachments = !self
                        .repo
                        .get_message_attachments(message_id)
                        .await
                        .map_err(|e| ChannelMutationErr::Repo(e.into()))?
                        .is_empty();

                    Some(crate::domain::events::MessageChangedNotificationContext {
                        metadata,
                        participants: channel_participants,
                        mentions: replacement_mentions.clone().unwrap_or_default(),
                        has_attachments,
                    })
                } else {
                    None
                };

            self.events.dispatch(ChannelEvent::MessageChanged {
                channel_id,
                actor: actor.clone(),
                message: message.clone(),
                recipients,
                nonce,
                posted_notification,
            });

            if actor.as_user().is_some()
                && let Err(err) = self.repo.upsert_activity(actor.clone(), channel_id).await
            {
                let err: anyhow::Error = err.into();
                tracing::error!(error=?err, "unable to upsert activity for message");
            }
        }

        if attachments_changed
            && content.is_none()
            && actor.as_user().is_some()
            && let Err(err) = self.repo.upsert_activity(actor, channel_id).await
        {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to upsert activity for attachment patch");
        }

        if attachments_changed || content.is_some() {
            self.repo
                .touch_channel_updated_at(channel_id)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self, query))]
    async fn delete_message(
        &self,
        actor: Sender,
        actor_role: ParticipantRole,
        channel_id: Uuid,
        message_id: Uuid,
        query: DeleteMessageQuery,
    ) -> Result<(), ChannelMutationErr> {
        let owner = self
            .repo
            .get_message_owner(channel_id, message_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?
            .ok_or_else(|| ChannelMutationErr::NotFound("message not found".to_string()))?;
        // Any participant may delete bot-authored messages.
        let owner_is_bot = owner.as_bot().is_some();
        if owner != actor && !owner_is_bot && !is_admin_or_owner(actor_role) {
            return Err(ChannelMutationErr::Unauthorized(
                "user is not authorized to delete this message".to_string(),
            ));
        }

        let message = self
            .repo
            .delete_message(channel_id, message_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        self.events.dispatch(ChannelEvent::MessageDeleted {
            channel_id,
            actor,
            message,
            recipients: participant_ids(&participants),
            nonce: query.nonce,
        });
        Ok(())
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn post_reaction(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostReactionRequest,
    ) -> Result<(), ChannelMutationErr> {
        let message_id = Uuid::parse_str(&req.message_id)
            .map_err(|err| ChannelMutationErr::BadRequest(err.to_string()))?;
        self.repo
            .get_message_owner(channel_id, message_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?
            .ok_or_else(|| ChannelMutationErr::NotFound("message not found".to_string()))?;
        match req.action {
            ReactionAction::Add => {
                self.repo
                    .add_reaction(channel_id, message_id, req.emoji, actor.clone())
                    .await
            }
            ReactionAction::Remove => {
                self.repo
                    .remove_reaction(channel_id, message_id, req.emoji, actor.clone())
                    .await
            }
        }
        .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        let reactions = self
            .repo
            .get_message_reactions(channel_id, message_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        self.events.dispatch(ChannelEvent::ReactionChanged {
            channel_id,
            actor: actor.clone(),
            message_id,
            reactions,
            recipients: participant_ids(&participants),
            nonce: req.nonce,
        });

        if actor.as_user().is_some()
            && let Err(err) = self.repo.upsert_activity(actor, channel_id).await
        {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to upsert activity for reaction");
        }
        Ok(())
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn post_typing(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostTypingRequest,
    ) -> Result<(), ChannelMutationErr> {
        let thread_id = req
            .thread_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|err| ChannelMutationErr::BadRequest(err.to_string()))?;
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        self.events.dispatch(ChannelEvent::TypingChanged {
            channel_id,
            actor,
            action: req.action,
            thread_id,
            recipients: participant_ids(&participants),
            nonce: req.nonce,
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

impl<R, E, P, M> ChannelServiceImpl<R, E, P, M>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
    M: ChannelMentionExtractor,
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

    async fn patch_message_attachments(
        &self,
        actor: Sender,
        channel_id: Uuid,
        message_id: Uuid,
        attachment_ids_to_delete: Vec<String>,
        attachments_to_add: Vec<NewChannelAttachment>,
        nonce: Option<String>,
    ) -> Result<(), ChannelMutationErr> {
        let attachment_uuids = attachment_ids_to_delete
            .iter()
            .map(|id| Uuid::parse_str(id))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| ChannelMutationErr::BadRequest(err.to_string()))?;

        let existing = self
            .repo
            .get_message_attachments(message_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        let attachments_to_delete = existing
            .iter()
            .filter(|a| attachment_uuids.contains(&a.id))
            .cloned()
            .collect::<Vec<_>>();
        if attachments_to_delete.len() != attachment_uuids.len() {
            tracing::error!(attachment_ids=?attachment_uuids, "some attachments were not found");
        }

        let fetched_attachment_ids = attachments_to_delete
            .iter()
            .map(|a| a.id)
            .collect::<Vec<_>>();
        let fetched_entity_ids = attachments_to_delete
            .iter()
            .map(|a| a.entity_id.clone())
            .collect::<Vec<_>>();

        if !fetched_attachment_ids.is_empty() {
            self.repo
                .delete_attachments(fetched_attachment_ids)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
            self.repo
                .delete_entity_mentions_for_entities(fetched_entity_ids, message_id.to_string())
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        }

        let added_attachments = if attachments_to_add.is_empty() {
            Vec::new()
        } else {
            self.repo
                .add_attachments(message_id, channel_id, attachments_to_add.clone())
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?
        };

        let items = extract_share_items(&attachments_to_add, &[]);
        if !items.is_empty()
            && let Some(user_actor) = actor.as_user()
            && let Err(err) = self
                .reference_share_permissions
                .update_channel_share_permissions_for_referenced_items(
                    user_actor.clone(),
                    channel_id,
                    items,
                )
                .await
        {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to update channel share permissions");
        }

        let all_attachments = self
            .repo
            .get_message_attachments(message_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        self.repo
            .patch_message_attachments(message_id, all_attachments.clone())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        self.events.dispatch(ChannelEvent::AttachmentsChanged {
            channel_id,
            actor,
            message_id,
            attachments: all_attachments,
            added: added_attachments,
            removed: attachments_to_delete,
            recipients: participant_ids(&participants),
            nonce,
        });

        Ok(())
    }
}

/// Build a centered window of messages around an anchor.
///
/// - `before`: older messages in DESC order (closest to anchor first).
/// - `anchor`: the anchor message itself.
/// - `after`: newer messages in ASC order (closest to anchor first).
/// - `limit`: total number of messages to return (including the anchor).
///
/// Returns messages in DESC order (newest first).
struct CenteredWindow {
    rows: Vec<TopLevelMessageRow>,
    has_more_newer: bool,
}

impl std::ops::Deref for CenteredWindow {
    type Target = [TopLevelMessageRow];

    fn deref(&self) -> &Self::Target {
        &self.rows
    }
}

fn center_window(
    before: Vec<TopLevelMessageRow>,
    anchor: TopLevelMessageRow,
    after: Vec<TopLevelMessageRow>,
    limit: usize,
) -> CenteredWindow {
    if limit == 0 {
        return CenteredWindow {
            rows: vec![],
            has_more_newer: !after.is_empty(),
        };
    }
    if limit == 1 {
        return CenteredWindow {
            rows: vec![anchor],
            has_more_newer: !after.is_empty(),
        };
    }

    let slots = limit - 1;
    let half = slots / 2;

    let before_take = half.min(before.len());
    let after_take = (slots - before_take).min(after.len());
    let before_take = (slots - after_take).min(before.len());
    let has_more_newer = after.len() > after_take;

    let mut before = before;
    before.truncate(before_take);

    let mut after = after;
    after.truncate(after_take);
    after.reverse();

    let mut result = after;
    result.reserve(1 + before.len());
    result.push(anchor);
    result.append(&mut before);

    CenteredWindow {
        rows: result,
        has_more_newer,
    }
}

impl<R, E, P, M> ChannelService for ChannelServiceImpl<R, E, P, M>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
    M: ChannelMentionExtractor,
    anyhow::Error: From<R::Err>,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_channel_messages(
        &self,
        channel_id: Uuid,
        query: Query<Uuid, CreatedAt, ()>,
        direction: MessagePageDirection,
        limit: u16,
        filters: &ChannelMessageFilters,
        notification_user_id: Option<MacroUserIdStr<'static>>,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        let limit = limit.clamp(1, 100);

        let rows_result = self
            .repo
            .get_top_level_messages(
                channel_id,
                &query,
                direction,
                limit,
                filters,
                notification_user_id,
            )
            .await
            .map_err(anyhow::Error::from)?;

        let messages = self.hydrate_messages(rows_result.rows).await?;

        let page = messages
            .into_iter()
            .paginate_on(limit.into(), CreatedAt)
            .filter_on(())
            .into_page();

        Ok(ChannelMessagesQueryResult {
            page,
            has_more_newer: rows_result.has_more_newer,
        })
    }

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

    #[tracing::instrument(err, skip(self))]
    async fn get_message_context(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
        after: i64,
    ) -> Result<Vec<ChannelContextMessage>, ChannelMessagesErr> {
        let mut messages = self
            .repo
            .get_messages_with_context(channel_id, message_id, before.max(0), after.max(0))
            .await
            .map_err(anyhow::Error::from)
            .map_err(ChannelMessagesErr::Repo)?;

        let bot_profiles = self
            .get_bot_profiles_for_senders(messages.iter().map(|m| m.sender_id.as_str()))
            .await?;
        for message in &mut messages {
            message.bot_profile = bot_profile_for(&bot_profiles, &message.sender_id);
        }

        Ok(messages)
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

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_messages_around(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        limit: u16,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        let limit = limit.clamp(1, 100);

        let anchor = self
            .repo
            .resolve_top_level_parent(channel_id, message_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(ChannelMessagesErr::MessageNotFound(message_id))?;

        if anchor.deleted_at.is_some() {
            let thread_data = self
                .repo
                .get_thread_data(&[anchor.id], 1)
                .await
                .map_err(anyhow::Error::from)?;
            let has_active_replies = thread_data
                .get(&anchor.id)
                .is_some_and(|td| td.reply_count > 0);

            if !has_active_replies {
                return Err(ChannelMessagesErr::MessageNotFound(message_id));
            }
        }

        let (before, after) = self
            .repo
            .get_top_level_messages_around(channel_id, anchor.created_at, anchor.id, limit)
            .await
            .map_err(anyhow::Error::from)?;

        let window = center_window(before, anchor, after, limit.into());
        let has_more_newer = window.has_more_newer;
        let messages = self.hydrate_messages(window.rows).await?;

        let page = messages
            .into_iter()
            .paginate_on(limit.into(), CreatedAt)
            .filter_on(())
            .into_page();

        Ok(ChannelMessagesQueryResult {
            page,
            has_more_newer,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_thread_reply_rows(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Vec<ThreadReplyRow>, ChannelMessagesErr> {
        let parent = self
            .repo
            .resolve_top_level_parent(channel_id, message_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(ChannelMessagesErr::MessageNotFound(message_id))?;

        self.repo
            .get_thread_replies(parent.id)
            .await
            .map_err(anyhow::Error::from)
            .map_err(ChannelMessagesErr::Repo)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_thread_replies(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Vec<ThreadReply>, ChannelMessagesErr> {
        let reply_rows = self.get_thread_reply_rows(channel_id, message_id).await?;
        self.hydrate_thread_replies(reply_rows).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn resolve_message(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<ResolvedChannelMessage, ChannelMessagesErr> {
        self.repo
            .resolve_message(channel_id, message_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(ChannelMessagesErr::MessageNotFound(message_id))
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

    async fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> Result<PostMessageResponse, ChannelMutationErr> {
        ChannelServiceImpl::post_message(self, actor, channel_id, req).await
    }

    async fn patch_message(
        &self,
        actor: Sender,
        actor_role: ParticipantRole,
        channel_id: Uuid,
        message_id: Uuid,
        req: PatchMessageRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::patch_message(self, actor, actor_role, channel_id, message_id, req)
            .await
    }

    async fn delete_message(
        &self,
        actor: Sender,
        actor_role: ParticipantRole,
        channel_id: Uuid,
        message_id: Uuid,
        query: DeleteMessageQuery,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::delete_message(self, actor, actor_role, channel_id, message_id, query)
            .await
    }

    async fn post_reaction(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostReactionRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::post_reaction(self, actor, channel_id, req).await
    }

    async fn post_typing(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostTypingRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::post_typing(self, actor, channel_id, req).await
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
