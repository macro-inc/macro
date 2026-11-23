//! Permission states, what a setting targets, who a policy belongs to, who is
//! asking, and the views the API returns.

#[cfg(test)]
mod test;

use agent_fold::domain::log::AgentSessionId;
use agent_permission_registry::Action;
use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// How an operation may be called. Ordered from most to least permissive, so
/// `max` is the more restrictive of two states.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    ToSchema,
    schemars::JsonSchema,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
#[schema(as = ToolPermissionState)]
pub enum PermissionState {
    /// Runs without asking: the default for everything.
    Always,
    /// Runs only after the person approves it.
    Ask,
    /// Never runs.
    Never,
}

/// What a stored setting applies to: an action's default, one group's
/// action (an exception to the default), or one operation.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[schema(as = ToolPermissionTarget)]
pub enum Target {
    /// The default of `action`: every group's, unless the group has an
    /// exception. Stored only when it is not always.
    #[schema(title = "ActionTarget")]
    Action {
        /// The action.
        action: Action,
    },
    /// An exception to the action's default: every operation of `group`
    /// whose action is `action`.
    #[schema(title = "GroupActionTarget")]
    GroupAction {
        /// A registry group id, e.g. `documents`.
        group: String,
        /// The action.
        action: Action,
    },
    /// One SDK operation.
    #[schema(title = "ToolTarget")]
    Tool {
        /// The SDK's spec name, e.g. `storage`.
        service: String,
        /// The raw operationId, e.g. `delete_document`.
        operation: String,
    },
}

/// The stored name of a [`Target`]'s kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum TargetKind {
    /// [`Target::Action`].
    Action,
    /// [`Target::GroupAction`].
    GroupAction,
    /// [`Target::Tool`].
    Tool,
}

impl Target {
    /// The kind this target is stored under.
    pub fn kind(&self) -> TargetKind {
        match self {
            Target::Action { .. } => TargetKind::Action,
            Target::GroupAction { .. } => TargetKind::GroupAction,
            Target::Tool { .. } => TargetKind::Tool,
        }
    }

    /// The stored key: `destroy`, `documents:destroy` or
    /// `storage.delete_document`.
    pub fn key(&self) -> String {
        match self {
            Target::Action { action } => action.as_str().to_owned(),
            Target::GroupAction { group, action } => format!("{group}:{}", action.as_str()),
            Target::Tool { service, operation } => format!("{service}.{operation}"),
        }
    }

    /// The target stored as `kind` and `key`, or `None` when they are not one.
    pub fn from_stored(kind: TargetKind, key: &str) -> Option<Target> {
        match kind {
            TargetKind::Action => Some(Target::Action {
                action: Action::parse(key)?,
            }),
            TargetKind::GroupAction => {
                let (group, action) = key.split_once(':')?;
                Some(Target::GroupAction {
                    group: group.to_owned(),
                    action: Action::parse(action)?,
                })
            }
            TargetKind::Tool => {
                let (service, operation) = key.split_once('.')?;
                Some(Target::Tool {
                    service: service.to_owned(),
                    operation: operation.to_owned(),
                })
            }
        }
    }
}

/// A stored setting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = ToolPermissionRule)]
pub struct Rule {
    /// What it applies to.
    pub target: Target,
    /// Its state.
    pub state: PermissionState,
    /// The agent set it by restricting itself.
    pub via_agent: bool,
    /// Only restricts: an operation's setting takes the stricter of itself and
    /// its group's action, and a group's action the stricter of itself and
    /// the action's default, instead of replacing it. Set for anything not
    /// made by a signed-in person; see [`SetBy`].
    #[serde(skip)]
    pub restriction_only: bool,
    /// When it was last set.
    pub updated_at: DateTime<Utc>,
}

/// One requested change. `state: None` removes the setting: a tool falls back
/// to its group's action, a group's action to the action's default, a default
/// to always. `always` on a default removes it too, since that is what no
/// default means; a person's `always` on a group's action is kept, as an
/// explicit exception.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = ToolPermissionChange)]
pub struct Change {
    /// What to change.
    pub target: Target,
    /// The new state, or `null` to remove the setting.
    pub state: Option<PermissionState>,
}

/// A policy's stable id: the same for as long as the policy exists, whatever
/// its owner or settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
#[schema(as = ToolPermissionPolicyId)]
pub struct PolicyId(Uuid);

