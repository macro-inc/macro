//! Human group controls and signed lifecycle orchestration.
use super::*;
use crate::domain::groups::{ports::GroupPermission, *};
use tracing::Instrument;

impl MetaService {
    /// Share the host's task tracker so a disconnected client cannot cancel creation.
    pub fn with_group_tasks(mut self, tracker: tokio_util::task::TaskTracker) -> Self {
        self.group_tasks = tracker;
        self
    }

    async fn require_group_connector(&self, connection: &Connection, user: &str) -> PortResult<()> {
        if connection.user_id != user {
            return Err(MessagingError::Forbidden.into());
        }
        self.native.require_member(connection.team_id, user).await?;
        if connection.provider != Provider::Whatsapp
            || connection.whatsapp_mode != Some(WhatsappMode::Platform)
            || !connection.is_ready()
        {
            return Err(MessagingError::GroupIneligible.into());
        }
        let current = self
            .repository
            .connection(connection.id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        if current.user_id != connection.user_id
            || current.connected_at != connection.connected_at
            || !current.is_ready()
        {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }

    /// Create with a native identity retained by the browser. A client timeout does
    /// not abort the tracked request; there is never an automatic second POST.
    #[tracing::instrument(skip_all, fields(connection_id=%connection_id,channel_id=%request.channel_id), err)]
    pub async fn create_group(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        connection_id: Uuid,
        mut request: CreateGroup,
        authority: SendAuthority,
    ) -> PortResult<GroupSetup> {
        if authority != SendAuthority::Human {
            return Err(MessagingError::Forbidden.into());
        }
        let (team, user) = team_actor(access)?;
        let c = self
            .repository
            .connection(connection_id)
            .await?
            .filter(|c| c.team_id == team)
            .ok_or(MessagingError::NotFound)?;
        self.require_group_connector(&c, user).await?;
        request.subject = request.subject.trim().to_owned();
        if request.channel_id.get_version_num() != 7
            || request.subject.is_empty()
            || request.subject.chars().count() > GROUP_SUBJECT_MAX_CHARS
            || request.subject.chars().any(char::is_control)
        {
            return Err(
                MessagingError::Invalid("choose a group subject of 1–128 characters").into(),
            );
        }
        // Completed requests are authorized reads, even while another lifecycle
        // operation holds this account's subscription lock.
        if let Some(existing) = self.completed_group(&c, request.channel_id, user).await? {
            if existing.subject != request.subject {
                return Err(MessagingError::Conflict.into());
            }
            return Ok(existing);
        }
        let service = self.clone();
        let user = user.to_owned();
        self.group_tasks
            .spawn(
                async move {
                    let _guard = service
                        .repository
                        .lock_subscription(&c)
                        .await?
                        .ok_or(MessagingError::Conflict)?;
                    service.require_group_connector(&c, &user).await?;
                    if let Some(existing) =
                        service.repository.group_attempt(request.channel_id).await?
                    {
                        service
                            .native
                            .require_group_permission(
                                request.channel_id,
                                &user,
                                GroupPermission::Delete,
                            )
                            .await?;
                        if existing.setup.connection_id != c.id
                            || existing.generation != c.connected_at
                            || existing.setup.subject != request.subject
                        {
                            return Err(MessagingError::Conflict.into());
                        }
                        return Ok(existing.setup);
                    }
                    if let Some(existing) = service
                        .completed_group(&c, request.channel_id, &user)
                        .await?
                    {
                        if existing.subject != request.subject {
                            return Err(MessagingError::Conflict.into());
                        }
                        return Ok(existing);
                    }
                    let token = service.token(&c).await?;
                    service
                        .provider
                        .require_group_eligibility(&c, &token)
                        .await?;
                    service.require_group_connector(&c, &user).await?;
                    let attempt = service.native.create_group_channel(&c, &request).await?;
                    service.submit_group(&c, &user, &token, attempt).await
                }
                .instrument(tracing::Span::current()),
            )
            .await
            .map_err(|_| MessagingError::Unavailable)?
    }

    async fn submit_group(
        &self,
        c: &Connection,
        user: &str,
        token: &AccessToken,
        attempt: GroupAttempt,
    ) -> PortResult<GroupSetup> {
        self.require_group_connector(c, user).await?;
        self.native
            .require_group_permission(attempt.setup.channel_id, user, GroupPermission::Delete)
            .await?;
        let result = self
            .provider
            .create_group(c, token, &attempt.setup.subject)
            .await;
        self.repository
            .finish_group_create(c, &attempt, result)
            .await?;
        if let Some(current) = self
            .repository
            .group_attempt(attempt.setup.channel_id)
            .await?
        {
            return Ok(current.setup);
        }
        self.completed_group(c, attempt.setup.channel_id, user)
            .await?
            .ok_or_else(|| MessagingError::Conflict.into())
    }

    async fn completed_group(
        &self,
        c: &Connection,
        channel: Uuid,
        user: &str,
    ) -> PortResult<Option<GroupSetup>> {
        let Some(conversation) = self.repository.conversation(channel).await? else {
            return Ok(None);
        };
        self.native
            .require_group_permission(channel, user, GroupPermission::Delete)
            .await?;
        if conversation.connection_id != c.id || conversation.kind != ConversationKind::Group {
            return Err(MessagingError::Conflict.into());
        }
        let existing = self
            .repository
            .completed_group(c, channel)
            .await?
            .ok_or(MessagingError::Conflict)?;
        // Recheck the current generation after reading the retained creation
        // identity; the read-only replay does not need a provider lifecycle lock.
        self.require_group_connector(c, user).await?;
        Ok(Some(existing))
    }

    /// Deliberate retry replaces the previous request correlation, under the same
    /// subscription lock held for every provider create and reconnect.
    #[tracing::instrument(skip_all, fields(channel_id=%channel), err)]
    pub async fn retry_group(
        &self,
        channel: Uuid,
        user: &str,
        authority: SendAuthority,
    ) -> PortResult<GroupSetup> {
        if authority != SendAuthority::Human {
            return Err(MessagingError::Forbidden.into());
        }
        let (c, _, _) = self.group_connection(channel).await?;
        self.require_group_connector(&c, user).await?;
        self.native
            .require_group_permission(channel, user, GroupPermission::Delete)
            .await?;
        if let Some(existing) = self.completed_group(&c, channel, user).await? {
            return Ok(existing);
        }
        let service = self.clone();
        let user = user.to_owned();
        self.group_tasks
            .spawn(
                async move {
                    let _guard = service
                        .repository
                        .lock_subscription(&c)
                        .await?
                        .ok_or(MessagingError::Conflict)?;
                    service.require_group_connector(&c, &user).await?;
                    if let Some(existing) = service.completed_group(&c, channel, &user).await? {
                        return Ok(existing);
                    }
                    let token = service.token(&c).await?;
                    service
                        .provider
                        .require_group_eligibility(&c, &token)
                        .await?;
                    service.require_group_connector(&c, &user).await?;
                    let attempt = match service.repository.retry_group(&c, channel).await {
                        Ok(attempt) => attempt,
                        Err(error)
                            if matches!(error.current_context(), MessagingError::Conflict) =>
                        {
                            return service
                                .completed_group(&c, channel, &user)
                                .await?
                                .ok_or(error);
                        }
                        Err(error) => return Err(error),
                    };
                    service.submit_group(&c, &user, &token, attempt).await
                }
                .instrument(tracing::Span::current()),
            )
            .await
            .map_err(|_| MessagingError::Unavailable)?
    }

    async fn group_connection(
        &self,
        channel: Uuid,
    ) -> PortResult<(Connection, Option<GroupSetup>, Option<Conversation>)> {
        let setup = self
            .repository
            .group_attempt(channel)
            .await?
            .map(|a| a.setup);
        let conversation = self
            .repository
            .conversation(channel)
            .await?
            .filter(|c| c.kind == ConversationKind::Group);
        let id = setup
            .as_ref()
            .map(|s| s.connection_id)
            .or_else(|| conversation.as_ref().map(|c| c.connection_id))
            .ok_or(MessagingError::NotFound)?;
        let c = self
            .repository
            .connection(id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        Ok((c, setup, conversation))
    }

    /// Native view access alone permits reading external participant metadata.
    pub async fn group_view(
        &self,
        access: &EntityAccessReceipt<MessageView>,
        authority: SendAuthority,
    ) -> PortResult<Option<GroupView>> {
        let channel = channel_id(access)?;
        let user = access
            .get_authenticated_user()
            .ok()
            .map(|u| u.as_ref())
            .unwrap_or("");
        let (c, setup, conversation) = match self.group_connection(channel).await {
            Err(e) if matches!(e.current_context(), MessagingError::NotFound) => return Ok(None),
            result => result?,
        };
        let member = authority == SendAuthority::Human
            && self.native.require_member(c.team_id, user).await.is_ok();
        let can_delete = member
            && self
                .native
                .require_group_permission(channel, user, GroupPermission::Delete)
                .await
                .is_ok();
        let status = conversation.as_ref().and_then(|c| c.group_status);
        Ok(Some(GroupView {
            channel_id: channel,
            can_retry: can_delete
                && c.user_id == user
                && setup.as_ref().is_some_and(|s| {
                    matches!(s.state, GroupSetupState::Failed | GroupSetupState::Unknown)
                }),
            can_copy_link: member
                && status.is_some_and(|s| s != GroupStatus::Deleted)
                && self
                    .native
                    .require_group_permission(channel, user, GroupPermission::Reply)
                    .await
                    .is_ok(),
            can_remove: member
                && status == Some(GroupStatus::Active)
                && self
                    .native
                    .require_group_permission(channel, user, GroupPermission::Remove)
                    .await
                    .is_ok(),
            can_delete,
            setup,
            status,
            participants: self.repository.group_participants(channel).await?,
        }))
    }

    /// Link access is independent of the customer-service reply window.
    pub async fn group_link(
        &self,
        channel: Uuid,
        user: &str,
        authority: SendAuthority,
    ) -> PortResult<GroupInviteLink> {
        if authority != SendAuthority::Human {
            return Err(MessagingError::Forbidden.into());
        }
        let (c, _, _) = self.group_connection(channel).await?;
        self.native.require_member(c.team_id, user).await?;
        self.native
            .require_group_permission(channel, user, GroupPermission::Reply)
            .await?;
        self.repository.group_link(channel).await
    }

    /// Request removal of a currently confirmed member; signed facts settle it.
    #[tracing::instrument(skip_all, fields(channel_id=%channel), err)]
    pub async fn remove_group_participant(
        &self,
        channel: Uuid,
        user: &str,
        participant: Uuid,
        authority: SendAuthority,
    ) -> PortResult<()> {
        if authority != SendAuthority::Human {
            return Err(MessagingError::Forbidden.into());
        }
        let (c, _, _) = self.group_connection(channel).await?;
        let _guard = self
            .repository
            .lock_subscription(&c)
            .await?
            .ok_or(MessagingError::Conflict)?;
        let conversation = self
            .repository
            .conversation(channel)
            .await?
            .filter(|g| g.kind == ConversationKind::Group)
            .ok_or(MessagingError::Conflict)?;
        self.native.require_member(c.team_id, user).await?;
        self.native.require_member(c.team_id, &c.user_id).await?;
        self.native
            .require_group_permission(channel, user, GroupPermission::Remove)
            .await?;
        if conversation.group_status != Some(GroupStatus::Active) || !c.is_ready() {
            return Err(MessagingError::GroupReadOnly.into());
        }
        let person = self
            .repository
            .group_participants(channel)
            .await?
            .into_iter()
            .find(|p| p.external_sender_id == participant)
            .ok_or(MessagingError::NotFound)?;
        let token = self.token(&c).await?;
        self.native.require_member(c.team_id, user).await?;
        self.native
            .require_group_permission(channel, user, GroupPermission::Remove)
            .await?;
        let current = self
            .repository
            .connection(c.id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        if current.connected_at != c.connected_at || !current.is_ready() {
            return Err(MessagingError::Conflict.into());
        }
        self.provider
            .remove_group_participant(&c, &token, &conversation.customer_id, &person.customer_id)
            .await
    }

    /// Discard only an unbound failed/unknown setup. A callback that bound it
    /// meanwhile requires a new, explicit remote-deletion confirmation instead.
    #[tracing::instrument(skip_all,fields(channel_id=%channel),err)]
    pub async fn discard_group_setup(
        &self,
        channel: Uuid,
        user: &str,
        authority: SendAuthority,
    ) -> PortResult<()> {
        if authority != SendAuthority::Human {
            return Err(MessagingError::Forbidden.into());
        }
        let attempt = self
            .repository
            .group_attempt(channel)
            .await?
            .ok_or(MessagingError::Conflict)?;
        let c = self
            .repository
            .connection(attempt.setup.connection_id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let _guard = self
            .repository
            .lock_subscription(&c)
            .await?
            .ok_or(MessagingError::Conflict)?;
        let current = self
            .repository
            .group_attempt(channel)
            .await?
            .ok_or(MessagingError::Conflict)?;
        if !matches!(
            current.setup.state,
            GroupSetupState::Failed | GroupSetupState::Unknown
        ) {
            return Err(MessagingError::Conflict.into());
        }
        self.native.require_member(c.team_id, user).await?;
        self.native
            .require_group_permission(channel, user, GroupPermission::Delete)
            .await?;
        self.native
            .delete_group_channel(&c, channel, user, true)
            .await
    }

    /// Explicit human deletion owns the provider effect and retains synchronization
    /// through native teardown. Generic native deletion remains fail closed.
    #[tracing::instrument(skip_all, fields(channel_id=%channel), err)]
    pub async fn delete_group(
        &self,
        channel: Uuid,
        user: &str,
        authority: SendAuthority,
    ) -> PortResult<()> {
        if authority != SendAuthority::Human {
            return Err(MessagingError::Forbidden.into());
        }
        let (c, setup, _) = self.group_connection(channel).await?;
        if setup.is_some() {
            return Err(MessagingError::Conflict.into());
        }
        let _guard = self.prepare_group_deletion(channel, user).await?;
        self.native
            .delete_group_channel(&c, channel, user, false)
            .await
    }

    /// Prepare explicit provider deletion. The returned guard stays held through
    /// local deletion, preventing a retry/reconnect racing a discarded setup.
    #[tracing::instrument(skip_all, fields(channel_id=%channel), err)]
    async fn prepare_group_deletion(
        &self,
        channel: Uuid,
        user: &str,
    ) -> PortResult<Box<dyn SubscriptionGuard>> {
        let (c, prior_setup, _) = self.group_connection(channel).await?;
        let guard = self
            .repository
            .lock_subscription(&c)
            .await?
            .ok_or(MessagingError::Conflict)?;
        let (current, setup, conversation) = self.group_connection(channel).await?;
        if current.connected_at != c.connected_at || (prior_setup.is_some() && setup.is_none()) {
            return Err(MessagingError::Conflict.into());
        }
        self.native.require_member(c.team_id, user).await?;
        self.native
            .require_group_permission(channel, user, GroupPermission::Delete)
            .await?;
        if let Some(setup) = setup {
            if !matches!(
                setup.state,
                GroupSetupState::Failed | GroupSetupState::Unknown
            ) {
                return Err(MessagingError::Conflict.into());
            }
            return Ok(guard);
        }
        let conversation = conversation.ok_or(MessagingError::NotFound)?;
        if conversation.group_status == Some(GroupStatus::Deleted) {
            return Ok(guard);
        }
        self.native.require_member(c.team_id, &c.user_id).await?;
        if !c.is_ready() {
            return Err(MessagingError::Disconnected.into());
        }
        let token = self.token(&c).await?;
        self.native.require_member(c.team_id, user).await?;
        self.native
            .require_group_permission(channel, user, GroupPermission::Delete)
            .await?;
        let current = self
            .repository
            .connection(c.id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        if current.connected_at != c.connected_at || !current.is_ready() {
            return Err(MessagingError::Conflict.into());
        }
        self.provider
            .delete_group(&c, &token, &conversation.customer_id)
            .await?;
        self.repository.confirm_group_deleted(&c, channel).await?;
        Ok(guard)
    }
}
