//! In-memory ports for domain policy tests. PostgreSQL locking/fencing has its
//! own integration coverage in the repository adapter.

use super::*;
use crate::domain::{
    event_trigger::{ActionTrigger, EventPayload},
    models::{ActionKind, ScheduledAction},
};
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use serde_json::json;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

pub fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|routine-owner@macro.com").unwrap()
}

pub fn incoming() -> IncomingEvent {
    IncomingEvent {
        event_id: generate_uuid_v7(),
        schema_version: 1,
        payload: EventPayload::Document(
            serde_json::from_value(json!({
                "event_type":"document.updated", "metadata": {
                    "document_id": generate_uuid_v7(), "owner":"macro|event-actor@macro.com",
                    "actor_user_id":"macro|event-actor@macro.com", "share_permission_updated":false
                }
            }))
            .unwrap(),
        ),
    }
}

pub fn configuration() -> EventActionConfiguration {
    EventActionConfiguration {
        action_id: generate_uuid_v7(),
        owner: Owner::User(user()),
        enabled: true,
        revision: ConfigurationRevision::INITIAL,
        filters: serde_json::from_value(
            json!([{"events":["document.updated", "channel.created"]}]),
        )
        .unwrap(),
        activated_at: Utc::now() - chrono::Duration::days(1),
    }
}

pub fn pending(configuration: &EventActionConfiguration) -> PendingEventRun {
    PendingEventRun {
        action_id: configuration.action_id,
        revision: configuration.revision,
        event: incoming().normalize().unwrap(),
        admitted_at: Utc::now(),
    }
}

pub fn capability(owner: MacroUserIdStr<'static>, event: &EventReference) -> EventAccessCapability {
    let entity = Entity {
        entity_id: event.entity_id().to_string(),
        entity_type: match event.entity_type() {
            EventEntityType::Document => EntityType::Document,
            EventEntityType::Channel => EntityType::Channel,
        },
    };
    match event.entity_type() {
        EventEntityType::Document => EventAccessCapability::Document(
            EntityAccessReceipt::try_new_authenticated_user(
                owner,
                entity,
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::View,
                },
            )
            .unwrap(),
        ),
        EventEntityType::Channel => EventAccessCapability::Channel(
            EntityAccessReceipt::try_new_authenticated_user(
                owner,
                entity,
                EntityPermission::ChannelViewOnly,
            )
            .unwrap(),
        ),
    }
}

#[derive(Default)]
pub struct Access {
    pub denied: Mutex<bool>,
    pub unavailable: Mutex<bool>,
    pub override_receipt: Mutex<Option<EventAccessCapability>>,
    pub calls: Mutex<Vec<MacroUserIdStr<'static>>>,
}
impl CurrentOwnerAccess for Access {
    async fn authorize(
        &self,
        owner: &MacroUserIdStr<'static>,
        event: &EventReference,
    ) -> Result<Option<EventAccessCapability>, Report> {
        self.calls.lock().unwrap().push(owner.clone());
        if *self.unavailable.lock().unwrap() {
            return Err(rootcause::report!("access unavailable"));
        }
        if *self.denied.lock().unwrap() {
            return Ok(None);
        }
        Ok(Some(
            self.override_receipt
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_else(|| capability(owner.clone(), event)),
        ))
    }
}

