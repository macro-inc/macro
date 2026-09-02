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
        ApprovePairingRequest, ClaimOutcome, ClaimPairingRequest, ClaimedPairing,
        CreatePairingRequest, CreatedPairing, Harness, HarnessAgent, HarnessOwner, HarnessSession,
        PairingDetails, PairingStatus,
    },
    ports::{HarnessError, HarnessRepo, HarnessService, NewHarness, NewPairing},
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

impl<R> HarnessServiceImpl<R>
where
    R: HarnessRepo,
{
    async fn ensure_may_manage(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: &Harness,
    ) -> Result<(), HarnessError> {
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
        let name = req.name.trim();
        if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
            return Err(HarnessError::BadRequest(format!(
                "name must be 1..={MAX_NAME_CHARS} characters"
            )));
        }
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
                    requested_scope: req.scope,
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
            Some(name) => {
                let name = name.trim();
                if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
                    return Err(HarnessError::BadRequest(format!(
                        "name must be 1..={MAX_NAME_CHARS} characters"
                    )));
                }
                name.to_owned()
            }
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

        Ok(ClaimOutcome::Claimed(ClaimedPairing { harness, token }))
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
}
