//! `ShowPermissions`: the direct tool an agent calls to put its permission
//! controls in front of the person, when they ask it to be allowed something
//! its permissions refuse or ask about. It changes nothing; the chat card
//! reads and writes the settings with the viewer's own session.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_fold::domain::log::AgentSessionId;
use agent_permission_registry::Action;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::model::{
    Caller, Credential, Origin, PermissionError, PermissionState, PermissionsView, SourceStatus,
    Target, ToolPermissionDefault,
};
use crate::domain::service::AgentPermissions;

/// The most groups and tools one call may show.
const MAX_GROUPS: usize = 20;
const MAX_TOOLS: usize = 50;

/// What the model is told the card does.
const SHOWN: &str = "Shown to the person with controls. Only someone who can edit this agent \
    can change them. Wait for them, then try again.";

/// The session the tool runs in, from the authenticated MCP request.
#[derive(Clone)]
pub struct PermissionToolContext {
    /// Agent permissions.
    pub service: Arc<dyn AgentPermissions>,
    /// The session.
    pub session: AgentSessionId,
    /// The session's agent.
    pub agent: BotId,
    /// The session's owner; for a built-in persona, whose settings apply.
    pub owner: MacroUserIdStr<'static>,
}

/// The tools: only `ShowPermissions`.
pub fn toolset() -> AsyncToolCollection<PermissionToolContext> {
    AsyncToolCollection::new().add_tool::<ShowPermissions, PermissionToolContext>()
}

fn description() -> String {
    let groups = agent_permission_registry::groups()
        .iter()
        .map(|group| format!("{} ({})", group.id, group.name))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Show the person the controls for some of your permissions, so they can change them. \
         Call it when the person asks you to be able to do something your permissions refuse \
         (never) or ask about, naming the groups and actions, or the operations, from the \
         refusal. It changes nothing: they toggle the setting themselves, and only someone who \
         can edit this agent can. Groups: {groups}. Actions: create, read, update, destroy, send; \
         a group's action no operation has is not shown. Each action has a default that every \
         group without its own exception follows; the result lists the defaults."
    )
}

/// Show the person the controls for some of the agent's permissions.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(title = "ShowPermissions", description = description())]
pub struct ShowPermissions {
    /// Groups to show, each with some or all of its actions.
    #[serde(default)]
    #[schemars(length(max = 20))]
    pub groups: Vec<GroupSelection>,
    /// Single operations to show.
    #[serde(default)]
    #[schemars(length(max = 50))]
    pub tools: Vec<ToolSelection>,
    /// One sentence shown above the controls.
    #[serde(default)]
    #[schemars(length(max = 200))]
    pub reason: Option<String>,
}

/// One group, and which of its actions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct GroupSelection {
    /// A group id, such as `documents` or `email`.
    #[schemars(description = "A group id, as listed in this tool's description.")]
    pub group: String,
    /// The actions to show; empty or absent shows every action the group has
    /// operations for.
    #[serde(default)]
    #[schemars(description = "Omit for all of the group's actions.")]
    pub actions: Vec<Action>,
}

/// One SDK operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ToolSelection {
    /// The SDK's spec name, such as `email`.
    pub service: String,
    /// The raw operationId, as a refusal names it.
    #[schemars(description = "operationId, as in a refusal")]
    pub operation: String,
}

/// What was shown, resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShowPermissionsSelection {
    /// The groups, each with the actions shown (every one it has operations
    /// for when none were named). Only actions some operation has are shown.
    pub groups: Vec<GroupSelection>,
    /// The operations.
    pub tools: Vec<ToolSelection>,
}

/// One shown setting as it stands now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShownPermission {
    /// The group action or operation.
    #[schemars(with = "serde_json::Value")]
    pub target: Target,
    /// Its effective state.
    pub state: PermissionState,
    /// Where the state comes from.
    pub origin: Origin,
}

