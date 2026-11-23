use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Mutex;

use agent_permission_registry::Action;
use bot_id::MACRO_NEW_BOT_ID;
use chrono::DateTime;

use super::*;
use macro_uuid::Uuid;

use crate::domain::model::{
    AgentFacts, AgentOwner, AgentScope, CandidatesFor, CatalogEntry, CatalogGroup, Follows,
    MAX_CHAIN, PolicyChain, PolicyLevel, SourceScope, SourceStatus, SourceUnavailable, Target,
    TeamFacts, TeamRole,
};
use crate::domain::ports::{SourceWrite, TeamDirectory};

const OWNER: &str = "macro|owner@example.com";
const TEAMMATE: &str = "macro|teammate@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

fn catalog() -> Arc<Catalog> {
    let entry = |service: &str, operation: &str, group: &str, action| CatalogEntry {
        service: service.to_owned(),
        operation: operation.to_owned(),
        group: group.to_owned(),
        action,
        label: operation.to_owned(),
    };
    Arc::new(Catalog {
        version: "0123456789ab".to_owned(),
        groups: ["documents", "email"]
            .into_iter()
            .map(|id| CatalogGroup {
                id: id.to_owned(),
                name: id.to_owned(),
                description: id.to_owned(),
            })
            .collect(),
        entries: vec![
            entry("storage", "delete_document", "documents", Action::Destroy),
            entry("email", "send_email", "email", Action::Send),
        ],
        always_allowed: vec![entry(
            "agent-harness",
            "tighten_agent_tool_permissions",
            "agents",
            Action::Update,
        )],
    })
}

/// Whose rules a test reads from the fake store.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Key {
    Agent(BotId),
    Persona(BotId, String),
    Team(Uuid),
    Session(AgentSessionId),
}

fn key(owner: &PolicyOwner) -> Key {
    match owner {
        PolicyOwner::Agent(agent) => Key::Agent(*agent),
        PolicyOwner::Persona { persona, user } => Key::Persona(*persona, user.as_ref().to_owned()),
        PolicyOwner::Team(team) => Key::Team(*team),
    }
}

/// Where the fake store keeps rules: under a policy's id, or a session's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Slot {
    Policy(PolicyId),
    Session(AgentSessionId),
}

#[derive(Default)]
struct FakeStore {
    /// Each owner's policy id, made on first use.
    policies: Mutex<HashMap<Key, PolicyId>>,
    /// Each policy's owner, and what it follows when not its own settings.
    owners: Mutex<HashMap<PolicyId, (PolicyOwner, Follows)>>,
    rules: Mutex<HashMap<Slot, Vec<Rule>>>,
}

impl FakeStore {
    fn save(&self, slot: Slot, changes: &[Change], set_by: SetBy) {
        let mut rules = self.rules.lock().unwrap();
        let current = rules.entry(slot).or_default();
        for change in changes {
            current.retain(|rule| rule.target != change.target);
            if let Some(state) = change.state {
                current.push(Rule {
                    target: change.target.clone(),
                    state,
                    via_agent: set_by.via_agent(),
                    restriction_only: set_by.restriction_only(),
                    updated_at: DateTime::UNIX_EPOCH,
                });
            }
        }
    }

    fn slot(&self, key: &Key) -> Option<Slot> {
        match key {
            Key::Session(session) => Some(Slot::Session(*session)),
            Key::Agent(_) | Key::Persona(..) | Key::Team(_) => self
                .policies
                .lock()
                .unwrap()
                .get(key)
                .copied()
                .map(Slot::Policy),
        }
    }

    fn read_slot(&self, slot: Slot) -> Vec<Rule> {
        self.rules
            .lock()
            .unwrap()
            .get(&slot)
            .cloned()
            .unwrap_or_default()
    }

    fn read(&self, key: &Key) -> Vec<Rule> {
        self.slot(key)
            .map(|slot| self.read_slot(slot))
            .unwrap_or_default()
    }

    fn policy(&self, key: &Key) -> Option<PolicyId> {
        self.policies.lock().unwrap().get(key).copied()
    }

    /// `policy`'s chain as it stands, or `None` for no such policy.
    fn read_chain(&self, policy: PolicyId) -> Option<PolicyChain> {
        let owners = self.owners.lock().unwrap();
        let mut levels = Vec::new();
        let mut next = Some(policy);
        while let Some(id) = next {
            let (owner, follows) = owners.get(&id)?.clone();
            levels.push(PolicyLevel {
                id,
                owner,
                follows,
                rules: self.read_slot(Slot::Policy(id)),
            });
            next = match follows {
                Follows::Source(source) if levels.len() <= MAX_CHAIN => Some(source),
                Follows::Source(_) | Follows::Own | Follows::Lost => None,
            };
        }
        Some(PolicyChain::new(levels).expect("the fake store holds only chains"))
    }

    /// The most policies on a path of followers ending at `policy`.
    fn height(&self, policy: PolicyId) -> usize {
        let followers: Vec<PolicyId> = self
            .owners
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, (_, follows))| *follows == Follows::Source(policy))
            .map(|(id, _)| *id)
            .collect();
        1 + followers
            .into_iter()
            .map(|follower| self.height(follower))
            .max()
            .unwrap_or(0)
    }
}

impl PermissionStore for Arc<FakeStore> {
    type Err = Infallible;

    async fn ensure_policy(&self, owner: &PolicyOwner) -> Result<PolicyId, Infallible> {
        let id = *self
            .policies
            .lock()
            .unwrap()
            .entry(key(owner))
            .or_insert_with(PolicyId::generate);
        self.owners
            .lock()
            .unwrap()
            .entry(id)
            .or_insert_with(|| (owner.clone(), Follows::Own));
        Ok(id)
    }

    async fn find_policy(&self, owner: &PolicyOwner) -> Result<Option<PolicyId>, Infallible> {
        Ok(self.policy(&key(owner)))
    }

    async fn ensure_following_policy(
        &self,
        agent: BotId,
        source: PolicyId,
    ) -> Result<PolicyId, Infallible> {
        let owner = PolicyOwner::Agent(agent);
        if let Some(id) = self.policy(&key(&owner)) {
            return Ok(id);
        }
        let id = self.ensure_policy(&owner).await?;
        if let Some((_, follows)) = self.owners.lock().unwrap().get_mut(&id) {
            *follows = Follows::Source(source);
        }
        Ok(id)
    }

    async fn chain(&self, policy: PolicyId) -> Result<Option<PolicyChain>, Infallible> {
        Ok(self.read_chain(policy))
    }

    async fn session_rules(&self, session: AgentSessionId) -> Result<Vec<Rule>, Infallible> {
        Ok(self.read_slot(Slot::Session(session)))
    }

    async fn chain_with_session(
        &self,
        policy: PolicyId,
        session: AgentSessionId,
    ) -> Result<Option<(PolicyChain, Vec<Rule>)>, Infallible> {
        Ok(self
            .read_chain(policy)
            .map(|chain| (chain, self.read_slot(Slot::Session(session)))))
    }

    async fn write<Plan>(
        &self,
        write: Write<'_>,
        plan: Plan,
    ) -> Result<Result<(), PermissionError>, Infallible>
    where
        Plan: FnOnce(&PolicyChain, &[Rule]) -> Result<Vec<Change>, PermissionError> + Send,
    {
        let Some(chain) = self.read_chain(write.policy) else {
            return Ok(Err(PermissionError::NotFound));
        };
        let overlay = write
            .session
            .map(|session| self.read_slot(Slot::Session(session)))
            .unwrap_or_default();
        let changes = match plan(&chain, &overlay) {
            Ok(changes) => changes,
            Err(refused) => return Ok(Err(refused)),
        };
        match write.to {
            WriteTo::Saved => self.save(Slot::Policy(write.policy), &changes, write.set_by),
            WriteTo::Session(session) => {
                self.save(Slot::Session(session), &changes, SetBy::Agent);
            }
        }
        Ok(Ok(()))
    }

    async fn reset(&self, policy: PolicyId) -> Result<(), Infallible> {
        self.rules.lock().unwrap().remove(&Slot::Policy(policy));
        Ok(())
    }

    async fn set_source(
        &self,
        write: SourceWrite<'_>,
        source: PolicyId,
    ) -> Result<Result<(), PermissionError>, Infallible> {
        let follower = self.owners.lock().unwrap().get(&write.policy).cloned();
        let Some((PolicyOwner::Agent(_), follows)) = follower else {
            return Ok(Err(match follower {
                Some(_) => PermissionError::SourceNotAllowed,
                None => PermissionError::NotFound,
            }));
        };
        if source == write.policy {
            return Ok(Err(PermissionError::SourceNotAllowed));
        }
        let Some(up) = self.read_chain(source) else {
            return Ok(Err(PermissionError::NotFound));
        };
        if up.levels().any(|level| level.id == write.policy) {
            return Ok(Err(PermissionError::SourceCycle));
        }
        if self.height(write.policy) + up.depth() > MAX_CHAIN {
            return Ok(Err(PermissionError::SourceTooDeep));
        }
        if let Some((_, current)) = self.owners.lock().unwrap().get_mut(&write.policy) {
            *current = Follows::Source(source);
        }
        if follows == Follows::Own
            && let Some(rules) = self
                .rules
                .lock()
                .unwrap()
                .get_mut(&Slot::Policy(write.policy))
        {
            rules.retain(|rule| rule.restriction_only);
        }
        Ok(Ok(()))
    }

