//! In-memory adapters and builders for domain tests.

use crate::domain::access::{AccessCaches, AudienceResolver};
use crate::domain::fan_out::FanOut;
use crate::domain::filters::WebhookFilter;
use crate::domain::models::{
    Cursor, LogEntry, LogRecord, NormalizedEvent, PrincipalKind, PublicLogEvent, StreamItem,
    StreamPrincipal, WebhookScope,
};
use crate::domain::ports::LogPage;
use crate::domain::ports::{
    AccessDirectory, AccessLookupError, ContactDirectory, CredentialCheck, EventLog, GithubClaims,
    LimitKey, PreviewFlag, StreamLimiter, TeamDirectory, TeamRole,
};
use crate::domain::registry::Registry;
use crate::domain::stream::{EventStreamService, OpenStream, StreamService};
use event_exposure::{Audience, EntityType, MinAccessLevel, Stage};
use futures::StreamExt as _;
use futures::stream::BoxStream;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// Each principal's granted level, by (entity type, entity id, principal).
type GrantLevels = HashMap<(EntityType, String, String), MinAccessLevel>;

/// Each team's members and their roles.
type TeamMembers = HashMap<Uuid, Vec<(MacroUserIdStr<'static>, TeamRole)>>;

pub fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{email}"))
        .unwrap()
        .into_owned()
}

pub const DOC: &str = "0193b3a0-0000-7000-8000-00000000d0c1";
pub const CHANNEL: &str = "0193b3a0-0000-7000-8000-0000000c4a11";

#[derive(Default)]
pub struct AccessState {
    pub accessors: HashMap<(EntityType, String), Vec<String>>,
    pub fail: bool,
}

#[derive(Clone, Default)]
pub struct FakeAccess {
    pub state: Arc<Mutex<AccessState>>,
    pub levels: Arc<Mutex<GrantLevels>>,
    pub list_calls: Arc<AtomicUsize>,
    pub exact_calls: Arc<AtomicUsize>,
}

impl FakeAccess {
    pub fn grant(&self, entity_type: EntityType, entity_id: &str, principal: &str) {
        self.state
            .lock()
            .unwrap()
            .accessors
            .entry((entity_type, entity_id.to_owned()))
            .or_default()
            .push(principal.to_owned());
    }

    pub fn revoke(&self, entity_type: EntityType, entity_id: &str, principal: &str) {
        if let Some(accessors) = self
            .state
            .lock()
            .unwrap()
            .accessors
            .get_mut(&(entity_type, entity_id.to_owned()))
        {
            accessors.retain(|accessor| accessor != principal);
        }
    }

    fn check(&self) -> Result<(), AccessLookupError> {
        if self.state.lock().unwrap().fail {
            return Err(AccessLookupError::Failed(rootcause::report!("access down")));
        }
        Ok(())
    }
}

impl FakeAccess {
    pub fn set_level(
        &self,
        entity_type: EntityType,
        entity_id: &str,
        principal: &str,
        level: MinAccessLevel,
    ) {
        self.levels.lock().unwrap().insert(
            (entity_type, entity_id.to_owned(), principal.to_owned()),
            level,
        );
    }
}

impl AccessDirectory for FakeAccess {
    async fn is_accessor_at_least(
        &self,
        principal_id: &str,
        entity_type: EntityType,
        entity_id: &str,
        min_level: MinAccessLevel,
    ) -> Result<bool, AccessLookupError> {
        let explicit = self
            .is_accessor(principal_id, entity_type, entity_id)
            .await?;
        let level = self
            .levels
            .lock()
            .unwrap()
            .get(&(entity_type, entity_id.to_owned(), principal_id.to_owned()))
            .copied();
        let rank = |level: MinAccessLevel| match level {
            MinAccessLevel::Comment => 1,
            MinAccessLevel::Edit => 2,
            MinAccessLevel::Owner => 3,
        };
        Ok(explicit && level.is_some_and(|level| rank(level) >= rank(min_level)))
    }

    async fn accessors(
        &self,
        entity_type: EntityType,
        entity_id: &str,
    ) -> Result<Vec<String>, AccessLookupError> {
        self.list_calls.fetch_add(1, Ordering::SeqCst);
        self.check()?;
        Ok(self
            .state
            .lock()
            .unwrap()
            .accessors
            .get(&(entity_type, entity_id.to_owned()))
            .cloned()
            .unwrap_or_default())
    }

