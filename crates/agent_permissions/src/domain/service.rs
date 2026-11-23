//! Who may read, change, tighten and reset an agent's permissions, and the
//! resolution a run's gate asks for.
//!
//! - Reading: whoever may edit the agent, anyone for their own settings for a
//!   built-in persona, and the agent itself.
//! - Setting and reset: whoever may edit the agent, from their own session in
//!   Macro. An agent's credential, an API key or an SDK token is refused.
//! - Tightening: anyone who may read, as long as no operation becomes more
//!   permissive. It is saved to the agent when the person behind the request
//!   may edit it, else (an agent acting in a session) to that session only.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_fold::domain::log::AgentSessionId;
use async_trait::async_trait;
use bot_id::BotId;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;

use super::model::{
    AgentAccess, AgentFacts, AgentOwner, AgentScope, AppliedTo, Caller, CandidatesFor, Catalog,
    Change, Credential, MAX_CHAIN, OperationKey, Origin, PermissionError, PermissionState,
    PermissionsView, PolicyChain, PolicyId, PolicyKind, PolicyOwner, PolicySource, ResolvedCall,
    Rule, SessionFacts, SessionPolicy, SetBy, SourceAgent, SourceCandidate, SourceCandidates,
    SourceScope, SourceStatus, SourceUnavailable, SourceVia, Tightened, ToolPermissionCatalog,
};
use super::ports::{
    AgentDirectory, PermissionStore, PermissionsRollout, SessionDirectory, SourceWrite, Write,
    WriteTo,
};
use super::resolve::{self, Resolver, ViewAccess};

/// The most changes one request may make: more than one group's custom view
/// holds.
pub const MAX_CHANGES: usize = 200;

/// The most agents the source picker lists.
pub const MAX_CANDIDATES: usize = 100;