impl PolicyId {
    /// A new id, for a policy about to be created.
    #[must_use]
    pub fn generate() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    /// The id a stored policy has.
    #[must_use]
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The id as stored.
    #[must_use]
    pub const fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for PolicyId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Whose saved settings apply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyOwner {
    /// An owned agent (a `bots` row): one policy, shared by everyone.
    Agent(BotId),
    /// A built-in persona: each person has their own, applied to the sessions
    /// they own.
    Persona {
        /// The persona's constant id.
        persona: BotId,
        /// The person.
        user: MacroUserIdStr<'static>,
    },
    /// A team's default policy: what its agents follow unless they pick
    /// another source. A root; its admins and owners edit it.
    Team(Uuid),
}

/// The most policies one chain may hold, the policy itself and its root
/// included: a follower, up to three policies it reaches through, and a root.
pub const MAX_CHAIN: usize = 5;

/// What a policy's settings start from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Follows {
    /// It owns its settings: a root.
    Own,
    /// It follows this policy (its source): the source's settings apply, and
    /// its own rows only restrict them.
    Source(PolicyId),
    /// It followed a source that was deleted for good: everything asks until
    /// someone picks a source or detaches. A root.
    Lost,
}

/// One policy of a chain, with its saved settings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyLevel {
    /// Its id.
    pub id: PolicyId,
    /// Whose it is.
    pub owner: PolicyOwner,
    /// What its settings start from.
    pub follows: Follows,
    /// Its saved settings.
    pub rules: Vec<Rule>,
}

/// A policy and every policy it follows, each the previous one's source,
/// ending at a root (a policy that owns its settings, or one whose source
/// was lost). Never longer than [`MAX_CHAIN`] and never a cycle: only
/// [`PolicyChain::new`] and [`PolicyChain::own`] build one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyChain {
    policy: PolicyLevel,
    sources: Vec<PolicyLevel>,
}

/// Why stored policies are not a chain. Setting a source refuses anything
/// that would make one, so only hand-edited data can.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ChainError {
    /// No policy.
    #[error("a policy chain needs a policy")]
    Empty,
    /// More than [`MAX_CHAIN`] policies.
    #[error("a policy chain is longer than {MAX_CHAIN} policies")]
    TooDeep,
    /// A policy follows one already in the chain.
    #[error("a policy chain is a cycle")]
    Cycle,
    /// A policy's next level is not its source.
    #[error("a policy chain is broken")]
    Broken,
}

impl PolicyChain {
    /// `levels` as a chain: the first the policy, each next one the previous
    /// one's source, the last a root.
    pub fn new(levels: Vec<PolicyLevel>) -> Result<Self, ChainError> {
        if levels.len() > MAX_CHAIN {
            return Err(ChainError::TooDeep);
        }
        let linked = levels
            .windows(2)
            .all(|pair| matches!(pair, [level, next] if level.follows == Follows::Source(next.id)));
        if !linked {
            return Err(ChainError::Broken);
        }
        let ids: Vec<PolicyId> = levels.iter().map(|level| level.id).collect();
        let mut levels = levels.into_iter();
        let policy = levels.next().ok_or(ChainError::Empty)?;
        let chain = Self {
            policy,
            sources: levels.collect(),
        };
        match chain.root().follows {
            Follows::Own | Follows::Lost => Ok(chain),
            Follows::Source(source) if ids.contains(&source) => Err(ChainError::Cycle),
            Follows::Source(_) => Err(ChainError::Broken),
        }
    }

    /// A policy that owns its settings.
    pub fn own(id: PolicyId, owner: PolicyOwner, rules: Vec<Rule>) -> Self {
        Self {
            policy: PolicyLevel {
                id,
                owner,
                follows: Follows::Own,
                rules,
            },
            sources: Vec::new(),
        }
    }

    /// The policy itself.
    pub fn policy(&self) -> &PolicyLevel {
        &self.policy
    }

    /// The policy it follows, when that still exists.
    pub fn source(&self) -> Option<&PolicyLevel> {
        self.sources.first()
    }

    /// Its sources, from the one it follows toward the root.
    pub fn sources(&self) -> &[PolicyLevel] {
        &self.sources
    }

