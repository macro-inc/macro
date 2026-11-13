//! Audience resolution: who, among a process' open streams, may see an event.
//!
//! Resolved once per event per process, against current access: the
//! expensive facts (an entity's accessor set, a team's members, a user's
//! teams) are looked up at most once per event and cached for
//! [`ACCESS_CACHE_TTL`], single-flight, so concurrent fan-out and replay
//! share one lookup. When only a few principals are interested in an entity,
//! each is checked exactly instead of listing every accessor.
//!
//! Events that change access evict the affected facts before they are
//! delivered ([`Invalidation`]). The access adapters behind
//! [`AccessDirectory`] must not cache on their own, so this cache and its
//! eviction are the only staleness: at most [`ACCESS_CACHE_TTL`], none after
//! a logged revocation.

use crate::domain::models::{Invalidation, PrincipalKind, StreamPrincipal, WebhookScope};
use crate::domain::ports::{
    AccessDirectory, AccessLookupError, ContactDirectory, GithubClaims, TeamDirectory, TeamRole,
};
use event_exposure::{Audience, EntityType, MinAccessLevel, MinTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::Instrument as _;
use uuid::Uuid;

/// How long a looked-up access fact is reused.
pub const ACCESS_CACHE_TTL: Duration = Duration::from_secs(5);

/// At most this many interested principals are checked one by one instead of
/// listing the entity's accessors.
pub const EXACT_CHECK_MAX: usize = 8;

/// Cache size past which expired entries are swept on insert.
const SWEEP_THRESHOLD: usize = 10_000;

struct Slot<V> {
    created: Instant,
    cell: tokio::sync::OnceCell<V>,
}

/// A time-bounded, single-flight cache: concurrent callers for one key share
/// one load, and an eviction makes the next caller load afresh.
struct TtlCache<K, V> {
    ttl: Duration,
    slots: Mutex<HashMap<K, Arc<Slot<V>>>>,
}

impl<K: Eq + Hash + Clone, V: Clone> TtlCache<K, V> {
    fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            slots: Mutex::new(HashMap::new()),
        }
    }

    fn slot(&self, key: &K) -> Arc<Slot<V>> {
        let mut slots = self
            .slots
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(slot) = slots.get(key)
            && slot.created.elapsed() < self.ttl
        {
            return slot.clone();
        }
        if slots.len() >= SWEEP_THRESHOLD {
            let ttl = self.ttl;
            slots.retain(|_, slot| slot.created.elapsed() < ttl);
        }
        let slot = Arc::new(Slot {
            created: Instant::now(),
            cell: tokio::sync::OnceCell::new(),
        });
        slots.insert(key.clone(), slot.clone());
        slot
    }

    /// The cached value, loading it if absent or expired. Returns whether it
    /// was already loaded. A failed load is not cached.
    async fn get_or_load<E, F, Fut>(&self, key: &K, load: F) -> Result<(V, bool), E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
    {
        let slot = self.slot(key);
        let hit = slot.cell.initialized();
        let value = slot.cell.get_or_try_init(load).await?.clone();
        Ok((value, hit))
    }

    fn evict(&self, key: &K) {
        self.slots
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(key);
    }

    fn evict_where(&self, mut evicted: impl FnMut(&K) -> bool) {
        self.slots
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .retain(|key, _| !evicted(key));
    }
}

type EntityKey = (EntityType, String);

/// Process-wide access caches, shared by fan-out and replay.
pub struct AccessCaches {
    accessors: TtlCache<EntityKey, Result<Arc<HashSet<String>>, Unsupported>>,
    exact: TtlCache<(EntityKey, String), bool>,
    at_least: TtlCache<(EntityKey, String, MinAccessLevel), bool>,
    contacts: TtlCache<(String, String), bool>,
    team_members: TtlCache<Uuid, Arc<HashMap<String, TeamRole>>>,
    user_teams: TtlCache<String, Arc<Vec<(Uuid, TeamRole)>>>,
    github_claims: TtlCache<(String, String), bool>,
}

/// An entity with no accessor expansion: cached like a set nobody is in.
#[derive(Debug, Clone, Copy)]
struct Unsupported;

