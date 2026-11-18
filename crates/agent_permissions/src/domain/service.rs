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
    PermissionError, PermissionState, PermissionsView, PolicyKind, PolicyOwner, ResolvedCall,
    Rule, SessionFacts, SessionPolicy, Tightened, ToolPermissionCatalog,
};
use super::ports::{AgentDirectory, PermissionStore, PermissionsRollout, SessionDirectory};
use super::resolve::{self, Layer, ViewAccess};

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
    async fn reset(&self, caller: &Caller, agent: BotId)
    -> Result<PermissionsView, PermissionError>;

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

/// Where a tightening goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Destination {
    Saved,
    Session(AgentSessionId),
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
) -> Option<Destination> {
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
        return Some(Destination::Saved);
    }

    context.map(|(session, _)| Destination::Session(*session))
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

    async fn build_view(
        &self,
        caller: &Caller,
        agent: BotId,
        access: AgentAccess,
        (owner, kind): (PolicyOwner, PolicyKind),
        context: Option<&AgentContext>,
        overlay: Option<Vec<Rule>>,
    ) -> Result<PermissionsView, PermissionError> {
        let saved = self.store.rules(&owner).await.map_err(internal)?;
        Ok(resolve::view(
            &self.catalog,
            agent,
            kind,
            view_access(caller, agent, access, &owner, context),
            saved,
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

    #[tracing::instrument(name = "agent_permissions.view_agent", skip_all, fields(agent_id = %agent), err)]
    async fn view_agent(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<PermissionsView, PermissionError> {
        self.ensure_enabled(caller).await?;
        let access = self.access(&caller.user, agent).await?;
        if access == AgentAccess::NotFound {
            return Err(PermissionError::NotFound);
        }

        let is_this_agent = match &caller.credential {
            Credential::Agent { agent: acting, .. } if *acting != agent => {
                return Err(PermissionError::Forbidden);
            }
            Credential::Agent { .. } => true,
            Credential::PersonSession | Credential::Other => false,
        };
        if access == AgentAccess::NotManageable && !is_this_agent {
            return Err(PermissionError::Forbidden);
        }

        let context = self.agent_context(caller, agent).await?;
        let overlay = self.session_rules(context.as_ref()).await?;
        let owner = Self::owner(caller, agent, access, context.as_ref());
        self.build_view(caller, agent, access, owner, context.as_ref(), overlay)
            .await
    }

    #[tracing::instrument(
        name = "agent_permissions.view_session",
        skip_all,
        fields(agent_session_id = tracing::field::Empty),
        err
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
        let owner = match access {
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
        let context = self.agent_context(caller, agent).await?;
        self.build_view(caller, agent, access, owner, context.as_ref(), Some(overlay))
            .await
    }

    #[tracing::instrument(
        name = "agent_permissions.set",
        skip_all,
        fields(agent_id = %agent, changes = changes.len()),
        err
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

        let changes = resolve::normalize(changes, false);
        self.store
            .apply(&owner, &changes, &caller.user, false)
            .await
            .map_err(internal)?;
        self.build_view(caller, agent, access, (owner, kind), None, None)
            .await
    }

    #[tracing::instrument(
        name = "agent_permissions.tighten",
        skip_all,
        fields(agent_id = %agent, changes = changes.len(), applied_to = tracing::field::Empty),
        err
    )]
    async fn tighten(
        &self,
        caller: &Caller,
        agent: BotId,
        changes: Vec<Change>,
    ) -> Result<Tightened, PermissionError> {
        self.ensure_enabled(caller).await?;
        validate(&self.catalog, &changes)?;
        let access = self.access(&caller.user, agent).await?;
        if access == AgentAccess::NotFound {
            return Err(PermissionError::NotFound);
        }

        let context = self.agent_context(caller, agent).await?;
        let (owner, kind) = Self::owner(caller, agent, access, context.as_ref());
        let destination = tighten_destination(caller, agent, access, &owner, context.as_ref())
            .ok_or(PermissionError::Forbidden)?;

        let saved = self.store.rules(&owner).await.map_err(internal)?;
        let overlay = self
            .session_rules(context.as_ref())
            .await?
            .unwrap_or_default();

        let applied_to = match destination {
            Destination::Saved => {
                let changes = resolve::normalize(changes, false);
                let after = resolve::apply(&saved, &changes);
                resolve::tighten_only(&self.catalog, (&saved, &overlay), (&after, &overlay))
                    .map_err(PermissionError::WouldLoosen)?;
                let via_agent = matches!(caller.credential, Credential::Agent { .. });
                self.store
                    .apply(&owner, &changes, &caller.user, via_agent)
                    .await
                    .map_err(internal)?;
                AppliedTo::Agent
            }
            Destination::Session(session) => {
                let changes = resolve::normalize(changes, true);
                let after = resolve::apply(&overlay, &changes);
                resolve::tighten_only(&self.catalog, (&saved, &overlay), (&saved, &after))
                    .map_err(PermissionError::WouldLoosen)?;
                self.store
                    .apply_session(session, &changes, &caller.user)
                    .await
                    .map_err(internal)?;
                AppliedTo::Session
            }
        };
        tracing::Span::current().record("applied_to", tracing::field::debug(applied_to));

        let overlay = self.session_rules(context.as_ref()).await?;
        let permissions = self
            .build_view(caller, agent, access, (owner, kind), context.as_ref(), overlay)
            .await?;
        Ok(Tightened {
            applied_to,
            permissions,
        })
    }

    #[tracing::instrument(name = "agent_permissions.reset", skip_all, fields(agent_id = %agent), err)]
    async fn reset(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<PermissionsView, PermissionError> {
        self.ensure_enabled(caller).await?;
        let (owner, kind, access) = self.editable_owner(caller, agent).await?;
        self.store.reset(&owner).await.map_err(internal)?;
        self.build_view(caller, agent, access, (owner, kind), None, None)
            .await
    }

    #[tracing::instrument(
        name = "agent_permissions.resolve_calls",
        skip_all,
        fields(
            agent_id = %policy.agent,
            agent_session_id = %policy.session.as_uuid(),
            operations = calls.len(),
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
        let saved = self.store.rules(&owner).await.map_err(internal)?;
        let overlay = self
            .store
            .session_rules(policy.session)
            .await
            .map_err(internal)?;
        let saved = Layer::new(&saved);
        let overlay = Layer::new(&overlay);

        Ok(calls
            .iter()
            .map(|key| match self.catalog.entry(&key.service, &key.operation) {
                Some(entry) => {
                    let (state, origin) = resolve::effective(&saved, &overlay, entry);
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
            })
            .collect())
    }
}
