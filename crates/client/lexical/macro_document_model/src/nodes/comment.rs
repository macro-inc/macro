//! CommentNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable CommentNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentNode {
    /// Stored mark payload.
    #[serde(flatten)]
    pub mark: MarkNode,
    /// Stored thread id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub thread_id: Maybe<i64>,
    /// Stored is draft payload.
    #[serde(default)]
    pub is_draft: bool,
}
impl NodeType for CommentNode {
    const TYPE: &'static str = "comment-mark";
    type Kind = ElementKind;
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::ModelResult<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    fn import_json(json: &SerializedNode) -> crate::ModelResult<Self> {
        if !json.contains_key("ids") {
            return Err(Error::Invariant("Array.from requires an array-like object"));
        }
        let json = super::wire::own_json(Self::TYPE, json)?;
        Ok(serde_json::from_value(Value::Object(json))?)
    }
}
impl ImportPolicy for CommentNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl ElementNode for CommentNode {
    type Parent = MarkNode;
    fn as_parent(&self) -> &Self::Parent {
        &self.mark
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.mark)
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _: SelectionSlot,
        restore_selection: bool,
    ) -> crate::ModelResult<Option<NodeKey>> {
        let data = tx.get_or_err::<Self>(this)?.clone();
        let next = tx.create(data)?;
        tx.insert_after(this, next, restore_selection)?;
        Ok(Some(next.key()))
    }
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for CommentNode {}

/// Create a comment mark with authored ids and draft metadata.
pub fn create_comment_node(
    tx: &mut Transaction<'_>,
    ids: Vec<String>,
    thread_id: Maybe<i64>,
    is_draft: Option<bool>,
) -> crate::ModelResult<Id<CommentNode>> {
    tx.create(CommentNode {
        mark: MarkNode { ids },
        thread_id,
        is_draft: is_draft.unwrap_or(false),
    })
}
/// Text covered by one mark id, rejoining separate top-level blocks in reading order.
pub fn get_comment_mark_text(view: StateRef<'_>, mark_id: &str) -> crate::ModelResult<String> {
    let mut blocks: Vec<String> = Vec::new();
    let mut block_key = None;
    for record in lexical_rich_nodes::utils::dfs(view, None, None) {
        let node = record.node;
        if !view
            .get::<CommentNode>(node)
            .is_some_and(|comment| comment.mark.ids.iter().any(|id| id == mark_id))
        {
            continue;
        }
        let key = view.top_level_element(node)?;
        if key.is_some() && key == block_key {
            if let Some(last) = blocks.last_mut() {
                last.push_str(&view.text_content(node));
            }
            continue;
        }
        block_key = key;
        blocks.push(view.text_content(node).into_owned());
    }
    Ok(js_trim(&blocks.join("\n")).into())
}
/// Bounds for comment text included in an agent context.
#[derive(Clone, Copy, Debug)]
pub struct CommentContextOptions {
    /// Maximum UTF-16 length of the selected text, before an ellipsis.
    pub marked_limit: usize,
    /// Maximum UTF-16 length of the surrounding window, before ellipses.
    pub surrounding_limit: usize,
}
impl Default for CommentContextOptions {
    fn default() -> Self {
        Self {
            marked_limit: 1000,
            surrounding_limit: 2000,
        }
    }
}
/// Bounded live marked text and the block window containing it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentMarkContext {
    /// Marked document text.
    pub marked_text: String,
    /// Containing block text, centered at the marked node position.
    pub surrounding_text: String,
}
fn text_before(view: StateRef<'_>, node: NodeKey) -> usize {
    let mut length = 0;
    let mut current = Some(node);
    while let Some(node) = current {
        if view
            .parent(node)
            .is_none_or(|parent| view.is_root_or_shadow_root(parent))
        {
            break;
        }
        for sibling in view.prev_siblings(node) {
            length += view.text_content(sibling).encode_utf16().count();
        }
        current = view.parent(node);
    }
    length
}
/// Locate a mark by node position, avoiding repeated-phrase searches in long blocks.
pub fn get_comment_mark_context(
    view: StateRef<'_>,
    mark_id: &str,
    options: CommentContextOptions,
) -> crate::ModelResult<Option<CommentMarkContext>> {
    let mut blocks = Vec::new();
    let mut offset = None;
    for record in lexical_rich_nodes::utils::dfs(view, None, None) {
        let node = record.node;
        if !view
            .get::<CommentNode>(node)
            .is_some_and(|comment| comment.mark.ids.iter().any(|id| id == mark_id))
        {
            continue;
        }
        offset.get_or_insert_with(|| text_before(view, node));
        if let Some(block) = view.top_level_element(node)?
            && !blocks.contains(&block)
        {
            blocks.push(block);
        }
    }
    if blocks.is_empty() {
        return Ok(None);
    }
    let marked = get_comment_mark_text(view, mark_id)?;
    let joined = blocks
        .iter()
        .map(|key| view.text_content(*key))
        .collect::<Vec<_>>()
        .join("\n");
    let leading = joined.encode_utf16().count()
        - joined
            .trim_start_matches(is_js_whitespace)
            .encode_utf16()
            .count();
    let surrounding = js_trim(&joined);
    let marked_units: Vec<_> = marked.encode_utf16().collect();
    let marked_text = if marked_units.len() > options.marked_limit {
        format!(
            "{}…",
            String::from_utf16_lossy(
                marked_units
                    .get(..options.marked_limit)
                    .ok_or(Error::Invariant("invalid mark limit"))?
            )
        )
    } else {
        marked.clone()
    };
    let units: Vec<_> = surrounding.encode_utf16().collect();
    let surrounding_text = if units.len() <= options.surrounding_limit {
        surrounding.into()
    } else {
        let pad =
            (options.surrounding_limit - marked_units.len().min(options.surrounding_limit)) / 2;
        let at = offset.unwrap_or(0).saturating_sub(leading);
        let start = at
            .saturating_sub(pad)
            .min(units.len() - options.surrounding_limit);
        let end = start + options.surrounding_limit;
        format!(
            "{}{}{}",
            if start > 0 { "…" } else { "" },
            String::from_utf16_lossy(
                units
                    .get(start..end)
                    .ok_or(Error::Invariant("invalid comment window"))?
            ),
            if end < units.len() { "…" } else { "" }
        )
    };
    Ok(Some(CommentMarkContext {
        marked_text,
        surrounding_text,
    }))
}