    async fn is_accessor(
        &self,
        principal_id: &str,
        entity_type: EntityType,
        entity_id: &str,
    ) -> Result<bool, AccessLookupError> {
        self.exact_calls.fetch_add(1, Ordering::SeqCst);
        self.check()?;
        Ok(self
            .state
            .lock()
            .unwrap()
            .accessors
            .get(&(entity_type, entity_id.to_owned()))
            .is_some_and(|accessors| accessors.iter().any(|accessor| accessor == principal_id)))
    }
}

#[derive(Clone, Default)]
pub struct FakeTeams {
    pub members: Arc<Mutex<TeamMembers>>,
}

impl FakeTeams {
    pub fn add(&self, team_id: Uuid, member: &MacroUserIdStr<'static>, role: TeamRole) {
        self.members
            .lock()
            .unwrap()
            .entry(team_id)
            .or_default()
            .push((member.clone(), role));
    }

    pub fn remove(&self, team_id: Uuid, member: &MacroUserIdStr<'static>) {
        if let Some(members) = self.members.lock().unwrap().get_mut(&team_id) {
            members.retain(|(user, _)| user != member);
        }
    }
}

impl TeamDirectory for FakeTeams {
    async fn members(
        &self,
        team_id: Uuid,
    ) -> Result<Vec<(MacroUserIdStr<'static>, TeamRole)>, Report> {
        Ok(self
            .members
            .lock()
            .unwrap()
            .get(&team_id)
            .cloned()
            .unwrap_or_default())
    }

    async fn teams_of(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<(Uuid, TeamRole)>, Report> {
        let mut teams: Vec<(Uuid, TeamRole)> = self
            .members
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(team_id, members)| {
                members
                    .iter()
                    .find(|(member, _)| member == user)
                    .map(|(_, role)| (*team_id, *role))
            })
            .collect();
        teams.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        Ok(teams)
    }
}

#[derive(Clone, Default)]
pub struct FakeContacts {
    pub pairs: Arc<Mutex<HashSet<(String, String)>>>,
}

impl FakeContacts {
    pub fn connect(&self, user: &MacroUserIdStr<'static>, other: &MacroUserIdStr<'static>) {
        self.pairs
            .lock()
            .unwrap()
            .insert((user.as_ref().to_owned(), other.as_ref().to_owned()));
    }
}

impl ContactDirectory for FakeContacts {
    async fn is_contact(
        &self,
        user: &MacroUserIdStr<'static>,
        other: &MacroUserIdStr<'static>,
    ) -> Result<bool, Report> {
        Ok(self
            .pairs
            .lock()
            .unwrap()
            .contains(&(user.as_ref().to_owned(), other.as_ref().to_owned())))
    }
}

#[derive(Clone, Default)]
pub struct FakeLog {
    pub entries: Arc<Mutex<Vec<(Cursor, LogRecord)>>>,
    pub floor: Arc<Mutex<Cursor>>,
}

impl FakeLog {
    pub fn push(&self, cursor: Cursor, record: LogRecord) {
        self.entries.lock().unwrap().push((cursor, record));
    }
}

impl EventLog for FakeLog {
    async fn append(&self, record: &LogRecord) -> Result<Cursor, Report> {
        let mut entries = self.entries.lock().unwrap();
        let cursor = Cursor {
            ms: entries.last().map_or(1, |(cursor, _)| cursor.ms + 1),
            seq: 0,
        };
        entries.push((cursor, record.clone()));
        Ok(cursor)
    }

    async fn read_after(&self, after: Cursor, count: usize) -> Result<LogPage, Report> {
        let entries: Vec<LogEntry> = self
            .entries
            .lock()
            .unwrap()
            .iter()
            .filter(|(cursor, _)| *cursor > after)
            .take(count)
            .map(|(cursor, record)| LogEntry {
                cursor: *cursor,
                record: record.clone(),
                span: tracing::Span::none(),
            })
            .collect();
        Ok(LogPage {
            last: entries.last().map(|entry| entry.cursor),
            full: entries.len() == count,
            entries,
        })
    }

    async fn retained_floor(&self) -> Result<Cursor, Report> {
        Ok(*self.floor.lock().unwrap())
    }
}