    /// The policy, then each source toward the root.
    pub fn levels(&self) -> impl DoubleEndedIterator<Item = &PolicyLevel> {
        std::iter::once(&self.policy).chain(&self.sources)
    }

    /// The last level: the policy itself when it follows nothing.
    pub fn root(&self) -> &PolicyLevel {
        self.sources.last().unwrap_or(&self.policy)
    }

    /// Whether the root's source was lost: everything starts from ask.
    pub fn lost(&self) -> bool {
        self.root().follows == Follows::Lost
    }

    /// Whether the policy follows another (or a lost one): its own rows
    /// then only restrict.
    pub fn follows(&self) -> bool {
        self.policy.follows != Follows::Own
    }

    /// The policy's own settings.
    pub fn rules(&self) -> &[Rule] {
        &self.policy.rules
    }

    /// The chain with the policy's own settings replaced by `rules`.
    #[must_use]
    pub fn with_rules(&self, rules: Vec<Rule>) -> Self {
        let mut chain = self.clone();
        chain.policy.rules = rules;
        chain
    }

    /// How many policies the chain holds, at least one.
    pub fn depth(&self) -> usize {
        1 + self.sources.len()
    }
}

/// How the caller authenticated, as the transport saw it. The service
/// decides what each may do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    /// A person signed in to Macro, acting themselves.
    PersonSession,
    /// An agent acting for `Caller::user`, in `session` when its credential
    /// carried a verified invocation.
    Agent {
        /// The agent the credential is attributed to.
        agent: BotId,
        /// The session the invocation belongs to.
        session: Option<AgentSessionId>,
    },
    /// Anything else that acts as a user: an API key, an SDK token.
    Other,
}

/// Who made a saved setting, which decides how it combines with its group's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetBy {
    /// A signed-in person: an operation's setting replaces its group's.
    Person,
    /// The agent restricting itself: only restricts, labelled as the agent's.
    Agent,
    /// Anything else acting as the user (an API key): only restricts.
    Other,
}

impl SetBy {
    /// Who a write by `credential` is from.
    pub fn of(credential: &Credential) -> Self {
        match credential {
            Credential::PersonSession => SetBy::Person,
            Credential::Agent { .. } => SetBy::Agent,
            Credential::Other => SetBy::Other,
        }
    }

    /// Whether the setting is labelled as the agent's.
    pub fn via_agent(self) -> bool {
        self == SetBy::Agent
    }

    /// Whether the setting only restricts (see [`Rule::restriction_only`]).
    pub fn restriction_only(self) -> bool {
        self != SetBy::Person
    }
}

/// Who is asking.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    /// The user the request acts as.
    pub user: MacroUserIdStr<'static>,
    /// How they authenticated.
    pub credential: Credential,
}

/// What a user may do with an agent, as the agents directory says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentAccess {
    /// An owned agent the user may edit.
    Manageable,
    /// An owned agent the user may not edit.
    NotManageable,
    /// A built-in persona: everyone has their own settings for it.
    Persona,
    /// No such agent.
    NotFound,
}

/// The facts about a session that decide whose permissions apply in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFacts {
    /// The agent running in it.
    pub agent: BotId,
    /// Who owns it.
    pub owner: MacroUserIdStr<'static>,
}

/// Who owns an owned agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentOwner {
    /// A person's private agent.
    User(MacroUserIdStr<'static>),
    /// A team's agent, shared by its members.
    Team(Uuid),
}

/// What the agents directory says about an owned agent: its owner and the
/// identity a person recognizes it by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentFacts {
    /// The agent.
    pub id: BotId,
    /// Its owner.
    pub owner: AgentOwner,
    /// Its name.
    pub name: String,
    /// Its handle; unknown once it is deleted.
    pub handle: Option<String>,
    /// Its picture.
    pub avatar_url: Option<String>,
    /// It was deleted (its policy stays, frozen).
    pub deleted: bool,
}

/// A person's role in a team.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TeamRole {
    /// A member: reads the team's default permissions.
    Member,
    /// An admin: edits them too.
    Admin,
    /// The owner: edits them too.
    Owner,
}

impl TeamRole {
    /// Whether the role may edit the team's default permissions.
    pub fn edits_default(self) -> bool {
        self >= TeamRole::Admin
    }
}

