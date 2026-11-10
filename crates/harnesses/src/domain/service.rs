//! Harness domain service.

#[cfg(test)]
mod test;

use chrono::{Duration, Utc};
use constant_time_eq::constant_time_eq;
use harness_id::HarnessId;
use harness_token::HashedHarnessToken;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{
    models::{
        ApprovePairingRequest, BoundHarnessAgent, ClaimOutcome, ClaimPairingRequest,
        ClaimedPairing, CreatePairingRequest, CreatedPairing, Harness, HarnessAgent,
        HarnessAgentOwner, HarnessOwner, HarnessSession, PairingDetails, PairingStatus,
        PatchHarnessRequest, ReportWorkspacesRequest, ReportedWorkspace, RequestedHarnessOwner,
        RequestedHarnessWorkspace,
    },
    ports::{
        BoundAgentFacts, HarnessChanges, HarnessError, HarnessRepo, HarnessService, HarnessUpdate,
        NewHarness, NewPairing,
    },
    tokens,
};

/// How long a pairing stays claimable.
const PAIRING_TTL_MINUTES: i64 = 15;
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
/// Cap on the workspaces one daemon reports; it bounds its own scan lower.
const MAX_REPORTED_WORKSPACES: usize = 500;
/// Longest reported workspace path, matching the session workspace limit.
const MAX_WORKSPACE_PATH_BYTES: usize = 4096;

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

/// A reported workspace list with every path checked and duplicates dropped,
/// keeping the first of each path.
fn validated_workspaces(
    workspaces: Vec<ReportedWorkspace>,
) -> Result<Vec<ReportedWorkspace>, HarnessError> {
    if workspaces.len() > MAX_REPORTED_WORKSPACES {
        return Err(HarnessError::BadRequest(format!(
            "report at most {MAX_REPORTED_WORKSPACES} workspaces"
        )));
    }

    let mut seen = std::collections::HashSet::new();
    let mut validated = Vec::with_capacity(workspaces.len());
    for workspace in workspaces {
        let path = workspace.path.as_str();
        if path.is_empty() || path.len() > MAX_WORKSPACE_PATH_BYTES || path.contains('\0') {
            return Err(HarnessError::BadRequest(format!(
                "workspace paths must be 1..={MAX_WORKSPACE_PATH_BYTES} bytes with no NUL"
            )));
        }
        if seen.insert(workspace.path.clone()) {
            validated.push(workspace);
        }
    }
    Ok(validated)
}

/// The requested workspace, when the daemon reported it.
fn validated_workspace(
    harness: &Harness,
    requested: RequestedHarnessWorkspace,
) -> Result<RequestedHarnessWorkspace, HarnessError> {
    match &requested {
        RequestedHarnessWorkspace::Local => Ok(requested),
        RequestedHarnessWorkspace::Path { path } => {
            let reported = harness
                .reported_workspaces
                .iter()
                .any(|workspace| workspace.path == *path);
            if !reported {
                return Err(HarnessError::BadRequest(
                    "this runtime has not reported that workspace; pick one it lists".to_owned(),
                ));
            }
            Ok(requested)
        }
    }
}

/// Whether `requested` is what the harness already uses.
fn workspace_is_current(harness: &Harness, requested: &RequestedHarnessWorkspace) -> bool {
    match requested {
        RequestedHarnessWorkspace::Local => harness.workspace_path.is_none(),
        RequestedHarnessWorkspace::Path { path } => {
            harness.workspace_path.as_deref() == Some(path.as_str())
        }
    }
}

/// Harness service backed by a repository.
#[derive(Debug, Clone)]
pub struct HarnessServiceImpl<R> {
    repo: R,
}

impl<R> HarnessServiceImpl<R> {
    /// Create a harness service backed by the supplied repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

/// Proof that a caller may manage a harness: only
/// [`HarnessServiceImpl::ensure_may_manage`] constructs one, and every change
/// to a registered harness takes one.
#[derive(Debug, Clone)]
pub struct ManagedHarness {
    harness: Harness,
    manager: MacroUserIdStr<'static>,
}

impl ManagedHarness {
    /// The harness as it was when the check passed.
    pub fn harness(&self) -> &Harness {
        &self.harness
    }

    /// The user the check passed for.
    pub fn manager(&self) -> &MacroUserIdStr<'static> {
        &self.manager
    }
}

/// The bound agents that could no longer run on a harness owned by
/// `new_owner`, by the bots crate's binding rule: a team agent runs only on
/// its own team's harness; a private agent runs on its owner's harness or on
/// a harness of a team its owner belongs to.
pub fn agents_stranded_by(
    new_owner: &HarnessOwner,
    bound: Vec<BoundAgentFacts>,
) -> Vec<BoundHarnessAgent> {
    bound
        .into_iter()
        .filter(|facts| {
            let usable = match (&facts.agent.owner, new_owner) {
                (HarnessAgentOwner::Team { team_id }, HarnessOwner::Team { team_id: new_team }) => {
                    team_id == new_team
                }
                (HarnessAgentOwner::Team { .. }, HarnessOwner::User { .. }) => false,
                (HarnessAgentOwner::User { user_id }, HarnessOwner::User { user_id: new_user }) => {
                    user_id == new_user
                }
                (HarnessAgentOwner::User { .. }, HarnessOwner::Team { .. }) => {
                    facts.owner_in_new_team
                }
            };
            !usable
        })
        .map(|facts| facts.agent)
        .collect()
}

