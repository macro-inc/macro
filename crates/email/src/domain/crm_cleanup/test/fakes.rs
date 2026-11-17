use super::*;
use chrono::{DateTime, TimeDelta, Utc};
use crm::domain::model::{CrmError, DepopulateContactOutcome};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::{
    crm_cleanup::{CrmCleanupCandidate, CrmCleanupJob},
    link::{Link, UserProvider},
};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

pub(super) const JOB: uuid::Uuid = uuid::Uuid::from_u128(1);
pub(super) const LINK: uuid::Uuid = uuid::Uuid::from_u128(2);
pub(super) const TEAM: uuid::Uuid = uuid::Uuid::from_u128(3);
pub(super) const EMAIL: &str = "contact@example.com";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Call {
    Snapshot,
    Create(i64, i64),
    Active,
    Job(uuid::Uuid),
    Status(uuid::Uuid, CrmCleanupJobStatus),
    Count(uuid::Uuid, i64),
    Page(i64, i64, i64),
    Pairs(Vec<(uuid::Uuid, String)>),
    Prune(Vec<(uuid::Uuid, String)>),
    Claim(uuid::Uuid, String),
    Link(uuid::Uuid),
    Team(String),
    Target(uuid::Uuid, String),
    Messages(uuid::Uuid, String),
    Depopulate(uuid::Uuid, uuid::Uuid, String),
    Send(CrmCleanupOperation),
    Now,
}

pub(super) struct State {
    pub calls: Vec<Call>,
    pub counts: HashMap<&'static str, usize>,
    pub fault: Option<(&'static str, usize)>,
    pub snapshot: Option<(i64, i64)>,
    pub created: VecDeque<Option<CrmCleanupJob>>,
    pub active: Option<CrmCleanupJob>,
    pub job: Option<CrmCleanupJob>,
    pub page: Vec<CrmCleanupCandidate>,
    pub sources: Vec<(uuid::Uuid, String)>,
    pub batch_count: u64,
    pub claimed: bool,
    pub link: Option<Link>,
    pub team: Option<uuid::Uuid>,
    pub target: bool,
    pub messages: bool,
    pub outcome: DepopulateContactOutcome,
    pub now: DateTime<Utc>,
}

#[derive(Clone)]
pub(super) struct Fake(pub Arc<Mutex<State>>);

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(super) struct Fault(pub &'static str);

pub(super) fn now() -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000, 0).unwrap()
}

pub(super) fn job(status: CrmCleanupJobStatus) -> CrmCleanupJob {
    CrmCleanupJob {
        id: JOB,
        status,
        total_candidates: 3,
        dispatched_count: 7,
        max_candidate_id: 300,
        created_at: now(),
        updated_at: now(),
    }
}

pub(super) fn candidate(id: i64, email: &str) -> CrmCleanupCandidate {
    CrmCleanupCandidate {
        id,
        link_id: LINK,
        contact_email: email.into(),
        created_at: now() - TimeDelta::hours(7),
    }
}

pub(super) fn setup() -> (CrmCleanupService<Fake, Fake, Fake, Fake>, Fake) {
    let fake = Fake(Arc::new(Mutex::new(State {
        calls: vec![],
        counts: HashMap::new(),
        fault: None,
        snapshot: Some((300, 3)),
        created: [Some(job(CrmCleanupJobStatus::Init))].into(),
        active: Some(job(CrmCleanupJobStatus::InProgress)),
        job: Some(job(CrmCleanupJobStatus::InProgress)),
        page: vec![candidate(10, EMAIL)],
        sources: vec![(LINK, EMAIL.into())],
        batch_count: 1,
        claimed: true,
        link: Some(Link {
            id: LINK,
            macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
            fusionauth_user_id: "owner".into(),
            email_address: EmailStr::try_from("owner@example.com".to_string()).unwrap(),
            provider: UserProvider::Gmail,
            is_sync_active: true,
            is_primary: true,
            needs_reauth: false,
            last_sync_error_at: None,
            created_at: now(),
            updated_at: now(),
        }),
        team: Some(TEAM),
        target: true,
        messages: false,
        outcome: DepopulateContactOutcome {
            source_deleted: true,
            contact_deleted: false,
            company_deleted: false,
        },
        now: now(),
    })));
    (
        CrmCleanupService {
            repository: fake.clone(),
            crm_service: fake.clone(),
            queue: fake.clone(),
            clock: fake.clone(),
        },
        fake,
    )
}

