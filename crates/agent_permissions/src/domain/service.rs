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
    AgentAccess, AppliedTo, Caller, Catalog, Change, Credential, OperationKey, Origin,
    PermissionError, PermissionState, PermissionsView, PolicyId, PolicyKind, PolicyOwner,
    ResolvedCall, Rule, SessionFacts, SessionPolicy, SetBy, Tightened, ToolPermissionCatalog,
};
use super::ports::{
    AgentDirectory, PermissionStore, PermissionsRollout, SessionDirectory, Write, WriteTo,
};
use super::resolve::{self, Resolver, ViewAccess};

/// The most changes one request may make: more than one group's custom view
/// holds.
pub const MAX_CHANGES: usize = 200;

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
        Ok(resolve::view(
            &self.catalog,
            agent,
            kind,
            view_access(caller, agent, access, &owner, context),
            &chain,
            overlay,
        ))
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
        self.store
            .write(write, |_, _| Ok(resolve::normalize(changes, false)))
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
                    WriteTo::Saved => (&[][..], resolve::apply(saved, &changes, set_by), Vec::new()),
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