    async fn detach<Plan>(
        &self,
        write: SourceWrite<'_>,
        plan: Plan,
    ) -> Result<Result<usize, PermissionError>, Infallible>
    where
        Plan: FnOnce(&PolicyChain) -> Result<Vec<Rule>, PermissionError> + Send,
    {
        let Some(chain) = self.read_chain(write.policy) else {
            return Ok(Err(PermissionError::NotFound));
        };
        let rules = match plan(&chain) {
            Ok(rules) => rules,
            Err(refused) => return Ok(Err(refused)),
        };
        let written = rules.len();
        self.rules
            .lock()
            .unwrap()
            .insert(Slot::Policy(write.policy), rules);
        if let Some((_, current)) = self.owners.lock().unwrap().get_mut(&write.policy) {
            *current = Follows::Own;
        }
        Ok(Ok(written))
    }

    async fn find_agent_policies(
        &self,
        agents: &[BotId],
    ) -> Result<Vec<Option<PolicyId>>, Infallible> {
        Ok(agents
            .iter()
            .map(|agent| self.policy(&Key::Agent(*agent)))
            .collect())
    }

    async fn ensure_following_policies(
        &self,
        agents: &[(BotId, PolicyId)],
    ) -> Result<Vec<PolicyId>, Infallible> {
        let mut ids = Vec::with_capacity(agents.len());
        for (agent, source) in agents {
            ids.push(self.ensure_following_policy(*agent, *source).await?);
        }
        Ok(ids)
    }

    async fn chain_ids(&self, policies: &[PolicyId]) -> Result<Vec<Vec<PolicyId>>, Infallible> {
        Ok(policies
            .iter()
            .map(|policy| {
                self.read_chain(*policy)
                    .map(|chain| chain.levels().map(|level| level.id).collect())
                    .unwrap_or_default()
            })
            .collect())
    }

    async fn followers_height(&self, policy: PolicyId) -> Result<usize, Infallible> {
        Ok(self.height(policy))
    }
}

/// Agents created after policies had default sources: no policy yet.
const NEW_PRIVATE: BotId = BotId::new_from_uuid(Uuid::from_u128(0x0E01));
const NEW_TEAM: BotId = BotId::new_from_uuid(Uuid::from_u128(0x0E02));
/// The agents that had a policy before default sources (the migration gave
/// each its own).
const EXISTING: [BotId; 7] = [
    BotId::TEST_A,
    SCOUT,
    GONE,
    THEIRS,
    TEAM_ONE,
    TEAM_TWO,
    OTHER_TEAMS,
];
/// The owner's private `Scout`.
const SCOUT: BotId = BotId::new_from_uuid(Uuid::from_u128(0x5C07));
/// The owner's deleted private agent.
const GONE: BotId = BotId::new_from_uuid(Uuid::from_u128(0x6011));
/// The teammate's private agent.
const THEIRS: BotId = BotId::new_from_uuid(Uuid::from_u128(0x7E12));
/// Two agents of `TEAM` (the owner and the teammate are members).
const TEAM_ONE: BotId = BotId::new_from_uuid(Uuid::from_u128(0x7EA1));
const TEAM_TWO: BotId = BotId::new_from_uuid(Uuid::from_u128(0x7EA2));
/// An agent of `OTHER_TEAM` (only the teammate is a member).
const OTHER_TEAMS: BotId = BotId::new_from_uuid(Uuid::from_u128(0x7EB1));
const TEAM: Uuid = Uuid::from_u128(0x7EA0);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x7EB0);

/// `BotId::TEST_A` and `SCOUT` are the owner's private agents (`GONE` a
/// deleted one), `THEIRS` the teammate's; `TEAM_ONE` and `TEAM_TWO` belong to
/// `TEAM`, `OTHER_TEAMS` to `OTHER_TEAM`. A private agent is edited by its
/// owner, a team's by its members. `TEST_B` does not exist.
struct FakeAgents {
    agents: Vec<AgentFacts>,
    members: Mutex<Vec<(Uuid, String)>>,
}

impl Default for FakeAgents {
    fn default() -> Self {
        let agent = |id: BotId, owner: AgentOwner, name: &str, deleted: bool| AgentFacts {
            id,
            owner,
            name: name.to_owned(),
            handle: (!deleted).then(|| name.to_lowercase()),
            avatar_url: None,
            deleted,
        };
        let mine = || AgentOwner::User(user(OWNER));
        Self {
            agents: vec![
                agent(BotId::TEST_A, mine(), "Analyst", false),
                agent(SCOUT, mine(), "Scout", false),
                agent(GONE, mine(), "Gone", true),
                agent(THEIRS, AgentOwner::User(user(TEAMMATE)), "Theirs", false),
                agent(TEAM_ONE, AgentOwner::Team(TEAM), "One", false),
                agent(TEAM_TWO, AgentOwner::Team(TEAM), "Two", false),
                agent(OTHER_TEAMS, AgentOwner::Team(OTHER_TEAM), "Other", false),
                agent(NEW_PRIVATE, mine(), "Newbie", false),
                agent(NEW_TEAM, AgentOwner::Team(TEAM), "New team agent", false),
            ],
            members: Mutex::new(vec![
                (TEAM, OWNER.to_owned()),
                (TEAM, TEAMMATE.to_owned()),
                (OTHER_TEAM, TEAMMATE.to_owned()),
            ]),
        }
    }
}

impl FakeAgents {
    fn manages(&self, user: &str, facts: &AgentFacts) -> bool {
        match &facts.owner {
            AgentOwner::User(owner) => owner.as_ref() == user,
            AgentOwner::Team(team) => self
                .members
                .lock()
                .unwrap()
                .iter()
                .any(|(member_of, member)| member_of == team && member == user),
        }
    }
}

impl AgentDirectory for FakeAgents {
    type Err = Infallible;

    async fn access(
        &self,
        user: &MacroUserIdStr<'static>,
        agent: BotId,
    ) -> Result<AgentAccess, Infallible> {
        Ok(
            match self
                .agents
                .iter()
                .find(|facts| facts.id == agent && !facts.deleted)
            {
                None => AgentAccess::NotFound,
                Some(facts) if self.manages(user.as_ref(), facts) => AgentAccess::Manageable,
                Some(_) => AgentAccess::NotManageable,
            },
        )
    }

    async fn facts(&self, agent: BotId) -> Result<Option<AgentFacts>, Infallible> {
        Ok(self.agents.iter().find(|facts| facts.id == agent).cloned())
    }

    async fn source_candidates(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: &AgentScope,
    ) -> Result<Vec<AgentFacts>, Infallible> {
        Ok(self
            .agents
            .iter()
            .filter(|facts| !facts.deleted && self.manages(user.as_ref(), facts))
            .filter(|facts| match (scope, &facts.owner) {
                (AgentScope::Private(_), _) => true,
                (AgentScope::Team(team), AgentOwner::Team(owner)) => team == owner,
                (AgentScope::Team(_), AgentOwner::User(_)) => false,
            })
            .cloned()
            .collect())
    }
}

/// `TEST_A` runs `BotId::TEST_A` for the teammate; `TEST_B` runs the
/// built-in persona for the owner.
struct FakeSessions;

impl SessionDirectory for FakeSessions {
    type Err = Infallible;

    async fn facts(&self, session: AgentSessionId) -> Result<Option<SessionFacts>, Infallible> {
        Ok(if session == AgentSessionId::TEST_A {
            Some(SessionFacts {
                agent: BotId::TEST_A,
                owner: user(TEAMMATE),
            })
        } else if session == AgentSessionId::TEST_B {
            Some(SessionFacts {
                agent: MACRO_NEW_BOT_ID,
                owner: user(OWNER),
            })
        } else {
            None
        })
    }
}

struct FakeRollout(bool);

impl PermissionsRollout for FakeRollout {
    async fn enabled(&self, _user: &MacroUserIdStr<'static>) -> bool {
        self.0
    }
}

struct Fixture {
    store: Arc<FakeStore>,
    service:
        AgentPermissionsService<Arc<FakeStore>, FakeAgents, FakeTeams, FakeSessions, FakeRollout>,
}

/// `TEAM`: the owner is its admin, the teammate a member; `OTHER_TEAM`: the
/// teammate is its owner.
struct FakeTeams;

impl TeamDirectory for FakeTeams {
    type Err = Infallible;

    async fn role(
        &self,
        user: &MacroUserIdStr<'static>,
        team: Uuid,
    ) -> Result<Option<TeamRole>, Infallible> {
        Ok(match (team, user.as_ref()) {
            (TEAM, OWNER) => Some(TeamRole::Admin),
            (TEAM, TEAMMATE) => Some(TeamRole::Member),
            (OTHER_TEAM, TEAMMATE) => Some(TeamRole::Owner),
            _ => None,
        })
    }

