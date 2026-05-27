use crate::domain::{
    events::ChannelEvent,
    models::{
        AddParticipantsRequest, ChannelAttachmentType, ChannelContextMessage, ChannelMessage,
        ChannelMessageFilters, ChannelParticipant, ChannelType, DeleteMessageQuery,
        GetOrCreateAction, GetOrCreateChannelResponse, GetOrCreateDmRequest,
        GetOrCreatePrivateRequest, MessagePageDirection, NewChannelAttachment, ParticipantRole,
        PatchChannelRequest, PatchMessageRequest, PostMessageRequest, PostMessageResponse,
        PostReactionRequest, PostTypingRequest, ReactionAction, ReferencedShareItem,
        RemoveParticipantsRequest, ResolvedChannelMessage, SimpleMention, ThreadInfo, ThreadReply,
        TopLevelMessageRow,
    },
    ports::{
        ChannelAttachmentsPage, ChannelEventDispatcher, ChannelMessagesErr,
        ChannelMessagesQueryResult, ChannelMutationErr, ChannelReferenceSharePermissions,
        ChannelRepo, ChannelService,
    },
};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, PaginateOn, Query};
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
> {
    repo: R,
    events: E,
    reference_share_permissions: P,
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
        }
    }
}

impl<R, E, P> ChannelServiceImpl<R, E, P>
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
        for td in thread_data.values() {
            for reply in &td.preview_replies {
                all_ids.push(reply.id);
            }
        }

        let (reactions, attachments) = tokio::join!(
            self.repo.get_reactions_batch(&all_ids),
            self.repo.get_attachments_batch(&all_ids),
        );

        let reactions = reactions.map_err(anyhow::Error::from)?;
        let attachments = attachments.map_err(anyhow::Error::from)?;

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
                                sender_id: r.sender_id.clone(),
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
                    sender_id: row.sender_id,
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
}

fn lower_macro_users(users: &[String]) -> Vec<String> {
    users
        .iter()
        .map(|u| u.to_lowercase())
        .filter(|u| u.starts_with("macro|"))
        .collect()
}

fn parse_macro_user_id(
    user_id: impl Into<String>,
) -> Result<MacroUserIdStr<'static>, ChannelMutationErr> {
    MacroUserIdStr::try_from(user_id.into())
        .map_err(|_| ChannelMutationErr::BadRequest("invalid user id".to_string()))
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

fn parse_user_ids(
    users: impl IntoIterator<Item = String>,
) -> Result<Vec<MacroUserIdStr<'static>>, ChannelMutationErr> {
    users
        .into_iter()
        .map(parse_macro_user_id)
        .collect::<Result<Vec<_>, _>>()
}

fn created_channel_participant_ids(
    owner_id: &str,
    participants: &[String],
) -> Result<Vec<MacroUserIdStr<'static>>, ChannelMutationErr> {
    let mut users = participants.to_vec();
    if !users.iter().any(|user| user == owner_id) {
        users.push(owner_id.to_string());
    }
    parse_user_ids(users)
}

