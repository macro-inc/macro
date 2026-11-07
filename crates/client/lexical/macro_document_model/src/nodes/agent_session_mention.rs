//! AgentSessionMentionNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable AgentSessionMentionNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionMentionNode {
    /// Stored id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub id: Maybe<String>,
    /// Stored label payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub label: Maybe<String>,
    /// Stored mention uuid payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub mention_uuid: Maybe<String>,
    /// Stored expanded payload.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub expanded: bool,
}
impl NodeType for AgentSessionMentionNode {
    const TYPE: &'static str = "agent-session-mention";
    type Kind = DecoratorKind;
    const FLAGS_PER_INSTANCE: bool = true;
    fn static_transform() -> Option<TransformFn<Self>> {
        Some(agent_session_mention_transform)
    }
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
impl ImportPolicy for AgentSessionMentionNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for AgentSessionMentionNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        3
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        !self.expanded
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (self
            .label
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("Agent session")
            .to_owned())
        .into()
    }
}
impl SearchText for AgentSessionMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(
            self.label
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("Agent session")
                .into(),
        )
    }
}

/// Keep expanded cards at the nearest root and collapsed chips inside paragraphs.
pub fn agent_session_mention_transform(
    tx: &mut Transaction<'_>,
    id: Id<AgentSessionMentionNode>,
) -> crate::Result<()> {
    let Some(parent) = tx.parent(id) else {
        return Ok(());
    };
    let expanded = tx.get_or_err::<AgentSessionMentionNode>(id)?.expanded;
    if expanded && !tx.is_root_or_shadow_root(parent) {
        let was_paragraph = tx.is::<Paragraph>(parent);
        lexical_rich_nodes::utils::insert_node_to_nearest_root_at_caret(
            tx,
            id.key(),
            SiblingCaret::new(id.key(), CaretDirection::Previous).into(),
            None,
        )?;
        if was_paragraph {
            for sibling in [tx.prev_sibling(id), tx.next_sibling(id)]
                .into_iter()
                .flatten()
            {
                if tx.is::<Paragraph>(sibling) && tx.is_empty(sibling) {
                    tx.remove(sibling, false)?;
                }
            }
        }
    } else if !expanded && tx.is_root_or_shadow_root(parent) {
        let paragraph = tx.create(Paragraph {})?;
        tx.replace(id, paragraph, false)?;
        tx.append(paragraph, &[id.key()])?;
    }
    Ok(())
}
