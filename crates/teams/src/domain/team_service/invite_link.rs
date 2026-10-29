//! A team's shareable invite link: the policy for who may see and change it,
//! and joining through it.

use channels::domain::ports::ChannelService;
use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt, MemberTeamRole};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::service::NotificationIngress;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;

use super::TeamServiceImpl;
use crate::domain::{
    contacts_enqueuer::ContactsEnqueuer,
    crm_enqueuer::CrmEnqueuer,
    customer_repo::CustomerRepository,
    events::TeamJoinMethod,
    model::{
        JoinTeamByInviteLinkError, JoinTeamByInviteLinkOutcome, ManageTeamInviteLinkError,
        TeamError, TeamInviteLinkTeam, TeamInviteLinkToken, TeamRole,
    },
    open_seat_release::OpenSeatRelease,
    owned_entity_cleanup::OwnedEntityCleanup,
    team_analytics::TeamAnalytics,
    team_crm_settings_repo::TeamCrmSettingsRepository,
    team_repo::{TeamInviteLinkService, TeamRepository},
};

/// The team and caller a member-level receipt was minted for.
fn receipt_team_and_user(
    receipt: &EntityAccessReceipt<MemberTeamRole>,
) -> Result<(uuid::Uuid, &MacroUserIdStr<'static>), TeamError> {
    let team_id = macro_uuid::string_to_uuid(&receipt.entity().entity_id)?;
    let user_id = receipt.get_authenticated_user()?;
    Ok((team_id, user_id))
}

impl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC>
    TeamServiceImpl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    CS: ChannelService + Clone,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
    EB: MacroEventBroker,
    OSR: OpenSeatRelease,
    OEC: OwnedEntityCleanup,
{
    /// Checks the caller may invite people to the team, the same rule as
    /// email invites, and returns whether they are a team admin or owner.
    async fn caller_may_invite(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<bool, ManageTeamInviteLinkError> {
        let is_admin = matches!(
            self.team_repository.get_team_role(team_id, user_id).await?,
            Some(TeamRole::Admin | TeamRole::Owner)
        );
        if !is_admin
            && !self
                .team_repository
                .get_team_allow_non_admin_invites(team_id)
                .await?
        {
            return Err(ManageTeamInviteLinkError::NonAdminInvitesDisabled);
        }
        Ok(is_admin)
    }
}

impl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC> TeamInviteLinkService
    for TeamServiceImpl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    CS: ChannelService + Clone,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
    EB: MacroEventBroker + Clone,
    OSR: OpenSeatRelease,
    OEC: OwnedEntityCleanup,
{
    #[tracing::instrument(skip(self), err)]
    async fn get_team_invite_link(
        &self,
        entity_access_receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<Option<TeamInviteLinkToken>, ManageTeamInviteLinkError> {
        let (team_id, user_id) = receipt_team_and_user(&entity_access_receipt)?;
        self.caller_may_invite(&team_id, user_id).await?;
        Ok(self.team_repository.get_team_invite_link(&team_id).await?)
    }

    #[tracing::instrument(skip(self), err)]
    async fn create_team_invite_link(
        &self,
        entity_access_receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<TeamInviteLinkToken, ManageTeamInviteLinkError> {
        let (team_id, user_id) = receipt_team_and_user(&entity_access_receipt)?;
        let is_admin = self.caller_may_invite(&team_id, user_id).await?;

        if !is_admin
            && self
                .team_repository
                .get_team_invite_link(&team_id)
                .await?
                .is_some()
        {
            return Err(ManageTeamInviteLinkError::ResetRequiresAdmin);
        }

        let token = TeamInviteLinkToken::generate();
        self.team_repository
            .set_team_invite_link(&team_id, &token)
            .await?;
        Ok(token)
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_team_invite_link(
        &self,
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<(), TeamError> {
        let team_id = macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id)?;
        self.team_repository.delete_team_invite_link(&team_id).await
    }

    #[tracing::instrument(skip(self, token), err)]
    async fn get_team_by_invite_link(
        &self,
        token: &TeamInviteLinkToken,
    ) -> Result<TeamInviteLinkTeam, JoinTeamByInviteLinkError> {
        self.team_repository
            .get_team_by_invite_link(token)
            .await?
            .ok_or(JoinTeamByInviteLinkError::LinkNotFound)
    }

    #[tracing::instrument(skip(self, token), err)]
    async fn join_team_by_invite_link(
        &self,
        token: &TeamInviteLinkToken,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<JoinTeamByInviteLinkOutcome, JoinTeamByInviteLinkError> {
        let team = self.get_team_by_invite_link(token).await?;

        let user_teams = self.team_repository.get_user_teams(user_id).await?;
        if user_teams.iter().any(|t| t.id == team.team_id) {
            return Ok(JoinTeamByInviteLinkOutcome::AlreadyMember {
                team_id: team.team_id,
            });
        }
        if !user_teams.is_empty() {
            return Err(JoinTeamByInviteLinkError::AlreadyInAnotherTeam);
        }

        match self
            .join_team_directly(&team.team_id, user_id, TeamJoinMethod::InviteLink)
            .await?
        {
            Some(member) => Ok(JoinTeamByInviteLinkOutcome::Joined(member)),
            // The insert found an existing membership, which a concurrent
            // join may have created on either this team or another one.
            None => {
                let user_teams = self.team_repository.get_user_teams(user_id).await?;
                if user_teams.iter().any(|t| t.id == team.team_id) {
                    Ok(JoinTeamByInviteLinkOutcome::AlreadyMember {
                        team_id: team.team_id,
                    })
                } else {
                    Err(JoinTeamByInviteLinkError::AlreadyInAnotherTeam)
                }
            }
        }
    }
}
