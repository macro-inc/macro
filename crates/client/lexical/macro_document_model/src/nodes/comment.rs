//! CommentNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable CommentNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentNode {
    /// Stored mark payload.
    #[serde(flatten)]
    pub mark: MarkNode,
    /// Stored thread id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub thread_id: Maybe<i64>,
    /// Stored is draft payload.
    #[serde(default)]
    pub is_draft: bool,
}
impl NodeType for CommentNode {
    const TYPE: &'static str = "comment-mark";
    type Kind = ElementKind;
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::Result<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    fn import_json(json: &SerializedNode) -> crate::Result<Self> {
        if !json.contains_key("ids") {
            return Err(Error::Invariant("Array.from requires an array-like object"));
        }
        let json = super::wire::own_json(Self::TYPE, json)?;
        Ok(serde_json::from_value(Value::Object(json))?)
    }
}
impl ImportPolicy for CommentNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl ElementNode for CommentNode {
    type Parent = MarkNode;
    fn as_parent(&self) -> &Self::Parent {
        &self.mark
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.mark)
    }
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for CommentNode {}