impl Default for AccessCaches {
    fn default() -> Self {
        Self {
            accessors: TtlCache::new(ACCESS_CACHE_TTL),
            exact: TtlCache::new(ACCESS_CACHE_TTL),
            at_least: TtlCache::new(ACCESS_CACHE_TTL),
            contacts: TtlCache::new(ACCESS_CACHE_TTL),
            team_members: TtlCache::new(ACCESS_CACHE_TTL),
            user_teams: TtlCache::new(ACCESS_CACHE_TTL),
            github_claims: TtlCache::new(ACCESS_CACHE_TTL),
        }
    }
}

impl AccessCaches {
    /// Evict what an event changed, before it is delivered.
    pub fn invalidate(&self, invalidation: &Invalidation) {
        match invalidation {
            Invalidation::Entity {
                entity_type,
                entity_id,
            } => {
                let key = (*entity_type, entity_id.clone());
                self.exact.evict_where(|(entity, _)| *entity == key);
                self.at_least.evict_where(|(entity, _, _)| *entity == key);
                self.accessors.evict(&key);
            }
            Invalidation::Team { team_id, user_id } => {
                // Team grants make members accessors of whatever the team was
                // granted, which no single entity key names: drop every
                // entity fact. Membership changes are rare.
                self.exact.evict_where(|_| true);
                self.at_least.evict_where(|_| true);
                self.accessors.evict_where(|_| true);
                self.team_members.evict(team_id);
                if let Some(user_id) = user_id {
                    self.user_teams.evict(&user_id.as_ref().to_owned());
                }
            }
            Invalidation::BotDeleted { .. } => {}
        }
    }
}

/// One stream asking whether it may see an event.
#[derive(Debug, Clone, Copy)]
pub struct Candidate<'a> {
    /// Who holds the stream.
    pub principal: &'a StreamPrincipal,
    /// Personal or team workspace, for workspace rules.
    pub scope: WebhookScope,
}

/// The outcome of resolving one event's audience for some candidates.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Resolution {
    /// Per candidate, in order: whether it is in the audience.
    pub admitted: Vec<bool>,
    /// The largest accessor set listed, when one was.
    pub accessor_count: Option<usize>,
    /// Whether every listed accessor set came from the cache.
    pub cache_hit: Option<bool>,
}

/// How one entity is resolved for one event.
#[derive(Debug, Clone)]
enum EntityStrategy {
    /// Check each interested principal exactly.
    Exact,
    /// Look principals up in the accessor set.
    Set(Result<Arc<HashSet<String>>, Unsupported>),
}

/// Facts looked up while resolving one event.
#[derive(Default)]
struct EventMemo {
    entities: HashMap<EntityKey, EntityStrategy>,
    exact: HashMap<(EntityKey, String), bool>,
    at_least: HashMap<(EntityKey, String, MinAccessLevel), bool>,
    contacts: HashMap<(String, String), bool>,
    accessor_count: Option<usize>,
    cache_hit: Option<bool>,
}

/// Resolves audiences against current access.
pub struct AudienceResolver<A, T, C, G> {
    access: A,
    teams: T,
    contacts: C,
    github: G,
    caches: Arc<AccessCaches>,
}

