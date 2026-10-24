//! Authorized standalone timeline operations.
use super::*;
use entity_access::domain::models::{AccessLevel, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::{
    SharePermissionV2, UpdateSharePermissionRequestV2,
    team_share::{TeamShareLevel, TeamShareRequest, authorize_team_share},
};
impl LinkedService {
    /// List all shared groups, including for viewers with no WhatsApp account.
    #[tracing::instrument(name = "whatsapp.groups.list", skip_all, err)]
    pub async fn adopted_groups(&self, user: &str) -> LinkedResult<Vec<WhatsAppGroupSummary>> {
        let records = self.timeline.visible_groups(user).await?;
        let account = self.accounts.owned_account(user).await?;
        let groups = records
            .into_iter()
            .map(|record| {
                let facts = account
                    .as_ref()
                    .map(|a| sending_facts_from_roster(a, record.roster));
                let mut group = record.summary;
                group.send_reason = reply_block(
                    self.features,
                    account.as_ref(),
                    &record.binding,
                    facts.as_ref(),
                );
                group.can_send = group.send_reason.is_none();
                group
            })
            .collect();
        Ok(groups)
    }
    /// Authorized group detail, standard sharing and own sending identity.
    pub async fn group_detail<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
    ) -> LinkedResult<WhatsAppGroupDetail> {
        let (user, id) = view_scope(access)?;
        let binding = self
            .bindings
            .binding(id)
            .await?
            .ok_or(LinkedError::NotFound)?;
        let account = self.accounts.owned_account(user).await?;
        let mut group = self.timeline.summary(id, user).await?;
        let observers = self.groups.group_accounts(id, user).await?;
        self.groups.request_groups_refresh(&observers).await?;
        group.send_reason = self.reply_block(account.as_ref(), &binding).await?;
        group.can_send = group.send_reason.is_none();
        let access_level = match access.entity_permission() {
            EntityPermission::AccessLevel { access_level } => *access_level,
            _ => return Err(LinkedError::Forbidden.into()),
        };
        Ok(WhatsAppGroupDetail {
            group,
            share_permission: self.timeline.permissions(id).await?,
            access_level,
            roster: self.groups.binding_roster(&binding).await?,
            sending_identity: account.and_then(|a| a.identity_jid),
            limits: Capabilities::default(),
        })
    }
    /// Read the complete timeline through view access, without remote membership.
    pub async fn messages<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        before: Option<Uuid>,
        limit: i64,
    ) -> LinkedResult<WhatsAppGroupMessages> {
        let (user, id) = view_scope(access)?;
        if !(1..=100).contains(&limit) {
            return Err(LinkedError::Invalid("limit must be between 1 and 100").into());
        }
        self.timeline.messages(id, user, before, limit).await
    }
    /// Advance the caller's own read cursor monotonically.
    #[tracing::instrument(name="whatsapp.groups.read",skip_all,err,fields(message_id=%message))]
    pub async fn mark_read<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        message: Uuid,
    ) -> LinkedResult<()> {
        let (user, id) = receipt_scope(access)?;
        self.timeline.mark_read(id, user, message).await
    }
    /// List only the caller's pending, uncertain or failed sends.
    pub async fn open_sends<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
    ) -> LinkedResult<Vec<SendProgress>> {
        let (user, id) = receipt_scope(access)?;
        self.sends.open_sends(id, user).await
    }
    /// Read standard permission settings.
    pub async fn permissions<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
    ) -> LinkedResult<SharePermissionV2> {
        let (_, id) = view_scope(access)?;
        self.timeline.permissions(id).await
    }
    /// Actual owner controls link and team sharing; ordinary people grants use
    /// the generic direct-access endpoints.
    #[tracing::instrument(name = "whatsapp.groups.permissions", skip_all, err)]
    pub async fn update_permissions<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        update: &UpdateSharePermissionRequestV2,
    ) -> LinkedResult<()> {
        let (user, id) = receipt_scope(access)?;
        let facts = self.timeline.share_facts(id).await?;
        let actor =
            MacroUserIdStr::try_from(user.to_owned()).map_err(|_| LinkedError::Forbidden)?;
        if !facts.owner.is_user(&actor) {
            return Err(LinkedError::Forbidden.into());
        }
        if update
            .channel_share_permissions
            .as_ref()
            .is_some_and(|c| !c.is_empty())
            || update.link_share_access_level.flatten() == Some(AccessLevel::Owner)
        {
            return Err(LinkedError::Invalid(
                "share with people or your team; ownership cannot be shared",
            )
            .into());
        }
        let command = authorize_team_share(
            Some(&actor),
            &facts,
            TeamShareRequest {
                access_level: update.team_share_access_level,
                legacy_enabled: None,
            },
            TeamShareLevel::View,
        )
        .map_err(|_| LinkedError::Forbidden)?;
        self.timeline
            .update_permissions(id, user, update, command.as_ref())
            .await
    }
}
