//! DocumentCardNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable DocumentCardNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCardNode {
    /// In-memory block alignment; upstream never serializes this property.
    #[serde(skip, default = "DecoratorBlockData::center")]
    pub block: DecoratorBlockData,
    /// Stored document id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub document_id: Maybe<String>,
    /// Stored document name payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub document_name: Maybe<String>,
    /// Stored block name payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub block_name: Maybe<String>,
    /// Stored block params payload.
    #[serde(default)]
    pub block_params: IndexMap<String, String>,
    /// Stored preview box payload.
    #[serde(default = "default_preview_box")]
    pub preview_box: PreviewBox,
    /// Stored preview data payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub preview_data: Maybe<Value>,
    /// Stored mention uuid payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub mention_uuid: Maybe<String>,
}
impl NodeType for DocumentCardNode {
    const TYPE: &'static str = "document-card";
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
impl ImportPolicy for DocumentCardNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for DocumentCardNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (js_optional(&self.document_name).to_owned()).into()
    }
}
impl SearchText for DocumentCardNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some("".into())
    }
}

impl Default for DocumentCardNode {
    fn default() -> Self {
        Self {
            block: DecoratorBlockData::center(),
            document_id: Maybe::Missing,
            document_name: Maybe::Missing,
            block_name: Maybe::Missing,
            block_params: IndexMap::new(),
            preview_box: default_preview_box(),
            preview_data: Maybe::Missing,
            mention_uuid: Maybe::Missing,
        }
    }
}

impl DecoratorBlock for DocumentCardNode {
    fn block(&self) -> &DecoratorBlockData {
        &self.block
    }
    fn block_mut(&mut self) -> &mut DecoratorBlockData {
        &mut self.block
    }
}

fn remove_empty_chain(
    tx: &mut Transaction<'_>,
    mut current: Option<NodeKey>,
    stop: Option<NodeKey>,
) -> crate::ModelResult<()> {
    while let Some(key) = current {
        if tx.is_root_or_shadow_root(key) || tx.children_size(key) != 0 {
            break;
        }
        let next = tx.parent(key);
        tx.remove(key, false)?;
        if Some(key) == stop {
            break;
        }
        current = next;
    }
    Ok(())
}
/// Promote an inline mention to a block card, preserving surrounding ancestor branches.
pub fn convert_mention_to_card(
    tx: &mut Transaction<'_>,
    mention: Id<DocumentMentionNode>,
    preview_box: Option<PreviewBox>,
    preview_data: Maybe<Value>,
) -> crate::ModelResult<Id<DocumentCardNode>> {
    let data = tx
        .view()
        .get_or_err::<DocumentMentionNode>(mention)?
        .clone();
    let card = tx.create(DocumentCardNode {
        document_id: data.document_id,
        document_name: data.document_name,
        block_name: data.block_name,
        block_params: data.block_params,
        mention_uuid: data.mention_uuid,
        preview_box: preview_box.unwrap_or_else(default_preview_box),
        preview_data,
        ..Default::default()
    })?;
    let parent = tx.parent_or_err(mention)?;
    if tx.is_root_or_shadow_root(parent) {
        tx.replace(mention, card, false)?;
        return Ok(card);
    }
    let offset = tx
        .index_within_parent(mention)
        .ok_or(Error::NoParent(mention.key()))?;
    let (before, after) = tx.split_node(parent, offset)?;
    let parent_after = tx.parent(mention);
    tx.insert_before(after, card, true)?;
    tx.remove(mention, false)?;
    remove_empty_chain(tx, Some(parent), before)?;
    remove_empty_chain(tx, parent_after, Some(after))?;
    Ok(card)
}
/// Replace a card by a paragraph containing its inline mention.
pub fn convert_card_to_mention(
    tx: &mut Transaction<'_>,
    card: Id<DocumentCardNode>,
) -> crate::ModelResult<Id<DocumentMentionNode>> {
    let data = tx.view().get_or_err::<DocumentCardNode>(card)?.clone();
    let mention = create_document_mention_node(
        tx,
        DocumentMentionNode {
            document_id: data.document_id,
            document_name: data.document_name,
            block_name: data.block_name,
            block_params: data.block_params,
            mention_uuid: data.mention_uuid,
            ..Default::default()
        },
    )?;
    let paragraph = tx.create(Paragraph {})?;
    tx.append(paragraph, &[mention.key()])?;
    tx.replace(card, paragraph, false)?;
    Ok(mention)
}
