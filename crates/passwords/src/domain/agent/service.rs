//! Agent vault use cases. Every agent call runs under one 30-second deadline and
//! admits in a fixed order: flags, directory, wake, provider presence, then the
//! catalog, policy, kind and selector checks, provider I/O and post-I/O rechecks.
use super::{
    AccessRequestBody, AdmittedAgent, AgentAccessRequestState, AgentAction, AgentCreateItem,
    AgentError, AgentKind, AgentPatchItem, AgentPolicy, AgentSearchHit, AgentSearchPage,
    AgentSetTotp, AgentTotpCode, AgentWriteResult, DiscloseRequest, Disclosed, Slot,
    TotpCodeRequest, WakeId, hit, ports::*, request_state, requestable, totp,
};
use crate::domain::{
    models::{
        Grant, GranteeKind, ItemId, ItemKind, ItemMetadata, Permission, Record, TeamId, TotpKeyId,
    },
    service::PasswordService,
};
use chrono::{DateTime, TimeDelta, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::{future::Future, sync::Arc};
use uuid::Uuid;

pub mod review;

/// One original deadline per agent call, starting after key extraction.
const DEADLINE: std::time::Duration = std::time::Duration::from_secs(30);
/// Timing-only verification-code attempts sharing that deadline.
const TOTP_ATTEMPTS: usize = 2;
/// Accepted wake timestamps: `[now - 24h, now + 5m]`, inclusive.
const WAKE_PAST: TimeDelta = TimeDelta::hours(24);
const WAKE_FUTURE: TimeDelta = TimeDelta::minutes(5);
const SEARCH_DEFAULT_LIMIT: u8 = 50;
const SEARCH_MAX_LIMIT: u8 = 100;
const MAX_NAME: usize = 200;
/// Request bounds frozen with the contract.
pub const REQUEST_LIMITS: RequestLimits = RequestLimits {
    denied_cooldown: TimeDelta::hours(1),
    max_new_requests: 20,
    window: TimeDelta::hours(1),
};

/// Current time source; injected so tests control TOTP windows without sleeping.
pub type Clock = Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>;

/// Agent vault use cases over the human vault's storage, lease and recovery.
pub struct AgentVaultService {
    /// Human vault service: repository, provider, lease and write recovery.
    pub vault: Arc<PasswordService>,
    /// Agent grants, approvals, requests, audit and outbox.
    pub agents: Arc<dyn AgentRepository>,
    /// Authoritative agent account facts.
    pub directory: Arc<dyn AgentDirectory>,
    /// Agent rollout and provider presence.
    pub availability: Arc<dyn AgentAvailability>,
    /// Delivery of committed request events.
    pub events: Arc<dyn AccessEventSink>,
    /// Current time.
    pub clock: Clock,
}

/// An authenticated agent call before admission.
pub struct AgentCall {
    /// The API key's user.
    pub key_user: MacroUserIdStr<'static>,
    /// Path team.
    pub team: TeamId,
    /// Raw `X-Macro-Agent-Session-Id` header, when present.
    pub wake: Option<String>,
}

/// Search parameters, parsed after admission.
pub struct SearchQuery {
    /// Metadata search text.
    pub q: String,
    /// Page size.
    pub limit: u8,
    /// Last item of the previous page.
    pub after: Option<ItemId>,
}
impl SearchQuery {
    /// Validate raw query parameters.
    pub fn parse(
        q: Option<String>,
        limit: Option<String>,
        cursor: Option<String>,
    ) -> Result<Self, AgentError> {
        let q = q.unwrap_or_default();
        if q.len() > MAX_NAME {
            return Err(AgentError::Invalid);
        }
        let limit = match limit {
            None => SEARCH_DEFAULT_LIMIT,
            Some(limit) => limit.parse::<u8>().map_err(|_| AgentError::Invalid)?,
        };
        if limit == 0 || limit > SEARCH_MAX_LIMIT {
            return Err(AgentError::Invalid);
        }
        let after = cursor
            .map(|cursor| Uuid::parse_str(&cursor).map(ItemId))
            .transpose()
            .map_err(|_| AgentError::Invalid)?;
        Ok(Self { q, limit, after })
    }
}

/// Whether a write created the item or replayed an accepted operation.
pub enum Written {
    /// Newly created.
    Created(AgentWriteResult),
    /// The same operation was already accepted.
    Replayed(AgentWriteResult),
}

/// Whether a request created a pending request or the agent can already use the item.
pub enum Requested {
    /// The agent can already use the item; nothing was requested.
    Usable(AgentAccessRequestState),
    /// A new or deduplicated pending request.
    Pending(AgentAccessRequestState),
}

impl AgentVaultService {
    /// Run a use case under the original call deadline; expiry drops the
    /// future (and its lease) and fails closed.
    async fn bounded<T>(
        work: impl Future<Output = Result<T, AgentError>>,
    ) -> Result<T, AgentError> {
        tokio::time::timeout_at(tokio::time::Instant::now() + DEADLINE, work)
            .await
            .unwrap_or(Err(AgentError::Unavailable))
    }

    /// Flags, directory, wake and provider presence, in that order, before
    /// any catalog read or side effect.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.admit", fields(team_id = %call.team.0, wake.id = tracing::field::Empty))]
    async fn admit(&self, call: &AgentCall) -> Result<AdmittedAgent, AgentError> {
        if !self.availability.agent_enabled(&call.key_user).await {
            return Err(AgentError::NotFound);
        }
        self.directory_admits(&call.key_user, call.team).await?;
        let wake = self.wake(call.wake.as_deref())?;
        tracing::Span::current().record("wake.id", tracing::field::display(wake.0));
        if !self.availability.provider_configured() {
            return Err(AgentError::Unavailable);
        }
        Ok(AdmittedAgent {
            agent_user_id: call.key_user.clone(),
            team: call.team,
            wake,
        })
    }

    async fn directory_admits(
        &self,
        key_user: &MacroUserIdStr<'_>,
        team: TeamId,
    ) -> Result<(), AgentError> {
        let agent = self
            .directory
            .resolve(key_user)
            .await
            .map_err(|_| AgentError::Unavailable)?
            .ok_or(AgentError::InvalidAgent)?;
        let admitted = agent.enabled
            && agent.computer_live
            && agent.team_id == team
            && agent.agent_user_id.as_ref() == key_user.as_ref();
        if !admitted {
            return Err(AgentError::InvalidAgent);
        }
        Ok(())
    }

    fn wake(&self, header: Option<&str>) -> Result<WakeId, AgentError> {
        let id = header
            .and_then(|header| Uuid::parse_str(header).ok())
            .filter(|id| id.get_version_num() == 7)
            .ok_or(AgentError::InvalidSessionAttribution)?;
        let (seconds, nanos) = id
            .get_timestamp()
            .ok_or(AgentError::InvalidSessionAttribution)?
            .to_unix();
        let at = i64::try_from(seconds)
            .ok()
            .and_then(|seconds| DateTime::from_timestamp(seconds, nanos))
            .ok_or(AgentError::InvalidSessionAttribution)?;
        let now = (self.clock)();
        if at < now - WAKE_PAST || at > now + WAKE_FUTURE {
            return Err(AgentError::InvalidSessionAttribution);
        }
        Ok(WakeId(id))
    }

    /// Catalog then policy facts. Items outside the agent's catalog are an
    /// opaque `not_found`.
    async fn load(
        &self,
        agent: &AdmittedAgent,
        item: ItemId,
    ) -> Result<(Record, AgentPolicy), AgentError> {
        let record = self.vault.repository.get(agent.team, item).await?;
        if record.metadata.team_id != agent.team || !requestable(&record, &agent.agent_user_id) {
            return Err(AgentError::NotFound);
        }
        let row = self
            .agents
            .access(agent.team, &[item], &agent.agent_user_id)
            .await?
            .into_iter()
            .next()
            .map(|(_, row)| row);
        let policy = AgentPolicy::of(&record, &agent.agent_user_id, row.as_ref());
        Ok((record, policy))
    }

    /// Current directory admission and use policy after provider I/O; the
    /// record must still be the one the action authorized.
    async fn recheck(
        &self,
        agent: &AdmittedAgent,
        authorized: &Record,
    ) -> Result<(Record, AgentPolicy), AgentError> {
        self.directory_admits(&agent.agent_user_id, agent.team)
            .await?;
        let (current, policy) = self.load(agent, authorized.metadata.id).await?;
        policy.require_use()?;
        if current.revision != authorized.revision
            || current.metadata.version != authorized.metadata.version
        {
            return Err(AgentError::Conflict);
        }
        Ok((current, policy))
    }

    fn audit_entry(
        &self,
        agent: &AdmittedAgent,
        item: ItemId,
        action: AgentAction,
        event_id: Uuid,
    ) -> AgentAudit {
        AgentAudit {
            team: agent.team,
            item,
            actor: agent.agent_user_id.clone(),
            agent: agent.agent_user_id.clone(),
            wake: Some(agent.wake),
            action,
            permission_revision: None,
            event_id,
        }
    }

    /// Metadata-only search over the agent's catalog; every hit is audited.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.search", fields(team_id = %call.team.0, hit_count = tracing::field::Empty))]
    pub async fn search(
        &self,
        call: AgentCall,
        query: Result<SearchQuery, AgentError>,
    ) -> Result<AgentSearchPage, AgentError> {
        Self::bounded(async {
            let agent = self.admit(&call).await?;
            let query = query?;
            let mut records = self
                .agents
                .catalog(
                    agent.team,
                    &agent.agent_user_id,
                    &query.q,
                    query.after,
                    query.limit.saturating_add(1),
                )
                .await?;
            let next_cursor = if records.len() > usize::from(query.limit) {
                records.truncate(usize::from(query.limit));
                records
                    .last()
                    .map(|record| record.metadata.id.0.to_string())
            } else {
                None
            };
            let ids: Vec<_> = records.iter().map(|record| record.metadata.id).collect();
            let rows = self
                .agents
                .access(agent.team, &ids, &agent.agent_user_id)
                .await?;
            let items: Vec<AgentSearchHit> = records
                .iter()
                .map(|record| {
                    let row = rows
                        .iter()
                        .find(|(id, _)| *id == record.metadata.id)
                        .map(|(_, row)| row);
                    hit(record, &AgentPolicy::of(record, &agent.agent_user_id, row))
                })
                .collect();
            let entries: Vec<_> = ids
                .iter()
                .map(|id| {
                    self.audit_entry(&agent, *id, AgentAction::AgentSearchHit, Uuid::now_v7())
                })
                .collect();
            self.agents.audit(&entries).await?;
            tracing::Span::current().record("hit_count", items.len());
            Ok(AgentSearchPage { items, next_cursor })
        })
        .await
    }

    /// Disclose exactly one selected slot of a usable login or API item.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.disclose", fields(team_id = %call.team.0, item_id = %item.0, outcome = tracing::field::Empty))]
    pub async fn disclose(
        &self,
        call: AgentCall,
        item: ItemId,
        body: Result<DiscloseRequest, AgentError>,
    ) -> Result<Disclosed, AgentError> {
        Self::bounded(async {
            let agent = self.admit(&call).await?;
            let body = body?;
            let _lock = self.vault.repository.lock(agent.team, item).await?;
            self.load(&agent, item).await?.1.require_use()?;
            self.vault.reconcile(agent.team, item).await?;
            let (record, policy) = self.load(&agent, item).await?;
            policy.require_use()?;
            if AgentKind::of(&record.metadata.kind)? != body.selector.kind() {
                return Err(AgentError::Invalid);
            }
            let version = record.metadata.version;
            if body
                .expected_version
                .is_some_and(|expected| expected != version)
            {
                return Err(AgentError::Conflict);
            }
            self.agents
                .audit(&[self.audit_entry(
                    &agent,
                    item,
                    AgentAction::AgentDisclose,
                    Uuid::now_v7(),
                )])
                .await?;
            let values = self.vault.provider.read(agent.team, item, version).await?;
            self.recheck(&agent, &record).await.inspect_err(|_| {
                tracing::Span::current().record("outcome", "post_io_denied");
            })?;
            let value = match body.selector.slot() {
                Slot::Username => values.username.clone(),
                Slot::Password => values.password.clone(),
            };
            if value.0.is_empty() {
                return Err(AgentError::FieldNotSet);
            }
            tracing::Span::current().record("outcome", "disclosed");
            Ok(Disclosed {
                value,
                version,
                selector: body.selector,
            })
        })
        .await
    }

    /// The current verification code with a conservative remaining lifetime.
    /// At most two attempts, refreshed only for timing ambiguity or expiry.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.totp.code", fields(team_id = %call.team.0, item_id = %item.0, attempts = tracing::field::Empty, outcome = tracing::field::Empty))]
    pub async fn totp_code(
        &self,
        call: AgentCall,
        item: ItemId,
        body: Result<TotpCodeRequest, AgentError>,
    ) -> Result<AgentTotpCode, AgentError> {
        Self::bounded(async {
            let agent = self.admit(&call).await?;
            body?;
            let _lock = self.vault.repository.lock(agent.team, item).await?;
            let (record, policy) = self.load(&agent, item).await?;
            policy.require_use()?;
            if !matches!(
                record.metadata.kind,
                ItemKind::Login | ItemKind::VerificationCode
            ) {
                return Err(AgentError::UnsupportedKind);
            }
            let key = record.totp_key_id.ok_or(AgentError::FieldNotSet)?;
            self.agents
                .audit(&[self.audit_entry(
                    &agent,
                    item,
                    AgentAction::AgentTotpCode,
                    Uuid::now_v7(),
                )])
                .await?;
            for attempt in 1..=TOTP_ATTEMPTS {
                tracing::Span::current().record("attempts", attempt);
                let t0 = (self.clock)();
                let code = self.vault.provider.totp(agent.team, key).await?;
                let t1 = (self.clock)();
                let Some(cutoff) = totp::window_cutoff(t0, t1, code.period) else {
                    continue;
                };
                let (current, _) = self.recheck(&agent, &record).await?;
                if current.totp_key_id != Some(key) {
                    return Err(AgentError::Busy);
                }
                let now = (self.clock)();
                let Some(valid_for_ms) = totp::valid_for_ms(cutoff, now, code.period) else {
                    continue;
                };
                tracing::Span::current().record("outcome", "disclosed");
                return Ok(AgentTotpCode {
                    code: code.code,
                    expires_at: cutoff,
                    period_seconds: code.period,
                    valid_for_ms,
                });
            }
            tracing::Span::current().record("outcome", "timing_exhausted");
            Err(AgentError::Unavailable)
        })
        .await
    }

    /// Create a login or API item owned by the team, attributed to this agent,
    /// with the default team Edit grant and a revocable creator Agent Edit grant.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.create", fields(team_id = %call.team.0, item_id = tracing::field::Empty, replayed = tracing::field::Empty))]
    pub async fn create(
        &self,
        call: AgentCall,
        body: Result<AgentCreateItem, AgentError>,
    ) -> Result<Written, AgentError> {
        Self::bounded(async {
            let agent = self.admit(&call).await?;
            let body = body?;
            if body.operation_id.get_version_num() != 7 {
                return Err(AgentError::Invalid);
            }
            let name = Self::name(body.name)?;
            let kind = body.secret.kind();
            let values = body.secret.into_values()?;
            let id = ItemId(body.operation_id);
            tracing::Span::current().record("item_id", tracing::field::display(id.0));
            let team = agent.team;
            let _lock = self.vault.repository.lock(team, id).await?;
            if let Ok(staged) = self
                .vault
                .repository
                .staged(team, id, body.operation_id)
                .await
                && staged.user_id.as_ref() != agent.agent_user_id.as_ref()
            {
                return Err(AgentError::Conflict);
            }
            self.vault.reconcile(team, id).await?;
            match self.vault.repository.get(team, id).await {
                Ok(existing) => {
                    tracing::Span::current().record("replayed", true);
                    return self
                        .replayed_create(&agent, existing, body.operation_id)
                        .await;
                }
                Err(crate::domain::models::Error::NotFound) => {}
                Err(error) => return Err(error.into()),
            }
            let now = Utc::now();
            let record = Record {
                user_id: agent.agent_user_id.clone(),
                grants: vec![
                    Grant {
                        kind: GranteeKind::Team,
                        id: team.0.to_string(),
                        permission: Permission::Edit,
                    },
                    Grant {
                        kind: GranteeKind::Agent,
                        id: agent.agent_user_id.to_string(),
                        permission: Permission::Edit,
                    },
                ],
                deleting: false,
                revision: 0,
                totp_key_id: None,
                metadata: ItemMetadata {
                    id,
                    team_id: team,
                    name,
                    kind: kind.item_kind(),
                    url: body.url,
                    folder_id: None,
                    favorite: false,
                    version: 1,
                    has_totp: false,
                    shared: true,
                    share_count: 0,
                    created_at: now,
                    updated_at: now,
                    last_used_at: None,
                },
            };
            self.agents
                .stage(
                    body.operation_id,
                    &record,
                    &Self::publisher(&agent, AgentAction::AgentCreate),
                )
                .await?;
            self.vault
                .provider
                .write(team, id, 0, body.operation_id, &values)
                .await?;
            self.vault.reconcile(team, id).await?;
            tracing::Span::current().record("replayed", false);
            let committed = self.vault.repository.get(team, id).await?;
            Ok(Written::Created(
                self.written(
                    &agent,
                    committed,
                    body.operation_id,
                    AgentAction::AgentCreate,
                )
                .await?,
            ))
        })
        .await
    }

    async fn replayed_create(
        &self,
        agent: &AdmittedAgent,
        existing: Record,
        operation: Uuid,
    ) -> Result<Written, AgentError> {
        if existing.deleting || existing.user_id.as_ref() != agent.agent_user_id.as_ref() {
            return Err(AgentError::Conflict);
        }
        Ok(Written::Replayed(
            self.written(agent, existing, operation, AgentAction::AgentCreate)
                .await?,
        ))
    }

    /// Audit an accepted write once per operation and describe the item.
    async fn written(
        &self,
        agent: &AdmittedAgent,
        record: Record,
        operation: Uuid,
        action: AgentAction,
    ) -> Result<AgentWriteResult, AgentError> {
        self.agents
            .audit(&[self.audit_entry(agent, record.metadata.id, action, operation)])
            .await?;
        let row = self
            .agents
            .access(agent.team, &[record.metadata.id], &agent.agent_user_id)
            .await?
            .into_iter()
            .next()
            .map(|(_, row)| row);
        let policy = AgentPolicy::of(&record, &agent.agent_user_id, row.as_ref());
        Ok(AgentWriteResult {
            version: record.metadata.version,
            item: hit(&record, &policy),
        })
    }

    fn publisher(agent: &AdmittedAgent, action: AgentAction) -> IntentAgent {
        IntentAgent {
            agent: agent.agent_user_id.clone(),
            wake: agent.wake,
            action,
        }
    }

    fn name(name: String) -> Result<String, AgentError> {
        if name.trim().is_empty() || name.len() > MAX_NAME {
            return Err(AgentError::Invalid);
        }
        Ok(name)
    }

    /// Replace supplied slots and display fields as one new provider version.
    /// Unpatched slots, notes and custom fields are written back exactly as
    /// committed; a metadata-only update also writes a version, so every
    /// update shares the operation-ID intent, CAS and replay path.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.update", fields(team_id = %call.team.0, item_id = %item.0, replayed = tracing::field::Empty))]
    pub async fn update(
        &self,
        call: AgentCall,
        item: ItemId,
        body: Result<AgentPatchItem, AgentError>,
    ) -> Result<AgentWriteResult, AgentError> {
        Self::bounded(async {
            let agent = self.admit(&call).await?;
            let body = body?;
            if body.operation_id.get_version_num() != 7
                || (body.secret_patch.is_none() && body.metadata_patch.is_none())
            {
                return Err(AgentError::Invalid);
            }
            let team = agent.team;
            let _lock = self.vault.repository.lock(team, item).await?;
            self.load(&agent, item).await?.1.require_update()?;
            self.vault.reconcile(team, item).await?;
            let (mut record, policy) = self.load(&agent, item).await?;
            policy.require_update()?;
            let kind = AgentKind::of(&record.metadata.kind)?;
            if body
                .secret_patch
                .as_ref()
                .is_some_and(|patch| patch.kind() != kind)
            {
                return Err(AgentError::Invalid);
            }
            let expected = record.metadata.version;
            if body.expected_version != expected {
                // A retry of an accepted operation returns its result instead of
                // applying the patch again.
                if let Some((version, operation)) = self.vault.provider.status(team, item).await?
                    && operation == body.operation_id
                    && version == expected
                {
                    tracing::Span::current().record("replayed", true);
                    return self
                        .written(&agent, record, body.operation_id, AgentAction::AgentUpdate)
                        .await;
                }
                return Err(AgentError::Conflict);
            }
            // An operation id names one action: never an enrollment generation.
            if self
                .agents
                .enrollment(team, TotpKeyId(body.operation_id))
                .await?
                .is_some()
            {
                return Err(AgentError::Conflict);
            }
            let mut values = self.vault.provider.read(team, item, expected).await?;
            // Authority may have changed during the read; recheck before any write.
            self.recheck(&agent, &record).await?.1.require_update()?;
            if let Some(metadata) = body.metadata_patch {
                if let Some(name) = metadata.name {
                    record.metadata.name = Self::name(name)?;
                }
                if let Some(url) = metadata.url {
                    record.metadata.url = url;
                }
            }
            if let Some(patch) = body.secret_patch {
                patch.apply(&mut values)?;
            }
            record.metadata.version = expected.checked_add(1).ok_or(AgentError::Invalid)?;
            record.metadata.updated_at = Utc::now();
            self.agents
                .stage(
                    body.operation_id,
                    &record,
                    &Self::publisher(&agent, AgentAction::AgentUpdate),
                )
                .await?;
            self.vault
                .provider
                .write(team, item, expected, body.operation_id, &values)
                .await?;
            self.vault.reconcile(team, item).await?;
            tracing::Span::current().record("replayed", false);
            let committed = self.vault.repository.get(team, item).await?;
            self.written(
                &agent,
                committed,
                body.operation_id,
                AgentAction::AgentUpdate,
            )
            .await
        })
        .await
    }

    /// Enroll a verification-code seed on a login item this agent created.
    /// The operation id names the enrollment generation. Under the team lease it
    /// must be unused, this item's interrupted pending setup, or (replay) this
    /// item's active generation; anything else is a conflict before any provider
    /// write. Activation and its audit commit together.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.totp.configure", fields(team_id = %call.team.0, item_id = %item.0))]
    pub async fn set_totp(
        &self,
        call: AgentCall,
        item: ItemId,
        body: Result<AgentSetTotp, AgentError>,
    ) -> Result<(), AgentError> {
        Self::bounded(async {
            let agent = self.admit(&call).await?;
            let body = body?;
            if body.operation_id.get_version_num() != 7
                || body.seed.0.len() > 1024
                || !lazy_regex::regex_is_match!(r"^[A-Z2-7]+=*$", &body.seed.0)
            {
                return Err(AgentError::Invalid);
            }
            let team = agent.team;
            let _lock = self.vault.repository.lock(team, item).await?;
            let (record, policy) = self.load(&agent, item).await?;
            policy.require_totp_setup()?;
            if !matches!(
                record.metadata.kind,
                ItemKind::Login | ItemKind::VerificationCode
            ) {
                return Err(AgentError::UnsupportedKind);
            }
            // An operation id names one action: never a create or update intent.
            if self
                .vault
                .repository
                .staged(team, item, body.operation_id)
                .await
                .is_ok()
            {
                return Err(AgentError::Conflict);
            }
            let key = TotpKeyId(body.operation_id);
            let audit =
                self.audit_entry(&agent, item, AgentAction::AgentTotpSetup, body.operation_id);
            match self.agents.enrollment(team, key).await? {
                None => {}
                Some((owner, EnrollmentState::Pending)) if owner == item => {}
                Some((owner, EnrollmentState::Active))
                    if owner == item && record.totp_key_id == Some(key) =>
                {
                    self.agents.audit(&[audit]).await?;
                    return Ok(());
                }
                Some(_) => return Err(AgentError::Conflict),
            }
            if record.metadata.version != body.expected_version {
                return Err(AgentError::Conflict);
            }
            self.agents
                .stage_totp(
                    team,
                    item,
                    key,
                    &Self::publisher(&agent, AgentAction::AgentTotpSetup),
                )
                .await?;
            self.vault.provider.set_totp(team, key, &body.seed).await?;
            self.vault
                .repository
                .activate_totp(team, item, key, record.revision)
                .await?;
            self.agents.audit(&[audit]).await?;
            Ok(())
        })
        .await
    }

    /// Ask authorized humans for access. Deduplicated per item and agent; a
    /// denial cools down and new requests are rate limited per agent and team.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.access.request", fields(team_id = %call.team.0, item_id = %item.0, outcome = tracing::field::Empty))]
    pub async fn request_access(
        &self,
        call: AgentCall,
        item: ItemId,
        body: Result<AccessRequestBody, AgentError>,
    ) -> Result<Requested, AgentError> {
        Self::bounded(async {
            let agent = self.admit(&call).await?;
            let body = body?;
            let (record, policy) = self.load(&agent, item).await?;
            if policy.require_use().is_ok() {
                tracing::Span::current().record("outcome", "usable");
                let row = self.row(&agent, item).await?;
                return Ok(Requested::Usable(request_state(
                    item,
                    &agent.agent_user_id,
                    row.as_ref(),
                    &policy,
                )));
            }
            let human_creator = if record.user_id.as_ref() != agent.agent_user_id.as_ref()
                && self.vault.repository.is_human(&record.user_id).await?
            {
                Some(record.user_id.clone())
            } else {
                None
            };
            let outcome = self
                .agents
                .request(NewRequest {
                    team: agent.team,
                    item,
                    agent: agent.agent_user_id.clone(),
                    wake: agent.wake,
                    permission: body.permission,
                    human_creator,
                    request_id: Uuid::now_v7(),
                    item_name: record.metadata.name.clone(),
                    limits: REQUEST_LIMITS,
                })
                .await?;
            let row = match outcome {
                RequestOutcome::Created(row) => {
                    tracing::Span::current().record("outcome", "created");
                    row
                }
                RequestOutcome::Deduplicated(row) => {
                    tracing::Span::current().record("outcome", "deduplicated");
                    row
                }
                RequestOutcome::RetryAt(at) => {
                    tracing::Span::current().record("outcome", "rate_limited");
                    let wait = at.signed_duration_since((self.clock)());
                    let retry_after_ms = u64::try_from(wait.num_milliseconds())
                        .unwrap_or(0)
                        .saturating_add(1);
                    return Err(AgentError::RateLimited { retry_after_ms });
                }
            };
            let policy = AgentPolicy::of(&record, &agent.agent_user_id, Some(&row));
            Ok(Requested::Pending(request_state(
                item,
                &agent.agent_user_id,
                Some(&row),
                &policy,
            )))
        })
        .await
    }

    /// This agent's own request state for the item.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.access.mine", fields(team_id = %call.team.0, item_id = %item.0))]
    pub async fn my_request(
        &self,
        call: AgentCall,
        item: ItemId,
    ) -> Result<AgentAccessRequestState, AgentError> {
        Self::bounded(async {
            let agent = self.admit(&call).await?;
            let (_, policy) = self.load(&agent, item).await?;
            let row = self.row(&agent, item).await?;
            Ok(request_state(
                item,
                &agent.agent_user_id,
                row.as_ref(),
                &policy,
            ))
        })
        .await
    }

    async fn row(
        &self,
        agent: &AdmittedAgent,
        item: ItemId,
    ) -> Result<Option<super::AgentAccessRow>, AgentError> {
        Ok(self
            .agents
            .access(agent.team, &[item], &agent.agent_user_id)
            .await?
            .into_iter()
            .next()
            .map(|(_, row)| row))
    }

    /// Deliver committed request events while the agent vault is enabled.
    /// Failures stay queued and are deferred with backoff behind due events.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.events.deliver", fields(delivered = tracing::field::Empty, failed = tracing::field::Empty))]
    pub async fn deliver_access_events(&self) -> Result<usize, AgentError> {
        if !self.availability.agent_service_enabled().await {
            return Ok(0);
        }
        let mut delivered = 0;
        let mut failed = 0;
        for event in self.agents.undelivered().await? {
            match self.events.deliver(&event).await {
                Ok(()) => {
                    self.agents.delivered(event.id).await?;
                    delivered += 1;
                }
                Err(error) => {
                    failed += 1;
                    // Back off this event so it cannot hold the batch's head.
                    self.agents.defer(event.id).await?;
                    tracing::warn!(event_id = %event.id, error = %error, "passwords agent access event delivery failed; retained for retry");
                }
            }
        }
        tracing::Span::current().record("delivered", delivered);
        tracing::Span::current().record("failed", failed);
        Ok(delivered)
    }
}
