//! Durable node ids and the source's source-order mapping pass.
use indexmap::IndexMap;
use lexical_model::*;
/// Persisted id strings, including the empty string; non-string values parse as absent.
pub static ID_STATE: StateKey<Option<String>> = StateKey::new("id", |value| {
    value.and_then(serde_json::Value::as_str).map(str::to_owned)
});
/// Bidirectional mappings updated during the depth-first id assertion pass.
#[derive(Clone, Debug, Default)]
pub struct NodeIdMappings {
    /// Last node carrying each durable id.
    pub id_to_node_key: IndexMap<String, NodeKey>,
    /// Id assigned to each visited node.
    pub node_key_to_id: IndexMap<NodeKey, String>,
}
/// Read a durable id without generating one.
pub fn get_id(view: StateRef<'_>, node: NodeKey) -> crate::ModelResult<Option<String>> {
    view.get_state(node, &ID_STATE)
}
/// Set or clear the durable id of one node.
pub fn set_id(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    id: Option<String>,
) -> crate::ModelResult<()> {
    tx.set_state(node, &ID_STATE, id)
}
/// Keep a nonempty existing id, otherwise generate exactly `size` source nanoid characters.
pub fn assert_id(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    size: usize,
) -> crate::ModelResult<String> {
    if let Some(id) = get_id(tx.view(), node)?.filter(|id| !id.is_empty()) {
        return Ok(id);
    }
    let id = crate::nanoid(tx, size)?;
    set_id(tx, node, Some(id.clone()))?;
    Ok(id)
}
/// Assign durable ids to the root and descendants in source depth-first order.
pub fn update_all_node_ids(
    tx: &mut Transaction<'_>,
    mappings: &mut NodeIdMappings,
    root: Option<NodeKey>,
) -> crate::ModelResult<()> {
    let nodes = lexical_rich_nodes::utils::dfs(tx.view(), root, None);
    for record in nodes {
        let id = assert_id(tx, record.node, lexical_node_id::WEB_ID_LENGTH)?;
        mappings.id_to_node_key.insert(id.clone(), record.node);
        mappings.node_key_to_id.insert(record.node, id);
    }
    Ok(())
}
