//! Authorized timeline, read state and sharing operations.
use super::*;
use crate::domain::rich::RichContent;
use entity_access::domain::models::{AccessLevel, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::{
    SharePermissionV2, UpdateSharePermissionRequestV2,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
    team_share::{TeamShareLevel, TeamShareRequest, authorize_team_share},
};
impl<P: ChatProvider> ExternalChatService<P> {
    /// List all shared chats, including for viewers with no provider account.
    #[tracing::instrument(name = "whatsapp.linked.list", skip_all, err, fields(count))]
    pub async fn list(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Vec<ExternalChatSummary>> {
        let records = self.timeline.visible_chats(user).await?;
        let account = self.provider.account(user).await?;
        tracing::Span::current().record("count", records.len());
        let chats: Vec<ChatRef> = records.iter().map(|record| record.chat.clone()).collect();
        let sending = match &account {
            Some(account) if account.connected && !chats.is_empty() => {
                self.provider.sending_facts(account, &chats).await?
            }
            _ => vec![],
        };
        let communities = if chats.is_empty() {
            vec![]
        } else {
            self.provider.communities(&chats).await?
        };
        let mut sending = sending.into_iter();
        Ok(records
            .into_iter()
            .zip(communities)
            .map(|(record, community)| {
                let facts = sending.next();
                let reason = reply_block(account.as_ref(), &record.chat, facts.as_ref());
                record.facts.summary(reason, community)
            })
            .collect())
    }
    /// Authorized chat detail, standard sharing and own sending identity.
    #[tracing::instrument(name = "whatsapp.linked.detail", skip_all, err, fields(chat_id))]
    pub async fn detail<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
    ) -> ExternalChatResult<ExternalChatDetail> {
        let (user, id) = view_scope(access)?;
        tracing::Span::current().record("chat_id", tracing::field::display(id));
        let chat = self
            .chats
            .chat(id)
            .await?
            .ok_or(ExternalChatError::NotFound)?;
        // A bot viewer reads, but has no provider account of its own.
        let account = match access.get_authenticated_user() {
            Ok(person) => self.provider.account(person).await?,
            Err(_) => None,
        };
        let facts = self.timeline.chat_facts(id, user).await?;
        self.provider.request_refresh(&chat, user).await?;
        let reason = self.reply_block(account.as_ref(), &chat).await?;
        let access_level = match access.entity_permission() {
            EntityPermission::AccessLevel { access_level } => *access_level,
            _ => return Err(ExternalChatError::Forbidden.into()),
        };
        let community = self
            .provider
            .communities(std::slice::from_ref(&chat))
            .await?
            .pop()
            .flatten();
        let members = self.provider.members(&chat).await?;
        Ok(ExternalChatDetail {
            chat: facts.summary(reason, community),
            share_permission: self.timeline.permissions(id).await?,
            access_level,
            disappearing_seconds: members.as_ref().and_then(|m| m.disappearing_seconds),
            members: members.map(|m| m.members),
            sending_identity: account.and_then(|a| a.identity),
            limits: self.provider.capabilities(&chat),
        })
    }
    /// Read the complete timeline through view access, without remote
    /// membership. `limit` defaults to [`DEFAULT_PAGE`], at most [`PAGE_LIMIT`].
    pub async fn messages<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        before: Option<Uuid>,
        limit: Option<i64>,
    ) -> ExternalChatResult<ExternalChatMessages> {
        let (user, id) = view_scope(access)?;
        let limit = limit.unwrap_or(DEFAULT_PAGE);
        if !(1..=PAGE_LIMIT).contains(&limit) {
            return Err(ExternalChatError::Invalid("the page size is out of range").into());
        }
        let chat = self
            .chats
            .chat(id)
            .await?
            .ok_or(ExternalChatError::NotFound)?;
        let page = self.timeline.messages(&chat, user, before, limit).await?;
        Ok(ExternalChatMessages {
            messages: self.message_views(&chat, user, page.messages).await?,
            next_cursor: page.next_cursor,
        })
    }
    /// One message through view access, as the timeline shows it.
    pub async fn message<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        message: Uuid,
    ) -> ExternalChatResult<ExternalChatMessage> {
        let (user, id) = view_scope(access)?;
        let chat = self
            .chats
            .chat(id)
            .await?
            .ok_or(ExternalChatError::NotFound)?;
        let stored = self
            .timeline
            .message(&chat, user, message)
            .await?
            .ok_or(ExternalChatError::NotFound)?;
        self.message_views(&chat, user, vec![stored])
            .await?
            .pop()
            .ok_or_else(|| ExternalChatError::NotFound.into())
    }
    /// Stored messages as `viewer` sees them: the people they name and the
    /// viewer's own delivery states.
    async fn message_views(
        &self,
        chat: &ChatRef,
        viewer: &str,
        messages: Vec<StoredMessage>,
    ) -> ExternalChatResult<Vec<ExternalChatMessage>> {
        let mut named = vec![];
        for message in &messages {
            if let Some(RichContent::System(line)) = &message.rich {
                named.extend(line.participants.iter().cloned());
            }
            named.extend(message.mentions.iter().cloned());
        }
        let people = self.provider.people(chat, &named).await?;
        let ids: Vec<Uuid> = messages.iter().map(|message| message.id).collect();
        let deliveries = if ids.is_empty() {
            vec![]
        } else {
            self.provider.delivery_states(chat.id, viewer, &ids).await?
        };
        Ok(messages
            .into_iter()
            .map(|message| {
                let delivery = deliveries
                    .iter()
                    .find(|(id, _)| *id == message.id)
                    .map(|(_, state)| *state);
                view::message_view(message, delivery, viewer, &people)
            })
            .collect())
    }
    /// Advance the caller's own read cursor monotonically.
    #[tracing::instrument(name = "whatsapp.linked.read", skip_all, err, fields(chat_id, message_id = %message))]
    pub async fn mark_read<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        message: Uuid,
    ) -> ExternalChatResult<()> {
        let (user, id) = receipt_scope(access)?;
        tracing::Span::current().record("chat_id", tracing::field::display(id));
        self.timeline.mark_read(id, user, message).await
    }
    /// List only the caller's pending, uncertain or failed sends.
    pub async fn open_sends<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
    ) -> ExternalChatResult<Vec<SendProgress>> {
        let (user, id) = receipt_scope(access)?;
        self.provider.open_sends(id, user).await
    }
    /// Read standard permission settings.
    pub async fn permissions<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
    ) -> ExternalChatResult<SharePermissionV2> {
        let (_, id) = view_scope(access)?;
        self.timeline.permissions(id).await
    }
    /// Only the actual owner, in a session of their own, controls link, team
    /// and channel sharing; ordinary people grants use the generic
    /// direct-access endpoints. Everything is shared read-only.
    #[tracing::instrument(name = "whatsapp.linked.permissions", skip_all, err, fields(chat_id))]
    pub async fn update_permissions<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        update: &UpdateSharePermissionRequestV2,
        authority: SendAuthority,
    ) -> ExternalChatResult<()> {
        human(authority)?;
        let (user, id) = receipt_scope(access)?;
        tracing::Span::current().record("chat_id", tracing::field::display(id));
        let facts = self.timeline.share_facts(id).await?;
        if !facts.owner.is_user(user) {
            return Err(ExternalChatError::Forbidden.into());
        }
        if update
            .link_share_access_level
            .flatten()
            .is_some_and(|level| level != AccessLevel::View)
        {
            return Err(ExternalChatError::Invalid("WhatsApp chats are shared read-only").into());
        }
        validate_channel_grants(
            update
                .channel_share_permissions
                .as_deref()
                .unwrap_or_default(),
        )?;
        let command = authorize_team_share(
            Some(user),
            &facts,
            TeamShareRequest {
                access_level: update.team_share_access_level,
                legacy_enabled: None,
            },
            TeamShareLevel::View,
        )
        .map_err(|_| ExternalChatError::Forbidden)?;
        self.timeline
            .update_permissions(id, user, update, command.as_ref())
            .await
    }
}

/// Channel grants name each channel once and are read-only; a removal needs no
/// level.
fn validate_channel_grants(grants: &[UpdateChannelSharePermission]) -> ExternalChatResult<()> {
    let mut channels = std::collections::HashSet::new();
    for grant in grants {
        let read_only = match grant.operation {
            UpdateOperation::Remove => true,
            UpdateOperation::Add | UpdateOperation::Replace => {
                grant.access_level == Some(AccessLevel::View)
            }
        };
        if !channels.insert(&grant.channel_id)
            || Uuid::parse_str(&grant.channel_id).is_err()
            || !read_only
        {
            return Err(ExternalChatError::Invalid(
                "WhatsApp chats are shared read-only with a channel",
            )
            .into());
        }
    }
    Ok(())
}