    async fn teams(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<TeamFacts>, Infallible> {
        let mut teams = Vec::new();
        for team in [TEAM, OTHER_TEAM] {
            if self.role(user, team).await?.is_some() {
                teams.push(self.team(team).await?.unwrap());
            }
        }
        Ok(teams)
    }

    async fn team(&self, team: Uuid) -> Result<Option<TeamFacts>, Infallible> {
        Ok(match team {
            TEAM => Some(TeamFacts {
                id: TEAM,
                name: "Team".to_owned(),
            }),
            OTHER_TEAM => Some(TeamFacts {
                id: OTHER_TEAM,
                name: "Other team".to_owned(),
            }),
            _ => None,
        })
    }
}

fn fixture_with(enabled: bool) -> Fixture {
    let store = Arc::new(FakeStore::default());
    // The agents that existed before default sources own their settings.
    for agent in EXISTING {
        let id = PolicyId::generate();
        store.policies.lock().unwrap().insert(Key::Agent(agent), id);
        store
            .owners
            .lock()
            .unwrap()
            .insert(id, (PolicyOwner::Agent(agent), Follows::Own));
    }
    Fixture {
        service: AgentPermissionsService::new(
            Arc::clone(&store),
            FakeAgents::default(),
            FakeTeams,
            FakeSessions,
            FakeRollout(enabled),
            catalog(),
        ),
        store,
    }
}

fn fixture() -> Fixture {
    fixture_with(true)
}

fn person(id: &str) -> Caller {
    Caller {
        user: user(id),
        credential: Credential::PersonSession,
    }
}

fn agent_caller(id: &str, agent: BotId, session: Option<AgentSessionId>) -> Caller {
    Caller {
        user: user(id),
        credential: Credential::Agent { agent, session },
    }
}

fn never_send() -> Vec<Change> {
    vec![Change {
        target: Target::GroupAction {
            group: "email".to_owned(),
            action: Action::Send,
        },
        state: Some(PermissionState::Never),
    }]
}

fn allow_send() -> Vec<Change> {
    vec![Change {
        target: Target::GroupAction {
            group: "email".to_owned(),
            action: Action::Send,
        },
        state: None,
    }]
}

#[tokio::test]
async fn only_a_persons_own_session_may_set_or_reset() {
    let fixture = fixture();
    let api_key = Caller {
        user: user(OWNER),
        credential: Credential::Other,
    };
    let agent = agent_caller(OWNER, BotId::TEST_A, None);

    for caller in [&api_key, &agent] {
        assert!(matches!(
            fixture
                .service
                .set(caller, BotId::TEST_A, never_send())
                .await,
            Err(PermissionError::NeedsPerson)
        ));
        assert!(matches!(
            fixture.service.reset(caller, BotId::TEST_A).await,
            Err(PermissionError::NeedsPerson)
        ));
    }

    let view = fixture
        .service
        .set(&person(OWNER), BotId::TEST_A, never_send())
        .await
        .unwrap();
    assert_eq!(view.restricted, 1);
    assert!(view.can_edit);
}

#[tokio::test]
async fn someone_who_may_not_edit_the_agent_is_refused() {
    let fixture = fixture();
    assert!(matches!(
        fixture
            .service
            .set(&person(TEAMMATE), BotId::TEST_A, never_send())
            .await,
        Err(PermissionError::Forbidden)
    ));
    assert!(matches!(
        fixture
            .service
            .view_agent(&person(TEAMMATE), BotId::TEST_A)
            .await,
        Err(PermissionError::Forbidden)
    ));
    assert!(matches!(
        fixture
            .service
            .view_agent(&person(OWNER), BotId::TEST_B)
            .await,
        Err(PermissionError::NotFound)
    ));
}

#[tokio::test]
async fn a_persona_writes_the_callers_own_settings() {
    let fixture = fixture();
    let view = fixture
        .service
        .set(&person(TEAMMATE), MACRO_NEW_BOT_ID, never_send())
        .await
        .unwrap();
    assert_eq!(view.kind, PolicyKind::Persona);
    assert_eq!(
        fixture
            .store
            .read(&Key::Persona(MACRO_NEW_BOT_ID, TEAMMATE.to_owned()))
            .len(),
        1
    );
    assert!(
        fixture
            .store
            .read(&Key::Persona(MACRO_NEW_BOT_ID, OWNER.to_owned()))
            .is_empty()
    );
}

#[tokio::test]
async fn an_agent_acting_for_someone_who_may_edit_it_tightens_the_saved_settings() {
    let fixture = fixture();
    let caller = agent_caller(OWNER, BotId::TEST_A, None);

    let tightened = fixture
        .service
        .tighten(&caller, BotId::TEST_A, never_send())
        .await
        .unwrap();

    assert_eq!(tightened.applied_to, AppliedTo::Agent);
    let saved = fixture.store.read(&Key::Agent(BotId::TEST_A));
    assert_eq!(saved.len(), 1);
    assert!(saved[0].via_agent);
    assert!(!tightened.permissions.can_edit);
    assert!(tightened.permissions.can_tighten);
}

#[tokio::test]
async fn an_agent_acting_for_someone_else_tightens_only_its_session() {
    let fixture = fixture();
    let caller = agent_caller(TEAMMATE, BotId::TEST_A, Some(AgentSessionId::TEST_A));

    let tightened = fixture
        .service
        .tighten(&caller, BotId::TEST_A, never_send())
        .await
        .unwrap();

    assert_eq!(tightened.applied_to, AppliedTo::Session);
    assert!(fixture.store.read(&Key::Agent(BotId::TEST_A)).is_empty());
    assert_eq!(
        fixture
            .store
            .read(&Key::Session(AgentSessionId::TEST_A))
            .len(),
        1
    );
    assert_eq!(tightened.permissions.restricted, 1);
    assert_eq!(
        tightened.permissions.session_rules.map(|rules| rules.len()),
        Some(1)
    );
}

#[tokio::test]
async fn an_agent_may_not_tighten_another_or_without_a_session_or_an_editor() {
    let fixture = fixture();

    // Another agent's id.
    let other = agent_caller(OWNER, BotId::TEST_B, Some(AgentSessionId::TEST_A));
    assert!(matches!(
        fixture
            .service
            .tighten(&other, BotId::TEST_A, never_send())
            .await,
        Err(PermissionError::Forbidden)
    ));

    // No session, and the person it acts for may not edit it.
    let no_session = agent_caller(TEAMMATE, BotId::TEST_A, None);
    assert!(matches!(
        fixture
            .service
            .tighten(&no_session, BotId::TEST_A, never_send())
            .await,
        Err(PermissionError::Forbidden)
    ));

    // A session that runs a different agent gives no overlay either.
    let wrong_session = agent_caller(TEAMMATE, BotId::TEST_A, Some(AgentSessionId::TEST_B));
    assert!(matches!(
        fixture
            .service
            .tighten(&wrong_session, BotId::TEST_A, never_send())
            .await,
        Err(PermissionError::Forbidden)
    ));
}

#[tokio::test]
async fn loosening_through_tighten_names_the_operations() {
    let fixture = fixture();
    fixture
        .service
        .set(&person(OWNER), BotId::TEST_A, never_send())
        .await
        .unwrap();

    let caller = agent_caller(OWNER, BotId::TEST_A, None);
    let Err(PermissionError::WouldLoosen(operations)) = fixture
        .service
        .tighten(&caller, BotId::TEST_A, allow_send())
        .await
    else {
        panic!("loosening was not refused");
    };
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].operation, "send_email");
    assert_eq!(fixture.store.read(&Key::Agent(BotId::TEST_A)).len(), 1);
}

