//! ReplyTargetNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable ReplyTargetNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyTargetNode {
    /// Stored parent payload.
    pub parent: ReplyTargetParent,
    /// Stored target message id payload.
    pub target_message_id: String,
    /// Stored target thread id payload.
    pub target_thread_id: String,
    /// Stored display text payload.
    pub display_text: String,
    /// Stored sender id payload.
    pub sender_id: String,
}
impl NodeType for ReplyTargetNode {
    const TYPE: &'static str = "reply-target";
    type Kind = DecoratorKind;
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::Result<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    fn import_json(json: &SerializedNode) -> crate::Result<Self> {
        let json = super::wire::own_json(Self::TYPE, json)?;
        Ok(serde_json::from_value(Value::Object(json))?)
    }
}
impl ImportPolicy for ReplyTargetNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for ReplyTargetNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        2
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (self.display_text.clone()).into()
    }
}
impl SearchText for ReplyTargetNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(self.display_text.as_str().into())
    }
}
