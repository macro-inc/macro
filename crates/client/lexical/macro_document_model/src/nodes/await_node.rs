//! AwaitNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable AwaitNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitNode {
    /// Stored await id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub await_id: Maybe<String>,
    /// Stored text payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub text: Maybe<String>,
    /// Stored inline payload.
    #[serde(default = "default_true")]
    pub inline: bool,
}
impl NodeType for AwaitNode {
    const TYPE: &'static str = "await";
    type Kind = DecoratorKind;
    const FLAGS_PER_INSTANCE: bool = true;
    lexical_model::impl_default_node!();
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn create_default(tx: &mut Transaction<'_>) -> crate::Result<NodeKey> {
        Ok(create_await_node(tx, None, None, true)?.key())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::Result<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    fn import_json(json: &SerializedNode) -> crate::Result<Self> {
        let json = super::wire::own_json(Self::TYPE, json)?;
        Ok(serde_json::from_value(Value::Object(json))?)
    }
}
impl ImportPolicy for AwaitNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdAndPeer;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for AwaitNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        self.inline
    }
    fn is_keyboard_selectable(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (String::new()).into()
    }
}
impl SearchText for AwaitNode {}

impl Default for AwaitNode {
    fn default() -> Self {
        Self {
            await_id: Maybe::Missing,
            text: Maybe::Missing,
            inline: true,
        }
    }
}

/// Create an await placeholder with an injected nanoid when no id was supplied.
pub fn create_await_node(
    tx: &mut Transaction<'_>,
    await_id: Option<String>,
    text: Option<String>,
    inline: bool,
) -> crate::Result<Id<AwaitNode>> {
    let await_id = match await_id {
        Some(id) => id,
        None => crate::nanoid(tx, 21)?,
    };
    tx.create(AwaitNode {
        await_id: Maybe::Value(await_id),
        text: Maybe::from_option(text),
        inline,
    })
}
