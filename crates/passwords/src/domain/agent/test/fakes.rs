use crate::domain::{
    agent::{
        AgentAccessRow, AgentAction, DirectoryAgent, StoredRequest, StoredRequestStatus, ports::*,
    },
    models::*,
    ports::Repository,
    service::test::fakes::FakeRepository,
};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use uuid::Uuid;

/// Directory fake: one optional agent, with a lookup counter.
pub struct FakeDirectory {
    pub agent: Mutex<Option<DirectoryAgent>>,
    pub calls: AtomicUsize,
    /// When set, lookups after this many calls find no agent.
    pub revoke_after: Mutex<Option<usize>>,
}
#[async_trait]
impl AgentDirectory for FakeDirectory {
    async fn resolve(&self, user: &MacroUserIdStr<'_>) -> Result<Option<DirectoryAgent>, Error> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        if self
            .revoke_after
            .lock()
            .unwrap()
            .is_some_and(|after| call >= after)
        {
            return Ok(None);
        }
        Ok(self
            .agent
            .lock()
            .unwrap()
            .clone()
            .filter(|agent| agent.agent_user_id.as_ref() == user.as_ref()))
    }
}

/// Rollout fake with explicit switches and an evaluation counter.
pub struct FakeAgentAvailability {
    pub enabled: AtomicBool,
    pub configured: AtomicBool,
    pub calls: AtomicUsize,
}
#[async_trait]
impl AgentAvailability for FakeAgentAvailability {
    async fn agent_enabled(&self, _: &MacroUserIdStr<'_>) -> bool {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.enabled.load(Ordering::SeqCst)
    }
    async fn agent_service_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }
    fn provider_configured(&self) -> bool {
        self.configured.load(Ordering::SeqCst)
    }
}