/// Agent permissions, as the HTTP API and a run's gate use them.
///
/// `async_trait` because the harness holds it as `Arc<dyn AgentPermissions>`.
#[async_trait]
pub trait AgentPermissions: Send + Sync + 'static {
    /// Every group, action and operation a permission can name.
    async fn catalog(&self, caller: &Caller) -> Result<ToolPermissionCatalog, PermissionError>;

    /// `agent`'s permissions as they apply to the caller.
    async fn view_agent(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<PermissionsView, PermissionError>;

    /// The permissions that apply in a session the caller may view: its
    /// agent's (for a built-in persona, its owner's) plus the session's
    /// overlay.
    async fn view_session(
        &self,
        caller: &Caller,
        session: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<PermissionsView, PermissionError>;

    /// Change `agent`'s saved permissions in any direction. A person's own
    /// session only.
    async fn set(
        &self,
        caller: &Caller,
        agent: BotId,
        changes: Vec<Change>,
    ) -> Result<PermissionsView, PermissionError>;

    /// Make `agent`'s permissions stricter; refused when any operation would
    /// become more permissive.
    async fn tighten(
        &self,
        caller: &Caller,
        agent: BotId,
        changes: Vec<Change>,
    ) -> Result<Tightened, PermissionError>;

    /// Delete every saved setting, so everything is always allowed again
    /// (session overlays stay). A person's own session only.
    async fn reset(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<PermissionsView, PermissionError>;

    /// Make `agent` follow the policy `source`: its source's settings apply
    /// on its next call, and its own rows only restrict them. A person who
    /// may edit the agent, from their own session; the source must be in
    /// the agent's scope. Following grants no authority over the source.
    async fn set_source(
        &self,
        caller: &Caller,
        agent: BotId,
        source: PolicyId,
    ) -> Result<PermissionsView, PermissionError>;

    /// Make `agent` own its settings again: they become a snapshot of what
    /// it resolves to now (session overlays and approvals aside), with
    /// `changes` applied on top, in one transaction. Same caller rule as
    /// [`AgentPermissions::set_source`].
    async fn detach(
        &self,
        caller: &Caller,
        agent: BotId,
        changes: Option<Vec<Change>>,
    ) -> Result<PermissionsView, PermissionError>;

    /// The sources the picker offers, for an agent (annotated with why one
    /// can't be picked) or a scope a new agent will have.
    async fn source_candidates(
        &self,
        caller: &Caller,
        of: CandidatesFor,
    ) -> Result<SourceCandidates, PermissionError>;

    /// A policy the caller may read, by id: their own Macro policy, or an
    /// agent's they may edit. The preview of a source before the agent that
    /// will follow it exists.
    async fn view_policy(
        &self,
        caller: &Caller,
        policy: PolicyId,
    ) -> Result<PermissionsView, PermissionError>;

    /// What a session's permissions say about each of `calls`. An operation
    /// the registry does not know is `never`. Does not check the rollout:
    /// the caller decides whether permissions apply to the run.
    async fn resolve_calls(
        &self,
        policy: &SessionPolicy,
        calls: &[OperationKey],
    ) -> Result<Vec<ResolvedCall>, PermissionError>;
}

/// [`AgentPermissions`] over its ports.
pub struct AgentPermissionsService<Store, Agents, Sessions, Rollout> {
    store: Store,
    agents: Agents,
    sessions: Sessions,
    rollout: Rollout,
    catalog: Arc<Catalog>,
    catalog_view: ToolPermissionCatalog,
}

impl<Store, Agents, Sessions, Rollout> AgentPermissionsService<Store, Agents, Sessions, Rollout> {
    /// Build the service.
    pub fn new(
        store: Store,
        agents: Agents,
        sessions: Sessions,
        rollout: Rollout,
        catalog: Arc<Catalog>,
    ) -> Self {
        let catalog_view = resolve::catalog_view(&catalog);
        Self {
            store,
            agents,
            sessions,
            rollout,
            catalog,
            catalog_view,
        }
    }
}

/// Whether `agent` is a built-in persona: a first-party bot that opens
/// sessions, with no `bots` row to hang settings on.
fn is_persona(agent: BotId) -> bool {
    bot_id::system_bot(agent).is_some_and(|bot| bot.has_agent)
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> PermissionError {
    PermissionError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// The session an agent caller acts in, verified to run `agent`.
type AgentContext = (AgentSessionId, SessionFacts);

/// Who may tighten `owner`'s policy for `agent`: the person behind the
/// request saves it when they may edit the policy; an agent acting in a
/// session it runs restricts that session; anyone else may not.
fn tighten_destination(
    caller: &Caller,
    agent: BotId,
    access: AgentAccess,
    owner: &PolicyOwner,
    context: Option<&AgentContext>,
) -> Option<WriteTo> {
    if let Credential::Agent { agent: acting, .. } = &caller.credential
        && *acting != agent
    {
        return None;
    }

    let person_may_edit = match (access, owner) {
        (AgentAccess::Manageable, _) => true,
        (AgentAccess::Persona, PolicyOwner::Persona { user, .. }) => *user == caller.user,
        _ => false,
    };
    if person_may_edit {
        return Some(WriteTo::Saved);
    }

    context.map(|(session, _)| WriteTo::Session(*session))
}

fn view_access(
    caller: &Caller,
    agent: BotId,
    access: AgentAccess,
    owner: &PolicyOwner,
    context: Option<&AgentContext>,
) -> ViewAccess {
    let person = caller.credential == Credential::PersonSession;
    let may_edit = match (access, owner) {
        (AgentAccess::Manageable, _) => true,
        (AgentAccess::Persona, PolicyOwner::Persona { user, .. }) => *user == caller.user,
        _ => false,
    };
    ViewAccess {
        can_edit: person && may_edit,
        can_tighten: tighten_destination(caller, agent, access, owner, context).is_some(),
    }
}

/// A built-in persona as a source: Macro, reached as `@macro`.
fn persona_agent(persona: BotId) -> SourceAgent {
    let system = bot_id::system_bot(persona);
    SourceAgent {
        id: persona,
        name: system.map_or_else(|| "Macro".to_owned(), |bot| bot.name.to_owned()),
        handle: system.map(|bot| bot_id::mention_handle(persona, bot.handle).to_owned()),
        avatar_url: None,
        deleted: false,
    }
}

fn agent_source(facts: &AgentFacts) -> SourceAgent {
    SourceAgent {
        id: facts.id,
        name: facts.name.clone(),
        handle: facts.handle.clone(),
        avatar_url: facts.avatar_url.clone(),
        deleted: facts.deleted,
    }
}

fn owner_scope(owner: &AgentOwner) -> SourceScope {
    match owner {
        AgentOwner::User(_) => SourceScope::Personal,
        AgentOwner::Team(team) => SourceScope::Team { team_id: *team },
    }
}

fn validate(catalog: &Catalog, changes: &[Change]) -> Result<(), PermissionError> {
    if changes.is_empty() || changes.len() > MAX_CHANGES {
        return Err(PermissionError::Invalid(format!(
            "send between 1 and {MAX_CHANGES} changes"
        )));
    }
    let unknown = resolve::unknown_targets(catalog, changes);
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(PermissionError::UnknownTarget(unknown))
    }
}

impl<Store, Agents, Sessions, Rollout> AgentPermissionsService<Store, Agents, Sessions, Rollout>
where
    Store: PermissionStore,
    Agents: AgentDirectory,
    Sessions: SessionDirectory,
    Rollout: PermissionsRollout,
{
    async fn ensure_enabled(&self, caller: &Caller) -> Result<(), PermissionError> {
        if self.rollout.enabled(&caller.user).await {
            Ok(())
        } else {
            Err(PermissionError::Disabled)
        }
    }

    async fn access(
        &self,
        user: &MacroUserIdStr<'static>,
        agent: BotId,
    ) -> Result<AgentAccess, PermissionError> {
        if is_persona(agent) {
            return Ok(AgentAccess::Persona);
        }
        self.agents.access(user, agent).await.map_err(internal)
    }

    /// The session an agent caller acts in, when its credential carries one
    /// that runs `agent`.
    async fn agent_context(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<Option<AgentContext>, PermissionError> {
        let Credential::Agent {
            agent: acting,
            session: Some(session),
        } = &caller.credential
        else {
            return Ok(None);
        };
        if *acting != agent {
            return Ok(None);
        }

        let facts = self.sessions.facts(*session).await.map_err(internal)?;
        Ok(facts
            .filter(|facts| facts.agent == agent)
            .map(|facts| (*session, facts)))
    }

    async fn session_rules(
        &self,
        context: Option<&AgentContext>,
    ) -> Result<Option<Vec<Rule>>, PermissionError> {
        match context {
            Some((session, _)) => self
                .store
                .session_rules(*session)
                .await
                .map(Some)
                .map_err(internal),
            None => Ok(None),
        }
    }

    /// The policy `caller` reads or tightens for `agent`: a persona's is the
    /// session owner's when an agent acts in a session, else the caller's.
    fn owner(
        caller: &Caller,
        agent: BotId,
        access: AgentAccess,
        context: Option<&AgentContext>,
    ) -> (PolicyOwner, PolicyKind) {
        match access {
            AgentAccess::Persona => {
                let user = context
                    .map(|(_, facts)| facts.owner.clone())
                    .unwrap_or_else(|| caller.user.clone());
                (
                    PolicyOwner::Persona {
                        persona: agent,
                        user,
                    },
                    PolicyKind::Persona,
                )
            }
            AgentAccess::Manageable | AgentAccess::NotManageable | AgentAccess::NotFound => {
                (PolicyOwner::Agent(agent), PolicyKind::Agent)
            }
        }
    }

    /// The policy a person changes or resets, after checking they may.
    async fn editable_owner(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<(PolicyOwner, PolicyKind, AgentAccess), PermissionError> {
        if caller.credential != Credential::PersonSession {
            return Err(PermissionError::NeedsPerson);
        }
        let access = self.access(&caller.user, agent).await?;
        match access {
            AgentAccess::NotFound => Err(PermissionError::NotFound),
            AgentAccess::NotManageable => Err(PermissionError::Forbidden),
            AgentAccess::Manageable | AgentAccess::Persona => {
                let (owner, kind) = Self::owner(caller, agent, access, None);
                Ok((owner, kind, access))
            }
        }
    }

    /// The id of `owner`'s policy, created when it has none yet.
    async fn policy_id(&self, owner: &PolicyOwner) -> Result<PolicyId, PermissionError> {
        self.store.ensure_policy(owner).await.map_err(internal)
    }

    async fn build_view(
        &self,
        caller: &Caller,
        agent: BotId,
        access: AgentAccess,
        (policy, owner, kind): (PolicyId, PolicyOwner, PolicyKind),
        context: Option<&AgentContext>,
        overlay: Option<Vec<Rule>>,
    ) -> Result<PermissionsView, PermissionError> {
        let chain = self
            .store
            .chain(policy)
            .await
            .map_err(internal)?
            .ok_or(PermissionError::NotFound)?;
        let mut view = resolve::view(
            &self.catalog,
            agent,
            kind,
            view_access(caller, agent, access, &owner, context),
            &chain,
            overlay,
        );
        view.can_set_source = caller.credential == Credential::PersonSession
            && access == AgentAccess::Manageable
            && kind == PolicyKind::Agent;
        if chain.follows() {
            view.source = Some(self.source_view(caller, agent, &chain).await?);
            view.inherited = Some(resolve::materialize(
                &self.catalog,
                &chain.with_rules(Vec::new()),
            ));
        }
        Ok(view)
    }

    async fn facts(&self, agent: BotId) -> Result<Option<AgentFacts>, PermissionError> {
        self.agents.facts(agent).await.map_err(internal)
    }

    /// A source policy's agent (for a persona, the persona), whose it is,
    /// and its facts when it is an agent's.
    async fn source_identity(
        &self,
        owner: &PolicyOwner,
    ) -> Result<Option<(SourceAgent, SourceScope, PolicyKind, Option<AgentFacts>)>, PermissionError>
    {
        match owner {
            PolicyOwner::Persona { persona, .. } => Ok(Some((
                persona_agent(*persona),
                SourceScope::Personal,
                PolicyKind::Persona,
                None,
            ))),
            PolicyOwner::Agent(bot) => Ok(self.facts(*bot).await?.map(|facts| {
                (
                    agent_source(&facts),
                    owner_scope(&facts.owner),
                    PolicyKind::Agent,
                    Some(facts),
                )
            })),
        }
    }

    /// Whether an agent owned by `follower` may follow `source` (section
    /// 4.8): a private agent its owner's Macro, their private agents and
    /// their teams' agents; a team agent its team's agents. Never a persona
    /// other than Macro, nor a person's policy for a team agent.
    async fn in_scope(
        &self,
        follower: &AgentOwner,
        source: &PolicyOwner,
        source_facts: Option<&AgentFacts>,
    ) -> Result<bool, PermissionError> {
        match (follower, source) {
            (AgentOwner::User(owner), PolicyOwner::Persona { persona, user }) => {
                Ok(*persona == bot_id::MACRO_NEW_BOT_ID && user == owner)
            }
            (AgentOwner::Team(_), PolicyOwner::Persona { .. }) => Ok(false),
            (_, PolicyOwner::Agent(bot)) => {
                let Some(facts) = source_facts else {
                    return Ok(false);
                };
                Ok(match (follower, &facts.owner) {
                    (AgentOwner::User(owner), AgentOwner::User(source_owner)) => {
                        owner == source_owner
                    }
                    // A team's agent is in the person's scope when they are
                    // its member: whoever may edit it.
                    (AgentOwner::User(owner), AgentOwner::Team(_)) => {
                        self.agents.access(owner, *bot).await.map_err(internal)?
                            == AgentAccess::Manageable
                    }
                    (AgentOwner::Team(team), AgentOwner::Team(source_team)) => team == source_team,
                    (AgentOwner::Team(_), AgentOwner::User(_)) => false,
                })
            }
        }
    }

    /// The source a following `chain` shows: who it is, whether it still
    /// applies as itself and is in scope, the caller's own authority over
    /// it, and the rest of the chain.
    async fn source_view(
        &self,
        caller: &Caller,
        agent: BotId,
        chain: &PolicyChain,
    ) -> Result<PolicySource, PermissionError> {
        let Some(source) = chain.source() else {
            return Ok(PolicySource {
                policy_id: None,
                kind: None,
                agent: None,
                scope: None,
                status: SourceStatus::Lost,
                in_scope: false,
                can_edit: false,
                via: Vec::new(),
            });
        };
        let identity = self.source_identity(&source.owner).await?;
        let follower = self.facts(agent).await?;
        let in_scope = match &follower {
            Some(follower) => {
                let facts = identity
                    .as_ref()
                    .and_then(|(_, _, _, facts)| facts.as_ref());
                self.in_scope(&follower.owner, &source.owner, facts).await?
            }
            None => false,
        };
        let person = caller.credential == Credential::PersonSession;
        let can_edit = person
            && match &source.owner {
                PolicyOwner::Persona { user, .. } => *user == caller.user,
                PolicyOwner::Agent(bot) => {
                    self.access(&caller.user, *bot).await? == AgentAccess::Manageable
                }
            };
        let mut via = Vec::new();
        for level in chain.sources().iter().skip(1) {
            if let Some((agent, ..)) = self.source_identity(&level.owner).await? {
                via.push(SourceVia {
                    name: agent.name,
                    handle: agent.handle,
                });
            }
        }
        let deleted = identity.as_ref().is_none_or(|(agent, ..)| agent.deleted);
        Ok(match identity {
            Some((agent, scope, kind, _)) => PolicySource {
                policy_id: Some(source.id),
                kind: Some(kind),
                agent: Some(agent),
                scope: Some(scope),
                status: if deleted {
                    SourceStatus::Deleted
                } else {
                    SourceStatus::Live
                },
                in_scope,
                can_edit: can_edit && !deleted,
                via,
            },
            // The agents directory no longer knows it (its row went with
            // its team): it applies frozen.
            None => PolicySource {
                policy_id: Some(source.id),
                kind: Some(PolicyKind::Agent),
                agent: None,
                scope: None,
                status: SourceStatus::Deleted,
                in_scope: false,
                can_edit: false,
                via,
            },
        })
    }

    /// The agent a person sets the source of or detaches: an owned agent
    /// they may edit, from their own session.
    async fn followable_agent(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<(PolicyId, AgentAccess), PermissionError> {
        let (owner, kind, access) = self.editable_owner(caller, agent).await?;
        if kind != PolicyKind::Agent {
            // A persona's policy is a root: it never follows.
            return Err(PermissionError::SourceNotAllowed);
        }
        Ok((self.policy_id(&owner).await?, access))
    }

    async fn agent_view(
        &self,
        caller: &Caller,
        agent: BotId,
        access: AgentAccess,
        policy: PolicyId,
    ) -> Result<PermissionsView, PermissionError> {
        self.build_view(
            caller,
            agent,
            access,
            (policy, PolicyOwner::Agent(agent), PolicyKind::Agent),
            None,
            None,
        )
        .await
    }
}

#[async_trait]
impl<Store, Agents, Sessions, Rollout> AgentPermissions
    for AgentPermissionsService<Store, Agents, Sessions, Rollout>
where
    Store: PermissionStore,
    Agents: AgentDirectory,
    Sessions: SessionDirectory,
    Rollout: PermissionsRollout,
{
    async fn catalog(&self, caller: &Caller) -> Result<ToolPermissionCatalog, PermissionError> {
        self.ensure_enabled(caller).await?;
        Ok(self.catalog_view.clone())
    }

    #[tracing::instrument(name = "agent_permissions.view_agent", skip_all, fields(agent_id = %agent), err(level = "warn"))]
    async fn view_agent(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<PermissionsView, PermissionError> {
        self.ensure_enabled(caller).await?;
        let is_this_agent = match &caller.credential {
            Credential::Agent { agent: acting, .. } if *acting != agent => {
                return Err(PermissionError::Forbidden);
            }
            Credential::Agent { .. } => true,
            Credential::PersonSession | Credential::Other => false,
        };
        let access = self.access(&caller.user, agent).await?;
        if access == AgentAccess::NotFound {
            return Err(PermissionError::NotFound);
        }
        if access == AgentAccess::NotManageable && !is_this_agent {
            return Err(PermissionError::Forbidden);
        }

        let context = self.agent_context(caller, agent).await?;
        let overlay = self.session_rules(context.as_ref()).await?;
        let (owner, kind) = Self::owner(caller, agent, access, context.as_ref());
        let policy = self.policy_id(&owner).await?;
        self.build_view(
            caller,
            agent,
            access,
            (policy, owner, kind),
            context.as_ref(),
            overlay,
        )
        .await
    }

    #[tracing::instrument(
        name = "agent_permissions.view_session",
        skip_all,
        fields(agent_session_id = tracing::field::Empty),
        err(level = "warn")
    )]
    async fn view_session(
        &self,
        caller: &Caller,
        session: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<PermissionsView, PermissionError> {
        self.ensure_enabled(caller).await?;
        if session.entity().entity_type != EntityType::AgentSession {
            return Err(PermissionError::Forbidden);
        }
        let session_id: AgentSessionId = session
            .entity()
            .entity_id
            .parse()
            .map_err(|_| PermissionError::NotFound)?;
        tracing::Span::current().record(
            "agent_session_id",
            tracing::field::display(session_id.as_uuid()),
        );

        let facts = self
            .sessions
            .facts(session_id)
            .await
            .map_err(internal)?
            .ok_or(PermissionError::NotFound)?;
        let agent = facts.agent;
        let access = self.access(&caller.user, agent).await?;
        if access == AgentAccess::NotFound {
            return Err(PermissionError::NotFound);
        }

        // The settings that apply in the session: for a persona, its owner's.
        let (owner, kind) = match access {
            AgentAccess::Persona => (
                PolicyOwner::Persona {
                    persona: agent,
                    user: facts.owner.clone(),
                },
                PolicyKind::Persona,
            ),
            AgentAccess::Manageable | AgentAccess::NotManageable | AgentAccess::NotFound => {
                (PolicyOwner::Agent(agent), PolicyKind::Agent)
            }
        };
        let overlay = self
            .store
            .session_rules(session_id)
            .await
            .map_err(internal)?;
        // An agent acting in another session of the same agent tightens that
        // one, not this.
        let context = self
            .agent_context(caller, agent)
            .await?
            .filter(|(acting_in, _)| *acting_in == session_id);
        let policy = self.policy_id(&owner).await?;
        self.build_view(
            caller,
            agent,
            access,
            (policy, owner, kind),
            context.as_ref(),
            Some(overlay),
        )
        .await
    }

    #[tracing::instrument(
        name = "agent_permissions.set",
        skip_all,
        fields(agent_id = %agent, changes = changes.len()),
        err(level = "warn")
    )]
    async fn set(
        &self,
        caller: &Caller,
        agent: BotId,
        changes: Vec<Change>,
    ) -> Result<PermissionsView, PermissionError> {
        self.ensure_enabled(caller).await?;
        validate(&self.catalog, &changes)?;
        let (owner, kind, access) = self.editable_owner(caller, agent).await?;
        let policy = self.policy_id(&owner).await?;

        let write = Write {
            policy,
            session: None,
            to: WriteTo::Saved,
            by: &caller.user,
            set_by: SetBy::Person,
        };
        let catalog = &self.catalog;
        self.store
            .write(write, |chain, _| {
                let changes = resolve::normalize(changes, false);
                // A follower's rows only restrict its source's: one looser
                // than the source would be saved and do nothing.
                resolve::below_source(catalog, chain, &changes).map_err(|operations| {
                    PermissionError::FollowsSource {
                        operations,
                        followed: chain.source().map(|source| source.id),
                    }
                })?;
                Ok(changes)
            })
            .await
            .map_err(internal)??;
        self.build_view(caller, agent, access, (policy, owner, kind), None, None)
            .await
    }

    #[tracing::instrument(
        name = "agent_permissions.tighten",
        skip_all,
        fields(agent_id = %agent, changes = changes.len(), applied_to = tracing::field::Empty),
        err(level = "warn")
    )]
    async fn tighten(
        &self,
        caller: &Caller,
        agent: BotId,
        changes: Vec<Change>,
    ) -> Result<Tightened, PermissionError> {
        self.ensure_enabled(caller).await?;
        validate(&self.catalog, &changes)?;
        if let Credential::Agent { agent: acting, .. } = &caller.credential
            && *acting != agent
        {
            return Err(PermissionError::Forbidden);
        }
        let access = self.access(&caller.user, agent).await?;
        if access == AgentAccess::NotFound {
            return Err(PermissionError::NotFound);
        }

        let context = self.agent_context(caller, agent).await?;
        let (owner, kind) = Self::owner(caller, agent, access, context.as_ref());
        let to = tighten_destination(caller, agent, access, &owner, context.as_ref())
            .ok_or(PermissionError::Forbidden)?;
        let policy = self.policy_id(&owner).await?;

        // A tightening never stores `always`, so an `always` is saved as
        // clearing its setting, and settings not made by a signed-in person
        // only add to what they sit under (a tool to its group's action, an
        // exception to the default). A state the agent asks for that is
        // looser than its target's now (an `always` under a stricter group,
        // removing a default) is refused rather than quietly saved as a
        // no-op. The checks run on the rules as they stand under the store's
        // lock, so a concurrent change can't slip between the check and the
        // write.
        let requested = changes.clone();
        let changes = resolve::normalize(changes, true);
        let set_by = SetBy::of(&caller.credential);
        let catalog = &self.catalog;
        let write = Write {
            policy,
            session: context.as_ref().map(|(session, _)| *session),
            to,
            by: &caller.user,
            set_by,
        };
        self.store
            .write(write, |chain, overlay| {
                // The saved policy applies to every session, so it must not
                // loosen whatever this session's overlay holds. A follower's
                // rows sit on its chain, so both compare what the chain
                // resolves to.
                let saved = chain.rules();
                let (before_overlay, after_saved, after_overlay) = match to {
                    WriteTo::Saved => {
                        (&[][..], resolve::apply(saved, &changes, set_by), Vec::new())
                    }
                    WriteTo::Session(_) => (
                        overlay,
                        saved.to_vec(),
                        resolve::apply(overlay, &changes, set_by),
                    ),
                };
                let before = Resolver::new(chain, before_overlay);
                let after = Resolver::with_rules(chain, &after_saved, &after_overlay);
                resolve::asks_looser(catalog, &before, &requested)
                    .and_then(|()| resolve::tighten_only(catalog, &before, &after))
                    .map_err(PermissionError::WouldLoosen)?;
                Ok(changes)
            })
            .await
            .map_err(internal)??;
        let applied_to = match to {
            WriteTo::Saved => AppliedTo::Agent,
            WriteTo::Session(_) => AppliedTo::Session,
        };
        tracing::Span::current().record("applied_to", tracing::field::debug(applied_to));

        let overlay = self.session_rules(context.as_ref()).await?;
        let permissions = self
            .build_view(
                caller,
                agent,
                access,
                (policy, owner, kind),
                context.as_ref(),
                overlay,
            )
            .await?;
        Ok(Tightened {
            applied_to,
            permissions,
        })
    }

    #[tracing::instrument(name = "agent_permissions.reset", skip_all, fields(agent_id = %agent), err(level = "warn"))]
    async fn reset(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<PermissionsView, PermissionError> {
        self.ensure_enabled(caller).await?;
        let (owner, kind, access) = self.editable_owner(caller, agent).await?;
        let policy = self.policy_id(&owner).await?;
        self.store.reset(policy).await.map_err(internal)?;
        self.build_view(caller, agent, access, (policy, owner, kind), None, None)
            .await
    }

    #[tracing::instrument(
        name = "agent_permissions.set_source",
        skip_all,
        fields(
            agent_id = %agent,
            source_policy_id = %source,
            policy_id = tracing::field::Empty,
            chain_len = tracing::field::Empty,
        ),
        err(level = "warn")
    )]
    async fn set_source(
        &self,
        caller: &Caller,
        agent: BotId,
        source: PolicyId,
    ) -> Result<PermissionsView, PermissionError> {
        self.ensure_enabled(caller).await?;
        let (owner, kind, access) = self.editable_owner(caller, agent).await?;
        if kind != PolicyKind::Agent {
            return Err(PermissionError::SourceNotAllowed);
        }
        let follower = self.facts(agent).await?.ok_or(PermissionError::NotFound)?;
        let source_chain = self
            .store
            .chain(source)
            .await
            .map_err(internal)?
            .ok_or(PermissionError::NotFound)?;
        let source_owner = &source_chain.policy().owner;
        let source_facts = match source_owner {
            PolicyOwner::Agent(bot) => {
                let facts = self.facts(*bot).await?.ok_or(PermissionError::NotFound)?;
                // A deleted agent's policy stays followed where it was, but
                // nobody newly follows it.
                if facts.deleted {
                    return Err(PermissionError::SourceNotAllowed);
                }
                Some(facts)
            }
            PolicyOwner::Persona { .. } => None,
        };
        if !self
            .in_scope(&follower.owner, source_owner, source_facts.as_ref())
            .await?
        {
            return Err(PermissionError::SourceNotAllowed);
        }

        let policy = self.policy_id(&owner).await?;
        let span = tracing::Span::current();
        span.record("policy_id", tracing::field::display(policy));
        span.record("chain_len", source_chain.depth() + 1);
        self.store
            .set_source(
                SourceWrite {
                    policy,
                    by: &caller.user,
                },
                source,
            )
            .await
            .map_err(internal)??;
        self.agent_view(caller, agent, access, policy).await
    }

    #[tracing::instrument(
        name = "agent_permissions.detach",
        skip_all,
        fields(
            agent_id = %agent,
            changes = changes.as_ref().map_or(0, Vec::len),
            policy_id = tracing::field::Empty,
            source_policy_id = tracing::field::Empty,
            chain_len = tracing::field::Empty,
            rules_written = tracing::field::Empty,
        ),
        err(level = "warn")
    )]
    async fn detach(
        &self,
        caller: &Caller,
        agent: BotId,
        changes: Option<Vec<Change>>,
    ) -> Result<PermissionsView, PermissionError> {
        self.ensure_enabled(caller).await?;
        if let Some(changes) = &changes {
            validate(&self.catalog, changes)?;
        }
        let (policy, access) = self.followable_agent(caller, agent).await?;
        let span = tracing::Span::current();
        span.record("policy_id", tracing::field::display(policy));

        let changes = resolve::normalize(changes.unwrap_or_default(), false);
        let catalog = &self.catalog;
        let written = self
            .store
            .detach(
                SourceWrite {
                    policy,
                    by: &caller.user,
                },
                |chain| {
                    span.record("chain_len", chain.depth());
                    if let Some(source) = chain.source() {
                        span.record("source_policy_id", tracing::field::display(source.id));
                    }
                    // A policy that owns its settings keeps them as they are;
                    // a follower takes the snapshot of what it resolves to.
                    let base = if chain.follows() {
                        resolve::materialize(catalog, chain)
                    } else {
                        chain.rules().to_vec()
                    };
                    Ok(resolve::apply(&base, &changes, SetBy::Person))
                },
            )
            .await
            .map_err(internal)??;
        span.record("rules_written", written);
        self.agent_view(caller, agent, access, policy).await
    }

    #[tracing::instrument(
        name = "agent_permissions.source_candidates",
        skip_all,
        fields(candidates = tracing::field::Empty),
        err(level = "warn")
    )]
    async fn source_candidates(
        &self,
        caller: &Caller,
        of: CandidatesFor,
    ) -> Result<SourceCandidates, PermissionError> {
        self.ensure_enabled(caller).await?;
        // For an existing agent: its scope, its policy, how tall its
        // follower tree is and what it follows now.
        let (scope, follower) = match of {
            CandidatesFor::Agent(agent) => {
                match self.access(&caller.user, agent).await? {
                    AgentAccess::Manageable => {}
                    AgentAccess::Persona => return Err(PermissionError::SourceNotAllowed),
                    AgentAccess::NotFound => return Err(PermissionError::NotFound),
                    AgentAccess::NotManageable => return Err(PermissionError::Forbidden),
                }
                let facts = self.facts(agent).await?.ok_or(PermissionError::NotFound)?;
                let scope = match facts.owner {
                    AgentOwner::User(user) => AgentScope::Private(user),
                    AgentOwner::Team(team) => AgentScope::Team(team),
                };
                let policy = self.policy_id(&PolicyOwner::Agent(agent)).await?;
                let height = self
                    .store
                    .followers_height(policy)
                    .await
                    .map_err(internal)?;
                let current = self
                    .store
                    .chain(policy)
                    .await
                    .map_err(internal)?
                    .and_then(|chain| chain.source().map(|source| source.id));
                (scope, Some((agent, policy, height, current)))
            }
            CandidatesFor::Private => (AgentScope::Private(caller.user.clone()), None),
            CandidatesFor::Team(team) => (AgentScope::Team(team), None),
        };

        let mut candidates = Vec::new();
        if let AgentScope::Private(user) = &scope {
            let persona = bot_id::MACRO_NEW_BOT_ID;
            let policy = self
                .policy_id(&PolicyOwner::Persona {
                    persona,
                    user: user.clone(),
                })
                .await?;
            candidates.push(SourceCandidate {
                policy_id: policy,
                kind: PolicyKind::Persona,
                agent: persona_agent(persona),
                scope: SourceScope::Personal,
                current: false,
                unavailable: None,
            });
        }
        let mut agents: Vec<AgentFacts> = self
            .agents
            .source_candidates(&caller.user, &scope)
            .await
            .map_err(internal)?
            .into_iter()
            .filter(|facts| !facts.deleted && follower.is_none_or(|(agent, ..)| agent != facts.id))
            .collect();
        agents.truncate(MAX_CANDIDATES);
        let ids: Vec<BotId> = agents.iter().map(|facts| facts.id).collect();
        let policies = self
            .store
            .ensure_agent_policies(&ids)
            .await
            .map_err(internal)?;
        for (facts, policy) in agents.iter().zip(policies) {
            candidates.push(SourceCandidate {
                policy_id: policy,
                kind: PolicyKind::Agent,
                agent: agent_source(facts),
                scope: owner_scope(&facts.owner),
                current: false,
                unavailable: None,
            });
        }

        if let Some((_, policy, height, current)) = follower {
            for candidate in &mut candidates {
                candidate.current = current == Some(candidate.policy_id);
                let Some(chain) = self
                    .store
                    .chain(candidate.policy_id)
                    .await
                    .map_err(internal)?
                else {
                    continue;
                };
                candidate.unavailable = if chain.levels().any(|level| level.id == policy) {
                    Some(SourceUnavailable::Cycle)
                } else if height + chain.depth() > MAX_CHAIN {
                    Some(SourceUnavailable::TooDeep)
                } else {
                    None
                };
            }
        }
        tracing::Span::current().record("candidates", candidates.len());
        Ok(SourceCandidates { candidates })
    }

    #[tracing::instrument(
        name = "agent_permissions.view_policy",
        skip_all,
        fields(policy_id = %policy),
        err(level = "warn")
    )]
    async fn view_policy(
        &self,
        caller: &Caller,
        policy: PolicyId,
    ) -> Result<PermissionsView, PermissionError> {
        self.ensure_enabled(caller).await?;
        let chain = self
            .store
            .chain(policy)
            .await
            .map_err(internal)?
            .ok_or(PermissionError::NotFound)?;
        // Another person's or an unreadable agent's policy is not found, so
        // an id says nothing about whose it is.
        let owner = chain.policy().owner.clone();
        let (agent, kind, access) = match &owner {
            PolicyOwner::Persona { persona, user } if *user == caller.user => {
                (*persona, PolicyKind::Persona, AgentAccess::Persona)
            }
            PolicyOwner::Persona { .. } => return Err(PermissionError::NotFound),
            PolicyOwner::Agent(bot) => match self.access(&caller.user, *bot).await? {
                AgentAccess::Manageable => (*bot, PolicyKind::Agent, AgentAccess::Manageable),
                AgentAccess::NotManageable | AgentAccess::NotFound | AgentAccess::Persona => {
                    return Err(PermissionError::NotFound);
                }
            },
        };
        self.build_view(caller, agent, access, (policy, owner, kind), None, None)
            .await
    }

    #[tracing::instrument(
        name = "agent_permissions.resolve_calls",
        skip_all,
        fields(
            agent_id = %policy.agent,
            agent_session_id = %policy.session.as_uuid(),
            operations = calls.len(),
            policy_id = tracing::field::Empty,
            chain_len = tracing::field::Empty,
            source_policy_id = tracing::field::Empty,
        ),
        err
    )]
    async fn resolve_calls(
        &self,
        policy: &SessionPolicy,
        calls: &[OperationKey],
    ) -> Result<Vec<ResolvedCall>, PermissionError> {
        let owner = if is_persona(policy.agent) {
            PolicyOwner::Persona {
                persona: policy.agent,
                user: policy.owner.clone(),
            }
        } else {
            PolicyOwner::Agent(policy.agent)
        };
        // Its own statement, before the snapshot, so the snapshot stays read
        // only.
        let policy_id = self.policy_id(&owner).await?;
        let span = tracing::Span::current();
        span.record("policy_id", tracing::field::display(policy_id));
        // One snapshot: a gate must never combine layers no single
        // committed state held, such as the saved rules from before a
        // person's Never with the overlay from after the agent dropped its
        // own, or a source's rules from before its change with a follower's
        // from after it. A chain that is too long or a cycle (only
        // hand-edited data can make one) fails here, and the run is refused.
        let (chain, overlay) = self
            .store
            .chain_with_session(policy_id, policy.session)
            .await
            .map_err(internal)?
            .ok_or_else(|| {
                PermissionError::Internal(
                    rootcause::report!("a policy vanished after it was ensured").into_dynamic(),
                )
            })?;
        span.record("chain_len", chain.depth());
        if let Some(source) = chain.source() {
            span.record("source_policy_id", tracing::field::display(source.id));
        }
        let resolver = Resolver::new(&chain, &overlay);

        Ok(calls
            .iter()
            .map(|key| {
                if let Some(entry) = self.catalog.always_allowed(&key.service, &key.operation) {
                    return ResolvedCall {
                        key: key.clone(),
                        entry: Some(entry.clone()),
                        state: PermissionState::Always,
                        origin: Origin::Default,
                    };
                }
                match self.catalog.entry(&key.service, &key.operation) {
                    Some(entry) => {
                        let (state, origin) = resolver.entry(entry);
                        ResolvedCall {
                            key: key.clone(),
                            entry: Some(entry.clone()),
                            state,
                            origin,
                        }
                    }
                    None => {
                        tracing::error!(
                            service = %key.service,
                            operation = %key.operation,
                            "an analyzed SDK operation is missing from the permission registry"
                        );
                        ResolvedCall {
                            key: key.clone(),
                            entry: None,
                            state: PermissionState::Never,
                            origin: Origin::Default,
                        }
                    }
                }
            })
            .collect())
    }
}
