#[cfg(test)]
mod test;

use super::{
    AgentSessionAdmission, DisableMemberReport, EnterpriseAdminService, EnterpriseError,
    EnterpriseRepository, HarnessRevoker, IdentityBroker, MemberAccess, MemberDirectory, Result,
    RuntimePresetAllowlist, TeamDirectory, UserLifecycle, VerifiedRoxIdentity,
};
use crate::audit::{AuditAction, AuditRecord, AuditResult};
use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

/// Admin and identity use cases over small outbound ports.
#[derive(Clone)]
pub struct EnterpriseService<R, T, U, D, H> {
    repository: R,
    teams: T,
    lifecycle: U,
    members: D,
    harnesses: H,
}

impl<R, T, U, D, H> EnterpriseService<R, T, U, D, H> {
    /// Compose the service without reading team billing flags.
    pub fn new(repository: R, teams: T, lifecycle: U, members: D, harnesses: H) -> Self {
        Self {
            repository,
            teams,
            lifecycle,
            members,
            harnesses,
        }
    }
}

impl<R: EnterpriseRepository, T, U, D, H> EnterpriseService<R, T, U, D, H> {
    /// Persist identity facts a trusted caller has already verified.
    pub async fn bind_verified(
        &self,
        macro_user_id: &MacroUserIdStr<'_>,
        identity: VerifiedRoxIdentity,
    ) -> Result<()> {
        self.repository.bind_verified(macro_user_id, identity).await
    }

    /// Exchange through the supplied port and bind only verified returned facts.
    pub async fn exchange_and_bind<B: IdentityBroker>(
        &self,
        broker: &B,
        macro_user_id: &MacroUserIdStr<'_>,
    ) -> Result<()> {
        let identity = broker.exchange().await?;
        self.bind_verified(macro_user_id, identity).await
    }

    /// Record a completed login without storing any token or login payload.
    pub async fn record_login(&self, actor: &MacroUserIdStr<'_>) -> Result<()> {
        self.repository
            .record(AuditRecord::new(
                actor,
                AuditAction::Login,
                actor.as_ref(),
                AuditResult::Success,
            ))
            .await
    }
}

fn team_id(receipt: &EntityAccessReceipt<AdminTeamRole>) -> Result<Uuid> {
    Uuid::parse_str(&receipt.entity().entity_id).map_err(|_| EnterpriseError::InvalidTeam)
}

impl<R, T, U, D, H> EnterpriseService<R, T, U, D, H>
where
    R: EnterpriseRepository,
    T: TeamDirectory,
    U: UserLifecycle,
    D: MemberDirectory,
    H: HarnessRevoker,
{
    async fn ensure_team_member(
        &self,
        receipt: &EntityAccessReceipt<AdminTeamRole>,
        member: &MacroUserIdStr<'_>,
    ) -> Result<Uuid> {
        let team_id = team_id(receipt)?;
        let teams = self.teams.team_ids(member.clone().into_owned()).await?;
        if !teams.contains(&team_id) {
            return Err(EnterpriseError::NotTeamMember);
        }
        Ok(team_id)
    }
}

impl<R, T, U, D, H> EnterpriseAdminService for EnterpriseService<R, T, U, D, H>
where
    R: EnterpriseRepository,
    T: TeamDirectory,
    U: UserLifecycle,
    D: MemberDirectory,
    H: HarnessRevoker,
{
    async fn disable_member(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        member: MacroUserIdStr<'static>,
    ) -> Result<DisableMemberReport> {
        self.ensure_team_member(&receipt, &member).await?;
        let actor = receipt.get_authenticated_user()?.clone().into_owned();
        let fusion_user_id = self.members.fusion_user_id(&member).await?;

        // Axiom: this admin action is a soft off-switch, never account or content deletion.
        self.lifecycle.deactivate_user(&fusion_user_id).await?;
        let server_records_revoked = self.harnesses.revoke_server_records(&member).await?;
        let report = DisableMemberReport::new(server_records_revoked);
        self.repository
            .commit_member_state(&actor, &member, true, report.audit_result())
            .await?;
        Ok(report)
    }

    async fn enable_member(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        member: MacroUserIdStr<'static>,
    ) -> Result<()> {
        self.ensure_team_member(&receipt, &member).await?;
        let actor = receipt.get_authenticated_user()?.clone().into_owned();
        let fusion_user_id = self.members.fusion_user_id(&member).await?;
        self.lifecycle.reactivate_user(&fusion_user_id).await?;
        self.repository
            .commit_member_state(&actor, &member, false, AuditResult::Success)
            .await
    }

    async fn set_runtime_allowlist(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        allowlist: RuntimePresetAllowlist,
    ) -> Result<RuntimePresetAllowlist> {
        let team_id = team_id(&receipt)?;
        self.repository
            .set_runtime_allowlist(team_id, Some(&allowlist))
            .await?;
        Ok(allowlist)
    }

    async fn clear_runtime_allowlist(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<()> {
        self.repository
            .set_runtime_allowlist(team_id(&receipt)?, None)
            .await
    }
}

/// Production identity exchange: no endpoint is known, so no network client exists here.
#[derive(Debug, Clone, Default)]
pub struct ProductionIdentityBroker;

impl IdentityBroker for ProductionIdentityBroker {
    async fn exchange(&self) -> Result<VerifiedRoxIdentity> {
        Err(EnterpriseError::BrokerExchangeGap)
    }
}

/// Read-only member gate shared by email initialization.
#[derive(Clone)]
pub struct MemberAccessService<R>(R);

impl<R> MemberAccessService<R> {
    /// Compose the gate over enterprise lifecycle state.
    pub fn new(repository: R) -> Self {
        Self(repository)
    }
}

impl<R: EnterpriseRepository> MemberAccess for MemberAccessService<R> {
    async fn ensure_active(&self, user: &MacroUserIdStr<'_>) -> Result<()> {
        if self.repository.member_disabled(user).await? {
            return Err(EnterpriseError::MemberDisabled);
        }
        Ok(())
    }
}

/// Agent-session admission over member state and team runtime policy.
#[derive(Clone)]
pub struct RuntimePolicy<R, T> {
    repository: R,
    teams: T,
}

impl<R, T> RuntimePolicy<R, T> {
    /// Compose runtime admission without any launcher or CLI dependency.
    pub fn new(repository: R, teams: T) -> Self {
        Self { repository, teams }
    }
}

impl<R: EnterpriseRepository, T: TeamDirectory> AgentSessionAdmission for RuntimePolicy<R, T> {
    async fn ensure_allowed(&self, user: MacroUserIdStr<'static>, preset_id: &str) -> Result<()> {
        if self.repository.member_disabled(&user).await? {
            return Err(EnterpriseError::MemberDisabled);
        }

        let Some(team_id) = self.teams.team_ids(user).await?.first().copied() else {
            return Ok(());
        };
        let Some(allowlist) = self.repository.runtime_allowlist(team_id).await? else {
            // Axiom: absence preserves all presets that start today.
            return Ok(());
        };
        if !allowlist.permits(preset_id) {
            return Err(EnterpriseError::RuntimePresetDenied);
        }
        Ok(())
    }
}