impl Fake {
    pub fn calls(&self) -> Vec<Call> {
        self.0.lock().unwrap().calls.clone()
    }
    fn call(&self, name: &'static str, value: Call) -> anyhow::Result<()> {
        let mut s = self.0.lock().unwrap();
        s.calls.push(value);
        let count = s.counts.entry(name).or_default();
        *count += 1;
        let count = *count;
        if s.fault == Some((name, count)) {
            return Err(anyhow::Error::new(Fault(name)));
        }
        Ok(())
    }
}

impl CleanupJobs for Fake {
    async fn create_job(&self, count: i64, max_id: i64) -> anyhow::Result<Option<CrmCleanupJob>> {
        self.call("create", Call::Create(count, max_id))?;
        Ok(self.0.lock().unwrap().created.pop_front().unwrap_or(None))
    }
    async fn get_active_job(&self) -> anyhow::Result<Option<CrmCleanupJob>> {
        self.call("active", Call::Active)?;
        Ok(self.0.lock().unwrap().active.clone())
    }
    async fn get_job(&self, id: uuid::Uuid) -> anyhow::Result<Option<CrmCleanupJob>> {
        self.call("job", Call::Job(id))?;
        Ok(self.0.lock().unwrap().job.clone())
    }
    async fn set_job_status(
        &self,
        id: uuid::Uuid,
        status: CrmCleanupJobStatus,
    ) -> anyhow::Result<()> {
        self.call("status", Call::Status(id, status))
    }
    async fn add_dispatched_count(&self, id: uuid::Uuid, count: i64) -> anyhow::Result<()> {
        self.call("count", Call::Count(id, count))
    }
}
impl CleanupCandidates for Fake {
    async fn get_max_id_and_count(&self) -> anyhow::Result<Option<(i64, i64)>> {
        self.call("snapshot", Call::Snapshot)?;
        Ok(self.0.lock().unwrap().snapshot)
    }
    async fn list_candidates_page(
        &self,
        last_id: i64,
        max_id: i64,
        limit: i64,
    ) -> anyhow::Result<Vec<CrmCleanupCandidate>> {
        self.call("page", Call::Page(last_id, max_id, limit))?;
        Ok(self.0.lock().unwrap().page.clone())
    }
    async fn claim_candidates(&self, pairs: &[(uuid::Uuid, String)]) -> anyhow::Result<u64> {
        self.call("prune", Call::Prune(pairs.to_vec()))?;
        Ok(self.0.lock().unwrap().batch_count)
    }
    async fn claim_candidate(&self, link: uuid::Uuid, email: &str) -> anyhow::Result<bool> {
        self.call("claim", Call::Claim(link, email.into()))?;
        Ok(self.0.lock().unwrap().claimed)
    }
}
impl CleanupMailbox for Fake {
    async fn fetch_link_by_id(&self, link: uuid::Uuid) -> anyhow::Result<Option<Link>> {
        self.call("link", Call::Link(link))?;
        Ok(self.0.lock().unwrap().link.clone())
    }
    async fn link_has_any_message_with(
        &self,
        link: uuid::Uuid,
        email: &str,
    ) -> anyhow::Result<bool> {
        self.call("messages", Call::Messages(link, email.into()))?;
        Ok(self.0.lock().unwrap().messages)
    }
}
impl CleanupCrm for Fake {
    async fn get_team_id_for_user(&self, user: &str) -> Result<Option<uuid::Uuid>, CrmError> {
        self.call("team", Call::Team(user.into()))?;
        Ok(self.0.lock().unwrap().team)
    }
    async fn link_contact_pairs_with_sources(
        &self,
        pairs: &[(uuid::Uuid, String)],
    ) -> Result<Vec<(uuid::Uuid, String)>, CrmError> {
        self.call("pairs", Call::Pairs(pairs.to_vec()))?;
        Ok(self.0.lock().unwrap().sources.clone())
    }
    async fn has_depopulate_target(
        &self,
        team: &uuid::Uuid,
        email: &str,
    ) -> Result<bool, CrmError> {
        self.call("target", Call::Target(*team, email.into()))?;
        Ok(self.0.lock().unwrap().target)
    }
    async fn depopulate_contact(
        &self,
        team: &uuid::Uuid,
        link: &uuid::Uuid,
        email: &str,
    ) -> Result<DepopulateContactOutcome, CrmError> {
        self.call("depopulate", Call::Depopulate(*team, *link, email.into()))?;
        Ok(self.0.lock().unwrap().outcome)
    }
}
impl CleanupQueue for Fake {
    async fn enqueue(&self, operation: CrmCleanupOperation) -> anyhow::Result<()> {
        self.call("send", Call::Send(operation))
    }
}
impl CleanupClock for Fake {
    fn now(&self) -> DateTime<Utc> {
        let mut s = self.0.lock().unwrap();
        s.calls.push(Call::Now);
        s.now
    }
}