/// A team, as a person recognizes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = ToolPermissionSourceTeam)]
pub struct TeamFacts {
    /// The team.
    pub id: Uuid,
    /// Its name.
    pub name: String,
}

/// Whose agents a follower may follow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentScope {
    /// A person's private agents (and the agents of their teams).
    Private(MacroUserIdStr<'static>),
    /// A team's agents.
    Team(Uuid),
}

/// One registry group, as the catalog lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogGroup {
    /// Stable id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// What it covers.
    pub description: String,
}

/// One classified SDK operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = ToolPermissionCatalogTool)]
pub struct CatalogEntry {
    /// The SDK's spec name.
    pub service: String,
    /// The raw operationId.
    pub operation: String,
    /// Its group id.
    #[serde(skip)]
    pub group: String,
    /// Its action.
    pub action: Action,
    /// What it does, for a person.
    pub label: String,
}

/// Every group and operation permissions resolve against.
#[derive(Debug, Clone)]
pub struct Catalog {
    /// Which registry this is (changes with any classification).
    pub version: String,
    /// The groups, in display order.
    pub groups: Vec<CatalogGroup>,
    /// The operations settings can name, in registry order.
    pub entries: Vec<CatalogEntry>,
    /// The operations no setting applies to: always allowed, e.g. the
    /// agent's own tightening, which can only restrict it.
    pub always_allowed: Vec<CatalogEntry>,
}

impl Catalog {
    /// The group with this id.
    pub fn group(&self, id: &str) -> Option<&CatalogGroup> {
        self.groups.iter().find(|group| group.id == id)
    }

    /// The operation `service.operation`, if settings can name it.
    pub fn entry(&self, service: &str, operation: &str) -> Option<&CatalogEntry> {
        self.entries
            .iter()
            .find(|entry| entry.service == service && entry.operation == operation)
    }

    /// The operation `service.operation`, if it is always allowed.
    pub fn always_allowed(&self, service: &str, operation: &str) -> Option<&CatalogEntry> {
        self.always_allowed
            .iter()
            .find(|entry| entry.service == service && entry.operation == operation)
    }
}

/// An action, as the catalog describes it to a person.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionCatalogAction {
    /// The action.
    pub action: Action,
    /// Its display name, e.g. "Delete".
    pub name: &'static str,
    /// What it covers.
    pub description: &'static str,
}

/// A group and its operations, as the catalog lists them.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionCatalogGroup {
    /// Stable id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// What it covers.
    pub description: String,
    /// Its operations, in registry order.
    pub tools: Vec<CatalogEntry>,
}

/// Every group, action and operation a permission can name.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionCatalog {
    /// The registry version; the same in every permissions view it resolved.
    pub version: String,
    /// The five actions, in display order.
    pub actions: Vec<ToolPermissionCatalogAction>,
    /// The groups, in display order.
    pub groups: Vec<ToolPermissionCatalogGroup>,
}

/// Whether the permissions are an owned agent's or the caller's own for a
/// built-in persona.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = ToolPermissionPolicyKind)]
pub enum PolicyKind {
    /// An owned agent's.
    Agent,
    /// A person's own settings for a built-in persona.
    Persona,
    /// A team's default permissions.
    Team,
}

/// Where an effective state comes from.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
#[schema(as = ToolPermissionOrigin)]
pub enum Origin {
    /// The operation's own setting.
    Tool,
    /// Its group's action setting: an exception to the action's default.
    GroupAction,
    /// Nothing is set: always.
    Default,
    /// The action's default.
    Action,
    /// The agent restricted itself for this session only.
    Session,
    /// The policy it follows (its source, or one further along the chain).
    Source,
}

/// An operation whose state differs from its group's action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionOverride {
    /// The SDK's spec name.
    pub service: String,
    /// The raw operationId.
    pub operation: String,
    /// What it does, for a person.
    pub label: String,
    /// Its effective state.
    pub state: PermissionState,
    /// `tool` or `session`.
    pub origin: Origin,
}

/// One action's default, resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionDefault {
    /// The action.
    pub action: Action,
    /// The state of every group's action that has no exception.
    pub state: PermissionState,
    /// `action` (a saved default), `default` (none: always) or `session`.
    pub origin: Origin,
}

