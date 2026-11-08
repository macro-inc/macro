//! AgentActivityNode: own payload and model hooks; no browser runtime.
use super::*;
/// Activity props preserve caller key order; row objects pass through verbatim.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentActivityNode(pub Map<String, Value>);
impl NodeType for AgentActivityNode {
    const TYPE: &'static str = "agent-activity";
    type Kind = DecoratorKind;
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::ModelResult<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    fn import_json(json: &SerializedNode) -> crate::ModelResult<Self> {
        let json = super::wire::own_json(Self::TYPE, json)?;
        Ok(serde_json::from_value(Value::Object(json))?)
    }
}
impl ImportPolicy for AgentActivityNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for AgentActivityNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn is_keyboard_selectable(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (String::new()).into()
    }
}
impl SearchText for AgentActivityNode {}

/// Whether a status is recognized by the activity renderer.
pub fn is_agent_activity_status(value: &Value) -> bool {
    matches!(
        value.as_str(),
        Some("running" | "completed" | "failed" | "interrupted")
    )
}
/// Whether an activity card is a view card; unknown card versions remain stored.
pub fn is_agent_activity_card(value: &Value) -> bool {
    value.get("kind").and_then(Value::as_str) == Some("view") && value.get("view").is_some()
}
/// Validate a markdown activity envelope without narrowing its future card fields.
pub fn is_agent_activity_data(value: &Value) -> bool {
    value.get("agentSessionId").is_some_and(Value::is_string)
        && ["turn", "segment"].iter().all(|key| {
            value
                .get(*key)
                .and_then(Value::as_f64)
                .is_some_and(|n| n >= 0.0 && n.fract() == 0.0)
        })
        && value.get("sealed").is_some_and(Value::is_boolean)
        && value
            .get("rows")
            .and_then(Value::as_array)
            .is_some_and(|rows| {
                rows.iter().all(|row| {
                    row.get("id").is_some_and(Value::is_string)
                        && row.get("label").is_some_and(Value::is_string)
                        && row.get("detail").is_none_or(Value::is_string)
                        && row.get("status").is_some_and(is_agent_activity_status)
                        && row.get("card").is_none_or(|card| {
                            card.is_null() || card.is_object() || card.is_array()
                        })
                })
            })
}
/// Copy text from the labels and optional details of activity rows.
pub fn agent_activity_text(rows: &[Value]) -> String {
    rows.iter()
        .map(|row| {
            let label = row.get("label").and_then(Value::as_str).unwrap_or("");
            if let Some(detail) = row
                .get("detail")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                format!("{label} {detail}")
            } else {
                label.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
