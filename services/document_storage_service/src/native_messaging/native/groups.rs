//! DSS composes group-owned state with native channel transactions and access receipts.
use super::*;
use entity_access::domain::models::{AdminParticipantRole, OwnerParticipantRole};
use meta_messaging::domain::groups::{ports::*, *};

#[async_trait]
impl NativeGroups for NativeChannels {
    async fn require_group_permission(
        &self,
        channel: Uuid,
        user: &str,
        permission: GroupPermission,
    ) -> PortResult<()> {
        let user =
            MacroUserIdStr::try_from(user.to_owned()).map_err(|_| MessagingError::Forbidden)?;
        let channel = channel.to_string();
        match permission {
            GroupPermission::Reply => {
                self.access
                    .generate_entity_access_receipt::<MessageWrite>(
                        &user.0,
                        None,
                        &channel,
                        EntityType::Channel,
                    )
                    .await
                    .map_err(access_error)?;
            }
            GroupPermission::Remove => {
                self.access
                    .generate_entity_access_receipt::<AdminParticipantRole>(
                        &user.0,
                        None,
                        &channel,
                        EntityType::Channel,
                    )
                    .await
                    .map_err(access_error)?;
            }
            GroupPermission::Delete => {
                self.access
                    .generate_entity_access_receipt::<OwnerParticipantRole>(
                        &user.0,
                        None,
                        &channel,
                        EntityType::Channel,
                    )
                    .await
                    .map_err(access_error)?;
            }
        }
        Ok(())
    }

    async fn create_group_channel(
        &self,
        c: &Connection,
        request: &CreateGroup,
    ) -> PortResult<GroupAttempt> {
        let mut tx = self.pool.begin().await.map_err(error)?;
        let owner =
            MacroUserIdStr::try_from(c.user_id.clone()).map_err(|_| MessagingError::Forbidden)?;
        let reserved = PgChannelsRepo::ensure_reserved_channel_in(
            &mut tx,
            &HistoricalChannel {
                id: request.channel_id,
                name: request.subject.clone(),
                kind: HistoricalChannelKind::Private,
                owner: owner.clone(),
                participants: HashSet::new(),
                created_at: Utc::now(),
            },
            true,
        )
        .await
        .map_err(error)?;
        if !reserved.created {
            return Err(MessagingError::Conflict.into());
        }
        PgChannelsRepo::bind_messaging_in(
            &mut tx,
            request.channel_id,
            channels::domain::models::MessagingBinding::WhatsappGroup,
        )
        .await
        .map_err(error)?;
        let attempt = PgMessagingRepository::create_group_in(&mut tx, c, request).await?;
        tx.commit().await.map_err(error)?;
        self.channel_events
            .dispatch(channels::domain::events::ChannelEvent::ChannelCreated {
                channel_id: request.channel_id,
                actor: ChannelSender::new_from_user(owner.clone()),
                on_behalf_of: None,
                channel_type: channels::domain::models::ChannelType::Private,
                channel_name: Some(request.subject.clone()),
                participant_user_ids: vec![owner],
            });
        Ok(attempt)
    }

    async fn delete_group_channel(
        &self,
        c: &Connection,
        channel: Uuid,
        user: &str,
        discard: bool,
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(error)?;
        PgMessagingRepository::lock_group_deletion_in(&mut tx, c, channel, discard).await?;
        PgChannelsRepo::delete_channel_in(&mut tx, channel, user)
            .await
            .map_err(error)?;
        tx.commit().await.map_err(error)?;
        let actor = ChannelSender::new_from_user(
            MacroUserIdStr::try_from(user.to_owned()).map_err(|_| MessagingError::Forbidden)?,
        );
        self.channel_events
            .dispatch(channels::domain::events::ChannelEvent::ChannelDeleted {
                channel_id: channel,
                actor,
            });
        Ok(())
    }

    async fn apply_group_event(&self, c: &Connection, event: &GroupEvent) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(error)?;
        let mutation = PgMessagingRepository::apply_group_event_in(&mut tx, c, event).await?;
        let native_event = if let Some(change) = mutation {
            Some(
                PgChannelsRepo::provider_name_in(&mut tx, change.channel_id, &change.name)
                    .await
                    .map_err(error)?,
            )
        } else {
            None
        };
        tx.commit().await.map_err(error)?;
        if let Some(event) = native_event {
            self.channel_events.dispatch(event);
        }
        Ok(())
    }
}
