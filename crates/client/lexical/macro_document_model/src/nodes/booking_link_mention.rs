//! BookingLinkMentionNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable BookingLinkMentionNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingLinkMentionNode {
    /// Stored profile id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub profile_id: Maybe<String>,
    /// Stored slug payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub slug: Maybe<String>,
    /// Stored label payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub label: Maybe<String>,
    /// Stored url payload.
    pub url: String,
}
impl NodeType for BookingLinkMentionNode {
    const TYPE: &'static str = "booking-link-mention";
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
impl ImportPolicy for BookingLinkMentionNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for BookingLinkMentionNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (self
            .label
            .as_deref()
            .filter(|s| !s.is_empty())
            .or(self.slug.as_deref().filter(|s| !s.is_empty()))
            .unwrap_or("Booking link")
            .to_owned())
        .into()
    }
}
impl SearchText for BookingLinkMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(
            self.label
                .as_deref()
                .filter(|s| !s.is_empty())
                .or(self.slug.as_deref().filter(|s| !s.is_empty()))
                .unwrap_or("Booking link")
                .into(),
        )
    }
}
