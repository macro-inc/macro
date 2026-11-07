//! UserMentionNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable UserMentionNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMentionNode {
    /// Stored user id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub user_id: Maybe<String>,
    /// Stored email payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub email: Maybe<String>,
    /// Stored display name payload.
    #[serde(default)]
    pub display_name: String,
    /// Stored mention uuid payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub mention_uuid: Maybe<String>,
}
impl NodeType for UserMentionNode {
    const TYPE: &'static str = "user-mention";
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
impl ImportPolicy for UserMentionNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for UserMentionNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (if self.display_name.is_empty() {
            String::new()
        } else {
            format!("@{}", self.display_name)
        })
        .into()
    }
}
impl SearchText for UserMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some("".into())
    }
}