/// `ShowPermissions`' result: what the chat card shows, and a snapshot for
/// the model. The card reads the live settings itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShowPermissionsResult {
    /// The agent whose permissions these are.
    #[schemars(with = "String")]
    #[schema(value_type = String)]
    pub agent_id: BotId,
    /// The session the card is in.
    #[schemars(with = "String")]
    #[schema(value_type = String)]
    pub session_id: AgentSessionId,
    /// What to show.
    pub selection: ShowPermissionsSelection,
    /// The agent's sentence for above the controls.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Each shown setting as it stands now.
    pub current: Vec<ShownPermission>,
    /// Each action's default as it stands now, in display order: what every
    /// group's action without an exception follows.
    #[serde(default)]
    pub defaults: Vec<ToolPermissionDefault>,
    /// When the agent follows another policy: "Follows <name> (@handle)".
    /// Its settings come from there, and changes made there apply here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follows: Option<String>,
    /// What the model should do next.
    pub message: String,
}

/// The line naming what a following view follows.
fn follows_line(view: &PermissionsView) -> Option<String> {
    let source = view.source.as_ref()?;
    if source.status == SourceStatus::Lost {
        return Some(
            "Followed permissions that were deleted for good: everything asks until someone \
             picks a source or gives it its own"
                .to_owned(),
        );
    }
    let frozen = if source.status == SourceStatus::Deleted {
        ", frozen as they were when it was deleted"
    } else {
        ""
    };
    Some(match (&source.agent, &source.team) {
        (Some(agent), _) => match &agent.handle {
            Some(handle) => format!("Follows {} (@{handle}){frozen}", agent.name),
            None => format!("Follows {}{frozen}", agent.name),
        },
        (None, Some(team)) => format!("Follows the {} team's default permissions", team.name),
        (None, None) => format!("Follows a deleted agent's permissions{frozen}"),
    })
}

impl ToolAnnotated for ShowPermissions {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Show permissions");
}

fn tool_error(description: String, error: PermissionError) -> ToolCallError {
    ToolCallError {
        internal_error: error.into(),
        description,
    }
}

#[async_trait]
impl AsyncTool<PermissionToolContext> for ShowPermissions {
    type Output = ShowPermissionsResult;

    #[tracing::instrument(
        name = "agent_permissions.show",
        skip_all,
        fields(
            agent_id = %context.agent,
            agent_session_id = %context.session.as_uuid(),
            groups = self.groups.len(),
            tools = self.tools.len(),
        ),
        err(Display)
    )]
    async fn call(
        &self,
        context: ServiceContext<PermissionToolContext>,
        _request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let selection = self.select().map_err(|description| {
            tool_error(
                description,
                PermissionError::Invalid("bad selection".into()),
            )
        })?;
        // As the agent in this session, acting for its owner: the same view
        // its own SDK reads, with this session's restrictions.
        let caller = Caller {
            user: context.owner.clone(),
            credential: Credential::Agent {
                agent: context.agent,
                session: Some(context.session),
            },
        };
        let view = context
            .service
            .view_agent(&caller, context.agent)
            .await
            .map_err(|error| {
                tool_error(
                    "This agent's permissions could not be read; nothing was shown.".into(),
                    error,
                )
            })?;
        let (selection, omitted) = visible(&view, &self.groups, selection);
        if selection.groups.is_empty() && selection.tools.is_empty() {
            return Err(tool_error(
                format!(
                    "No operation has {}, so there is nothing to show. Name the groups and \
                     actions from a refusal.",
                    omitted.join(", ")
                ),
                PermissionError::Invalid("nothing to show".into()),
            ));
        }
        let message = if omitted.is_empty() {
            SHOWN.to_owned()
        } else {
            format!(
                "{SHOWN} Not shown, since no operation has them: {}.",
                omitted.join(", ")
            )
        };
        Ok(ShowPermissionsResult {
            agent_id: context.agent,
            session_id: context.session,
            current: current(&view, &selection),
            defaults: view.defaults.clone(),
            follows: follows_line(&view),
            selection,
            reason: self.reason.clone(),
            message,
        })
    }
}

