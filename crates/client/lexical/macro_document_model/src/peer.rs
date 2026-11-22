//! Authorship and local ownership using transaction-staged NodeState.
use lexical_model::*;
use serde_json::Value;
use std::sync::Arc;
/// Persisted primary owner, parsed as a string or absent.
pub static PEER_ID: StateKey<Option<String>> = StateKey::new("peerId", |value| {
    value.and_then(Value::as_str).map(str::to_owned)
});
/// Synced co-owners; an empty list remains distinct from absence.
pub static SHARED_PEER_IDS: StateKey<Option<Arc<[String]>>> =
    StateKey::new("sharedPeerIds", |value| {
        value
            .and_then(Value::as_array)
            .and_then(|values| {
                values
                    .iter()
                    .map(|value| value.as_str().map(str::to_owned))
                    .collect::<Option<Vec<_>>>()
            })
            .map(Arc::from)
    });
/// Local-only ownership status.
pub static LOCAL: StateKey<Option<bool>> =
    StateKey::new("local", |value| value.and_then(Value::as_bool));
/// Tag used for follow-ups that change only local ownership status.
pub const LOCAL_STATUS_TAG: &str = "local-status";
/// Current session owner, staged and rolled back with its transaction.
#[derive(Clone, Debug, Default)]
pub struct PeerIdState {
    /// Current peer, if ownership is enabled.
    pub peer_id: Option<String>,
}
#[derive(Clone)]
struct PeerClasses(&'static [&'static str]);
/// Session input updating the active peer after open or reset.
#[derive(Clone, Debug)]
pub struct SetLocalPeer {
    /// New session peer.
    pub peer_id: Option<String>,
}
/// Set the current peer without changing document content.
pub static SET_LOCAL_PEER: CommandKey<SetLocalPeer> = CommandKey::new("peer.set_local_peer");
/// Read the primary owner from a pending or committed view.
pub fn get_peer_id(view: StateRef<'_>, key: NodeKey) -> crate::ModelResult<Option<String>> {
    view.get_state(key, &PEER_ID)
}
/// Set the primary owner verbatim.
pub fn set_peer_id(tx: &mut Transaction<'_>, key: NodeKey, peer: String) -> crate::ModelResult<()> {
    tx.set_state(key, &PEER_ID, Some(peer))
}
/// Keep an equal peer without dirtying the node.
pub fn assert_peer_id(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    peer: &str,
) -> crate::ModelResult<()> {
    if get_peer_id(tx.view(), key)?.as_deref() != Some(peer) {
        set_peer_id(tx, key, peer.into())?;
    }
    Ok(())
}
/// Read shared peers while preserving their insertion order.
pub fn get_shared_peers(
    view: StateRef<'_>,
    key: NodeKey,
) -> crate::ModelResult<Option<Arc<[String]>>> {
    view.get_state(key, &SHARED_PEER_IDS)
}
/// Whether a peer appears in the co-owner list.
pub fn has_shared_peer(view: StateRef<'_>, key: NodeKey, peer: &str) -> crate::ModelResult<bool> {
    Ok(get_shared_peers(view, key)?.is_some_and(|peers| peers.iter().any(|value| value == peer)))
}
/// Add a co-owner only when a nonempty primary owner exists and differs.
pub fn add_shared_peer(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    peer: &str,
) -> crate::ModelResult<()> {
    let Some(owner) = get_peer_id(tx.view(), key)?.filter(|owner| !owner.is_empty()) else {
        return Ok(());
    };
    if owner == peer {
        return Ok(());
    }
    let mut peers = get_shared_peers(tx.view(), key)?.map_or_else(Vec::new, |peers| peers.to_vec());
    if !peers.iter().any(|value| value == peer) {
        peers.push(peer.into());
    }
    tx.set_state(key, &SHARED_PEER_IDS, Some(peers.into()))
}
/// Read local ownership status.
pub fn get_local(view: StateRef<'_>, key: NodeKey) -> crate::ModelResult<Option<bool>> {
    view.get_state(key, &LOCAL)
}
/// Write local ownership status.
pub fn set_local(tx: &mut Transaction<'_>, key: NodeKey, local: bool) -> crate::ModelResult<()> {
    tx.set_state(key, &LOCAL, Some(local))
}
/// Remove an owner or co-owner, promoting the first remaining shared peer when necessary.
/// Return true only when ownership is removed entirely.
pub fn remove_peer_id(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    peer: &str,
) -> crate::ModelResult<bool> {
    let owner = get_peer_id(tx.view(), key)?;
    let mut peers = get_shared_peers(tx.view(), key)?.map_or_else(Vec::new, |peers| peers.to_vec());
    if owner.as_deref() == Some(peer) {
        if peers.is_empty() {
            tx.set_state(key, &PEER_ID, None)?;
            tx.set_state(key, &LOCAL, None)?;
            return Ok(true);
        }
        let promoted = peers.remove(0);
        set_peer_id(tx, key, promoted)?;
    } else if peers.iter().any(|value| value == peer) {
        peers.retain(|value| value != peer);
    } else {
        return Ok(false);
    }
    tx.set_state(
        key,
        &SHARED_PEER_IDS,
        (!peers.is_empty()).then(|| Arc::from(peers)),
    )?;
    set_local(tx, key, false)?;
    Ok(false)
}
/// Validation source; serialized inputs retain raw JavaScript truthiness.
pub enum PeerIdTarget<'a> {
    /// A typed node in a pending or committed view.
    Node(StateRef<'a>, NodeKey),
    /// Raw imported node JSON.
    Serialized(&'a Value),
}
/// Apply the source ownership validator; no current peer means validation is disabled.
pub fn peer_id_valid(target: PeerIdTarget<'_>, current: Option<&str>) -> crate::ModelResult<bool> {
    let Some(current) = current.filter(|peer| !peer.is_empty()) else {
        return Ok(true);
    };
    Ok(match target {
        PeerIdTarget::Node(view, key) => get_peer_id(view, key)?.as_deref() == Some(current),
        PeerIdTarget::Serialized(node) => node["$"]["peerId"].as_str() == Some(current),
    })
}
/// Preserve the source early return on a missing owner and overwrite by shared ownership.
/// Starting at the root is normally a no-op.
pub fn update_all_ownership(
    tx: &mut Transaction<'_>,
    peer: Option<&str>,
    root: Option<NodeKey>,
) -> crate::ModelResult<()> {
    let Some(peer) = peer.filter(|peer| !peer.is_empty()) else {
        return Ok(());
    };
    let order = lexical_rich_nodes::utils::dfs(tx.view(), root, None);
    for record in order {
        let Some(owner) = get_peer_id(tx.view(), record.node)? else {
            return Ok(());
        };
        if owner == peer {
            set_local(tx, record.node, true)?;
        }
        let shared = has_shared_peer(tx.view(), record.node, peer)?;
        set_local(tx, record.node, shared)?;
    }
    Ok(())
}
/// Ownership transforms and local-only post-commit reconciliation.
pub struct PeerIdPlugin;
impl PeerIdPlugin {
    /// Install only the caller's ownership-bearing classes.
    pub fn register(
        builder: EditorBuilder,
        classes: &'static [&'static str],
        initial: PeerIdState,
    ) -> EditorBuilder {
        builder
            .extension_state(initial)
            .extension_state(PeerClasses(classes))
            .transform_each(peer_transform, TransformScope::Types(classes))
            .plugin(Self)
    }
}
/// Assign missing ownership when a nonempty current peer exists.
pub fn peer_transform(tx: &mut Transaction<'_>, key: NodeKey) -> crate::ModelResult<()> {
    if let Some(peer) = tx
        .extension::<PeerIdState>()?
        .peer_id
        .clone()
        .filter(|peer| !peer.is_empty())
        && get_peer_id(tx.view(), key)?.is_none()
    {
        set_peer_id(tx, key, peer)?;
    }
    Ok(())
}
impl Plugin for PeerIdPlugin {
    fn name(&self) -> &'static str {
        "peer-id"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&SET_LOCAL_PEER),
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> crate::ModelResult<Handled> {
        if let Command::Extension(extension) = command
            && let Some(input) = extension.payload(&SET_LOCAL_PEER)
        {
            tx.extension_mut::<PeerIdState>()?.peer_id = input.peer_id.clone();
            return Ok(Handled::Yes);
        }
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> crate::ModelResult<()> {
        let classes = tx.extension::<PeerClasses>()?.0;
        let current = tx.extension::<PeerIdState>()?.peer_id.clone();
        let remote = commit.tags.iter().any(|tag| tag.to_string() == "from-loro");
        for (key, mutation) in &commit.changes.mutations {
            if *mutation == Mutation::Destroyed
                || !tx.is_attached(*key)
                || !classes.contains(&tx.type_name(*key)?)
            {
                continue;
            }
            let peer = get_peer_id(tx.view(), *key)?;
            let created = *mutation == Mutation::Created
                && peer.is_some()
                && get_local(tx.view(), *key)?.is_none();
            let changed = remote
                && *mutation == Mutation::Updated
                && get_peer_id(commit.prev.view(), *key)? != peer;
            if created || changed {
                let value = peer == current;
                if get_local(tx.view(), *key)? != Some(value) {
                    set_local(tx, *key, value)?;
                    tx.add_tag(UpdateTag::Custom(LOCAL_STATUS_TAG.into()));
                }
            }
        }
        Ok(())
    }
}
