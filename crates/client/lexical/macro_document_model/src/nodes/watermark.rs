//! WatermarkNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable WatermarkNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkNode {
    /// Stored content payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub content: Maybe<String>,
}
impl NodeType for WatermarkNode {
    const TYPE: &'static str = "watermark";
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
impl ImportPolicy for WatermarkNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for WatermarkNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn is_keyboard_selectable(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn is_isolated(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (js_optional(&self.content).to_owned()).into()
    }
    fn remove(_: &mut Transaction<'_>, _: Id<Self>, _: bool) -> crate::ModelResult<()> {
        Ok(())
    }
}
impl SearchText for WatermarkNode {}

/// Bypass the watermark's no-op removal hook, as explicit owner cleanup does in JS.
pub fn force_remove_watermark(
    tx: &mut Transaction<'_>,
    id: Id<WatermarkNode>,
) -> crate::ModelResult<()> {
    tx.default_remove(id.key(), true, false)
}
/// Create an unattached watermark through configured replacement.
pub fn create_watermark_node(
    tx: &mut Transaction<'_>,
    content: Option<String>,
) -> crate::ModelResult<Id<WatermarkNode>> {
    tx.create(WatermarkNode {
        content: Maybe::from_option(content),
    })
}
/// Model half of append-to-last; an empty root or falsy content inserts nothing.
pub fn append_watermark_node_to_last(
    tx: &mut Transaction<'_>,
    content: Option<String>,
) -> crate::ModelResult<Option<Id<WatermarkNode>>> {
    let Some(content) = content.filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let Some(last) = tx.last_child(NodeKey::ROOT) else {
        return Ok(None);
    };
    let node = create_watermark_node(tx, Some(content))?;
    tx.insert_after(last, node, true)?;
    Ok(Some(node))
}

impl lexical_markdown::MarkdownText for WatermarkNode {
    fn markdown_text(&self) -> Option<&str> {
        self.content.as_ref().map(|value| value.as_str())
    }
}