#[derive(Default)]
pub struct State {
    pub configurations: Vec<EventActionConfiguration>,
    pub pending: Vec<PendingEventRun>,
    pub started: Vec<(PendingEventRun, ClaimToken, DateTime<Utc>)>,
    pub finished: Vec<(EventRunKey, EventRunOutcome)>,
    pub pages: Vec<Option<Uuid>>,
    pub fail_page: Option<usize>,
    pub fail_claim: bool,
    pub lose_claim: bool,
    pub fail_finalize: bool,
    pub disable_after_claim: bool,
}
#[derive(Default)]
pub struct Repo(pub Mutex<State>);
impl EventRunRepository for Repo {
    async fn candidate_actions(
        &self,
        _: &EventReference,
        after: Option<Uuid>,
        limit: PageSize,
    ) -> Result<CandidateActionPage, Report> {
        let mut state = self.0.lock().unwrap();
        state.pages.push(after);
        if state.fail_page == Some(state.pages.len()) {
            return Err(rootcause::report!("page unavailable"));
        }
        let mut configs = state.configurations.clone();
        configs.sort_by_key(|config| config.action_id);
        let configurations: Vec<_> = configs
            .into_iter()
            .filter(|config| after.is_none_or(|id| config.action_id > id))
            .take(limit.get().into())
            .collect();
        Ok(CandidateActionPage {
            next_after: configurations.last().map(|config| config.action_id),
            configurations,
        })
    }
    async fn current_configuration(
        &self,
        id: Uuid,
    ) -> Result<Option<EventActionConfiguration>, Report> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .configurations
            .iter()
            .find(|c| c.action_id == id)
            .cloned())
    }
    async fn admit(
        &self,
        id: Uuid,
        revision: ConfigurationRevision,
        event: &EventReference,
    ) -> Result<AdmissionResult, Report> {
        let mut state = self.0.lock().unwrap();
        let pending = PendingEventRun {
            action_id: id,
            revision,
            event: event.clone(),
            admitted_at: Utc::now(),
        };
        if state.pending.iter().any(|p| p.key() == pending.key())
            || state
                .started
                .iter()
                .any(|(p, _, _)| p.key() == pending.key())
            || state.finished.iter().any(|(key, _)| *key == pending.key())
        {
            return Ok(AdmissionResult::AlreadyPresent);
        }
        state.pending.push(pending);
        Ok(AdmissionResult::Admitted)
    }
    async fn pending_runs(&self, limit: PageSize) -> Result<Vec<PendingEventRun>, Report> {
        let state = self.0.lock().unwrap();
        let mut actions = Vec::new();
        Ok(state
            .pending
            .iter()
            .filter(|p| {
                if actions.contains(&p.action_id)
                    || state
                        .started
                        .iter()
                        .any(|(s, _, _)| s.action_id == p.action_id)
                {
                    return false;
                }
                actions.push(p.action_id);
                true
            })
            .take(limit.get().into())
            .cloned()
            .collect())
    }
    async fn claim(
        &self,
        run: AuthorizedEventRun,
        token: ClaimToken,
        started_at: DateTime<Utc>,
        deadline: DateTime<Utc>,
    ) -> Result<Option<ClaimedEventRun>, Report> {
        let mut state = self.0.lock().unwrap();
        if state.fail_claim {
            return Err(rootcause::report!("claim unavailable"));
        }
        if state.lose_claim
            || state
                .started
                .iter()
                .any(|(p, _, _)| p.action_id == run.pending.action_id)
        {
            return Ok(None);
        }
        let Some(config) = state
            .configurations
            .iter()
            .find(|c| c.action_id == run.pending.action_id)
            .cloned()
        else {
            return Ok(None);
        };
        if config.check_pending(&run.pending).is_err() {
            return Ok(None);
        }
        let Some(index) = state
            .pending
            .iter()
            .position(|p| p.action_id == run.pending.action_id)
        else {
            return Ok(None);
        };
        if state.pending[index].key() != run.pending.key() {
            return Ok(None);
        }
        state.pending.remove(index);
        state.started.push((run.pending.clone(), token, deadline));
        if state.disable_after_claim {
            state
                .configurations
                .iter_mut()
                .find(|c| c.action_id == config.action_id)
                .unwrap()
                .enabled = false;
        }
        Ok(Some(ClaimedEventRun {
            run,
            token,
            started_at,
            deadline,
            action: ScheduledAction {
                id: Some(config.action_id),
                owner: config.owner,
                name: "routine".into(),
                trigger: ActionTrigger::Events {
                    filters: config.filters,
                },
                kind: ActionKind::Agent,
                task: json!({}),
                created_at: started_at,
                updated_at: started_at,
                enabled: true,
                configuration_revision: config.revision,
                event_activated_at: Some(config.activated_at),
                next_run_at: None,
                claimed: Some(started_at),
            },
        }))
    }
    async fn finalize(&self, run: FinalizeEventRun) -> Result<FinalizationResult, Report> {
        let mut state = self.0.lock().unwrap();
        if state.fail_finalize {
            return Err(rootcause::report!("bookkeeping unavailable"));
        }
        let Some(index) = state
            .started
            .iter()
            .position(|(p, t, _)| p.key() == run.key && *t == run.token)
        else {
            return Ok(FinalizationResult::StaleClaim);
        };
        state.started.remove(index);
        state.finished.push((run.key, run.execution.outcome));
        Ok(FinalizationResult::Finalized)
    }
    async fn cancel_pending(
        &self,
        key: EventRunKey,
        revision: ConfigurationRevision,
        reason: CancellationReason,
    ) -> Result<(), Report> {
        let mut state = self.0.lock().unwrap();
        if let Some(index) = state
            .pending
            .iter()
            .position(|p| p.key() == key && p.revision == revision)
        {
            state.pending.remove(index);
            state
                .finished
                .push((key, EventRunOutcome::Cancelled { reason }));
        }
        Ok(())
    }
    async fn reconcile(&self, now: DateTime<Utc>, limit: PageSize) -> Result<u16, Report> {
        let mut state = self.0.lock().unwrap();
        let mut count = 0;
        while count < limit.get() {
            let Some(index) = state
                .started
                .iter()
                .position(|(_, _, deadline)| *deadline <= now)
            else {
                break;
            };
            let (pending, _, _) = state.started.remove(index);
            state
                .finished
                .push((pending.key(), EventRunOutcome::Interrupted));
            count += 1;
        }
        Ok(count)
    }
}

#[derive(Default)]
pub struct Executor {
    pub calls: Mutex<Vec<EventRunKey>>,
    pub outcomes: Mutex<VecDeque<EventRunOutcome>>,
}
impl EventExecutor for Executor {
    async fn execute(
        &self,
        run: &ClaimedEventRun,
        _: impl Future<Output = ()> + Send,
    ) -> EventExecutionResult {
        self.calls.lock().unwrap().push(run.run.pending.key());
        assert!(run.run.access.authorizes(&user(), &run.run.pending.event));
        EventExecutionResult {
            outcome: self
                .outcomes
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(EventRunOutcome::Succeeded),
            record: None,
        }
    }
}

pub fn setup() -> (Arc<Repo>, Arc<Access>, Arc<Executor>, PendingEventRun) {
    let config = configuration();
    let pending = pending(&config);
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations.push(config);
    repo.0.lock().unwrap().pending.push(pending.clone());
    (repo, Arc::default(), Arc::default(), pending)
}