/// One action of a group, resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionAction {
    /// The action.
    pub action: Action,
    /// The state of its operations that have no setting of their own.
    pub state: PermissionState,
    /// `group_action` (its exception), `action` (the action's default),
    /// `default` (nothing saved: always) or `session`.
    pub origin: Origin,
    /// This policy has an exception saved for it (in `rules`), even when
    /// its state equals the default.
    pub exception: bool,
    /// How many operations the group has with this action.
    pub tools: u32,
    /// The operations whose state differs from `state`.
    pub overrides: Vec<ToolPermissionOverride>,
}

/// One group, resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionGroup {
    /// The group id.
    pub group: String,
    /// The actions it has operations for, in display order.
    pub actions: Vec<ToolPermissionAction>,
}

/// The agent a source policy belongs to (for a built-in persona, the
/// persona), as a person recognizes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = ToolPermissionSourceAgent)]
pub struct SourceAgent {
    /// The agent's (or persona's) id.
    pub id: BotId,
    /// Its name.
    pub name: String,
    /// Its handle; absent once it is deleted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    /// Its picture.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    /// It was deleted: its policy still applies, and nobody can edit it.
    pub deleted: bool,
}

/// Whose a source policy is: a person's own (their Macro, their private
/// agents) or a team's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
// Fields are renamed one by one: the OpenAPI schema ignores serde's
// `rename_all_fields`.
#[serde(tag = "kind", rename_all = "snake_case")]
#[schema(as = ToolPermissionSourceScope)]
pub enum SourceScope {
    /// A person's own.
    Personal,
    /// A team's.
    Team {
        /// The team.
        #[serde(rename = "teamId")]
        team_id: Uuid,
        /// Its name, when it could be read.
        #[serde(rename = "teamName", skip_serializing_if = "Option::is_none")]
        team_name: Option<String>,
    },
}

/// Whether a followed source still applies as itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = ToolPermissionSourceStatus)]
pub enum SourceStatus {
    /// It exists and its owner can change it.
    Live,
    /// Its agent was deleted: it applies frozen, as it was.
    Deleted,
    /// It was deleted for good: everything asks until someone picks a
    /// source or detaches.
    Lost,
}

/// One more policy along a chain: "Scout follows Macro".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = ToolPermissionSourceVia)]
pub struct SourceVia {
    /// Its name.
    pub name: String,
    /// Its handle, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
}

/// The policy a follower follows, as its view shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = ToolPermissionSource)]
pub struct PolicySource {
    /// The source's policy id; `null` once it was lost.
    pub policy_id: Option<PolicyId>,
    /// Whose it is; absent once it was lost.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<PolicyKind>,
    /// Its agent (or persona); absent for a team's default and once it was
    /// lost.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<SourceAgent>,
    /// The team, for a team's default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<TeamFacts>,
    /// Whose it is, for the picker's badge; absent once it was lost.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<SourceScope>,
    /// Whether it still applies as itself.
    pub status: SourceStatus,
    /// The follower may still follow it: false once the follower's or the
    /// source's owner changed so that it would not be offered now. Nothing
    /// loosens; its editors should pick a source or detach.
    pub in_scope: bool,
    /// The caller may edit the source itself (through its own permissions).
    pub can_edit: bool,
    /// The rest of the chain past the source, toward its root.
    pub via: Vec<SourceVia>,
}

/// Why a candidate source can't be picked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = ToolPermissionSourceUnavailable)]
pub enum SourceUnavailable {
    /// It follows the agent, directly or through others.
    Cycle,
    /// Too many policies would follow each other in a row.
    TooDeep,
}

/// A policy the picker offers as a source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = ToolPermissionSourceCandidate)]
pub struct SourceCandidate {
    /// Its policy id, to set as the source.
    pub policy_id: PolicyId,
    /// Whose it is.
    pub kind: PolicyKind,
    /// Its agent (or persona); absent for a team's default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<SourceAgent>,
    /// The team, for a team's default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<TeamFacts>,
    /// Whose it is, for the badge.
    pub scope: SourceScope,
    /// The agent follows it now.
    pub current: bool,
    /// Why it can't be picked, when it can't.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable: Option<SourceUnavailable>,
}

/// The sources the picker offers: the person's own Macro first, then team
/// defaults, then agents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = ToolPermissionSourceCandidates)]
pub struct SourceCandidates {
    /// The candidates, in display order.
    pub candidates: Vec<SourceCandidate>,
}

