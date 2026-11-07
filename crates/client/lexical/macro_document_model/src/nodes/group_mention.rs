//! GroupMentionNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable GroupMentionNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMentionNode {
    /// Stored group alias payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub group_alias: Maybe<String>,
}
impl NodeType for GroupMentionNode {
    const TYPE: &'static str = "group-mention";
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
impl ImportPolicy for GroupMentionNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for GroupMentionNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (format!("@{}", js_optional(&self.group_alias))).into()
    }
}
impl SearchText for GroupMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some("".into())
    }
}