impl<R, E, P> ChannelServiceImpl<R, E, P>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
{
    #[tracing::instrument(err, skip(self, req))]
    async fn create_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        actor_org_id: Option<i64>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreateChannelResponse, ChannelMutationErr> {
        if req.channel_type == ChannelType::Team {
            let team_id = req.team_id.ok_or_else(|| {
                ChannelMutationErr::BadRequest("team id missing for team channel type".to_string())
            })?;
            let has_team = self
                .repo
                .user_has_team(actor.as_ref().to_string(), team_id)
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

        let org_id = match req.channel_type {
            ChannelType::Organization => actor_org_id,
            _ => None,
        };
        let participants = lower_macro_users(&req.participants);
        if participants.is_empty() {
            return Err(ChannelMutationErr::BadRequest(
                "participants must be a non-empty list of 'macro|<email>'".to_string(),
            ));
        }
        let create_req = crate::domain::models::CreateChannelRequest {
            participants: participants.clone(),
            ..req.clone()
        };

        let channel_id = self
            .create_channel_record(actor.as_ref().to_string(), org_id, create_req)
            .await?;

        self.events.dispatch(ChannelEvent::ChannelCreated {
            channel_id,
            channel_type: req.channel_type,
            participant_user_ids: created_channel_participant_ids(actor.as_ref(), &participants)?,
        });

        Ok(crate::domain::models::CreateChannelResponse {
            id: channel_id.to_string(),
        })
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn get_or_create_dm(
        &self,
        actor: MacroUserIdStr<'static>,
        req: GetOrCreateDmRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        let recipient_id = req.recipient_id.to_lowercase();
        let user_id = actor.as_ref().to_lowercase();

        if recipient_id.is_empty() {
            return Err(ChannelMutationErr::BadRequest(
                "recipient_id must be a non-empty string".to_string(),
            ));
        }
        if !recipient_id.starts_with("macro|") {
            return Err(ChannelMutationErr::BadRequest(
                "recipient_id must be 'macro|<email>'".to_string(),
            ));
        }
        if recipient_id == user_id {
            return Err(ChannelMutationErr::BadRequest(
                "recipient_id cannot be the same as the user_id".to_string(),
            ));
        }

        let existing_channel_id = self
            .repo
            .maybe_get_dm(user_id.clone(), recipient_id.clone())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        self.get_or_create_channel(
            existing_channel_id,
            user_id.clone(),
            None,
            crate::domain::models::CreateChannelRequest {
                name: None,
                channel_type: ChannelType::DirectMessage,
                team_id: None,
                participants: vec![user_id.clone(), recipient_id.clone()],
            },
        )
        .await
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn get_or_create_private(
        &self,
        actor: MacroUserIdStr<'static>,
        mut req: GetOrCreatePrivateRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        req.recipients = lower_macro_users(&req.recipients);
        if req.recipients.is_empty() {
            return Err(ChannelMutationErr::BadRequest(
                "recipients must be a non-empty list of 'macro|<email>'".to_string(),
            ));
        }

        let user_id = actor.as_ref().to_lowercase();
        let mut lookup = req.recipients.clone();
        lookup.push(user_id.clone());
        let existing_channel_id = self
            .repo
            .maybe_get_private_channel(lookup)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        self.get_or_create_channel(
            existing_channel_id,
            user_id,
            None,
            crate::domain::models::CreateChannelRequest {
                name: None,
                channel_type: ChannelType::Private,
                team_id: None,
                participants: req.recipients,
            },
        )
        .await
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn patch_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PatchChannelRequest,
    ) -> Result<(), ChannelMutationErr> {
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
        self.repo
            .patch_channel(channel_id, actor.as_ref().to_string(), req)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        self.repo
            .delete_channel(channel_id, actor.as_ref().to_string())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        self.events
            .dispatch(ChannelEvent::ChannelDeleted { channel_id });
        Ok(())
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn post_message(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> Result<PostMessageResponse, ChannelMutationErr> {
        let message = self
            .repo
            .create_message(
                channel_id,
                actor.as_ref().to_string(),
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
            && let Err(err) = self
                .reference_share_permissions
                .update_channel_share_permissions_for_referenced_items(
                    actor.clone(),
                    channel_id,
                    items,
                )
                .await
        {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to update channel share permissions");
        }

        let channel_metadata = self
            .repo
            .get_channel_metadata(channel_id, actor.clone())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        if let Err(err) = self
            .repo
            .upsert_activity(actor.as_ref().to_string(), channel_id)
            .await
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
        });

        Ok(PostMessageResponse {
            id: message.id.to_string(),
            nonce: req.nonce,
        })
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn patch_message(
        &self,
        actor: MacroUserIdStr<'static>,
        actor_role: ParticipantRole,
        channel_id: Uuid,
        message_id: Uuid,
        mut req: PatchMessageRequest,
    ) -> Result<(), ChannelMutationErr> {
        let owner = self
            .repo
            .get_message_owner(channel_id, message_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?
            .ok_or_else(|| ChannelMutationErr::NotFound("message not found".to_string()))?;
        if owner != actor.as_ref() && !is_admin_or_owner(actor_role) {
            return Err(ChannelMutationErr::Unauthorized(
                "user is not authorized to edit this message".to_string(),
            ));
        }

        let attachments_to_delete = req.attachment_ids_to_delete.clone().unwrap_or_default();
        let attachments_to_add = req.attachments_to_add.clone().unwrap_or_default();
        let attachments_changed =
            !attachments_to_delete.is_empty() || !attachments_to_add.is_empty();

        if attachments_changed {
            self.patch_message_attachments(
                actor.clone(),
                channel_id,
                message_id,
                attachments_to_delete,
                attachments_to_add,
                req.nonce.clone(),
            )
            .await?;
        }

        if let Some(content) = req.content.clone() {
            let message = self
                .repo
                .patch_message(channel_id, message_id, content)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

            if let Some(mentions) = req.mentions.take() {
                self.repo
                    .sync_message_mentions(message_id, mentions.clone())
                    .await
                    .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

                let items = extract_share_items(&[], &mentions);
                if !items.is_empty()
                    && let Err(err) = self
                        .reference_share_permissions
                        .update_channel_share_permissions_for_referenced_items(
                            actor.clone(),
                            channel_id,
                            items,
                        )
                        .await
                {
                    let err: anyhow::Error = err.into();
                    tracing::error!(error=?err, "unable to update channel share permissions");
                }
            }

            let participants = if let Some(thread_id) = message.thread_id {
                self.repo
                    .get_thread_participants(thread_id)
                    .await
                    .map_err(|e| ChannelMutationErr::Repo(e.into()))?
            } else {
                participant_ids(
                    &self
                        .repo
                        .get_participants(channel_id)
                        .await
                        .map_err(|e| ChannelMutationErr::Repo(e.into()))?,
                )
            };

            self.events.dispatch(ChannelEvent::MessageChanged {
                channel_id,
                message: message.clone(),
                recipients: participants,
                nonce: req.nonce.clone(),
            });

            if let Err(err) = self
                .repo
                .upsert_activity(actor.as_ref().to_string(), channel_id)
                .await
            {
                let err: anyhow::Error = err.into();
                tracing::error!(error=?err, "unable to upsert activity for message");
            }
        }

        if attachments_changed
            && req.content.is_none()
            && let Err(err) = self
                .repo
                .upsert_activity(actor.as_ref().to_string(), channel_id)
                .await
        {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to upsert activity for attachment patch");
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self, query))]
    async fn delete_message(
        &self,
        actor: MacroUserIdStr<'static>,
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
        if owner != actor.as_ref() && !is_admin_or_owner(actor_role) {
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
            message,
            recipients: participant_ids(&participants),
            nonce: query.nonce,
        });
        Ok(())
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn post_reaction(
        &self,
        actor: MacroUserIdStr<'static>,
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
                    .add_reaction(
                        channel_id,
                        message_id,
                        req.emoji,
                        actor.as_ref().to_string(),
                    )
                    .await
            }
            ReactionAction::Remove => {
                self.repo
                    .remove_reaction(
                        channel_id,
                        message_id,
                        req.emoji,
                        actor.as_ref().to_string(),
                    )
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
            message_id,
            reactions,
            recipients: participant_ids(&participants),
            nonce: req.nonce,
        });

        if let Err(err) = self
            .repo
            .upsert_activity(actor.as_ref().to_string(), channel_id)
            .await
        {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to upsert activity for reaction");
        }
        Ok(())
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn post_typing(
        &self,
        actor: MacroUserIdStr<'static>,
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
            user_id: actor.as_ref().to_string(),
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
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: AddParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
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

        let participants_to_add = lower_macro_users(&req.participants);
        for participant in &participants_to_add {
            self.repo
                .add_participant(channel_id, participant.clone(), ParticipantRole::Member)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        }

        let active_participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        let recipients = participants_to_add
            .iter()
            .filter_map(|id| MacroUserIdStr::try_from(id.clone()).ok())
            .collect();
        let channel_metadata = self
            .repo
            .get_channel_metadata(channel_id, actor.clone())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        let active_participant_user_ids = parse_user_ids(
            active_participants
                .into_iter()
                .map(|participant| participant.user_id),
        )?;
        self.events.dispatch(ChannelEvent::ParticipantsAdded {
            channel_id,
            channel_type: info.channel_type,
            active_participant_user_ids,
            invited_by_user_id: actor.clone(),
            recipient_user_ids: recipients,
            metadata: channel_metadata,
            message_content: None,
        });

        Ok(())
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn remove_participants(
        &self,
        channel_id: Uuid,
        req: RemoveParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
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
        for participant in req.participants {
            self.repo
                .remove_participant(channel_id, participant)
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        }
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn join_channel(
        &self,
        actor: MacroUserIdStr<'static>,
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
        let before = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        self.repo
            .add_participant(
                channel_id,
                actor.as_ref().to_string(),
                ParticipantRole::Member,
            )
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;

        let active_participant_user_ids = parse_user_ids(
            before
                .into_iter()
                .map(|participant| participant.user_id)
                .chain(std::iter::once(actor.as_ref().to_string())),
        )?;
        self.events.dispatch(ChannelEvent::ParticipantJoined {
            channel_id,
            channel_type: info.channel_type,
            user_id: actor,
            active_participant_user_ids,
        });
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn leave_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
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
        match (info.channel_type, participants.len()) {
            (ChannelType::Organization, _) => {
                return Err(ChannelMutationErr::BadRequest(
                    "cannot leave organization channel".to_string(),
                ));
            }
            (ChannelType::Private, 2) | (ChannelType::DirectMessage, _) => {
                return Err(ChannelMutationErr::BadRequest(
                    "cannot leave channel with only 2 participants".to_string(),
                ));
            }
            _ => {}
        }
        self.repo
            .remove_participant(channel_id, actor.as_ref().to_string())
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))
    }
}

impl<R, E, P> ChannelServiceImpl<R, E, P>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
{
    async fn create_channel_record(
        &self,
        owner_id: String,
        org_id: Option<i64>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<Uuid, ChannelMutationErr> {
        self.repo
            .create_channel(owner_id, org_id, req)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))
    }

    async fn get_or_create_channel(
        &self,
        existing_channel_id: Option<Uuid>,
        owner_id: String,
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
        let participant_user_ids =
            created_channel_participant_ids(&owner_id, &create_req.participants)?;
        let channel_id = self
            .create_channel_record(owner_id, org_id, create_req)
            .await?;
        self.events.dispatch(ChannelEvent::ChannelCreated {
            channel_id,
            channel_type,
            participant_user_ids,
        });
        Ok(GetOrCreateChannelResponse {
            channel_id: channel_id.to_string(),
            action: GetOrCreateAction::Create,
        })
    }

    async fn patch_message_attachments(
        &self,
        actor: MacroUserIdStr<'static>,
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

        if !attachments_to_add.is_empty() {
            self.repo
                .add_attachments(message_id, channel_id, attachments_to_add.clone())
                .await
                .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        }

        let items = extract_share_items(&attachments_to_add, &[]);
        if !items.is_empty()
            && let Err(err) = self
                .reference_share_permissions
                .update_channel_share_permissions_for_referenced_items(actor, channel_id, items)
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
            message_id,
            attachments: all_attachments,
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

impl<R, E, P> ChannelService for ChannelServiceImpl<R, E, P>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
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
    async fn get_message_context(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
        after: i64,
    ) -> Result<Vec<ChannelContextMessage>, ChannelMessagesErr> {
        self.repo
            .get_messages_with_context(channel_id, message_id, before.max(0), after.max(0))
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
    async fn get_thread_replies(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Vec<ThreadReply>, ChannelMessagesErr> {
        let parent = self
            .repo
            .resolve_top_level_parent(channel_id, message_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(ChannelMessagesErr::MessageNotFound(message_id))?;

        let reply_rows = self
            .repo
            .get_thread_replies(parent.id)
            .await
            .map_err(anyhow::Error::from)?;

        if reply_rows.is_empty() {
            return Ok(Vec::new());
        }

        let reply_ids: Vec<Uuid> = reply_rows.iter().map(|row| row.id).collect();
        let (reactions, attachments) = tokio::join!(
            self.repo.get_reactions_batch(&reply_ids),
            self.repo.get_attachments_batch(&reply_ids),
        );

        let reactions = reactions.map_err(anyhow::Error::from)?;
        let attachments = attachments.map_err(anyhow::Error::from)?;

        let replies = reply_rows
            .into_iter()
            .map(|row| ThreadReply {
                id: row.id,
                sender_id: row.sender_id,
                content: row.content,
                created_at: row.created_at,
                updated_at: row.updated_at,
                edited_at: row.edited_at,
                reactions: reactions.get(&row.id).cloned().unwrap_or_default(),
                attachments: attachments.get(&row.id).cloned().unwrap_or_default(),
            })
            .collect();

        Ok(replies)
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
        actor: MacroUserIdStr<'static>,
        actor_org_id: Option<i64>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<crate::domain::models::CreateChannelResponse, ChannelMutationErr> {
        ChannelServiceImpl::create_channel(self, actor, actor_org_id, req).await
    }

    async fn get_or_create_dm(
        &self,
        actor: MacroUserIdStr<'static>,
        req: GetOrCreateDmRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        ChannelServiceImpl::get_or_create_dm(self, actor, req).await
    }

    async fn get_or_create_private(
        &self,
        actor: MacroUserIdStr<'static>,
        req: GetOrCreatePrivateRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        ChannelServiceImpl::get_or_create_private(self, actor, req).await
    }

    async fn patch_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PatchChannelRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::patch_channel(self, actor, channel_id, req).await
    }

    async fn delete_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::delete_channel(self, actor, channel_id).await
    }

    async fn post_message(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> Result<PostMessageResponse, ChannelMutationErr> {
        ChannelServiceImpl::post_message(self, actor, channel_id, req).await
    }

    async fn patch_message(
        &self,
        actor: MacroUserIdStr<'static>,
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
        actor: MacroUserIdStr<'static>,
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
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PostReactionRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::post_reaction(self, actor, channel_id, req).await
    }

    async fn post_typing(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PostTypingRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::post_typing(self, actor, channel_id, req).await
    }

    async fn add_participants(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: AddParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::add_participants(self, actor, channel_id, req).await
    }

    async fn remove_participants(
        &self,
        channel_id: Uuid,
        req: RemoveParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::remove_participants(self, channel_id, req).await
    }

    async fn join_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::join_channel(self, actor, channel_id).await
    }

    async fn leave_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        ChannelServiceImpl::leave_channel(self, actor, channel_id).await
    }
}
