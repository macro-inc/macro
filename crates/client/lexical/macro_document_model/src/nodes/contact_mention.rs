//! ContactMentionNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable ContactMentionNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactMentionNode {
    /// Stored contact id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub contact_id: Maybe<String>,
    /// Stored name payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub name: Maybe<String>,
    /// Stored email or domain payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub email_or_domain: Maybe<String>,
    /// Stored is company payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub is_company: Maybe<bool>,
    /// Stored mention uuid payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub mention_uuid: Maybe<String>,
}
impl NodeType for ContactMentionNode {
    const TYPE: &'static str = "contact-mention";
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
impl ImportPolicy for ContactMentionNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for ContactMentionNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (format_contact_display_name(
            js_optional(&self.name),
            js_optional(&self.email_or_domain),
            self.is_company.as_ref() == Some(&true),
        ))
        .into()
    }
}
impl SearchText for ContactMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some("".into())
    }
}

impl ContactMentionNode {
    /// Validate the source display-name read before a service cache or text projection.
    pub fn validate_text_content(&self) -> crate::ModelResult<()> {
        if self.is_company.as_ref() != Some(&true) && !matches!(self.name, Maybe::Value(_)) {
            return Err(Error::Invariant("contact display name must be a string"));
        }
        Ok(())
    }
}