#[tokio::test]
async fn a_tool_allowed_under_a_stricter_group_is_refused_not_ignored() {
    let other = fixture();
    let fixture = fixture();
    fixture
        .service
        .set(&person(OWNER), BotId::TEST_A, never_send())
        .await
        .unwrap();
    let allow_tool = vec![Change {
        target: Target::Tool {
            service: "email".to_owned(),
            operation: "send_email".to_owned(),
        },
        state: Some(PermissionState::Always),
    }];

    let caller = agent_caller(OWNER, BotId::TEST_A, None);
    let Err(PermissionError::WouldLoosen(operations)) = fixture
        .service
        .tighten(&caller, BotId::TEST_A, allow_tool.clone())
        .await
    else {
        panic!("an always under a never group was not refused");
    };
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].operation, "send_email");
    assert_eq!(operations[0].to, PermissionState::Always);

    // Where the tool is already always allowed, asking for always loosens
    // nothing and passes.
    assert!(
        other
            .service
            .tighten(&caller, BotId::TEST_A, allow_tool)
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn reset_clears_the_saved_settings_and_leaves_session_overlays() {
    let fixture = fixture();
    fixture
        .service
        .set(&person(OWNER), BotId::TEST_A, never_send())
        .await
        .unwrap();
    fixture
        .service
        .tighten(
            &agent_caller(TEAMMATE, BotId::TEST_A, Some(AgentSessionId::TEST_A)),
            BotId::TEST_A,
            vec![Change {
                target: Target::Tool {
                    service: "storage".to_owned(),
                    operation: "delete_document".to_owned(),
                },
                state: Some(PermissionState::Ask),
            }],
        )
        .await
        .unwrap();

    let view = fixture
        .service
        .reset(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();

    assert_eq!(view.restricted, 0);
    assert!(fixture.store.read(&Key::Agent(BotId::TEST_A)).is_empty());
    assert_eq!(
        fixture
            .store
            .read(&Key::Session(AgentSessionId::TEST_A))
            .len(),
        1
    );
}

#[tokio::test]
async fn with_the_rollout_off_everything_is_disabled() {
    let fixture = fixture_with(false);
    let caller = person(OWNER);
    assert!(matches!(
        fixture.service.catalog(&caller).await,
        Err(PermissionError::Disabled)
    ));
    assert!(matches!(
        fixture.service.view_agent(&caller, BotId::TEST_A).await,
        Err(PermissionError::Disabled)
    ));
    assert!(matches!(
        fixture
            .service
            .set(&caller, BotId::TEST_A, never_send())
            .await,
        Err(PermissionError::Disabled)
    ));
    assert!(matches!(
        fixture
            .service
            .tighten(&caller, BotId::TEST_A, never_send())
            .await,
        Err(PermissionError::Disabled)
    ));
    assert!(matches!(
        fixture.service.reset(&caller, BotId::TEST_A).await,
        Err(PermissionError::Disabled)
    ));
}

#[tokio::test]
async fn unknown_targets_and_empty_requests_are_refused() {
    let fixture = fixture();
    let caller = person(OWNER);
    assert!(matches!(
        fixture.service.set(&caller, BotId::TEST_A, vec![]).await,
        Err(PermissionError::Invalid(_))
    ));
    let unknown = vec![Change {
        target: Target::GroupAction {
            group: "payroll".to_owned(),
            action: Action::Read,
        },
        state: Some(PermissionState::Never),
    }];
    assert!(matches!(
        fixture.service.set(&caller, BotId::TEST_A, unknown).await,
        Err(PermissionError::UnknownTarget(targets)) if targets.len() == 1
    ));
}

#[tokio::test]
async fn a_session_shows_its_agents_settings_and_overlay_and_a_personas_owners() {
    let fixture = fixture();
    fixture
        .service
        .set(&person(OWNER), MACRO_NEW_BOT_ID, never_send())
        .await
        .unwrap();

    let persona_session = EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(TEAMMATE),
        &AgentSessionId::TEST_B.as_uuid().to_string(),
        EntityType::AgentSession,
    );
    let view = fixture
        .service
        .view_session(&person(TEAMMATE), &persona_session)
        .await
        .unwrap();
    // The owner's settings apply; the viewer can't change them from here.
    assert_eq!(view.kind, PolicyKind::Persona);
    assert_eq!(view.restricted, 1);
    assert!(!view.can_edit);
    assert_eq!(view.session_rules, Some(vec![]));

    let owner_view = fixture
        .service
        .view_session(&person(OWNER), &persona_session)
        .await
        .unwrap();
    assert!(owner_view.can_edit);
}

#[tokio::test]
async fn resolve_calls_reads_the_policy_and_overlay_and_refuses_unknown_operations() {
    let fixture = fixture();
    fixture
        .service
        .tighten(
            &agent_caller(TEAMMATE, BotId::TEST_A, Some(AgentSessionId::TEST_A)),
            BotId::TEST_A,
            never_send(),
        )
        .await
        .unwrap();

    let calls = fixture
        .service
        .resolve_calls(
            &SessionPolicy {
                agent: BotId::TEST_A,
                owner: user(TEAMMATE),
                session: AgentSessionId::TEST_A,
            },
            &[
                OperationKey {
                    service: "email".to_owned(),
                    operation: "send_email".to_owned(),
                },
                OperationKey {
                    service: "storage".to_owned(),
                    operation: "delete_document".to_owned(),
                },
                OperationKey {
                    service: "storage".to_owned(),
                    operation: "launch_rocket".to_owned(),
                },
            ],
        )
        .await
        .unwrap();

    let states: Vec<(PermissionState, Origin, bool)> = calls
        .iter()
        .map(|call| (call.state, call.origin, call.entry.is_some()))
        .collect();
    assert_eq!(
        states,
        [
            (PermissionState::Never, Origin::Session, true),
            (PermissionState::Always, Origin::Default, true),
            (PermissionState::Never, Origin::Default, false),
        ]
    );
}

#[tokio::test]
async fn tightening_never_stores_an_exemption_from_a_later_group_setting() {
    let fixture = fixture();
    let delete_document = Target::Tool {
        service: "storage".to_owned(),
        operation: "delete_document".to_owned(),
    };
    fixture
        .service
        .tighten(
            &agent_caller(OWNER, BotId::TEST_A, None),
            BotId::TEST_A,
            vec![Change {
                target: delete_document.clone(),
                state: Some(PermissionState::Always),
            }],
        )
        .await
        .unwrap();
    assert!(fixture.store.read(&Key::Agent(BotId::TEST_A)).is_empty());

    let view = fixture
        .service
        .set(
            &person(OWNER),
            BotId::TEST_A,
            vec![Change {
                target: Target::GroupAction {
                    group: "documents".to_owned(),
                    action: Action::Destroy,
                },
                state: Some(PermissionState::Never),
            }],
        )
        .await
        .unwrap();
    assert_eq!(view.restricted, 1);
}

#[tokio::test]
async fn the_saved_policy_cannot_loosen_behind_a_session_restriction() {
    let fixture = fixture();
    // The agent restricted its session while its person could not edit it.
    fixture
        .service
        .tighten(
            &agent_caller(TEAMMATE, BotId::TEST_A, Some(AgentSessionId::TEST_A)),
            BotId::TEST_A,
            never_send(),
        )
        .await
        .unwrap();
    fixture
        .service
        .set(&person(OWNER), BotId::TEST_A, never_send())
        .await
        .unwrap();

    // Acting for someone who may edit, in the same session, it may not
    // clear the saved `never` though the overlay still holds one.
    let result = fixture
        .service
        .tighten(
            &agent_caller(OWNER, BotId::TEST_A, Some(AgentSessionId::TEST_A)),
            BotId::TEST_A,
            allow_send(),
        )
        .await;
    assert!(matches!(result, Err(PermissionError::WouldLoosen(_))));
    assert_eq!(fixture.store.read(&Key::Agent(BotId::TEST_A)).len(), 1);
}

fn send_email() -> OperationKey {
    OperationKey {
        service: "email".to_owned(),
        operation: "send_email".to_owned(),
    }
}

fn owner_policy() -> SessionPolicy {
    SessionPolicy {
        agent: BotId::TEST_A,
        owner: user(OWNER),
        session: AgentSessionId::TEST_A,
    }
}

/// The agent pins a tool to ask; a person's later never on its group still
/// applies to it.
#[tokio::test]
async fn an_agents_tool_pin_never_exempts_it_from_a_later_never() {
    let fixture = fixture();
    let pin = vec![Change {
        target: Target::Tool {
            service: "email".to_owned(),
            operation: "send_email".to_owned(),
        },
        state: Some(PermissionState::Ask),
    }];
    fixture
        .service
        .tighten(
            &agent_caller(OWNER, BotId::TEST_A, None),
            BotId::TEST_A,
            pin,
        )
        .await
        .unwrap();
    let resolved = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(resolved[0].state, PermissionState::Ask);

    fixture
        .service
        .set(&person(OWNER), BotId::TEST_A, never_send())
        .await
        .unwrap();
    let resolved = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(
        (resolved[0].state, resolved[0].origin),
        (PermissionState::Never, Origin::GroupAction)
    );
}

/// An API key's tool pin only restricts too: a person's later never on its
/// group still applies, and it is not labelled as the agent's.
#[tokio::test]
async fn an_api_keys_tool_pin_never_exempts_it_from_a_later_never() {
    let fixture = fixture();
    let api_key = Caller {
        user: user(OWNER),
        credential: Credential::Other,
    };
    let pin = vec![Change {
        target: Target::Tool {
            service: "email".to_owned(),
            operation: "send_email".to_owned(),
        },
        state: Some(PermissionState::Ask),
    }];
    let tightened = fixture
        .service
        .tighten(&api_key, BotId::TEST_A, pin)
        .await
        .unwrap();
    assert_eq!(tightened.applied_to, AppliedTo::Agent);
    let saved = fixture.store.read(&Key::Agent(BotId::TEST_A));
    assert_eq!(
        saved
            .iter()
            .map(|rule| (rule.via_agent, rule.restriction_only))
            .collect::<Vec<_>>(),
        vec![(false, true)]
    );
    let resolved = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(resolved[0].state, PermissionState::Ask);

    fixture
        .service
        .set(&person(OWNER), BotId::TEST_A, never_send())
        .await
        .unwrap();
    let resolved = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(
        (resolved[0].state, resolved[0].origin),
        (PermissionState::Never, Origin::GroupAction)
    );
}

/// The agent's own tightening resolves always and no setting can name it,
/// so restricting itself is never gated.
#[tokio::test]
async fn self_restriction_is_always_allowed_and_cannot_be_set() {
    let fixture = fixture();
    let tighten = OperationKey {
        service: "agent-harness".to_owned(),
        operation: "tighten_agent_tool_permissions".to_owned(),
    };
    let resolved = fixture
        .service
        .resolve_calls(&owner_policy(), &[tighten])
        .await
        .unwrap();
    assert_eq!(
        (resolved[0].state, resolved[0].entry.is_some()),
        (PermissionState::Always, true)
    );

    let set = fixture
        .service
        .set(
            &person(OWNER),
            BotId::TEST_A,
            vec![Change {
                target: Target::Tool {
                    service: "agent-harness".to_owned(),
                    operation: "tighten_agent_tool_permissions".to_owned(),
                },
                state: Some(PermissionState::Never),
            }],
        )
        .await;
    assert!(matches!(set, Err(PermissionError::UnknownTarget(_))));
}

/// Every read, write, reset and gate of one policy uses one id, the view
/// reports it, and each owner (each person, for a persona) has its own.
#[tokio::test]
async fn a_policy_keeps_one_id_through_reads_writes_and_the_gate() {
    let fixture = fixture();
    let set = fixture
        .service
        .set(&person(OWNER), BotId::TEST_A, never_send())
        .await
        .unwrap();
    let viewed = fixture
        .service
        .view_agent(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();
    let reset = fixture
        .service
        .reset(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();
    fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();

    let id = fixture.store.policy(&Key::Agent(BotId::TEST_A)).unwrap();
    assert_eq!(
        (set.policy_id, viewed.policy_id, reset.policy_id),
        (id, id, id)
    );
    assert_eq!(fixture.store.policies.lock().unwrap().len(), EXISTING.len());

    let mine = fixture
        .service
        .view_agent(&person(OWNER), MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    let theirs = fixture
        .service
        .view_agent(&person(TEAMMATE), MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    assert_ne!(mine.policy_id, id);
    assert_ne!(mine.policy_id, theirs.policy_id);
}

/// A refused request creates no policy.
#[tokio::test]
async fn a_refused_request_creates_no_policy() {
    let fixture = fixture();
    for agent in [BotId::TEST_A, BotId::TEST_B] {
        assert!(
            fixture
                .service
                .view_agent(&person(TEAMMATE), agent)
                .await
                .is_err()
        );
        assert!(
            fixture
                .service
                .set(&person(TEAMMATE), agent, never_send())
                .await
                .is_err()
        );
        assert!(
            fixture
                .service
                .tighten(&person(TEAMMATE), agent, never_send())
                .await
                .is_err()
        );
        assert!(
            fixture
                .service
                .reset(&person(TEAMMATE), agent)
                .await
                .is_err()
        );
    }
    assert_eq!(fixture.store.policies.lock().unwrap().len(), EXISTING.len());
}

fn send_default(state: Option<PermissionState>) -> Change {
    Change {
        target: Target::Action {
            action: Action::Send,
        },
        state,
    }
}

fn email_send(state: Option<PermissionState>) -> Change {
    Change {
        target: Target::GroupAction {
            group: "email".to_owned(),
            action: Action::Send,
        },
        state,
    }
}

#[tokio::test]
async fn a_person_sets_a_default_and_an_explicit_allow_exception() {
    let fixture = fixture();
    let view = fixture
        .service
        .set(
            &person(OWNER),
            BotId::TEST_A,
            vec![
                send_default(Some(PermissionState::Ask)),
                email_send(Some(PermissionState::Always)),
            ],
        )
        .await
        .unwrap();
    // The Allow is kept: Email follows it, not the Ask default.
    assert_eq!(view.rules.len(), 2);
    let send = view
        .defaults
        .iter()
        .find(|default| default.action == Action::Send)
        .unwrap();
    assert_eq!(
        (send.state, send.origin),
        (PermissionState::Ask, Origin::Action)
    );
    let email = view
        .groups
        .iter()
        .find(|group| group.group == "email")
        .unwrap();
    assert_eq!(
        (
            email.actions[0].state,
            email.actions[0].origin,
            email.actions[0].exception
        ),
        (PermissionState::Always, Origin::GroupAction, true)
    );
    let gate = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(gate[0].state, PermissionState::Always);

    // Allow on the default deletes its row; null on the exception removes it,
    // so Email follows the default, now always again.
    let view = fixture
        .service
        .set(
            &person(OWNER),
            BotId::TEST_A,
            vec![
                send_default(Some(PermissionState::Always)),
                email_send(None),
            ],
        )
        .await
        .unwrap();
    assert!(view.rules.is_empty());
    assert_eq!(view.restricted, 0);
}

#[tokio::test]
async fn an_agent_tightens_a_default_but_may_not_lower_or_remove_one() {
    let fixture = fixture();
    let caller = agent_caller(OWNER, BotId::TEST_A, None);
    let tightened = fixture
        .service
        .tighten(
            &caller,
            BotId::TEST_A,
            vec![send_default(Some(PermissionState::Never))],
        )
        .await
        .unwrap();
    assert_eq!(tightened.applied_to, AppliedTo::Agent);
    assert_eq!(tightened.permissions.restricted, 1);

    for state in [
        None,
        Some(PermissionState::Ask),
        Some(PermissionState::Always),
    ] {
        let refused = fixture
            .service
            .tighten(&caller, BotId::TEST_A, vec![send_default(state)])
            .await;
        let Err(PermissionError::WouldLoosen(operations)) = refused else {
            panic!("lowering the Send default to {state:?} was not refused");
        };
        assert_eq!(operations[0].operation, "send_email");
    }
    // An Allow exception under the Never default loosens Email · Send.
    assert!(matches!(
        fixture
            .service
            .tighten(
                &caller,
                BotId::TEST_A,
                vec![email_send(Some(PermissionState::Always))]
            )
            .await,
        Err(PermissionError::WouldLoosen(_))
    ));
}

#[tokio::test]
async fn an_agent_in_someone_elses_session_restricts_a_default_for_that_session() {
    let fixture = fixture();
    let caller = agent_caller(TEAMMATE, BotId::TEST_A, Some(AgentSessionId::TEST_A));
    let tightened = fixture
        .service
        .tighten(
            &caller,
            BotId::TEST_A,
            vec![send_default(Some(PermissionState::Ask))],
        )
        .await
        .unwrap();
    assert_eq!(tightened.applied_to, AppliedTo::Session);
    assert!(fixture.store.read(&Key::Agent(BotId::TEST_A)).is_empty());
    let send = tightened
        .permissions
        .defaults
        .iter()
        .find(|default| default.action == Action::Send)
        .unwrap();
    assert_eq!(
        (send.state, send.origin),
        (PermissionState::Ask, Origin::Session)
    );
    let gate = fixture
        .service
        .resolve_calls(
            &SessionPolicy {
                agent: BotId::TEST_A,
                owner: user(TEAMMATE),
                session: AgentSessionId::TEST_A,
            },
            &[send_email()],
        )
        .await
        .unwrap();
    assert_eq!(
        (gate[0].state, gate[0].origin),
        (PermissionState::Ask, Origin::Session)
    );
}

/// `BotId::TEST_A`'s policy made to follow the owner's own Macro policy, as
/// a source change would leave it.
async fn follow_owners_macro(fixture: &Fixture) -> PolicyId {
    let follower = fixture
        .store
        .ensure_policy(&PolicyOwner::Agent(BotId::TEST_A))
        .await
        .unwrap();
    let source = fixture
        .store
        .ensure_policy(&PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OWNER),
        })
        .await
        .unwrap();
    let owner = user(OWNER);
    fixture
        .store
        .set_source(
            SourceWrite {
                policy: follower,
                by: &owner,
            },
            source,
        )
        .await
        .unwrap()
        .unwrap();
    source
}

#[tokio::test]
async fn a_follower_resolves_through_its_source_live() {
    let fixture = fixture();
    follow_owners_macro(&fixture).await;
    let before = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(
        (before[0].state, before[0].origin),
        (PermissionState::Always, Origin::Source)
    );

    // The owner changes their own Macro settings: the follower's next call
    // takes them, and its view says the same.
    fixture
        .service
        .set(&person(OWNER), MACRO_NEW_BOT_ID, never_send())
        .await
        .unwrap();
    let after = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(
        (after[0].state, after[0].origin),
        (PermissionState::Never, Origin::Source)
    );
    let view = fixture
        .service
        .view_agent(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();
    let email = view
        .groups
        .iter()
        .find(|group| group.group == "email")
        .unwrap();
    assert_eq!(
        (email.actions[0].state, email.actions[0].origin),
        (PermissionState::Never, Origin::Source)
    );
    assert!(view.rules.is_empty());
}

#[tokio::test]
async fn an_agent_tightens_a_follower_but_cannot_loosen_its_source() {
    let fixture = fixture();
    follow_owners_macro(&fixture).await;
    fixture
        .service
        .set(&person(OWNER), MACRO_NEW_BOT_ID, never_send())
        .await
        .unwrap();
    let agent = agent_caller(OWNER, BotId::TEST_A, None);
    // Asking for always on what the source sets to never is refused.
    let loosen = vec![Change {
        target: Target::Tool {
            service: "email".to_owned(),
            operation: "send_email".to_owned(),
        },
        state: Some(PermissionState::Always),
    }];
    assert!(matches!(
        fixture.service.tighten(&agent, BotId::TEST_A, loosen).await,
        Err(PermissionError::WouldLoosen(_))
    ));
    // A stricter local default is saved on the follower, not the source.
    let stricter = vec![Change {
        target: Target::Action {
            action: Action::Destroy,
        },
        state: Some(PermissionState::Ask),
    }];
    let tightened = fixture
        .service
        .tighten(&agent, BotId::TEST_A, stricter)
        .await
        .unwrap();
    assert_eq!(tightened.applied_to, AppliedTo::Agent);
    assert_eq!(tightened.permissions.rules.len(), 1);
    let resolved = fixture
        .service
        .resolve_calls(
            &owner_policy(),
            &[OperationKey {
                service: "storage".to_owned(),
                operation: "delete_document".to_owned(),
            }],
        )
        .await
        .unwrap();
    assert_eq!(
        (resolved[0].state, resolved[0].origin),
        (PermissionState::Ask, Origin::Action)
    );
    assert_eq!(
        fixture
            .store
            .read(&Key::Persona(MACRO_NEW_BOT_ID, OWNER.to_owned()))
            .len(),
        1
    );
}

async fn policy_of(fixture: &Fixture, owner: PolicyOwner) -> PolicyId {
    fixture.store.ensure_policy(&owner).await.unwrap()
}

async fn owners_macro(fixture: &Fixture) -> PolicyId {
    policy_of(
        fixture,
        PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OWNER),
        },
    )
    .await
}

fn send_email_tool(state: Option<PermissionState>) -> Change {
    Change {
        target: Target::Tool {
            service: "email".to_owned(),
            operation: "send_email".to_owned(),
        },
        state,
    }
}

#[tokio::test]
async fn only_a_person_who_may_edit_the_agent_sets_or_clears_a_source() {
    let fixture = fixture();
    let source = owners_macro(&fixture).await;
    for caller in [
        agent_caller(OWNER, BotId::TEST_A, Some(AgentSessionId::TEST_A)),
        Caller {
            user: user(OWNER),
            credential: Credential::Other,
        },
    ] {
        assert!(matches!(
            fixture
                .service
                .set_source(&caller, BotId::TEST_A, source)
                .await,
            Err(PermissionError::NeedsPerson)
        ));
        assert!(matches!(
            fixture.service.detach(&caller, BotId::TEST_A, None).await,
            Err(PermissionError::NeedsPerson)
        ));
    }
    assert!(matches!(
        fixture
            .service
            .set_source(&person(TEAMMATE), BotId::TEST_A, source)
            .await,
        Err(PermissionError::Forbidden)
    ));
    assert!(matches!(
        fixture
            .service
            .set_source(&person(OWNER), BotId::TEST_B, source)
            .await,
        Err(PermissionError::NotFound)
    ));
    // A persona's policy is a root.
    assert!(matches!(
        fixture
            .service
            .set_source(&person(OWNER), MACRO_NEW_BOT_ID, source)
            .await,
        Err(PermissionError::SourceNotAllowed)
    ));

    let view = fixture
        .service
        .set_source(&person(OWNER), BotId::TEST_A, source)
        .await
        .unwrap();
    assert!(view.can_set_source);
    let followed = view.source.unwrap();
    assert_eq!(followed.policy_id, Some(source));
    assert_eq!(followed.kind, Some(PolicyKind::Persona));
    assert_eq!(followed.status, SourceStatus::Live);
    assert_eq!(followed.scope, Some(SourceScope::Personal));
    assert!(followed.in_scope && followed.can_edit);
    assert_eq!(
        followed.agent.unwrap().handle.as_deref(),
        Some(bot_id::MACRO_AI_HANDLE)
    );
    assert_eq!(view.inherited, Some(Vec::new()));

    let detached = fixture
        .service
        .detach(&person(OWNER), BotId::TEST_A, None)
        .await
        .unwrap();
    assert!(detached.source.is_none() && detached.inherited.is_none());
}

#[tokio::test]
async fn scope_rules_for_private_and_team_agents() {
    let fixture = fixture();
    let agent = |bot| policy_of(&fixture, PolicyOwner::Agent(bot));
    let theirs_macro = policy_of(
        &fixture,
        PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(TEAMMATE),
        },
    )
    .await;
    let other_persona = policy_of(
        &fixture,
        PolicyOwner::Persona {
            persona: BotId::TEST_B,
            user: user(OWNER),
        },
    )
    .await;
    let mine = owners_macro(&fixture).await;
    let (scout, gone, theirs) = (agent(SCOUT).await, agent(GONE).await, agent(THEIRS).await);
    let (team_two, other_teams) = (agent(TEAM_TWO).await, agent(OTHER_TEAMS).await);

    // A private agent: its owner's Macro, their agents, their teams' agents.
    for (source, allowed) in [
        (mine, true),
        (scout, true),
        (team_two, true),
        (theirs_macro, false),
        (other_persona, false),
        (theirs, false),
        (other_teams, false),
        (gone, false),
    ] {
        let set = fixture
            .service
            .set_source(&person(OWNER), BotId::TEST_A, source)
            .await;
        assert_eq!(set.is_ok(), allowed, "{source} {set:?}");
        if !allowed {
            assert!(matches!(set, Err(PermissionError::SourceNotAllowed)));
        }
    }
    // A team's agent: its team's agents only.
    for (source, allowed) in [
        (team_two, true),
        (mine, false),
        (scout, false),
        (other_teams, false),
    ] {
        let set = fixture
            .service
            .set_source(&person(OWNER), TEAM_ONE, source)
            .await;
        assert_eq!(set.is_ok(), allowed, "{source} {set:?}");
    }
    assert!(matches!(
        fixture
            .service
            .set_source(&person(OWNER), BotId::TEST_A, PolicyId::generate())
            .await,
        Err(PermissionError::NotFound)
    ));
}

#[tokio::test]
async fn a_person_cannot_set_a_follower_looser_than_its_source() {
    let fixture = fixture();
    let source = owners_macro(&fixture).await;
    fixture
        .service
        .set(&person(OWNER), MACRO_NEW_BOT_ID, never_send())
        .await
        .unwrap();
    fixture
        .service
        .set_source(&person(OWNER), BotId::TEST_A, source)
        .await
        .unwrap();

    let refused = fixture
        .service
        .set(
            &person(OWNER),
            BotId::TEST_A,
            vec![send_email_tool(Some(PermissionState::Always))],
        )
        .await;
    match refused {
        Err(PermissionError::FollowsSource {
            operations,
            followed,
        }) => {
            assert_eq!(followed, Some(source));
            assert_eq!(operations[0].operation, "send_email");
            assert_eq!(
                (operations[0].from, operations[0].to),
                (PermissionState::Never, PermissionState::Always)
            );
        }
        other => panic!("{other:?}"),
    }
    // A stricter local setting is kept, and the stricter state applies.
    let stricter = fixture
        .service
        .set(
            &person(OWNER),
            BotId::TEST_A,
            vec![Change {
                target: Target::Action {
                    action: Action::Destroy,
                },
                state: Some(PermissionState::Ask),
            }],
        )
        .await
        .unwrap();
    assert_eq!(stricter.rules.len(), 1);
    let resolved = fixture
        .service
        .resolve_calls(
            &owner_policy(),
            &[
                send_email(),
                OperationKey {
                    service: "storage".to_owned(),
                    operation: "delete_document".to_owned(),
                },
            ],
        )
        .await
        .unwrap();
    assert_eq!(
        resolved
            .iter()
            .map(|call| (call.state, call.origin))
            .collect::<Vec<_>>(),
        [
            (PermissionState::Never, Origin::Source),
            (PermissionState::Ask, Origin::Action)
        ]
    );

    // Reset drops the local rows and keeps following.
    let reset = fixture
        .service
        .reset(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();
    assert!(reset.rules.is_empty());
    assert_eq!(reset.source.unwrap().policy_id, Some(source));

    // Raising it takes a detach, then an edit, here in one transaction.
    let detached = fixture
        .service
        .detach(
            &person(OWNER),
            BotId::TEST_A,
            Some(vec![send_email_tool(Some(PermissionState::Always))]),
        )
        .await
        .unwrap();
    assert!(detached.source.is_none());
    let resolved = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(
        (resolved[0].state, resolved[0].origin),
        (PermissionState::Always, Origin::Tool)
    );
    // The snapshot kept the source's exception as the agent's own.
    assert!(detached.rules.iter().any(|rule| rule.target
        == Target::GroupAction {
            group: "email".to_owned(),
            action: Action::Send,
        }
        && rule.state == PermissionState::Never));
}

#[tokio::test]
async fn set_source_drops_person_rows_and_keeps_restrictions() {
    let fixture = fixture();
    fixture
        .service
        .set(&person(OWNER), BotId::TEST_A, never_send())
        .await
        .unwrap();
    fixture
        .service
        .tighten(
            &agent_caller(OWNER, BotId::TEST_A, None),
            BotId::TEST_A,
            vec![Change {
                target: Target::Tool {
                    service: "storage".to_owned(),
                    operation: "delete_document".to_owned(),
                },
                state: Some(PermissionState::Ask),
            }],
        )
        .await
        .unwrap();
    let source = owners_macro(&fixture).await;
    let view = fixture
        .service
        .set_source(&person(OWNER), BotId::TEST_A, source)
        .await
        .unwrap();
    assert_eq!(view.rules.len(), 1);
    assert!(view.rules[0].via_agent);
}

#[tokio::test]
async fn following_grants_no_authority_over_the_source() {
    let fixture = fixture();
    let team_two = policy_of(&fixture, PolicyOwner::Agent(TEAM_TWO)).await;
    fixture
        .service
        .set_source(&person(OWNER), BotId::TEST_A, team_two)
        .await
        .unwrap();
    // The owner leaves the team: the reference stays (nothing loosens), but
    // they can't edit the source and the page asks them to pick again.
    fixture
        .service
        .agents
        .members
        .lock()
        .unwrap()
        .retain(|(team, member)| !(*team == TEAM && member == OWNER));
    let view = fixture
        .service
        .view_agent(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();
    let followed = view.source.unwrap();
    assert_eq!(followed.policy_id, Some(team_two));
    assert!(!followed.can_edit && !followed.in_scope);
    assert_eq!(
        followed.scope,
        Some(SourceScope::Team {
            team_id: TEAM,
            team_name: Some("Team".to_owned()),
        })
    );
    for refused in [
        fixture
            .service
            .set(&person(OWNER), TEAM_TWO, never_send())
            .await
            .map(|_| ()),
        fixture
            .service
            .reset(&person(OWNER), TEAM_TWO)
            .await
            .map(|_| ()),
    ] {
        assert!(matches!(refused, Err(PermissionError::Forbidden)));
    }
    assert!(matches!(
        fixture.service.view_policy(&person(OWNER), team_two).await,
        Err(PermissionError::NotFound)
    ));
    assert!(matches!(
        fixture
            .service
            .set_source(&person(OWNER), SCOUT, team_two)
            .await,
        Err(PermissionError::SourceNotAllowed)
    ));
}

#[tokio::test]
async fn a_deleted_source_stays_frozen_and_a_lost_one_asks() {
    let fixture = fixture();
    let gone = policy_of(&fixture, PolicyOwner::Agent(GONE)).await;
    let follower = policy_of(&fixture, PolicyOwner::Agent(BotId::TEST_A)).await;
    let owner = user(OWNER);
    // Followed before it was deleted.
    fixture
        .store
        .set_source(
            SourceWrite {
                policy: follower,
                by: &owner,
            },
            gone,
        )
        .await
        .unwrap()
        .unwrap();
    let view = fixture
        .service
        .view_agent(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();
    let followed = view.source.unwrap();
    assert_eq!(followed.status, SourceStatus::Deleted);
    assert!(!followed.can_edit);
    assert_eq!(followed.agent.unwrap().name, "Gone");

    // Lost: its source went for good.
    if let Some((_, follows)) = fixture.store.owners.lock().unwrap().get_mut(&follower) {
        *follows = Follows::Lost;
    }
    let view = fixture
        .service
        .view_agent(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();
    let lost = view.source.unwrap();
    assert_eq!((lost.status, lost.policy_id), (SourceStatus::Lost, None));
    assert!(
        view.defaults
            .iter()
            .all(|default| default.state == PermissionState::Ask)
    );
}

#[tokio::test]
async fn the_picker_lists_macro_then_agents_and_says_why_one_cant_be_picked() {
    let fixture = fixture();
    let mine = owners_macro(&fixture).await;
    let scout = policy_of(&fixture, PolicyOwner::Agent(SCOUT)).await;
    let analyst = policy_of(&fixture, PolicyOwner::Agent(BotId::TEST_A)).await;
    // Scout follows Analyst, so Analyst can't follow Scout.
    fixture
        .service
        .set_source(&person(OWNER), SCOUT, analyst)
        .await
        .unwrap();
    fixture
        .service
        .set_source(&person(OWNER), BotId::TEST_A, mine)
        .await
        .unwrap();

    let listed = fixture
        .service
        .source_candidates(&person(OWNER), CandidatesFor::Agent(BotId::TEST_A))
        .await
        .unwrap()
        .candidates;
    let summary: Vec<_> = listed
        .iter()
        .map(|candidate| {
            (
                candidate.agent.as_ref().map_or(
                    candidate
                        .team
                        .as_ref()
                        .map_or("", |team| team.name.as_str()),
                    |agent| agent.name.as_str(),
                ),
                candidate.current,
                candidate.unavailable,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            ("Macro", true, None),
            ("Team", false, None),
            ("Scout", false, Some(SourceUnavailable::Cycle)),
            ("One", false, None),
            ("Two", false, None),
            ("Newbie", false, None),
            ("New team agent", false, None),
        ]
    );
    assert_eq!(listed[2].policy_id, scout);

    // A new team agent: that team's default, then its agents, no personal
    // Macro.
    let team = fixture
        .service
        .source_candidates(&person(OWNER), CandidatesFor::Team(TEAM))
        .await
        .unwrap()
        .candidates;
    assert_eq!(
        team.iter()
            .map(|candidate| {
                candidate.agent.as_ref().map_or(
                    candidate
                        .team
                        .as_ref()
                        .map_or("", |team| team.name.as_str()),
                    |agent| agent.name.as_str(),
                )
            })
            .collect::<Vec<_>>(),
        ["Team", "One", "Two", "New team agent"]
    );
    assert!(matches!(
        fixture
            .service
            .source_candidates(&person(TEAMMATE), CandidatesFor::Agent(BotId::TEST_A))
            .await,
        Err(PermissionError::Forbidden)
    ));
}

#[tokio::test]
async fn a_chain_too_long_is_marked_in_the_picker() {
    let fixture = fixture();
    let owner = user(OWNER);
    let follow = |follower: PolicyId, source: PolicyId| {
        let store = Arc::clone(&fixture.store);
        let owner = owner.clone();
        async move {
            store
                .set_source(
                    SourceWrite {
                        policy: follower,
                        by: &owner,
                    },
                    source,
                )
                .await
                .unwrap()
                .unwrap();
        }
    };
    // Two ← One ← Scout ← Macro: Two's chain holds four policies.
    let mut previous = owners_macro(&fixture).await;
    for bot in [SCOUT, TEAM_ONE, TEAM_TWO] {
        let policy = policy_of(&fixture, PolicyOwner::Agent(bot)).await;
        follow(policy, previous).await;
        previous = policy;
    }
    // Analyst has a follower, so its own chain would hold one more.
    let analyst = policy_of(&fixture, PolicyOwner::Agent(BotId::TEST_A)).await;
    let theirs = policy_of(&fixture, PolicyOwner::Agent(THEIRS)).await;
    follow(theirs, analyst).await;

    let listed = fixture
        .service
        .source_candidates(&person(OWNER), CandidatesFor::Agent(BotId::TEST_A))
        .await
        .unwrap()
        .candidates;
    let unavailable = |bot: BotId| {
        listed
            .iter()
            .find(|candidate| {
                candidate
                    .agent
                    .as_ref()
                    .is_some_and(|agent| agent.id == bot)
            })
            .unwrap()
            .unavailable
    };
    assert_eq!(unavailable(TEAM_ONE), None);
    assert_eq!(unavailable(TEAM_TWO), Some(SourceUnavailable::TooDeep));
    assert!(matches!(
        fixture
            .service
            .set_source(&person(OWNER), BotId::TEST_A, previous)
            .await,
        Err(PermissionError::SourceTooDeep)
    ));
}

#[tokio::test]
async fn a_policy_is_read_by_id_only_by_who_may_read_it() {
    let fixture = fixture();
    let mine = owners_macro(&fixture).await;
    let scout = policy_of(&fixture, PolicyOwner::Agent(SCOUT)).await;
    let view = fixture
        .service
        .view_policy(&person(OWNER), mine)
        .await
        .unwrap();
    assert_eq!(
        (view.policy_id, view.kind, view.agent_id),
        (mine, PolicyKind::Persona, MACRO_NEW_BOT_ID)
    );
    assert_eq!(
        fixture
            .service
            .view_policy(&person(OWNER), scout)
            .await
            .unwrap()
            .agent_id,
        SCOUT
    );
    for (caller, policy) in [(TEAMMATE, mine), (TEAMMATE, scout)] {
        assert!(matches!(
            fixture.service.view_policy(&person(caller), policy).await,
            Err(PermissionError::NotFound)
        ));
    }
    assert!(matches!(
        fixture
            .service
            .view_policy(&person(OWNER), PolicyId::generate())
            .await,
        Err(PermissionError::NotFound)
    ));
}

#[tokio::test]
async fn new_agents_follow_their_scope_default_and_existing_agents_keep_their_own() {
    let fixture = fixture();
    let mine = owners_macro(&fixture).await;
    let team = policy_of(&fixture, PolicyOwner::Team(TEAM)).await;
    // Listing the new agents as candidates first makes their policies, as
    // their first use would.
    fixture
        .service
        .source_candidates(&person(OWNER), CandidatesFor::Private)
        .await
        .unwrap();

    // A new private agent follows its owner's own Macro, live.
    let view = fixture
        .service
        .view_agent(&person(OWNER), NEW_PRIVATE)
        .await
        .unwrap();
    let followed = view.source.unwrap();
    assert_eq!(
        (followed.policy_id, followed.kind),
        (Some(mine), Some(PolicyKind::Persona))
    );
    fixture
        .service
        .set(&person(OWNER), MACRO_NEW_BOT_ID, never_send())
        .await
        .unwrap();
    let resolved = fixture
        .service
        .resolve_calls(
            &SessionPolicy {
                agent: NEW_PRIVATE,
                owner: user(OWNER),
                session: AgentSessionId::TEST_A,
            },
            &[send_email()],
        )
        .await
        .unwrap();
    assert_eq!(
        (resolved[0].state, resolved[0].origin),
        (PermissionState::Never, Origin::Source)
    );

    // A new team agent follows its team's default.
    let view = fixture
        .service
        .view_agent(&person(TEAMMATE), NEW_TEAM)
        .await
        .unwrap();
    let followed = view.source.unwrap();
    assert_eq!(
        (followed.policy_id, followed.kind),
        (Some(team), Some(PolicyKind::Team))
    );
    assert_eq!(followed.team.unwrap().name, "Team");
    assert_eq!(
        followed.scope,
        Some(SourceScope::Team {
            team_id: TEAM,
            team_name: Some("Team".to_owned()),
        })
    );
    assert!(followed.in_scope);
    // A member reads it but may not edit it.
    assert!(!followed.can_edit);

    // An agent that existed before keeps its own settings.
    let existing = fixture
        .service
        .view_agent(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();
    assert!(existing.source.is_none());
    let resolved = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(resolved[0].state, PermissionState::Always);
}

#[tokio::test]
async fn team_default_is_edited_by_admins_and_read_by_members() {
    let fixture = fixture();
    // The owner is TEAM's admin; the teammate a member.
    let set = fixture
        .service
        .set_team(&person(OWNER), TEAM, never_send())
        .await
        .unwrap();
    assert!(set.can_edit);
    assert_eq!((set.team_id, set.kind), (TEAM, PolicyKind::Team));
    assert_eq!(set.rules.len(), 1);

    let read = fixture
        .service
        .view_team(&person(TEAMMATE), TEAM)
        .await
        .unwrap();
    assert!(!read.can_edit);
    assert_eq!(read.policy_id, set.policy_id);
    for refused in [
        fixture
            .service
            .set_team(&person(TEAMMATE), TEAM, never_send())
            .await,
        fixture.service.reset_team(&person(TEAMMATE), TEAM).await,
    ] {
        assert!(matches!(refused, Err(PermissionError::Forbidden)));
    }
    // Not a member: nothing to see.
    assert!(matches!(
        fixture.service.view_team(&person(OWNER), OTHER_TEAM).await,
        Err(PermissionError::NotFound)
    ));
    // An admin's agent or API key may not change it.
    for credential in [
        Credential::Agent {
            agent: TEAM_ONE,
            session: None,
        },
        Credential::Other,
    ] {
        let caller = Caller {
            user: user(OWNER),
            credential,
        };
        assert!(matches!(
            fixture.service.set_team(&caller, TEAM, never_send()).await,
            Err(PermissionError::NeedsPerson)
        ));
        assert!(
            !fixture
                .service
                .view_team(&caller, TEAM)
                .await
                .unwrap()
                .can_edit
        );
    }

    // The team's agents that follow it take the change on their next call.
    fixture
        .service
        .view_agent(&person(TEAMMATE), NEW_TEAM)
        .await
        .unwrap();
    let resolved = fixture
        .service
        .resolve_calls(
            &SessionPolicy {
                agent: NEW_TEAM,
                owner: user(TEAMMATE),
                session: AgentSessionId::TEST_A,
            },
            &[send_email()],
        )
        .await
        .unwrap();
    assert_eq!(resolved[0].state, PermissionState::Never);

    let reset = fixture
        .service
        .reset_team(&person(OWNER), TEAM)
        .await
        .unwrap();
    assert!(reset.rules.is_empty());
    // Read by id too, by members only.
    assert_eq!(
        fixture
            .service
            .view_policy(&person(TEAMMATE), set.policy_id)
            .await
            .unwrap()
            .kind,
        PolicyKind::Team
    );
    assert!(matches!(
        fixture
            .service
            .view_policy(
                &Caller {
                    user: user("macro|stranger@example.com"),
                    credential: Credential::PersonSession,
                },
                set.policy_id
            )
            .await,
        Err(PermissionError::NotFound)
    ));

    let off = fixture_with(false);
    assert!(matches!(
        off.service.view_team(&person(OWNER), TEAM).await,
        Err(PermissionError::Disabled)
    ));
}

#[tokio::test]
async fn team_defaults_follow_the_scope_rules() {
    let fixture = fixture();
    let team = policy_of(&fixture, PolicyOwner::Team(TEAM)).await;
    let other_team = policy_of(&fixture, PolicyOwner::Team(OTHER_TEAM)).await;
    // A private agent may follow the default of a team its owner belongs to.
    for (agent, source, allowed) in [
        (BotId::TEST_A, team, true),
        (BotId::TEST_A, other_team, false),
        // A team agent its own team's only.
        (TEAM_ONE, team, true),
        (TEAM_ONE, other_team, false),
    ] {
        let set = fixture
            .service
            .set_source(&person(OWNER), agent, source)
            .await;
        assert_eq!(set.is_ok(), allowed, "{agent} {source} {set:?}");
    }
    // The owner, TEAM's admin, may edit the default an agent follows.
    let view = fixture
        .service
        .view_agent(&person(OWNER), TEAM_ONE)
        .await
        .unwrap();
    assert!(view.source.unwrap().can_edit);
}

#[tokio::test]
async fn a_sources_restrictions_on_itself_stay_its_own() {
    let fixture = fixture();
    follow_owners_macro(&fixture).await;
    // Macro, in the owner's own session, restricts itself: saved to the
    // owner's Macro policy, labelled as the agent's.
    let macro_in_session = agent_caller(OWNER, MACRO_NEW_BOT_ID, Some(AgentSessionId::TEST_B));
    let tightened = fixture
        .service
        .tighten(&macro_in_session, MACRO_NEW_BOT_ID, never_send())
        .await
        .unwrap();
    assert_eq!(tightened.applied_to, AppliedTo::Agent);
    let macro_resolved = fixture
        .service
        .resolve_calls(
            &SessionPolicy {
                agent: MACRO_NEW_BOT_ID,
                owner: user(OWNER),
                session: AgentSessionId::TEST_B,
            },
            &[send_email()],
        )
        .await
        .unwrap();
    assert_eq!(macro_resolved[0].state, PermissionState::Never);

    // The agent following Macro is not restricted by it, in the gate, the
    // view or what a detach copies.
    let follower = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(follower[0].state, PermissionState::Always);
    let view = fixture
        .service
        .view_agent(&person(OWNER), BotId::TEST_A)
        .await
        .unwrap();
    assert!(view.inherited.unwrap().is_empty());
    let detached = fixture
        .service
        .detach(&person(OWNER), BotId::TEST_A, None)
        .await
        .unwrap();
    assert!(detached.rules.is_empty());

    // A person's Never on Macro does reach it.
    follow_owners_macro(&fixture).await;
    fixture
        .service
        .set(&person(OWNER), MACRO_NEW_BOT_ID, never_send())
        .await
        .unwrap();
    let follower = fixture
        .service
        .resolve_calls(&owner_policy(), &[send_email()])
        .await
        .unwrap();
    assert_eq!(follower[0].state, PermissionState::Never);
}

#[tokio::test]
async fn a_follower_may_drop_its_own_exception_its_source_holds_too() {
    let fixture = fixture();
    follow_owners_macro(&fixture).await;
    fixture
        .service
        .set(&person(OWNER), MACRO_NEW_BOT_ID, never_send())
        .await
        .unwrap();
    let agent = agent_caller(OWNER, BotId::TEST_A, None);
    fixture
        .service
        .tighten(&agent, BotId::TEST_A, never_send())
        .await
        .unwrap();
    // Dropping its own Never leaves the source's Never: nothing loosens.
    let drop = vec![Change {
        target: Target::GroupAction {
            group: "email".to_owned(),
            action: Action::Send,
        },
        state: None,
    }];
    let tightened = fixture
        .service
        .tighten(&agent, BotId::TEST_A, drop)
        .await
        .unwrap();
    assert!(tightened.permissions.rules.is_empty());
}