impl ShowPermissions {
    /// The selection with every group and operation checked against the
    /// registry, actions filled in; the model's mistake otherwise.
    fn select(&self) -> Result<ShowPermissionsSelection, String> {
        if self.groups.is_empty() && self.tools.is_empty() {
            return Err("Name at least one group or tool to show.".into());
        }
        if self.groups.len() > MAX_GROUPS || self.tools.len() > MAX_TOOLS {
            return Err(format!(
                "Show at most {MAX_GROUPS} groups and {MAX_TOOLS} tools at once."
            ));
        }
        if self
            .reason
            .as_ref()
            .is_some_and(|reason| reason.chars().count() > 200)
        {
            return Err("Keep the reason to one sentence of at most 200 characters.".into());
        }
        let unknown_groups: Vec<&str> = self
            .groups
            .iter()
            .filter(|selected| agent_permission_registry::group(&selected.group).is_none())
            .map(|selected| selected.group.as_str())
            .collect();
        if !unknown_groups.is_empty() {
            let valid = agent_permission_registry::groups()
                .iter()
                .map(|group| group.id.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "Unknown permission groups: {}. The groups are: {valid}.",
                unknown_groups.join(", ")
            ));
        }
        let unknown_tools: Vec<String> = self
            .tools
            .iter()
            .filter(|tool| {
                agent_permission_registry::operation(&tool.service, &tool.operation).is_none()
            })
            .map(|tool| format!("{}.{}", tool.service, tool.operation))
            .collect();
        if !unknown_tools.is_empty() {
            return Err(format!(
                "Unknown operations: {}. Name them by service and operationId, as a refusal does.",
                unknown_tools.join(", ")
            ));
        }
        Ok(ShowPermissionsSelection {
            groups: self
                .groups
                .iter()
                .map(|selected| GroupSelection {
                    group: selected.group.clone(),
                    actions: if selected.actions.is_empty() {
                        Action::DISPLAY.to_vec()
                    } else {
                        selected.actions.clone()
                    },
                })
                .collect(),
            tools: self.tools.clone(),
        })
    }
}

/// `selection` narrowed to what `view` lists: a group's actions no operation
/// has are left out, and a group left with none. What the model named comes
/// back so it can be told (`requested`, which `selection` follows group for
/// group): each action it named as `group action`, a group it named whole
/// as `group` when none of its actions has an operation. Actions filled in
/// for it go quietly.
fn visible(
    view: &PermissionsView,
    requested: &[GroupSelection],
    selection: ShowPermissionsSelection,
) -> (ShowPermissionsSelection, Vec<String>) {
    let listed = |group: &str, action: Action| {
        view.groups
            .iter()
            .find(|resolved| resolved.group == group)
            .is_some_and(|resolved| resolved.actions.iter().any(|item| item.action == action))
    };
    let mut omitted = Vec::new();
    let mut groups = Vec::with_capacity(selection.groups.len());
    for (mut selected, asked) in selection.groups.into_iter().zip(requested) {
        let (shown, hidden): (Vec<Action>, Vec<Action>) = selected
            .actions
            .iter()
            .partition(|&&action| listed(&selected.group, action));
        if asked.actions.is_empty() {
            if shown.is_empty() {
                omitted.push(selected.group.clone());
            }
        } else {
            omitted.extend(
                hidden
                    .iter()
                    .map(|action| format!("{} {}", selected.group, action.as_str())),
            );
        }
        if !shown.is_empty() {
            selected.actions = shown;
            groups.push(selected);
        }
    }
    (
        ShowPermissionsSelection {
            groups,
            tools: selection.tools,
        },
        omitted,
    )
}

/// Each selected group action and operation as `view` resolves it.
fn current(view: &PermissionsView, selection: &ShowPermissionsSelection) -> Vec<ShownPermission> {
    let action_of = |group: &str, action: Action| {
        view.groups
            .iter()
            .find(|resolved| resolved.group == group)
            .and_then(|resolved| resolved.actions.iter().find(|item| item.action == action))
    };
    let mut shown = Vec::new();
    for selected in &selection.groups {
        for &action in &selected.actions {
            if let Some(resolved) = action_of(&selected.group, action) {
                shown.push(ShownPermission {
                    target: Target::GroupAction {
                        group: selected.group.clone(),
                        action,
                    },
                    state: resolved.state,
                    origin: resolved.origin,
                });
            }
        }
    }
    for tool in &selection.tools {
        let Some(entry) = agent_permission_registry::operation(&tool.service, &tool.operation)
        else {
            continue;
        };
        let Some(resolved) = action_of(&entry.group, entry.action) else {
            continue;
        };
        let (state, origin) = resolved
            .overrides
            .iter()
            .find(|item| item.service == tool.service && item.operation == tool.operation)
            .map_or((resolved.state, resolved.origin), |item| {
                (item.state, item.origin)
            });
        shown.push(ShownPermission {
            target: Target::Tool {
                service: tool.service.clone(),
                operation: tool.operation.clone(),
            },
            state,
            origin,
        });
    }
    shown
}
