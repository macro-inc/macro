//! Harness domain service.

use computer_id::ComputerId;
use pairing_id::PairingId;
#[cfg(test)]
mod test;

use chrono::{Duration, Utc};
use constant_time_eq::constant_time_eq;
use harness_id::HarnessId;
use harness_token::HashedHarnessToken;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{
    account_logins::{AccountLoginChange, AgentProvider, HarnessAccountLogin},
    models::{
        ApprovePairingRequest, ClaimOutcome, ClaimPairingRequest, ClaimedPairing,
        CreateHostedPairing, CreatePairingRequest, CreatedPairing, Harness, HarnessAccess,
        HarnessAgent, HarnessOwner, HarnessPermission, HarnessResident, HarnessSession,
        HostedPairing, PairingDetails, PairingStatus, PatchHarnessRequest,
        SetHarnessTeamAccessRequest,
    },
    ports::{
        ComputerTeamAgents, HarnessChanges, HarnessError, HarnessRepo, HarnessService,
        HarnessTeamAgents, HostedPairingUpsert, NewHarness, NewPairing,
    },
    tokens,
};

/// How long a pairing stays claimable.
const PAIRING_TTL_MINUTES: i64 = 15;
/// Whether a bought computer starts with permission prompts skipped.
const HOSTED_PERMISSION_BYPASS: bool = true;
/// Suggested delay between claim polls.
const POLL_INTERVAL_SECONDS: u64 = 5;
/// Cap on open pairings across the deployment; pairing is a human-paced flow.
const MAX_OPEN_PAIRINGS: i64 = 32;
/// Cap on open pairings requesting one name, bounding one stuck daemon.
const MAX_OPEN_PAIRINGS_PER_NAME: i64 = 4;
/// Attempts to find an unused pairing code before giving up.
const CODE_ATTEMPTS: usize = 5;
const MAX_NAME_CHARS: usize = 100;
const MAX_HOST_CHARS: usize = 200;

/// A trimmed display name within the length limit.
fn validated_name(name: &str) -> Result<String, HarnessError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(HarnessError::BadRequest(format!(
            "name must be 1..={MAX_NAME_CHARS} characters"
        )));
    }
    Ok(name.to_owned())
}

/// Harness service backed by a repository.
#[derive(Debug, Clone)]
pub struct HarnessServiceImpl<R, TeamAgents> {
    repo: R,
    team_agents: TeamAgents,
}

impl<R, TeamAgents> HarnessServiceImpl<R, TeamAgents> {
    /// Create a harness service over the repository and the computers'
    /// agent teammates.
    pub fn new(repo: R, team_agents: TeamAgents) -> Self {
        Self { repo, team_agents }
    }
}

impl<R, TeamAgents> HarnessServiceImpl<R, TeamAgents>
where
    R: HarnessRepo,
    TeamAgents: ComputerTeamAgents,
{
    /// Mark each agent teammate's computer with its agent, with one lookup
    /// for the whole list, so clients keep it out of everything that starts
    /// agents on a runtime.
    async fn with_team_agents(
        &self,
        mut harnesses: Vec<Harness>,
    ) -> Result<Vec<Harness>, HarnessError> {
        let computers: Vec<ComputerId> = harnesses
            .iter()
            .filter_map(|harness| harness.computer_id)
            .collect();
        if computers.is_empty() {
            return Ok(harnesses);
        }

        let mut agents = self
            .team_agents
            .team_agents_of(&computers)
            .await
            .map_err(Into::into)?;
        for harness in &mut harnesses {
            harness.team_agent_user_id = harness
                .computer_id
                .and_then(|computer_id| agents.remove(&computer_id));
        }
        Ok(harnesses)
    }

    /// [`Self::with_team_agents`] for one harness.
    async fn with_team_agent(&self, mut harness: Harness) -> Result<Harness, HarnessError> {
        if let Some(computer_id) = harness.computer_id {
            harness.team_agent_user_id = self
                .team_agents
                .team_agents_of(&[computer_id])
                .await
                .map_err(Into::into)?
                .remove(&computer_id);
        }
        Ok(harness)
    }

    async fn ensure_may_manage(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: &Harness,
    ) -> Result<(), HarnessError> {
        // A computer belongs to its team, whoever bought it: the access level
        // makes the team's owner and admins its owners.
        if harness.computer_id.is_some() {
            let access = self
                .repo
                .harness_access(harness.id, caller.clone())
                .await
                .map_err(Into::into)?;
            return match access {
                HarnessAccess::Owner => Ok(()),
                HarnessAccess::User | HarnessAccess::Read | HarnessAccess::None => {
                    Err(HarnessError::Unauthorized)
                }
            };
        }
        let HarnessOwner::User { user_id } = &harness.owner;
        if user_id == caller.as_ref() {
            return Ok(());
        }
        // A team's owner can take a machine the whole team runs on out of
        // service; only the runtime's own owner decides who else may use it.
        for team_id in &harness.shared_team_ids {
            if self
                .repo
                .user_owns_team(caller.clone(), *team_id)
                .await
                .map_err(Into::into)?
            {
                return Ok(());
            }
        }
        Err(HarnessError::Unauthorized)
    }
}