/// Which candidates to list: an agent's (its scope), or, for an agent not
/// created yet, a scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CandidatesFor {
    /// An existing agent: the sources it may follow, annotated.
    Agent(BotId),
    /// A new private agent of the caller.
    Private,
    /// A new agent of this team.
    Team(Uuid),
}

/// An agent's permissions as they apply to the caller.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = AgentToolPermissions)]
pub struct PermissionsView {
    /// The agent (or persona) id.
    pub agent_id: BotId,
    /// The policy's stable id.
    pub policy_id: PolicyId,
    /// Whose settings these are.
    pub kind: PolicyKind,
    /// The caller may change and reset them.
    pub can_edit: bool,
    /// The caller may tighten them.
    pub can_tighten: bool,
    /// The registry version the resolution used.
    pub version: String,
    /// How many operations are not always allowed.
    pub restricted: u32,
    /// Each action's default, in display order: what every group's action
    /// without an exception follows, a new group's included.
    pub defaults: Vec<ToolPermissionDefault>,
    /// The saved settings, including any on a group's action no operation
    /// has yet (not in `groups`, applied once one does).
    pub rules: Vec<Rule>,
    /// The agent's restrictions on itself for this session, when the view is
    /// of a session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_rules: Option<Vec<Rule>>,
    /// Every catalog group with an operation, with the actions it has
    /// operations for.
    pub groups: Vec<ToolPermissionGroup>,
    /// The caller may set this agent's source or detach it: a person who
    /// may edit an owned agent.
    pub can_set_source: bool,
    /// The policy it follows, when it follows one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<PolicySource>,
    /// When it follows: the settings it inherits, as a policy owning them
    /// would hold them (what a detach copies, before the agent's own
    /// restrictions). Read only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inherited: Option<Vec<Rule>>,
}

/// A team's default permissions: what the team's agents follow unless they
/// pick another source, resolved as a policy that owns its settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = TeamToolPermissions)]
pub struct TeamPermissionsView {
    /// The team.
    pub team_id: Uuid,
    /// The policy's stable id, to follow.
    pub policy_id: PolicyId,
    /// Always `team`.
    pub kind: PolicyKind,
    /// The caller may change and reset them: a team admin or owner, signed
    /// in to Macro.
    pub can_edit: bool,
    /// The registry version the resolution used.
    pub version: String,
    /// How many operations are not always allowed.
    pub restricted: u32,
    /// Each action's default, in display order.
    pub defaults: Vec<ToolPermissionDefault>,
    /// The saved settings, hidden ones included.
    pub rules: Vec<Rule>,
    /// Every catalog group with an operation, with the actions it has
    /// operations for.
    pub groups: Vec<ToolPermissionGroup>,
}

impl TeamPermissionsView {
    /// The team's view, from the view `resolve::view` built for its policy.
    pub fn new(team_id: Uuid, view: PermissionsView) -> Self {
        Self {
            team_id,
            policy_id: view.policy_id,
            kind: PolicyKind::Team,
            can_edit: view.can_edit,
            version: view.version,
            restricted: view.restricted,
            defaults: view.defaults,
            rules: view.rules,
            groups: view.groups,
        }
    }
}

/// Where a tightening was saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = ToolPermissionAppliedTo)]
pub enum AppliedTo {
    /// The agent's saved settings.
    Agent,
    /// This session only: the person the agent acts for may not edit it.
    Session,
}

/// The result of a tightening.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = TightenToolPermissionsResponse)]
pub struct Tightened {
    /// Where it was saved.
    pub applied_to: AppliedTo,
    /// The permissions now.
    pub permissions: PermissionsView,
}

/// An operation a change would have made more permissive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoosenedOperation {
    /// The SDK's spec name.
    pub service: String,
    /// The raw operationId.
    pub operation: String,
    /// What it does, for a person.
    pub label: String,
    /// Its state before.
    pub from: PermissionState,
    /// Its state after.
    pub to: PermissionState,
}

/// An SDK operation, as a program names it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct OperationKey {
    /// The SDK's spec name.
    pub service: String,
    /// The raw operationId.
    pub operation: String,
}

