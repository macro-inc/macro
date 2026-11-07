//! TaskListNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable TaskListNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListNode {
    /// Stored list payload.
    #[serde(flatten)]
    pub list: ListNode,
}
impl NodeType for TaskListNode {
    const TYPE: &'static str = "task-list";
    type Kind = ElementKind;
    lexical_model::impl_default_node!();
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::Result<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    fn import_json(json: &SerializedNode) -> crate::Result<Self> {
        let list = serde_json::from_value(Value::Object(json.clone()))?;
        Ok(Self { list })
    }
}
impl ImportPolicy for TaskListNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl ElementNode for TaskListNode {
    type Parent = ListNode;
    fn as_parent(&self) -> &Self::Parent {
        &self.list
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.list)
    }
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for TaskListNode {}

impl From<ListNode> for TaskListNode {
    fn from(list: ListNode) -> Self {
        Self { list }
    }
}

/// CSS mount class shared with the attached task-list view.
pub const TASK_LIST_BAR_CLASS: &str = "mdtl-bar-mount";
/// Persisted display settings preserve every object property, including future fields.
pub type TaskListViewSettings = std::sync::Arc<Value>;
/// State parser deliberately accepts arbitrary objects and rejects arrays, matching JS.
pub static TASK_LIST_VIEW: StateKey<TaskListViewSettings> =
    StateKey::new("taskListView", |value| {
        std::sync::Arc::new(
            value
                .filter(|v| v.is_object())
                .cloned()
                .unwrap_or(Value::Null),
        )
    });
/// Read persisted display settings without narrowing or dropping unknown fields.
pub fn get_task_list_view_settings(
    state: &impl Read,
    key: NodeKey,
) -> crate::Result<TaskListViewSettings> {
    state.view().get_state(key, &TASK_LIST_VIEW)
}
/// Set persisted display settings; null clears the value.
pub fn set_task_list_view_settings(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    settings: TaskListViewSettings,
) -> crate::Result<()> {
    tx.set_state(key, &TASK_LIST_VIEW, settings)
}