impl<A, T, C, G> AudienceResolver<A, T, C, G>
where
    A: AccessDirectory,
    T: TeamDirectory,
    C: ContactDirectory,
    G: GithubClaims,
{
    /// Create a resolver over the given directories and shared caches.
    pub fn new(access: A, teams: T, contacts: C, github: G, caches: Arc<AccessCaches>) -> Self {
        Self {
            access,
            teams,
            contacts,
            github,
            caches,
        }
    }

    /// The shared caches.
    pub fn caches(&self) -> &Arc<AccessCaches> {
        &self.caches
    }

    /// Decide, for each candidate, whether `audience` admits it.
    #[tracing::instrument(
        name = "events.stream.resolve_access",
        skip_all,
        err,
        fields(
            audience.class = audience_class(audience),
            candidate_count = candidates.len(),
            accessor_count = tracing::field::Empty,
            cache_hit = tracing::field::Empty,
            admitted = tracing::field::Empty,
        )
    )]
    pub async fn resolve(
        &self,
        audience: &Audience,
        candidates: &[Candidate<'_>],
    ) -> Result<Resolution, Report> {
        let mut memo = EventMemo::default();
        self.plan_entities(audience, candidates, &mut memo).await?;

        let mut admitted = Vec::with_capacity(candidates.len());
        for candidate in candidates {
            admitted.push(self.admits(&mut memo, audience, candidate).await?);
        }

        let span = tracing::Span::current();
        if let Some(count) = memo.accessor_count {
            span.record("accessor_count", count);
        }
        if let Some(hit) = memo.cache_hit {
            span.record("cache_hit", hit);
        }
        span.record(
            "admitted",
            admitted.iter().filter(|admitted| **admitted).count(),
        );
        Ok(Resolution {
            admitted,
            accessor_count: memo.accessor_count,
            cache_hit: memo.cache_hit,
        })
    }

    /// Choose, once per entity in the audience, between exact checks and the
    /// accessor set.
    async fn plan_entities(
        &self,
        audience: &Audience,
        candidates: &[Candidate<'_>],
        memo: &mut EventMemo,
    ) -> Result<(), Report> {
        let mut entities = Vec::new();
        collect_entities(audience, &mut entities);
        if entities.is_empty() {
            return Ok(());
        }

        let interested: HashSet<&str> = candidates
            .iter()
            .map(|candidate| candidate.principal.kind.user().as_ref())
            .collect();

        for key in entities {
            if memo.entities.contains_key(&key) {
                continue;
            }
            let strategy = if interested.len() <= EXACT_CHECK_MAX {
                EntityStrategy::Exact
            } else {
                let (set, hit) = self.accessor_set(&key).await?;
                if let Ok(set) = &set {
                    memo.accessor_count = Some(memo.accessor_count.unwrap_or(0).max(set.len()));
                }
                memo.cache_hit = Some(memo.cache_hit.unwrap_or(true) && hit);
                EntityStrategy::Set(set)
            };
            memo.entities.insert(key, strategy);
        }
        Ok(())
    }

    async fn accessor_set(
        &self,
        key: &EntityKey,
    ) -> Result<(Result<Arc<HashSet<String>>, Unsupported>, bool), Report> {
        let (entity_type, entity_id) = key;
        self.caches
            .accessors
            .get_or_load(key, || async {
                match self.access.accessors(*entity_type, entity_id).await {
                    Ok(accessors) => Ok(Ok(Arc::new(accessors.into_iter().collect()))),
                    Err(AccessLookupError::Unsupported(_)) => Ok(Err(Unsupported)),
                    Err(AccessLookupError::Failed(report)) => Err(report),
                }
            })
            .await
    }

    async fn admits(
        &self,
        memo: &mut EventMemo,
        audience: &Audience,
        candidate: &Candidate<'_>,
    ) -> Result<bool, Report> {
        let kind = &candidate.principal.kind;
        match audience {
            Audience::Entity {
                entity_type,
                entity_id,
            } => {
                let key = (*entity_type, entity_id.clone());
                self.admits_entity(memo, &key, kind).await
            }
            Audience::Recipient { user_id } | Audience::Owner { user_id } => Ok(kind
                .sees_personal_events()
                && candidate.scope == WebhookScope::User
                && kind.user() == user_id),
            Audience::Snapshot { user_ids } => {
                Ok(candidate.scope == WebhookScope::User && user_ids.contains(kind.user()))
            }
            Audience::ContactsOf { user_id } => {
                let user = kind.user();
                if candidate.scope != WebhookScope::User {
                    return Ok(false);
                }
                if user == user_id {
                    return Ok(true);
                }
                self.is_contact(memo, user_id, user).await
            }
            Audience::Workspace { workspace_id } => {
                let workspace = self.workspace(candidate).await?;
                Ok(workspace.as_deref() == Some(workspace_id.as_str()))
            }
            Audience::TeamsOf { user_id } => {
                // Kept as before: a user's team events reach team-scoped
                // streams of their teams; personal streams get them through
                // the contact rule.
                if candidate.scope == WebhookScope::User {
                    return Ok(false);
                }
                let Some(workspace) = self.workspace(candidate).await? else {
                    return Ok(false);
                };
                let teams = self.teams_of(user_id).await?;
                Ok(teams
                    .iter()
                    .any(|(team_id, _)| team_id.to_string() == workspace))
            }
            Audience::Team { team_id, min_role } => {
                let wanted = match min_role {
                    MinTeamRole::Member => TeamRole::Member,
                    MinTeamRole::Admin => TeamRole::Admin,
                };
                let members = self.team_members(*team_id).await?;
                Ok(members
                    .get(kind.user().as_ref())
                    .is_some_and(|role| *role >= wanted))
            }
            Audience::EntityAtLeast {
                entity_type,
                entity_id,
                min_level,
            } => {
                let key = (*entity_type, entity_id.clone());
                self.at_least(memo, key, kind.user().as_ref(), *min_level)
                    .await
            }
            Audience::GithubInstallation { installation_id } => {
                self.has_github_claim(installation_id, kind.user()).await
            }
            Audience::Any(audiences) => {
                // One branch failing must not hide another that admits: the
                // event is dropped only if no branch admits and one failed.
                let mut failure = None;
                for audience in audiences {
                    match Box::pin(self.admits(memo, audience, candidate)).await {
                        Ok(true) => return Ok(true),
                        Ok(false) => {}
                        Err(report) => failure = Some(report),
                    }
                }
                match failure {
                    Some(report) => Err(report),
                    None => Ok(false),
                }
            }
        }
    }

    async fn admits_entity(
        &self,
        memo: &mut EventMemo,
        key: &EntityKey,
        kind: &PrincipalKind,
    ) -> Result<bool, Report> {
        let user = kind.user();
        let strategy = memo
            .entities
            .get(key)
            .cloned()
            .unwrap_or(EntityStrategy::Exact);
        match strategy {
            EntityStrategy::Set(Ok(set)) => Ok(set.contains(user.as_ref())),
            EntityStrategy::Set(Err(Unsupported)) => Ok(false),
            EntityStrategy::Exact => self.exact(memo, key, user.as_ref()).await,
        }
    }

    async fn exact(
        &self,
        memo: &mut EventMemo,
        key: &EntityKey,
        principal_id: &str,
    ) -> Result<bool, Report> {
        let memo_key = (key.clone(), principal_id.to_owned());
        if let Some(admitted) = memo.exact.get(&memo_key) {
            return Ok(*admitted);
        }
        let (entity_type, entity_id) = key;
        let lookup = self.caches.exact.get_or_load(&memo_key, || async {
            match self
                .access
                .is_accessor(principal_id, *entity_type, entity_id)
                .await
            {
                Ok(admitted) => Ok(admitted),
                Err(AccessLookupError::Unsupported(_)) => Ok(false),
                Err(AccessLookupError::Failed(report)) => Err(report),
            }
        });
        let (admitted, _) = lookup.await?;
        memo.exact.insert(memo_key, admitted);
        Ok(admitted)
    }

    /// Explicit accessors at or above a level are checked one by one (cached
    /// like exact checks): the audience is rare (form responses) and its
    /// level is per person.
    async fn at_least(
        &self,
        memo: &mut EventMemo,
        key: EntityKey,
        principal_id: &str,
        min_level: MinAccessLevel,
    ) -> Result<bool, Report> {
        let memo_key = (key, principal_id.to_owned(), min_level);
        if let Some(admitted) = memo.at_least.get(&memo_key) {
            return Ok(*admitted);
        }
        let ((entity_type, entity_id), _, _) = &memo_key;
        let lookup = self.caches.at_least.get_or_load(&memo_key, || async {
            match self
                .access
                .is_accessor_at_least(principal_id, *entity_type, entity_id, min_level)
                .await
            {
                Ok(admitted) => Ok(admitted),
                Err(AccessLookupError::Unsupported(_)) => Ok(false),
                Err(AccessLookupError::Failed(report)) => Err(report),
            }
        });
        let (admitted, _) = lookup.await?;
        memo.at_least.insert(memo_key, admitted);
        Ok(admitted)
    }

    async fn is_contact(
        &self,
        memo: &mut EventMemo,
        user: &MacroUserIdStr<'static>,
        other: &MacroUserIdStr<'static>,
    ) -> Result<bool, Report> {
        let memo_key = (user.as_ref().to_owned(), other.as_ref().to_owned());
        if let Some(contact) = memo.contacts.get(&memo_key) {
            return Ok(*contact);
        }
        let (contact, _) = self
            .caches
            .contacts
            .get_or_load(&memo_key, || self.contacts.is_contact(user, other))
            .await?;
        memo.contacts.insert(memo_key, contact);
        Ok(contact)
    }

    async fn has_github_claim(
        &self,
        installation_id: &str,
        user: &MacroUserIdStr<'static>,
    ) -> Result<bool, Report> {
        let key = (installation_id.to_owned(), user.as_ref().to_owned());
        let (claimed, _) = self
            .caches
            .github_claims
            .get_or_load(&key, || self.github.has_claim(user, installation_id))
            .await?;
        Ok(claimed)
    }

    async fn team_members(&self, team_id: Uuid) -> Result<Arc<HashMap<String, TeamRole>>, Report> {
        let (members, _) = self
            .caches
            .team_members
            .get_or_load(&team_id, || async {
                let members = self.teams.members(team_id).await?;
                Ok::<_, Report>(Arc::new(
                    members
                        .into_iter()
                        .map(|(user, role)| (user.as_ref().to_owned(), role))
                        .collect(),
                ))
            })
            .await?;
        Ok(members)
    }

    async fn teams_of(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Arc<Vec<(Uuid, TeamRole)>>, Report> {
        let (teams, _) = self
            .caches
            .user_teams
            .get_or_load(&user.as_ref().to_owned(), || async {
                Ok::<_, Report>(Arc::new(self.teams.teams_of(user).await?))
            })
            .instrument(tracing::debug_span!("events.stream.resolve_user_teams"))
            .await?;
        Ok(teams)
    }

    /// The workspace a stream represents for workspace rules: the user for a
    /// personal stream, the user's most privileged team for a team stream. Re-resolved (through the cache) per
    /// event so a stream that lost its team stops matching it.
    pub async fn workspace(&self, candidate: &Candidate<'_>) -> Result<Option<String>, Report> {
        let user = candidate.principal.kind.user();
        match candidate.scope {
            WebhookScope::User => Ok(Some(user.as_ref().to_owned())),
            WebhookScope::Team => {
                let teams = self.teams_of(user).await?;
                Ok(teams.first().map(|(team_id, _)| team_id.to_string()))
            }
        }
    }
}

fn collect_entities(audience: &Audience, entities: &mut Vec<EntityKey>) {
    match audience {
        Audience::Entity {
            entity_type,
            entity_id,
        } => entities.push((*entity_type, entity_id.clone())),
        Audience::Any(audiences) => {
            for audience in audiences {
                collect_entities(audience, entities);
            }
        }
        Audience::Recipient { .. }
        | Audience::Owner { .. }
        | Audience::Team { .. }
        | Audience::TeamsOf { .. }
        | Audience::ContactsOf { .. }
        | Audience::Workspace { .. }
        | Audience::GithubInstallation { .. }
        | Audience::EntityAtLeast { .. }
        | Audience::Snapshot { .. } => {}
    }
}

/// The span value for an audience's class.
pub fn audience_class(audience: &Audience) -> &'static str {
    match audience {
        Audience::Entity { .. } => "entity",
        Audience::Recipient { .. } => "recipient",
        Audience::Owner { .. } => "owner",
        Audience::Team { .. } => "team",
        Audience::TeamsOf { .. } => "teams_of",
        Audience::ContactsOf { .. } => "contacts_of",
        Audience::Workspace { .. } => "workspace",
        Audience::Snapshot { .. } => "snapshot",
        Audience::GithubInstallation { .. } => "github_installation",
        Audience::EntityAtLeast { .. } => "entity_at_least",
        Audience::Any(_) => "any",
    }
}