/// What a session's permissions say about one operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCall {
    /// The operation.
    pub key: OperationKey,
    /// Its classification, or `None` for an operation the registry does not
    /// know, which is `never` (fail closed).
    pub entry: Option<CatalogEntry>,
    /// Its effective state.
    pub state: PermissionState,
    /// Where the state comes from (`default` for an unknown operation).
    pub origin: Origin,
}

/// Whose permissions apply to a run: the session's agent, its owner (whose
/// settings apply for a built-in persona) and the session (its overlay).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPolicy {
    /// The session's agent.
    pub agent: BotId,
    /// The session's owner.
    pub owner: MacroUserIdStr<'static>,
    /// The session.
    pub session: AgentSessionId,
}

/// Why a permissions request was refused.
#[derive(Debug, thiserror::Error)]
pub enum PermissionError {
    /// The feature is off for the caller.
    #[error("not found")]
    Disabled,
    /// No such agent or session.
    #[error("not found")]
    NotFound,
    /// The caller may not do this.
    #[error("you don't have access to this agent's permissions")]
    Forbidden,
    /// Loosening and reset need a person's own session.
    #[error("Only a person signed in to Macro can loosen or reset an agent's permissions.")]
    NeedsPerson,
    /// The request is malformed, e.g. no changes or too many.
    #[error("{0}")]
    Invalid(String),
    /// Changes name groups or operations the registry does not have.
    #[error("unknown permission targets")]
    UnknownTarget(Vec<Target>),
    /// A tightening would make these operations more permissive.
    #[error("an agent can only make its permissions stricter")]
    WouldLoosen(Vec<LoosenedOperation>),
    /// A follower's setting may not be looser than its source's: raising it
    /// takes an edit of the source, or a detach and then an edit.
    #[error("this agent follows another agent's permissions, which are stricter")]
    FollowsSource {
        /// The operations the change would have loosened.
        operations: Vec<LoosenedOperation>,
        /// The policy it follows.
        followed: Option<PolicyId>,
    },
    /// Following the source would make a policy follow itself.
    #[error("that agent already follows this one's permissions, directly or through others")]
    SourceCycle,
    /// Following the source would chain more than [`MAX_CHAIN`] policies.
    #[error("too many agents would follow each other's permissions in a row")]
    SourceTooDeep,
    /// The policy may not follow that source: only an owned agent's policy
    /// follows, never itself.
    #[error("this agent can't follow that agent's permissions")]
    SourceNotAllowed,
    /// Storage or a directory failed; details stay in server diagnostics.
    #[error("internal error")]
    Internal(rootcause::Report),
}

/// One SDK operation a program may call, as the gate judged it: what the
/// approval dialog lists and a refusal names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GatedOperation {
    /// The SDK's spec name, e.g. `email`.
    pub service: String,
    /// The raw operationId, e.g. `send_message`.
    pub operation: String,
    /// What it does, for a person. `service.operation` for an operation the
    /// registry does not know.
    pub label: String,
    /// Its group id; `unclassified` for an operation the registry does not
    /// know.
    pub group: String,
    /// Its group's display name.
    pub group_name: String,
    /// Its action; absent for an operation the registry does not know.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<Action>,
    /// Its effective state.
    pub state: PermissionState,
    /// Where the state comes from.
    pub origin: Origin,
}

/// Why a program did not run, when its permissions stopped it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, schemars::JsonSchema)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ExecutionPermission {
    /// It may call operations set to never: nothing ran, nobody was asked.
    Blocked {
        /// The operations set to never.
        operations: Vec<GatedOperation>,
    },
    /// It may call operations set to ask, and the person did not approve.
    Declined {
        /// How the approval ended.
        status: DeclinedStatus,
        /// The operations it asked about.
        operations: Vec<GatedOperation>,
    },
}

/// How an approval ended without approving.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum DeclinedStatus {
    /// The person declined.
    Denied,
    /// Someone cancelled the wait, or the turn ended.
    Cancelled,
    /// Nobody answered in time.
    Expired,
}

/// What a session's permissions say about everything a program may call.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Admission {
    /// Operations set to never: the program must not run.
    pub blocked: Vec<GatedOperation>,
    /// Operations set to ask: the program runs only once a person approves.
    pub ask: Vec<GatedOperation>,
    /// Operations always allowed.
    pub allowed: Vec<GatedOperation>,
}
