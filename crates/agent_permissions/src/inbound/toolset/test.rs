use std::sync::Mutex;

use ai_toolset::ToolSet as _;
use chrono::DateTime;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};

use super::*;
use crate::domain::model::{
    Change, OperationKey, PolicyKind, ResolvedCall, Rule, SessionPolicy, Tightened,
    ToolPermissionCatalog,
};
use crate::domain::resolve::{self, ViewAccess};

/// Answers `view_agent` with the registry resolved under `rules`, and
/// records who asked.
struct Viewer {
    rules: Vec<Rule>,
    asked: Mutex<Vec<Caller>>,
}

#[async_trait]
impl AgentPermissions for Viewer {
    async fn catalog(&self, _: &Caller) -> Result<ToolPermissionCatalog, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn view_agent(
        &self,
        caller: &Caller,
        agent: BotId,
    ) -> Result<PermissionsView, PermissionError> {
        self.asked.lock().unwrap().push(caller.clone());
        Ok(resolve::view(
            &crate::outbound::registry::registry_catalog(),
            agent,
            PolicyKind::Agent,
            ViewAccess {
                can_edit: false,
                can_tighten: true,
            },
            self.rules.clone(),
            Some(Vec::new()),
        ))
    }
    async fn view_session(
        &self,
        _: &Caller,
        _: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<PermissionsView, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn set(
        &self,
        _: &Caller,
        _: BotId,
        _: Vec<Change>,
    ) -> Result<PermissionsView, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn tighten(
        &self,
        _: &Caller,
        _: BotId,
        _: Vec<Change>,
    ) -> Result<Tightened, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn reset(&self, _: &Caller, _: BotId) -> Result<PermissionsView, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn resolve_calls(
        &self,
        _: &SessionPolicy,
        _: &[OperationKey],
    ) -> Result<Vec<ResolvedCall>, PermissionError> {
        Err(PermissionError::NotFound)
    }
}

fn rule(target: Target, state: PermissionState) -> Rule {
    Rule {
        target,
        state,
        via_agent: false,
        restriction_only: false,
        updated_at: DateTime::UNIX_EPOCH,
    }
}

fn context(viewer: Arc<Viewer>) -> PermissionToolContext {
    PermissionToolContext {
        service: viewer,
        session: AgentSessionId::new(),
        agent: bot_id::MACRO_NEW_BOT_ID,
        owner: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
    }
}

async fn show(
    context: PermissionToolContext,
    arguments: serde_json::Value,
) -> Result<ShowPermissionsResult, String> {
    toolset()
        .try_tool_call(
            context.clone(),
            RequestContext::new(context.owner.clone()),
            "ShowPermissions",
            &arguments,
        )
        .await
        .map_err(|error| error.to_string())?
        .map(|value| serde_json::from_value(value).unwrap())
        .map_err(|error| error.description)
}

#[tokio::test]
async fn shows_the_selection_with_its_current_settings() {
    let viewer = Arc::new(Viewer {
        rules: vec![
            rule(
                Target::GroupAction {
                    group: "email".into(),
                    action: Action::Send,
                },
                PermissionState::Never,
            ),
            rule(
                Target::Tool {
                    service: "storage".into(),
                    operation: "delete_document".into(),
                },
                PermissionState::Ask,
            ),
        ],
        asked: Mutex::new(Vec::new()),
    });
    let context = context(viewer.clone());
    let result = show(
        context.clone(),
        serde_json::json!({
            "groups": [{"group": "email", "actions": ["send"]}, {"group": "tasks"}],
            "tools": [{"service": "storage", "operation": "delete_document"}],
            "reason": "You asked me to send the summary.",
        }),
    )
    .await
    .unwrap();
    assert_eq!(result.agent_id, context.agent);
    assert_eq!(result.session_id, context.session);
    assert_eq!(result.selection.groups[1].actions, Action::ALL.to_vec());
    assert_eq!(
        result.reason.as_deref(),
        Some("You asked me to send the summary.")
    );
    assert_eq!(result.message, SHOWN);
    // email:send, the five tasks actions, the tool.
    assert_eq!(result.current.len(), 7);
    assert_eq!(result.current[0].state, PermissionState::Never);
    assert_eq!(result.current[0].origin, Origin::GroupAction);
    assert_eq!(result.current[1].state, PermissionState::Always);
    let tool = result.current.last().unwrap();
    assert_eq!(tool.state, PermissionState::Ask);
    assert_eq!(tool.origin, Origin::Tool);
    // Read as the agent in its session, for its owner.
    assert_eq!(
        viewer.asked.lock().unwrap()[0],
        Caller {
            user: context.owner.clone(),
            credential: Credential::Agent {
                agent: context.agent,
                session: Some(context.session),
            },
        }
    );
    let wire = serde_json::to_value(&result).unwrap();
    assert_eq!(wire["current"][0]["target"]["kind"], "group_action");
    assert_eq!(
        wire["selection"]["tools"][0]["operation"],
        "delete_document"
    );
}

#[tokio::test]
async fn an_unknown_or_empty_selection_is_the_models_to_fix() {
    let viewer = Arc::new(Viewer {
        rules: Vec::new(),
        asked: Mutex::new(Vec::new()),
    });
    let refused = show(
        context(viewer.clone()),
        serde_json::json!({"groups": [{"group": "spaceships"}]}),
    )
    .await
    .unwrap_err();
    assert!(
        refused.contains("Unknown permission groups: spaceships"),
        "{refused}"
    );
    assert!(refused.contains("documents"), "{refused}");
    let refused = show(
        context(viewer.clone()),
        serde_json::json!({"tools": [{"service": "storage", "operation": "nope"}]}),
    )
    .await
    .unwrap_err();
    assert!(refused.contains("storage.nope"), "{refused}");
    let refused = show(context(viewer.clone()), serde_json::json!({}))
        .await
        .unwrap_err();
    assert!(refused.contains("at least one"), "{refused}");
    assert!(viewer.asked.lock().unwrap().is_empty());
}

#[test]
fn the_description_lists_every_group() {
    let tool = &toolset().tools["ShowPermissions"];
    for group in agent_permission_registry::groups() {
        assert!(tool.description.contains(&group.id), "{}", group.id);
    }
    assert!(tool.annotations.kind.read_only_hint());
    let schema = serde_json::to_value(&tool.input_schema).unwrap();
    // Constraints reach providers in the descriptions.
    let limit = |property: &str| schema["properties"][property]["description"].to_string();
    assert!(limit("groups").contains("maxItems: 20"), "{schema}");
    assert!(limit("tools").contains("maxItems: 50"), "{schema}");
}
