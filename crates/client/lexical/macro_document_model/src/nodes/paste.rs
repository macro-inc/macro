//! PasteNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable PasteNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteNode {
    /// In-memory block alignment; upstream never serializes this property.
    #[serde(skip, default = "DecoratorBlockData::center")]
    pub block: DecoratorBlockData,
    /// Stored content payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub content: Maybe<String>,
    /// Stored origin payload.
    pub origin: PasteOrigin,
}
impl NodeType for PasteNode {
    const TYPE: &'static str = "paste";
    type Kind = DecoratorKind;
    fn after_clone(&self) -> Option<Self> {
        let mut node = self.clone();
        node.block = DecoratorBlockData::center();
        Some(node)
    }
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
impl ImportPolicy for PasteNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for PasteNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (js_optional(&self.content).to_owned()).into()
    }
}
impl SearchText for PasteNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(js_optional(&self.content).into())
    }
}

impl Default for PasteNode {
    fn default() -> Self {
        Self {
            block: DecoratorBlockData::center(),
            content: Maybe::Missing,
            origin: PasteOrigin::Pasted,
        }
    }
}

impl DecoratorBlock for PasteNode {
    fn block(&self) -> &DecoratorBlockData {
        &self.block
    }
    fn block_mut(&mut self) -> &mut DecoratorBlockData {
        &mut self.block
    }
}

/// Create a paste chip from authored content and its normalized origin.
pub fn create_paste_node(
    tx: &mut Transaction<'_>,
    content: Maybe<String>,
    origin: PasteOrigin,
) -> crate::ModelResult<Id<PasteNode>> {
    tx.create(PasteNode {
        content,
        origin,
        ..Default::default()
    })
}
/// Replace a paste chip with the parsed document content it contains.
pub fn convert_paste_to_text(
    tx: &mut Transaction<'_>,
    paste: Id<PasteNode>,
    options: &crate::transformers::MacroMarkdownOptions,
) -> crate::Result<()> {
    let content = tx
        .get_or_err::<PasteNode>(paste)?
        .content
        .as_deref()
        .unwrap_or("")
        .to_owned();
    let wrapper = tx.create(Paragraph {})?;
    tx.replace(paste, wrapper, false)?;
    let transformers = crate::transformers::transformers("all", options)?;
    lexical_markdown::convert_from_markdown_string(
        tx,
        &content,
        &transformers,
        Some(wrapper.key()),
        &lexical_markdown::MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        },
    )?;
    let last = tx.view().last_child(wrapper);
    let children = tx.view().children_keys(wrapper)?;
    for child in children {
        tx.insert_before(wrapper, child, true)?;
    }
    tx.remove(wrapper, false)?;
    if let Some(last) = last {
        tx.select_end(last)?;
    }
    Ok(())
}

/// Unknown or absent paste provenance defaults to clipboard paste.
pub fn normalize_paste_origin(value: &Value) -> PasteOrigin {
    if value.as_str() == Some("referenced") {
        PasteOrigin::Referenced
    } else {
        PasteOrigin::Pasted
    }
}

/// Stack a referenced paste above the draft and select the first editable block.
pub fn insert_referenced_paste(tx: &mut Transaction<'_>, content: &str) -> crate::ModelResult<()> {
    let content = js_trim(content);
    if content.is_empty() {
        return Ok(());
    }
    let node = create_paste_node(tx, Maybe::Value(content.into()), PasteOrigin::Referenced)?;
    if let Some(first) = tx.first_child(NodeKey::ROOT) {
        tx.insert_before(first, node, true)?;
    } else {
        tx.append(NodeKey::ROOT, &[node.key()])?;
    }
    let mut last = node.key();
    while let Some(next) = tx.next_sibling(last).filter(|key| tx.is::<PasteNode>(*key)) {
        last = next;
    }
    if let Some(next) = tx.next_sibling(last).filter(|key| tx.is_element(*key)) {
        tx.select_end(next)?;
    } else {
        let paragraph = tx.create(Paragraph {})?;
        tx.insert_after(last, paragraph, true)?;
        tx.select_end(paragraph)?;
    }
    Ok(())
}