impl<R> HarnessServiceImpl<R>
where
    R: HarnessRepo,
{
    async fn ensure_may_manage(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
    ) -> Result<ManagedHarness, HarnessError> {
        let harness = self
            .repo
            .get_harness(harness_id)
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::NotFound("unknown harness".to_owned()))?;

        let may_manage = match &harness.owner {
            HarnessOwner::User { user_id } => user_id == caller.as_ref(),
            // Same rule as team bots: the registrant or the team owner.
            HarnessOwner::Team { team_id } => {
                harness.created_by == caller.as_ref()
                    || self
                        .repo
                        .user_owns_team(caller.clone(), *team_id)
                        .await
                        .map_err(Into::into)?
            }
        };
        if !may_manage {
            return Err(HarnessError::Unauthorized);
        }
        Ok(ManagedHarness {
            harness,
            manager: caller,
        })
    }

    /// Resolve a requested owner for the manager: private means theirs, and a
    /// team must be one they belong to, as at approval.
    async fn resolve_owner(
        &self,
        managed: &ManagedHarness,
        requested: RequestedHarnessOwner,
    ) -> Result<HarnessOwner, HarnessError> {
        match requested {
            RequestedHarnessOwner::User => Ok(HarnessOwner::User {
                user_id: managed.manager.as_ref().to_owned(),
            }),
            RequestedHarnessOwner::Team { team_id } => {
                let is_member = self
                    .repo
                    .user_has_team(managed.manager.clone(), team_id)
                    .await
                    .map_err(Into::into)?;
                if !is_member {
                    return Err(HarnessError::Unauthorized);
                }
                Ok(HarnessOwner::Team { team_id })
            }
        }
    }

    async fn update(
        &self,
        managed: ManagedHarness,
        req: PatchHarnessRequest,
    ) -> Result<Harness, HarnessError> {
        let owner = match req.owner {
            Some(requested) => Some(self.resolve_owner(&managed, requested).await?),
            None => None,
        };
        let workspace = req
            .workspace
            .map(|requested| validated_workspace(&managed.harness, requested))
            .transpose()?;
        let changes = HarnessChanges {
            name: req.name.as_deref().map(validated_name).transpose()?,
            allow_permission_bypass: req.allow_permission_bypass,
            owner: owner.filter(|owner| *owner != managed.harness.owner),
            workspace: workspace
                .filter(|workspace| !workspace_is_current(&managed.harness, workspace)),
        };
        if changes == HarnessChanges::default() {
            return Ok(managed.harness);
        }

        match self
            .repo
            .update_harness(&managed, changes)
            .await
            .map_err(Into::into)?
        {
            HarnessUpdate::Updated(harness) => Ok(harness),
            HarnessUpdate::Missing => Err(HarnessError::NotFound("unknown harness".to_owned())),
            HarnessUpdate::OwnerChangeBlocked(agents) => {
                Err(HarnessError::OwnerChangeBlocked(agents))
            }
        }
    }

    async fn revoke(&self, managed: ManagedHarness) -> Result<(), HarnessError> {
        if !self
            .repo
            .delete_harness(managed.harness.id)
            .await
            .map_err(Into::into)?
        {
            return Err(HarnessError::NotFound("unknown harness".to_owned()));
        }
        Ok(())
    }
}

impl<R> HarnessService for HarnessServiceImpl<R>
where
    R: HarnessRepo,
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
        let pairing_id = Uuid::new_v4();

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

        // Any current member may register a team harness, mirroring team
        // agents: harnesses exist to serve agents teammates create.
        let owner = match req.team_id {
            Some(team_id) => {
                let is_member = self
                    .repo
                    .user_has_team(caller.clone(), team_id)
                    .await
                    .map_err(Into::into)?;
                if !is_member {
                    return Err(HarnessError::Unauthorized);
                }
                HarnessOwner::Team { team_id }
            }
            None => HarnessOwner::User {
                user_id: caller.as_ref().to_owned(),
            },
        };

        self.repo
            .approve_pairing(
                &code,
                NewHarness {
                    allow_permission_bypass: req.allow_permission_bypass,
                    id: HarnessId::new_from_uuid(Uuid::new_v4()),
                    name,
                    owner,
                    created_by: caller,
                },
            )
            .await
            .map_err(Into::into)?
            .ok_or_else(|| HarnessError::Gone("this pairing is no longer pending".to_owned()))
    }

    #[tracing::instrument(skip(self, req), err)]
    async fn claim_pairing(
        &self,
        pairing_id: Uuid,
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
        Ok(self
            .repo
            .list_visible_harnesses(caller)
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
        let managed = self.ensure_may_manage(caller, harness_id).await?;
        self.update(managed, req).await
    }

    #[tracing::instrument(skip(self), fields(caller = %caller), err)]
    async fn delete_harness(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
    ) -> Result<(), HarnessError> {
        let managed = self.ensure_may_manage(caller, harness_id).await?;
        self.revoke(managed).await
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
        // authorization: a daemon may always retire itself.
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
        name = "harness.report_workspaces",
        skip(self, req),
        fields(harness = %harness_id, workspaces = req.workspaces.len()),
        err
    )]
    async fn report_workspaces(
        &self,
        harness_id: HarnessId,
        req: ReportWorkspacesRequest,
    ) -> Result<(), HarnessError> {
        let workspaces = validated_workspaces(req.workspaces)?;
        if !self
            .repo
            .replace_reported_workspaces(harness_id, workspaces)
            .await
            .map_err(Into::into)?
        {
            return Err(HarnessError::NotFound("unknown harness".to_owned()));
        }
        Ok(())
    }
}