#[derive(Clone, Default)]
pub struct FakePreview {
    pub users: Arc<Mutex<HashSet<String>>>,
}

impl FakePreview {
    pub fn enable(&self, user: &MacroUserIdStr<'static>) {
        self.users.lock().unwrap().insert(user.as_ref().to_owned());
    }
}

impl PreviewFlag for FakePreview {
    async fn enabled_for(&self, user: &MacroUserIdStr<'static>) -> bool {
        self.users.lock().unwrap().contains(user.as_ref())
    }
}

#[derive(Clone, Default)]
pub struct FakeLimiter {
    pub holders: Arc<Mutex<HashMap<LimitKey, HashSet<String>>>>,
}

impl StreamLimiter for FakeLimiter {
    async fn acquire(&self, keys: &[LimitKey], stream: &str) -> Result<Option<LimitKey>, Report> {
        let mut holders = self.holders.lock().unwrap();
        for key in keys {
            let held = holders.entry(key.clone()).or_default();
            if !held.contains(stream) && held.len() as u64 >= key.max_streams() {
                for acquired in keys.iter().take_while(|acquired| *acquired != key) {
                    if let Some(held) = holders.get_mut(acquired) {
                        held.remove(stream);
                    }
                }
                return Ok(Some(key.clone()));
            }
            held.insert(stream.to_owned());
        }
        Ok(None)
    }

    async fn renew(&self, keys: &[LimitKey], stream: &str) -> Result<Vec<LimitKey>, Report> {
        let mut holders = self.holders.lock().unwrap();
        for key in keys {
            holders
                .entry(key.clone())
                .or_default()
                .insert(stream.to_owned());
        }
        Ok(Vec::new())
    }

    async fn release(&self, keys: &[LimitKey], stream: &str) {
        let mut holders = self.holders.lock().unwrap();
        for key in keys {
            if let Some(held) = holders.get_mut(key) {
                held.remove(stream);
            }
        }
    }
}

pub struct FakeCredential(pub Arc<AtomicBool>);

impl CredentialCheck for FakeCredential {
    fn still_valid(&self) -> futures::future::BoxFuture<'_, Result<bool, Report>> {
        let valid = self.0.load(Ordering::SeqCst);
        Box::pin(async move { Ok(valid) })
    }
}

#[derive(Clone, Default)]
pub struct FakeGithub {
    pub claims: Arc<Mutex<HashSet<(String, String)>>>,
}

impl FakeGithub {
    pub fn claim(&self, user: &MacroUserIdStr<'static>, installation_id: &str) {
        self.claims
            .lock()
            .unwrap()
            .insert((user.as_ref().to_owned(), installation_id.to_owned()));
    }
}