/// In-memory agent repository over the shared fake item repository.
pub struct FakeAgents {
    pub items: Arc<FakeRepository>,
    pub rows: Mutex<HashMap<(Uuid, String), AgentAccessRow>>,
    pub audits: Mutex<Vec<AgentAudit>>,
    pub events: Mutex<Vec<AccessEvent>>,
    pub delivered: Mutex<Vec<Uuid>>,
    pub calls: AtomicUsize,
    /// Current human team administrators, used as reviewers.
    pub admins: Mutex<Vec<MacroUserIdStr<'static>>>,
    /// Publisher identity retained per operation or enrollment key.
    pub publishers: Mutex<HashMap<Uuid, (String, AgentAction)>>,
    /// Enrollment keys the fixture marks retired.
    pub retired: Mutex<Vec<Uuid>>,
    /// Events whose delivery failed and was postponed.
    pub deferred: Mutex<Vec<Uuid>>,
}
#[async_trait]
impl AgentRepository for FakeAgents {
    async fn stage(
        &self,
        operation: Uuid,
        record: &Record,
        publisher: &IntentAgent,
    ) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if !self
            .items
            .agents
            .lock()
            .unwrap()
            .contains(publisher.agent.as_ref())
        {
            return Err(Error::NotFound);
        }
        let mut staged = self.items.staged.lock().unwrap();
        let mut publishers = self.publishers.lock().unwrap();
        if let Some(previous) = staged.get(&operation) {
            let same_publisher = publishers.get(&operation).is_some_and(|(agent, action)| {
                agent == publisher.agent.as_ref() && *action == publisher.action
            });
            if previous.metadata.version != record.metadata.version || !same_publisher {
                return Err(Error::Conflict);
            }
        } else {
            staged.insert(operation, record.clone());
            publishers.insert(operation, (publisher.agent.to_string(), publisher.action));
        }
        Ok(())
    }
    async fn stage_totp(
        &self,
        team: TeamId,
        item: ItemId,
        key: TotpKeyId,
        publisher: &IntentAgent,
    ) -> Result<(), Error> {
        let existing = self
            .items
            .enrollments
            .lock()
            .unwrap()
            .get(&key.0)
            .map(|entry| {
                (
                    entry.team_id,
                    entry.item_id,
                    entry.active || entry.cleanup_started,
                )
            });
        if let Some((owner_team, owner_item, settled)) = existing {
            let own_pending = owner_team == team
                && owner_item == item
                && !settled
                && !self.retired.lock().unwrap().contains(&key.0)
                && self
                    .publishers
                    .lock()
                    .unwrap()
                    .get(&key.0)
                    .is_some_and(|(agent, _)| agent == publisher.agent.as_ref());
            if !own_pending {
                return Err(Error::Conflict);
            }
            return Ok(());
        }
        self.items.stage_totp(team, item, key).await?;
        self.publishers
            .lock()
            .unwrap()
            .insert(key.0, (publisher.agent.to_string(), publisher.action));
        Ok(())
    }
    async fn enrollment(
        &self,
        team: TeamId,
        key: TotpKeyId,
    ) -> Result<Option<(ItemId, EnrollmentState)>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let enrollments = self.items.enrollments.lock().unwrap();
        Ok(enrollments
            .get(&key.0)
            .filter(|entry| entry.team_id == team)
            .map(|entry| {
                let state = if entry.active {
                    EnrollmentState::Active
                } else if entry.cleanup_started || self.retired.lock().unwrap().contains(&key.0) {
                    EnrollmentState::Retired
                } else {
                    EnrollmentState::Pending
                };
                (entry.item_id, state)
            }))
    }
    async fn item_access(
        &self,
        _: TeamId,
        item: ItemId,
        after: Option<&MacroUserIdStr<'_>>,
        limit: u8,
    ) -> Result<Vec<(MacroUserIdStr<'static>, AgentAccessRow)>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut rows: Vec<_> = self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|((stored, agent), _)| {
                *stored == item.0 && after.is_none_or(|after| agent.as_str() > after.as_ref())
            })
            .map(|((_, agent), row)| {
                (
                    MacroUserIdStr::parse_from_str(agent)
                        .map(macro_user_id::cowlike::CowLike::into_owned)
                        .unwrap(),
                    row.clone(),
                )
            })
            .collect();
        rows.sort_by(|left, right| left.0.as_ref().cmp(right.0.as_ref()));
        rows.truncate(usize::from(limit));
        Ok(rows)
    }
    async fn defer(&self, id: Uuid) -> Result<(), Error> {
        self.deferred.lock().unwrap().push(id);
        Ok(())
    }
    async fn catalog(
        &self,
        team: TeamId,
        agent: &MacroUserIdStr<'_>,
        _: &str,
        after: Option<ItemId>,
        limit: u8,
    ) -> Result<Vec<Record>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut records: Vec<Record> = self
            .items
            .records
            .lock()
            .unwrap()
            .values()
            .filter(|record| {
                record.metadata.team_id == team
                    && crate::domain::agent::requestable(record, agent)
                    && after.is_none_or(|after| record.metadata.id.0 < after.0)
            })
            .cloned()
            .collect();
        records.sort_by(|left, right| right.metadata.id.0.cmp(&left.metadata.id.0));
        records.truncate(usize::from(limit));
        Ok(records)
    }
    async fn access(
        &self,
        _: TeamId,
        items: &[ItemId],
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Vec<(ItemId, AgentAccessRow)>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let rows = self.rows.lock().unwrap();
        Ok(items
            .iter()
            .filter_map(|item| {
                rows.get(&(item.0, agent.to_string()))
                    .map(|row| (*item, row.clone()))
            })
            .collect())
    }
    async fn audit(&self, entries: &[AgentAudit]) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut audits = self.audits.lock().unwrap();
        for entry in entries {
            if !audits.iter().any(|audit| audit.event_id == entry.event_id) {
                audits.push(entry.clone());
            }
        }
        Ok(())
    }
    async fn request(&self, request: NewRequest) -> Result<RequestOutcome, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let now = chrono::Utc::now();
        let key = (request.item.0, request.agent.to_string());
        let mut rows = self.rows.lock().unwrap();
        let mut row = rows.get(&key).cloned().unwrap_or_default();
        if let Some(stored) = &row.request {
            if stored.status == StoredRequestStatus::Pending {
                return Ok(RequestOutcome::Deduplicated(row));
            }
            let cooldown_end = stored.updated_at + request.limits.denied_cooldown;
            if stored.status == StoredRequestStatus::Denied && cooldown_end > now {
                return Ok(RequestOutcome::RetryAt(cooldown_end));
            }
        }
        let mut audits = self.audits.lock().unwrap();
        let recent = audits
            .iter()
            .filter(|audit| {
                audit.team == request.team
                    && audit.agent.as_ref() == request.agent.as_ref()
                    && audit.action == crate::domain::agent::AgentAction::AgentAccessRequest
            })
            .count();
        if i64::try_from(recent).unwrap() >= request.limits.max_new_requests {
            return Ok(RequestOutcome::RetryAt(now + request.limits.window));
        }
        row.request = Some(StoredRequest {
            id: request.request_id,
            permission: request.permission,
            status: StoredRequestStatus::Pending,
            revision: row.request.as_ref().map_or(1, |stored| stored.revision + 1),
            updated_at: now,
        });
        rows.insert(key, row.clone());
        audits.push(AgentAudit {
            team: request.team,
            item: request.item,
            actor: request.agent.clone(),
            agent: request.agent.clone(),
            wake: Some(request.wake),
            action: crate::domain::agent::AgentAction::AgentAccessRequest,
            permission_revision: Some(row.permission_revision),
            event_id: request.request_id,
        });
        let mut reviewers = self.admins.lock().unwrap().clone();
        reviewers.extend(request.human_creator.clone());
        self.events.lock().unwrap().push(AccessEvent {
            id: Uuid::now_v7(),
            team: request.team,
            item: request.item,
            item_name: request.item_name.clone(),
            agent: request.agent.clone(),
            request_id: request.request_id,
            status: StoredRequestStatus::Pending,
            reviewers,
        });
        Ok(RequestOutcome::Created(row))
    }
    async fn transition(&self, transition: AccessTransition) -> Result<AgentAccessRow, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let team = transition.record.metadata.team_id;
        let item = transition.record.metadata.id;
        let mut records = self.items.records.lock().unwrap();
        let current = records.get_mut(&item.0).ok_or(Error::NotFound)?;
        if current.revision != transition.record.revision || current.deleting {
            return Err(Error::Conflict);
        }
        let key = (item.0, transition.agent.to_string());
        let mut rows = self.rows.lock().unwrap();
        let mut row = rows.get(&key).cloned().unwrap_or_default();
        let matches = match transition.expected {
            Expected::Request { id, revision } => row.request.as_ref().is_some_and(|request| {
                request.id == id
                    && request.revision == revision
                    && request.status == StoredRequestStatus::Pending
            }),
            Expected::PermissionRevision(revision) => row.permission_revision == revision,
        };
        if !matches {
            return Err(Error::Conflict);
        }
        if transition.permission_changed {
            current.grants = transition.record.grants.clone();
            current.revision += 1;
            row.permission_revision += 1;
        }
        row.approved = transition.approved;
        if let (Some(status), Some(request)) = (transition.request_status, row.request.as_mut()) {
            request.status = status;
            request.revision += 1;
            request.updated_at = chrono::Utc::now();
            self.events.lock().unwrap().push(AccessEvent {
                id: Uuid::now_v7(),
                team,
                item,
                item_name: transition.record.metadata.name.clone(),
                agent: transition.agent.clone(),
                request_id: request.id,
                status,
                reviewers: vec![],
            });
        }
        rows.insert(key, row.clone());
        self.audits.lock().unwrap().push(AgentAudit {
            team,
            item,
            actor: transition.reviewer.clone(),
            agent: transition.agent.clone(),
            wake: None,
            action: transition.action,
            permission_revision: Some(row.permission_revision),
            event_id: Uuid::now_v7(),
        });
        Ok(row)
    }
    async fn pending(
        &self,
        team: TeamId,
        creator: Option<&MacroUserIdStr<'_>>,
        _: Option<Uuid>,
        limit: u8,
    ) -> Result<Vec<PendingRequest>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let records = self.items.records.lock().unwrap();
        let rows = self.rows.lock().unwrap();
        let mut pending: Vec<PendingRequest> = rows
            .iter()
            .filter(|(_, row)| {
                row.request
                    .as_ref()
                    .is_some_and(|request| request.status == StoredRequestStatus::Pending)
            })
            .filter_map(|((item, agent), row)| {
                let record = records.get(item)?.clone();
                let manageable =
                    creator.is_none_or(|creator| record.user_id.as_ref() == creator.as_ref());
                (record.metadata.team_id == team && manageable).then(|| PendingRequest {
                    record,
                    agent: MacroUserIdStr::parse_from_str(agent)
                        .map(macro_user_id::cowlike::CowLike::into_owned)
                        .unwrap(),
                    row: row.clone(),
                })
            })
            .collect();
        pending.truncate(usize::from(limit));
        Ok(pending)
    }
    async fn find_request(
        &self,
        _: TeamId,
        item: ItemId,
        request: Uuid,
    ) -> Result<Option<(MacroUserIdStr<'static>, AgentAccessRow)>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .rows
            .lock()
            .unwrap()
            .iter()
            .find(|((stored_item, _), row)| {
                *stored_item == item.0
                    && row
                        .request
                        .as_ref()
                        .is_some_and(|stored| stored.id == request)
            })
            .map(|((_, agent), row)| {
                (
                    MacroUserIdStr::parse_from_str(agent)
                        .map(macro_user_id::cowlike::CowLike::into_owned)
                        .unwrap(),
                    row.clone(),
                )
            }))
    }
    async fn undelivered(&self) -> Result<Vec<AccessEvent>, Error> {
        let delivered = self.delivered.lock().unwrap();
        let deferred = self.deferred.lock().unwrap();
        Ok(self
            .events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| !delivered.contains(&event.id) && !deferred.contains(&event.id))
            .cloned()
            .collect())
    }
    async fn delivered(&self, id: Uuid) -> Result<(), Error> {
        self.delivered.lock().unwrap().push(id);
        Ok(())
    }
}

/// Records delivered events.
pub struct FakeSink {
    pub delivered: Mutex<Vec<AccessEvent>>,
    /// Events whose delivery fails.
    pub failing: Mutex<Vec<Uuid>>,
}
#[async_trait]
impl AccessEventSink for FakeSink {
    async fn deliver(&self, event: &AccessEvent) -> Result<(), Error> {
        if self.failing.lock().unwrap().contains(&event.id) {
            return Err(Error::Unavailable);
        }
        self.delivered.lock().unwrap().push(event.clone());
        Ok(())
    }
}
