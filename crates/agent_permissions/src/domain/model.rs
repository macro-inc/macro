//! Permission states, what a setting targets, who a policy belongs to, who is
//! asking, and the views the API returns.

use agent_fold::domain::log::AgentSessionId;
use agent_permission_registry::Action;
use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
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

/// What a stored setting applies to: every operation of a group's action, or
/// one operation.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[schema(as = ToolPermissionTarget)]
pub enum Target {
    /// Every operation of `group` whose action is `action`.
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
    /// [`Target::GroupAction`].
    GroupAction,
    /// [`Target::Tool`].
    Tool,
}

impl Target {
    /// The kind this target is stored under.
    pub fn kind(&self) -> TargetKind {
        match self {
            Target::GroupAction { .. } => TargetKind::GroupAction,
            Target::Tool { .. } => TargetKind::Tool,
        }
    }

    /// The stored key: `documents:destroy` or `storage.delete_document`.
    pub fn key(&self) -> String {
        match self {
            Target::GroupAction { group, action } => format!("{group}:{}", action.as_str()),
            Target::Tool { service, operation } => format!("{service}.{operation}"),
        }
    }

    /// The target stored as `kind` and `key`, or `None` when they are not one.
    pub fn from_stored(kind: TargetKind, key: &str) -> Option<Target> {
        match kind {
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
    /// its group's action instead of replacing it. Set for anything not made
    /// by a signed-in person; see [`SetBy`].
    #[serde(skip)]
    pub restriction_only: bool,
    /// When it was last set.
    pub updated_at: DateTime<Utc>,
}

/// One requested change. `state: None` removes the setting: a tool falls back
/// to its group's action, a group's action to always. `always` on a group's
/// action removes it too, since that is its default.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = ToolPermissionChange)]
pub struct Change {
    /// What to change.
    pub target: Target,
    /// The new state, or `null` to remove the setting.
    pub state: Option<PermissionState>,
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
    /// Its group's action setting.
    GroupAction,
    /// Nothing is set: always.
    Default,
    /// The agent restricted itself for this session only.
    Session,
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

/// One action of a group, resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionAction {
    /// The action.
    pub action: Action,
    /// The state of its operations that have no setting of their own.
    pub state: PermissionState,
    /// `group_action`, `default` or `session`.
    pub origin: Origin,
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
    /// All five actions, in display order.
    pub actions: Vec<ToolPermissionAction>,
}

/// An agent's permissions as they apply to the caller.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = AgentToolPermissions)]
pub struct PermissionsView {
    /// The agent (or persona) id.
    pub agent_id: BotId,
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
    /// The saved settings.
    pub rules: Vec<Rule>,
    /// The agent's restrictions on itself for this session, when the view is
    /// of a session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_rules: Option<Vec<Rule>>,
    /// Every catalog group with its five actions.
    pub groups: Vec<ToolPermissionGroup>,
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
