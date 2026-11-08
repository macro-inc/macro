//! Durable node ids and the source's source-order mapping pass.
use indexmap::IndexMap;
use lexical_model::*;
use lexical_node_id::LexicalNodeId;
use rand_chacha::rand_core::{RngCore, SeedableRng};
/// Persisted id strings, including the empty string; non-string values parse as absent.
pub static ID_STATE: StateKey<Option<String>> = StateKey::new("id", |value| {
    value.and_then(serde_json::Value::as_str).map(str::to_owned)
});
/// Bidirectional mappings updated during the depth-first id assertion pass.
#[derive(Clone, Debug, Default)]
pub struct NodeIdMappings {
    /// Last node carrying each durable id.
    pub id_to_node_key: IndexMap<LexicalNodeId, NodeKey>,
    /// Id assigned to each visited node.
    pub node_key_to_id: IndexMap<NodeKey, LexicalNodeId>,
}
/// Read a durable id without generating one.
pub fn get_id(view: StateRef<'_>, node: NodeKey) -> crate::ModelResult<Option<LexicalNodeId>> {
    Ok(view
        .get_state(node, &ID_STATE)?
        .as_deref()
        .and_then(LexicalNodeId::from_stored))
}
/// Set or clear the durable id of one node.
pub fn set_id(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    id: Option<LexicalNodeId>,
) -> crate::ModelResult<()> {
    tx.set_state(node, &ID_STATE, id.map(Into::into))
}
/// Keep a nonempty existing id, otherwise generate exactly `size` source nanoid characters.
pub fn assert_id(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    size: usize,
) -> crate::ModelResult<LexicalNodeId> {
    if let Some(id) = get_id(tx.view(), node)? {
        return Ok(id);
    }
    let id = validated_id(crate::nanoid(tx, size)?)?;
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

/// Rollback-safe generator for node identity plugins, seeded explicitly by the host.
#[derive(Clone, Debug)]
pub struct NanoIdRng(rand_chacha::ChaCha20Rng);
impl NanoIdRng {
    /// Initialize a deterministic stream without ambient entropy.
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self(rand_chacha::ChaCha20Rng::from_seed(seed))
    }
    /// Generate URL-safe nanoid characters in source browser order.
    pub fn generate(&mut self, length: usize) -> String {
        let mut bytes = vec![0; length];
        self.0.fill_bytes(&mut bytes);
        bytes
            .into_iter()
            .rev()
            .map(|byte| char::from(lexical_node_id::NANOID_URL_ALPHABET[usize::from(byte & 63)]))
            .collect()
    }
}
/// Staged plugin mappings and entropy; failed transactions rewind both.
#[derive(Clone, Debug)]
pub struct NodeIdState {
    /// Length for missing and duplicate ids.
    pub id_length: usize,
    /// Bidirectional current identity mappings.
    pub mappings: NodeIdMappings,
    /// Seeded per-editor entropy.
    pub ids: NanoIdRng,
    classes: &'static [&'static str],
}
/// Assign and track durable identities in transform order and post-commit rounds.
pub struct NodeIdPlugin;
impl NodeIdPlugin {
    /// Install the transform for the supplied classes and initialize existing nodes.
    pub fn register(
        builder: EditorBuilder,
        classes: &'static [&'static str],
        id_length: Option<usize>,
        seed: [u8; 32],
    ) -> EditorBuilder {
        builder
            .extension_state(NodeIdState {
                id_length: id_length.unwrap_or(lexical_node_id::PLUGIN_DEFAULT_ID_LENGTH),
                mappings: NodeIdMappings::default(),
                ids: NanoIdRng::from_seed(seed),
                classes,
            })
            .transform_each(id_transform, TransformScope::Types(classes))
            .plugin(Self)
    }
    /// Resolve a mapped id only while its key exists in the current state.
    pub fn get_node_by_id(
        ids: &NodeIdState,
        state: &EditorState,
        id: &LexicalNodeId,
    ) -> Option<NodeKey> {
        ids.mappings
            .id_to_node_key
            .get(id)
            .copied()
            .filter(|key| state.view().contains(*key))
    }
}
/// Clear a node and its descendants before clipboard insertion.
pub fn invalidate_id(tx: &mut Transaction<'_>, key: NodeKey) -> crate::ModelResult<()> {
    let order = lexical_rich_nodes::utils::dfs(tx.view(), Some(key), None);
    for record in order {
        set_id(tx, record.node, None)?;
    }
    Ok(())
}
/// Prepare pasted nodes without consuming the insertion command.
pub fn prepare_clipboard_nodes(
    tx: &mut Transaction<'_>,
    nodes: &[NodeKey],
) -> crate::ModelResult<()> {
    for key in nodes {
        invalidate_id(tx, *key)?;
    }
    Ok(())
}
/// Assign missing ids and make the currently transformed duplicate lose.
pub fn id_transform(tx: &mut Transaction<'_>, key: NodeKey) -> crate::ModelResult<()> {
    let previous = get_id(tx.view(), key)?;
    let state = tx.extension_mut::<NodeIdState>()?;
    let duplicate = previous.as_ref().is_some_and(|id| {
        state
            .mappings
            .id_to_node_key
            .get(id)
            .is_some_and(|known| *known != key)
    });
    // Stored highlight identity is preserved; highlighting remains a view concern.
    let id = if previous.is_none() || (duplicate && tx.type_name(key)? != "code-highlight") {
        let state = tx.extension_mut::<NodeIdState>()?;
        validated_id(state.ids.generate(state.id_length))?
    } else {
        previous.ok_or(Error::Invariant("missing existing node id"))?
    };
    if get_id(tx.view(), key)?.as_ref() != Some(&id) {
        set_id(tx, key, Some(id.clone()))?;
    }
    let state = tx.extension_mut::<NodeIdState>()?;
    state.mappings.id_to_node_key.insert(id.clone(), key);
    state.mappings.node_key_to_id.insert(key, id);
    Ok(())
}
impl Plugin for NodeIdPlugin {
    fn name(&self) -> &'static str {
        "node-id"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::InsertClipboardNodes,
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> crate::ModelResult<Handled> {
        if let Command::InsertClipboardNodes { nodes, .. } = command { prepare_clipboard_nodes(tx, nodes)?; }
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> crate::ModelResult<()> {
        let classes = tx.extension::<NodeIdState>()?.classes;
        for (key, mutation) in &commit.changes.mutations {
            let view = if *mutation == Mutation::Destroyed {
                commit.prev.view()
            } else {
                tx.view()
            };
            if !view
                .type_name(*key)
                .is_ok_and(|name| classes.contains(&name))
            {
                continue;
            }
            if *mutation == Mutation::Destroyed {
                if let Some(id) = get_id(commit.prev.view(), *key)? {
                    let state = tx.extension_mut::<NodeIdState>()?;
                    state.mappings.id_to_node_key.shift_remove(&id);
                    state.mappings.node_key_to_id.shift_remove(key);
                }
            } else if *mutation == Mutation::Created && tx.is_attached(*key) {
                let id = if let Some(id) = get_id(tx.view(), *key)? {
                    id
                } else {
                    let state = tx.extension_mut::<NodeIdState>()?;
                    let id = validated_id(state.ids.generate(state.id_length))?;
                    set_id(tx, *key, Some(id.clone()))?;
                    id
                };
                let state = tx.extension_mut::<NodeIdState>()?;
                state.mappings.id_to_node_key.insert(id.clone(), *key);
                state.mappings.node_key_to_id.insert(*key, id);
            }
        }
        Ok(())
    }
}

fn validated_id(id: String) -> crate::ModelResult<LexicalNodeId> {
    LexicalNodeId::try_new(id).map_err(|_| Error::Invariant("node id must be nonempty"))
}
/// Always replace the existing id using the transaction's explicit constructor entropy.
pub fn regen_id(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    size: usize,
) -> crate::ModelResult<LexicalNodeId> {
    let id = validated_id(crate::nanoid(tx, size)?)?;
    set_id(tx, key, Some(id.clone()))?;
    Ok(id)
}
/// Shared stored id state key; empty strings are preserved on the wire.
pub use ID_STATE as NODE_ID;
/// Source default transform id length.
pub const DEFAULT_PLUGIN_ID_LENGTH: usize = lexical_node_id::PLUGIN_DEFAULT_ID_LENGTH;
/// Source update-all id length, including the root.
pub const UPDATE_ALL_ID_LENGTH: usize = lexical_node_id::WEB_ID_LENGTH;
/// Source nanoid alphabet in generator order.
pub const NANOID_ALPHABET: &[u8; 64] = lexical_node_id::NANOID_URL_ALPHABET;
