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