impl GithubClaims for FakeGithub {
    async fn claimants(
        &self,
        users: &[MacroUserIdStr<'static>],
        installation_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let claims = self.claims.lock().unwrap();
        Ok(users
            .iter()
            .filter(|user| claims.contains(&(user.as_ref().to_owned(), installation_id.to_owned())))
            .cloned()
            .collect())
    }

    async fn installation_owners(
        &self,
        _installation_id: &str,
    ) -> Result<crate::domain::ports::InstallationOwners, Report> {
        Ok(crate::domain::ports::InstallationOwners::default())
    }

    async fn has_claim(
        &self,
        user: &MacroUserIdStr<'static>,
        installation_id: &str,
    ) -> Result<bool, Report> {
        Ok(self
            .claims
            .lock()
            .unwrap()
            .contains(&(user.as_ref().to_owned(), installation_id.to_owned())))
    }
}

pub type TestService = StreamService<
    FakeAccess,
    FakeTeams,
    FakeContacts,
    FakeGithub,
    FakeLog,
    FakePreview,
    FakeLimiter,
>;

/// A process with its registry, fan-out and stream service over fakes.
pub struct Harness {
    pub access: FakeAccess,
    pub teams: FakeTeams,
    pub contacts: FakeContacts,
    pub log: FakeLog,
    pub preview: FakePreview,
    pub github: FakeGithub,
    pub fan_out: FanOut<FakeAccess, FakeTeams, FakeContacts, FakeGithub>,
    pub service: TestService,
    next_ms: AtomicUsize,
}

impl Default for Harness {
    fn default() -> Self {
        let access = FakeAccess::default();
        let teams = FakeTeams::default();
        let contacts = FakeContacts::default();
        let github = FakeGithub::default();
        let log = FakeLog::default();
        let preview = FakePreview::default();
        let limiter = FakeLimiter::default();
        let registry = Arc::new(Registry::default());
        let resolver = Arc::new(AudienceResolver::new(
            access.clone(),
            teams.clone(),
            contacts.clone(),
            github.clone(),
            Arc::new(AccessCaches::default()),
        ));
        let fan_out = FanOut::new(registry.clone(), resolver.clone());
        let service = StreamService::new(
            registry.clone(),
            resolver.clone(),
            Arc::new(log.clone()),
            Arc::new(preview.clone()),
            Arc::new(limiter.clone()),
        );
        Self {
            access,
            teams,
            contacts,
            github,
            log,
            preview,
            fan_out,
            service,
            next_ms: AtomicUsize::new(1_000),
        }
    }
}

pub fn person(user: &MacroUserIdStr<'static>) -> StreamPrincipal {
    StreamPrincipal {
        kind: PrincipalKind::User {
            user: user.clone(),
            api_key: false,
        },
        credential_id: format!("session-{}", user.as_ref().len()),
    }
}

pub fn filter(events: &[&str]) -> Vec<WebhookFilter> {
    vec![WebhookFilter {
        events: events.iter().map(|event| (*event).to_owned()).collect(),
        ids: None,
        entity_types: None,
    }]
}

pub fn event(name: &str, entity_type: &str, entity_id: &str) -> NormalizedEvent {
    NormalizedEvent {
        event_id: Uuid::now_v7().to_string(),
        schema_version: 1,
        event_name: name.to_owned(),
        entity_type: entity_type.to_owned(),
        entity_id: entity_id.to_owned(),
        ordering_key: entity_id.to_owned(),
        occurred_at: chrono::Utc::now(),
        broker_envelope: serde_json::json!({ "event_type": name }),
    }
}

pub fn public(event: NormalizedEvent, audience: Audience) -> LogRecord {
    LogRecord {
        event: Some(PublicLogEvent {
            event,
            audience,
            stage: Stage::Stable,
        }),
        invalidations: Vec::new(),
    }
}

pub fn entity(entity_type: EntityType, entity_id: &str) -> Audience {
    Audience::Entity {
        entity_type,
        entity_id: entity_id.to_owned(),
    }
}

/// An open stream under test.
pub struct Opened {
    pub items: BoxStream<'static, StreamItem>,
    pub valid: Arc<AtomicBool>,
}

impl Opened {
    /// The next item, or `None` if nothing arrives once every task is idle.
    pub async fn next_now(&mut self) -> Option<StreamItem> {
        // Paused time: an empty stream auto-advances to the next timer, so
        // bound the wait with a timeout that fires only when nothing else
        // can run.
        tokio::time::timeout(std::time::Duration::from_millis(10), self.items.next())
            .await
            .ok()
            .flatten()
    }

    pub async fn next_event_name(&mut self) -> Option<String> {
        match self.next_now().await? {
            StreamItem::Event { event, .. } => Some(event.event_name.clone()),
            StreamItem::Control(control) => Some(format!("control:{}", control.name())),
        }
    }
}

impl Harness {
    pub fn next_cursor(&self) -> Cursor {
        Cursor {
            ms: self.next_ms.fetch_add(1, Ordering::SeqCst) as u64,
            seq: 0,
        }
    }

    /// Append to the log and fan it out, as the tail would.
    pub async fn publish(&self, record: LogRecord) -> Cursor {
        let cursor = self.next_cursor();
        self.log.push(cursor, record.clone());
        self.fan_out
            .deliver(LogEntry {
                cursor,
                record,
                span: tracing::Span::none(),
            })
            .await;
        cursor
    }

    pub async fn open(
        &self,
        principal: StreamPrincipal,
        scope: WebhookScope,
        filters: Vec<WebhookFilter>,
        resume: Option<String>,
    ) -> Result<Opened, crate::domain::stream::StreamError> {
        let valid = Arc::new(AtomicBool::new(true));
        let items = self
            .service
            .open_stream(OpenStream {
                principal,
                scope,
                filters,
                resume: resume.map(crate::domain::stream::Resume::Cursor),
                credential: Arc::new(FakeCredential(valid.clone())),
            })
            .await?;
        Ok(Opened { items, valid })
    }
}