impl<R, TeamAgents> HarnessService for HarnessServiceImpl<R, TeamAgents>
where
    R: HarnessRepo,
    TeamAgents: ComputerTeamAgents,
{
    #[tracing::instrument(skip_all, err)]
    async fn create_pairing(
        &self,
        req: CreatePairingRequest,
    ) -> Result<CreatedPairing, HarnessError> {
        let name = validated_name(&req.name)?;
        let name = name.as_str();
        let host = req
            .host
            .as_deref()
            .map(str::trim)
            .filter(|host| !host.is_empty())
            .map(|host| host.chars().take(MAX_HOST_CHARS).collect::<String>());

        self.repo
            .delete_expired_pairings()
            .await
            .map_err(Into::into)?;
        let counts = self
            .repo
            .count_open_pairings(name)
            .await
            .map_err(Into::into)?;
        if counts.total >= MAX_OPEN_PAIRINGS || counts.with_same_name >= MAX_OPEN_PAIRINGS_PER_NAME
        {
            return Err(HarnessError::Throttled);
        }

        let device_secret = tokens::generate_device_secret();
        let device_secret_hash = harness_token::hash_token(&device_secret);
        let expires_at = Utc::now() + Duration::minutes(PAIRING_TTL_MINUTES);
        let pairing_id = PairingId::new_from_uuid(Uuid::now_v7());

        for _ in 0..CODE_ATTEMPTS {
            let code = tokens::generate_pairing_code();
            let inserted = self
                .repo
                .insert_pairing(NewPairing {
                    id: pairing_id,
                    code: code.clone(),
                    device_secret_hash,
                    requested_name: name.to_owned(),
                    host: host.clone(),
                    expires_at,
                })
                .await
                .map_err(Into::into)?;
            if inserted {
                return Ok(CreatedPairing {
                    pairing_id,
                    code,
                    device_secret,
                    expires_at,
                    poll_interval_seconds: POLL_INTERVAL_SECONDS,
                });
            }
        }

        Err(HarnessError::Repo(anyhow::anyhow!(
            "could not find an unused pairing code"
        )))
    }

    // `code` is the user-facing device secret for the pairing's 15-minute
    // window; it must never reach a span field or a log line.
    #[tracing::instrument(skip(self, code), err)]
    async fn get_pairing(&self, code: &str) -> Result<PairingDetails, HarnessError> {
        let code = tokens::normalize_pairing_code(code)
            .ok_or_else(|| HarnessError::BadRequest("malformed pairing code".to_owned()))?;
        let pairing = self
            .repo
            .get_pairing(&code)
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::NotFound("unknown pairing code".to_owned()))?;

        if pairing.status != PairingStatus::Pending {
            return Err(HarnessError::Gone(
                "this pairing was already approved".to_owned(),
            ));
        }
        if pairing.details.expires_at <= Utc::now() {
            return Err(HarnessError::Gone("this pairing expired".to_owned()));
        }

        Ok(pairing.details)
    }

    // Skip `code` (the device secret) and `req`; the caller is safe to record.
    #[tracing::instrument(skip(self, req, code), fields(caller = %caller), err)]
    async fn approve_pairing(
        &self,
        caller: MacroUserIdStr<'static>,
        code: &str,
        req: ApprovePairingRequest,
    ) -> Result<Harness, HarnessError> {
        // Reuses the pending/expired policy so approval failures report the
        // same way the lookup does.
        let details = self.get_pairing(code).await?;
        let code = tokens::normalize_pairing_code(code).expect("get_pairing validated the code");

        let name = match &req.name {
            Some(name) => validated_name(name)?,
            None => details.requested_name,
        };

        // Any current member may open their harness to their team, mirroring
        // team agents: harnesses exist to serve agents teammates create.
        if let Some(team_id) = req.team_id {
            let is_member = self
                .repo
                .user_has_team(caller.clone(), team_id)
                .await
                .map_err(Into::into)?;
            if !is_member {
                return Err(HarnessError::Unauthorized);
            }
        }

        self.repo
            .approve_pairing(
                &code,
                NewHarness {
                    allow_permission_bypass: req.allow_permission_bypass,
                    id: HarnessId::new_from_uuid(Uuid::now_v7()),
                    name,
                    owner: HarnessOwner::User {
                        user_id: caller.as_ref().to_owned(),
                    },
                    team_grant: req.team_id,
                    created_by: caller,
                    computer_id: None,
                },
            )
            .await
            .map_err(Into::into)?
            .map(|harness| Harness {
                access: HarnessAccess::Owner,
                ..harness
            })
            .ok_or_else(|| HarnessError::Gone("this pairing is no longer pending".to_owned()))
    }

    #[tracing::instrument(skip(self, req), err)]
    async fn claim_pairing(
        &self,
        pairing_id: PairingId,
        req: ClaimPairingRequest,
    ) -> Result<ClaimOutcome, HarnessError> {
        let facts = self
            .repo
            .pairing_claim_facts(pairing_id)
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::NotFound("unknown pairing".to_owned()))?;

        let presented = harness_token::hash_token(&req.device_secret);
        if !constant_time_eq(&presented, &facts.device_secret_hash) {
            return Err(HarnessError::Unauthorized);
        }

        match facts.status {
            PairingStatus::Claimed => {
                return Err(HarnessError::Gone(
                    "this pairing's credential was already claimed".to_owned(),
                ));
            }
            PairingStatus::Pending if facts.expires_at <= Utc::now() => {
                return Err(HarnessError::Gone("this pairing expired".to_owned()));
            }
            PairingStatus::Pending => return Ok(ClaimOutcome::Pending),
            // An approved pairing stays claimable past its expiry: the user
            // already said yes, and the daemon polling a few minutes late
            // should not force a re-pair.
            PairingStatus::Approved => {}
        }

        let token = tokens::generate_harness_token();
        let harness = self
            .repo
            .claim_pairing(
                pairing_id,
                presented,
                Uuid::new_v4(),
                HashedHarnessToken::from_raw(&token),
            )
            .await
            .map_err(Into::into)?
            .ok_or_else(|| {
                HarnessError::Gone("this pairing's credential was already claimed".to_owned())
            })?;

        Ok(ClaimOutcome::Claimed(Box::new(ClaimedPairing {
            harness,
            token,
        })))
    }

    #[tracing::instrument(skip(self), fields(caller = %caller), err)]
    async fn list_harnesses(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Harness>, HarnessError> {
        let harnesses = self
            .repo
            .list_usable_harnesses(caller)
            .await
            .map_err(Into::into)?;
        self.with_team_agents(harnesses).await
    }

    #[tracing::instrument(skip(self), fields(caller = %caller), err)]
    async fn list_directory(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Harness>, HarnessError> {
        let harnesses = self
            .repo
            .list_directory_harnesses(caller)
            .await
            .map_err(Into::into)?;
        self.with_team_agents(harnesses).await
    }

    #[tracing::instrument(skip(self, req), fields(caller = %caller, team_id = %req.team_id, enabled = req.enabled), err)]
    async fn set_team_access(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
        req: SetHarnessTeamAccessRequest,
    ) -> Result<(), HarnessError> {
        let access = self
            .repo
            .harness_access(harness_id, caller.clone())
            .await
            .map_err(Into::into)?;
        if access != HarnessAccess::Owner {
            return Err(HarnessError::Unauthorized);
        }
        // A computer's team access is its team, fixed at purchase.
        if self
            .repo
            .get_harness(harness_id)
            .await
            .map_err(Into::into)?
            .is_some_and(|harness| harness.computer_id.is_some())
        {
            return Err(HarnessError::ComputerHarness);
        }
        let is_member = self
            .repo
            .user_has_team(caller, req.team_id)
            .await
            .map_err(Into::into)?;
        if !is_member {
            return Err(HarnessError::Unauthorized);
        }
        Ok(self
            .repo
            .set_team_access(harness_id, req.team_id, req.enabled)
            .await
            .map_err(Into::into)?)
    }

    #[tracing::instrument(skip(self), fields(caller = %caller), err)]
    async fn list_residents(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
    ) -> Result<Vec<HarnessResident>, HarnessError> {
        let access = self
            .repo
            .harness_access(harness_id, caller)
            .await
            .map_err(Into::into)?;
        if access == HarnessAccess::None {
            return Err(HarnessError::Unauthorized);
        }
        Ok(self
            .repo
            .list_residents(harness_id)
            .await
            .map_err(Into::into)?)
    }

    #[tracing::instrument(skip(self, req), fields(caller = %caller), err)]
    async fn patch_harness(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
        req: PatchHarnessRequest,
    ) -> Result<Harness, HarnessError> {
        let mut harness = self
            .repo
            .get_harness(harness_id)
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::NotFound("unknown harness".to_owned()))?;
        self.ensure_may_manage(&caller, &harness).await?;
        let access = self
            .repo
            .harness_access(harness_id, caller)
            .await
            .map_err(Into::into)?;
        harness.access = access;

        let changes = HarnessChanges {
            name: req.name.as_deref().map(validated_name).transpose()?,
            allow_permission_bypass: req.allow_permission_bypass,
        };
        if changes == HarnessChanges::default() {
            return self.with_team_agent(harness).await;
        }
        let mut updated = self
            .repo
            .update_harness(harness_id, changes)
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::NotFound("unknown harness".to_owned()))?;
        updated.access = access;
        self.with_team_agent(updated).await
    }

    #[tracing::instrument(skip(self), fields(caller = %caller), err)]
    async fn delete_harness(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
    ) -> Result<(), HarnessError> {
        let harness = self
            .repo
            .get_harness(harness_id)
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::NotFound("unknown harness".to_owned()))?;

        self.ensure_may_manage(&caller, &harness).await?;
        if harness.computer_id.is_some() {
            return Err(HarnessError::ComputerHarness);
        }

        if !self
            .repo
            .delete_harness(harness_id)
            .await
            .map_err(Into::into)?
        {
            return Err(HarnessError::NotFound("unknown harness".to_owned()));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_bound_agents(
        &self,
        harness_id: HarnessId,
    ) -> Result<Vec<HarnessAgent>, HarnessError> {
        Ok(self
            .repo
            .list_bound_agents(harness_id)
            .await
            .map_err(Into::into)?)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_self(&self, harness_id: HarnessId) -> Result<Harness, HarnessError> {
        self.repo
            .get_harness(harness_id)
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::NotFound("unknown harness".to_owned()))
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_self(&self, harness_id: HarnessId) -> Result<(), HarnessError> {
        // The valid credential that authenticated this call is the whole
        // authorization: a daemon may retire itself, except a computer's,
        // which only releasing the computer retires (agents stay bound to a
        // computer harness until then).
        if self
            .repo
            .get_harness(harness_id)
            .await
            .map_err(Into::into)?
            .is_some_and(|harness| harness.computer_id.is_some())
        {
            return Err(HarnessError::ComputerHarness);
        }
        if !self
            .repo
            .delete_harness(harness_id)
            .await
            .map_err(Into::into)?
        {
            return Err(HarnessError::NotFound("unknown harness".to_owned()));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_sessions(
        &self,
        harness_id: HarnessId,
    ) -> Result<Vec<HarnessSession>, HarnessError> {
        Ok(self
            .repo
            .list_sessions(harness_id)
            .await
            .map_err(Into::into)?)
    }

    #[tracing::instrument(
        skip(self, req),
        fields(team_id = %req.team_id, computer_id = %req.computer_id, created_by = %req.created_by),
        err
    )]
    async fn create_hosted_pairing(
        &self,
        req: CreateHostedPairing,
    ) -> Result<HostedPairing, HarnessError> {
        let name = validated_name(&req.name)?;
        let device_secret = super::models::DeviceSecret::new(tokens::generate_device_secret());
        let new_pairing_id = PairingId::new_from_uuid(Uuid::now_v7());
        let upserted = self
            .repo
            .upsert_hosted_pairing(
                NewPairing {
                    id: new_pairing_id,
                    // Never shown or typed: the code only has to be unique,
                    // and its shape keeps it out of code lookups entirely.
                    code: format!("hosted:{new_pairing_id}"),
                    device_secret_hash: harness_token::hash_token(device_secret.expose()),
                    requested_name: name.clone(),
                    host: None,
                    expires_at: Utc::now() + Duration::minutes(PAIRING_TTL_MINUTES),
                },
                NewHarness {
                    // A bought computer is the team's own isolated VM, run
                    // for agents: it starts with "Don't ask before acting"
                    // on. Paired machines keep asking until their owner
                    // turns it on.
                    allow_permission_bypass: HOSTED_PERMISSION_BYPASS,
                    id: HarnessId::new_from_uuid(Uuid::now_v7()),
                    name,
                    owner: HarnessOwner::User {
                        user_id: req.created_by.as_ref().to_owned(),
                    },
                    team_grant: Some(req.team_id),
                    created_by: req.created_by,
                    computer_id: Some(req.computer_id),
                },
            )
            .await
            .map_err(Into::into)?;
        let pairing_id = match upserted {
            HostedPairingUpsert::Created => new_pairing_id,
            HostedPairingUpsert::Rotated { pairing_id } => pairing_id,
            HostedPairingUpsert::Rekeyed => new_pairing_id,
        };
        Ok(HostedPairing {
            pairing_id,
            device_secret,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn hosted_pairing_claimed(&self, pairing_id: PairingId) -> Result<bool, HarnessError> {
        let facts = self
            .repo
            .pairing_claim_facts(pairing_id)
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::NotFound("unknown hosted pairing".to_owned()))?;
        match facts.status {
            PairingStatus::Claimed => Ok(true),
            PairingStatus::Approved => Ok(false),
            PairingStatus::Pending => Err(HarnessError::BadRequest(
                "hosted pairing is not approved".to_owned(),
            )),
        }
    }

    #[tracing::instrument(skip(self), fields(harness_id = tracing::field::Empty), err)]
    async fn revoke_hosted_harness(&self, computer_id: ComputerId) -> Result<(), HarnessError> {
        let Some(harness_id) = self
            .repo
            .computer_harness(computer_id)
            .await
            .map_err(Into::into)?
        else {
            return Ok(());
        };
        tracing::Span::current().record("harness_id", tracing::field::display(harness_id));
        // A concurrent revoke deleting it first is the same outcome.
        self.repo
            .delete_harness(harness_id)
            .await
            .map_err(Into::into)?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn computer_harnesses(
        &self,
        computer_id: ComputerId,
    ) -> Result<Vec<HarnessId>, HarnessError> {
        Ok(self
            .repo
            .computer_harness_ids(computer_id)
            .await
            .map_err(Into::into)?)
    }

    #[tracing::instrument(skip(self), err)]
    async fn harness_computer(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<ComputerId>, HarnessError> {
        Ok(self
            .repo
            .harness_computer(harness_id)
            .await
            .map_err(Into::into)?)
    }

    #[tracing::instrument(skip(self), fields(caller = %caller), err)]
    async fn authorize_harness(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
        permission: HarnessPermission,
    ) -> Result<Harness, HarnessError> {
        let mut harness = self
            .repo
            .get_harness(harness_id)
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::NotFound("unknown harness".to_owned()))?;
        harness.access = self
            .repo
            .harness_access(harness_id, caller.clone())
            .await
            .map_err(Into::into)?;
        match permission {
            HarnessPermission::View if harness.access != HarnessAccess::None => {}
            HarnessPermission::Use
                if matches!(harness.access, HarnessAccess::Owner | HarnessAccess::User) => {}
            HarnessPermission::Manage => self.ensure_may_manage(&caller, &harness).await?,
            _ => return Err(HarnessError::Unauthorized),
        }
        Ok(harness)
    }

    #[tracing::instrument(skip(self, change), fields(provider = change.provider().as_ref()), err)]
    async fn record_account_login(
        &self,
        harness_id: HarnessId,
        change: AccountLoginChange,
    ) -> Result<(), HarnessError> {
        if !self
            .repo
            .record_account_login(harness_id, change)
            .await
            .map_err(Into::into)?
        {
            return Err(HarnessError::NotFound("unknown harness".to_owned()));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(provider = provider.as_ref()), err)]
    async fn active_account_login(
        &self,
        harness_id: HarnessId,
        provider: AgentProvider,
    ) -> Result<Option<HarnessAccountLogin>, HarnessError> {
        let login = self
            .repo
            .active_account_login(harness_id, provider)
            .await
            .map_err(Into::<anyhow::Error>::into)?;
        Ok(login)
    }
}

impl<R, TeamAgents> HarnessTeamAgents for HarnessServiceImpl<R, TeamAgents>
where
    R: HarnessRepo,
    TeamAgents: ComputerTeamAgents,
{
    #[tracing::instrument(skip(self), err)]
    async fn harness_team_agent(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<MacroUserIdStr<'static>>, HarnessError> {
        let Some(computer_id) = self
            .repo
            .harness_computer(harness_id)
            .await
            .map_err(Into::into)?
        else {
            return Ok(None);
        };
        Ok(self
            .team_agents
            .team_agents_of(&[computer_id])
            .await
            .map_err(Into::into)?
            .remove(&computer_id))
    }
}
