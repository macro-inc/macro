//! Explicit import policy and bounded, restart-safe execution.
use super::*;
use crate::domain::history::*;

impl MetaService {
    pub(super) async fn require_history_consent(
        &self,
        c: &Connection,
        received_at: chrono::DateTime<Utc>,
        waiting: bool,
    ) -> PortResult<bool> {
        self.native.require_member(c.team_id, &c.user_id).await?;
        let Some(user) = self
            .repository
            .history_consent_user(c, received_at, waiting)
            .await?
        else {
            return Ok(false);
        };
        if let Err(error) = self.native.require_member(c.team_id, &user).await {
            if matches!(error.current_context(), MessagingError::Forbidden) {
                self.repository.revoke_history_consent(c).await?;
            }
            return Err(error);
        }
        Ok(true)
    }

    /// Read import availability using the current team membership.
    pub async fn history_import_view(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        id: Uuid,
    ) -> PortResult<HistoryImportView> {
        let (team, user) = team_actor(access)?;
        self.native.require_member(team, user).await?;
        let c = self.team_connection(team, id).await?;
        let mut view = self.history_view(&c).await?;
        if let Err(error) = self.require_manager(&c, user).await {
            if !matches!(error.current_context(), MessagingError::Forbidden) {
                return Err(error);
            }
            view.can_import = false;
            view.reason =
                Some("Only the connector or a current team admin can import history.".into());
        }
        Ok(view)
    }
    async fn history_view(&self, c: &Connection) -> PortResult<HistoryImportView> {
        let import = self.repository.history_import(c).await?;
        let reason = if import.as_ref().is_some_and(|job| {
            job.status == HistoryStatus::Complete
                || (c.status == ConnectionStatus::Connected
                    && matches!(job.status, HistoryStatus::Pending | HistoryStatus::Syncing))
        }) {
            None
        } else {
            unavailable_reason(c, Utc::now()).map(str::to_owned)
        };
        let can_import = reason.is_none()
            && import.as_ref().is_none_or(|i| {
                c.provider == Provider::Instagram && i.status == HistoryStatus::Failed
            });
        Ok(HistoryImportView {
            can_import,
            reason,
            import,
        })
    }
    /// Record explicit consent; connecting an account alone never requests history.
    pub async fn import_history(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        id: Uuid,
    ) -> PortResult<HistoryImportView> {
        let (team, user) = team_actor(access)?;
        let c = self.team_connection(team, id).await?;
        if let Some(reason) = unavailable_reason(&c, Utc::now()) {
            return Err(MessagingError::Invalid(reason).into());
        }
        self.require_manager(&c, user).await?;
        self.native.require_member(c.team_id, &c.user_id).await?;
        self.repository.request_history_import(&c, user).await?;
        self.history_view(&c).await
    }
    /// Execute at most one provider checkpoint. Pagination never occupies an HTTP request.
    pub async fn process_history_import(&self, w: &HistoryWork) -> PortResult<()> {
        let result = self.history_step(w).await;
        match result {
            Ok(status) => {
                self.repository
                    .settle_history_import(w, status, None, None)
                    .await
            }
            Err(error) => {
                if matches!(error.current_context(), MessagingError::Conflict) {
                    return Err(error);
                }
                // Only Instagram reads can be replayed. WhatsApp requests are one-time operations.
                let retry = (w.step == HistoryStep::Instagram
                    && w.attempts < 5
                    && matches!(error.current_context(), MessagingError::Unavailable))
                .then(|| 5 * 2_u32.pow(u32::from(w.attempts.min(8))));
                let code = match error.current_context() {
                    MessagingError::Forbidden => "history_permission_lost",
                    MessagingError::Disconnected => "history_reconnect_required",
                    MessagingError::ProviderAccessRequired => "history_meta_access_required",
                    _ if w.step == HistoryStep::Instagram => "history_fetch_failed",
                    _ => "history_request_unconfirmed",
                };
                self.repository
                    .settle_history_import(
                        w,
                        if retry.is_some() {
                            HistoryStatus::Pending
                        } else {
                            HistoryStatus::Failed
                        },
                        Some(code),
                        retry,
                    )
                    .await
            }
        }
    }
    async fn history_step(&self, w: &HistoryWork) -> PortResult<HistoryStatus> {
        let c = self
            .repository
            .connection(w.lease.id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        if c.connected_at != Some(w.connected_at) {
            return Err(MessagingError::Conflict.into());
        }
        if !self.require_history_consent(&c, Utc::now(), false).await? {
            return Err(MessagingError::Forbidden.into());
        }
        if !self.repository.heartbeat_history_import(&w.lease).await? {
            return Err(MessagingError::Conflict.into());
        }
        let token = self.token(&c).await?;
        match w.step {
            HistoryStep::Contacts => {
                if unavailable_reason(&c, Utc::now()).is_some() {
                    return Err(MessagingError::ProviderRejected.into());
                }
                self.repository
                    .checkpoint_history_import(w, HistoryStep::ContactsRequested, None)
                    .await?;
                self.provider
                    .request_whatsapp_history(&c, &token, true)
                    .await?;
                self.repository
                    .checkpoint_history_import(w, HistoryStep::Messages, None)
                    .await?;
                Ok(HistoryStatus::Pending)
            }
            HistoryStep::ContactsRequested => Err(MessagingError::ProviderRejected.into()),
            HistoryStep::Messages => {
                if unavailable_reason(&c, Utc::now()).is_some() {
                    return Err(MessagingError::ProviderRejected.into());
                }
                self.repository
                    .checkpoint_history_import(w, HistoryStep::Waiting, None)
                    .await?;
                // A timeout may still produce webhooks. Keep consent and never resend this request.
                self.provider
                    .request_whatsapp_history(&c, &token, false)
                    .await?;
                Ok(HistoryStatus::Syncing)
            }
            HistoryStep::Waiting => Ok(HistoryStatus::Syncing),
            HistoryStep::Instagram => {
                let page = self
                    .provider
                    .instagram_history(&c, &token, w.cursor.as_deref())
                    .await?;
                if page.next.is_some() && page.next == w.cursor {
                    return Err(MessagingError::ProviderRejected.into());
                }
                for mut message in page.messages {
                    if message.provider != c.provider
                        || message.account_id != c.account_id
                        || message.provenance != Provenance::OnboardingHistory
                    {
                        return Err(MessagingError::ProviderRejected.into());
                    }
                    if !self.require_history_consent(&c, Utc::now(), false).await? {
                        return Err(MessagingError::Forbidden.into());
                    }
                    self.ingest_message(&c, &mut message, IngestionLease::History(&w.lease))
                        .await?;
                }
                self.repository
                    .checkpoint_history_import(w, HistoryStep::Instagram, page.next.as_deref())
                    .await?;
                Ok(if page.next.is_some() {
                    HistoryStatus::Pending
                } else {
                    HistoryStatus::Complete
                })
            }
        }
    }
}
