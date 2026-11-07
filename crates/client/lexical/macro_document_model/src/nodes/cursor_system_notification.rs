//! CursorSystemNotificationNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable CursorSystemNotificationNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorSystemNotificationNode {
    /// Stored source payload.
    pub source: String,
    /// Stored attributes payload.
    pub attributes: IndexMap<String, String>,
    /// Stored text payload.
    pub text: String,
}
impl NodeType for CursorSystemNotificationNode {
    const TYPE: &'static str = "system-notification";
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
impl ImportPolicy for CursorSystemNotificationNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for CursorSystemNotificationNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (self.text.clone()).into()
    }
}
impl SearchText for CursorSystemNotificationNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(self.text.as_str().into())
    }
}
