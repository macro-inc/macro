//! Collaborative editing: a design shared as CRDT maps of node states.
//!
//! Every peer opens the stored `.fig` and then applies the shared entries,
//! which hold only what changed since the collaboration began:
//!
//! | container | key | value |
//! | --- | --- | --- |
//! | `figMeta` | `format`, `baseBlobs` | entry layout version; blobs every peer's file starts with |
//! | `figNodes` | node id (`12:34`) | the node's whole state ([`codec::NodeState`], base64) |
//! | `figBlobs` | content key | geometry or glyph blob (base64) |
//! | `figImages` | SHA-1 | image file (base64) |
//!
//! A node entry is the node's absolute state after an edit (properties,
//! parent and position, removed or not), so applying it is idempotent and
//! independent of the order entries arrive in: concurrent edits to
//! different nodes merge, and edits to one node resolve last-writer-wins.
//! Saving the merged file and opening it again, then applying the same
//! entries, gives the same document, so the stored file can be replaced at
//! any time.
//!
//! [`Collab`] tracks what this peer changed ([`Collab::record`], reported by
//! [`Collab::changes`]) and applies other peers' entries
//! ([`Collab::apply`]). Each peer creates nodes in its own guid session, so
//! new ids never collide. Undo stays local: an undo is an ordinary change
//! of the nodes it restores.

pub mod codec;

use crate::document::{Document, Node, NodeIdx};
use crate::edit::flags;
use crate::model::Guid;
use codec::{BlobRef, DecodeError, NodeState, Reader, Writer, base64, blob_key, unbase64};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;

/// Version of the entry layout, stored in `figMeta.format`.
pub const FORMAT_VERSION: u32 = 1;

/// Images larger than this are not shared live; peers see them once the
/// merged file is saved and opened again.
pub const MAX_SHARED_IMAGE_BYTES: usize = 8 * 1024 * 1024;

/// Names of the maps that hold a collaborative design.
pub mod container {
    /// Format metadata.
    pub const META: &str = "figMeta";
    /// Node id → node state.
    pub const NODES: &str = "figNodes";
    /// Content key → blob.
    pub const BLOBS: &str = "figBlobs";
    /// SHA-1 → image file.
    pub const IMAGES: &str = "figImages";
    /// Every container.
    pub const ALL: [&str; 4] = [META, NODES, BLOBS, IMAGES];
}

/// Keys of the `figMeta` map.
pub mod meta {
    /// The entry layout version.
    pub const FORMAT: &str = "format";
    /// How many blobs the file had when the collaboration began. Blobs
    /// below it are the same in every later save, so entries refer to them
    /// by index.
    pub const BASE_BLOBS: &str = "baseBlobs";
}

/// One entry written (`value`) or deleted (`None`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryChange {
    /// The map.
    pub container: String,
    /// The key within it.
    pub key: String,
    /// The new value; absent or null deletes the entry.
    #[serde(default)]
    pub value: Option<String>,
}

impl EntryChange {
    fn set(container: &str, key: impl Into<String>, value: String) -> Self {
        Self {
            container: container.to_owned(),
            key: key.into(),
            value: Some(value),
        }
    }
}

/// What applying other peers' changes did.
#[derive(Debug, Default)]
pub struct Remote {
    /// Nodes that changed, and parents whose children changed.
    pub touched: Vec<NodeIdx>,
    /// Images that arrived (renderers forget that they were missing).
    pub images: Vec<String>,
}

/// One peer's view of the shared maps.
pub struct Collab {
    session: u32,
    base_blobs: u32,
    /// Shared key of each blob added during the collaboration.
    blob_keys: HashMap<u32, Arc<str>>,
    /// Blobs in the shared map (written or received) → document index.
    blobs_by_key: HashMap<Arc<str>, u32>,
    /// Images every peer has: in the file, written, or received.
    images_shared: HashSet<String>,
    /// Hash of each node's entry as last written or applied.
    synced: HashMap<Guid, u64>,
    /// Nodes changed here since the last [`Collab::changes`].
    dirty: BTreeSet<NodeIdx>,
    /// Edit flags of every field changed during the collaboration, by any
    /// peer: saving rewrites them whichever version of the file a peer
    /// opened.
    flags: HashMap<Guid, u32>,
    /// Entries waiting for blobs that have not arrived.
    pending: HashMap<Guid, String>,
    /// Nodes whose parent has not arrived.
    unlinked: HashSet<Guid>,
}

fn value_hash(value: &str) -> u64 {
    let mut h = std::hash::DefaultHasher::new();
    value.hash(&mut h);
    h.finish()
}

impl Collab {
    /// Starts collaborating on an opened document. New nodes get ids in
    /// `session` (unique per peer). `base_blobs` is `figMeta.baseBlobs`
    /// when the shared maps have it; otherwise this peer's count is used
    /// and returned as a change to write.
    pub fn new(
        doc: &mut Document,
        session: u32,
        base_blobs: Option<u32>,
    ) -> (Collab, Vec<EntryChange>) {
        let local = doc
            .nodes
            .iter()
            .filter_map(|n| n.props.guid)
            .filter(|g| g.session == session)
            .map(|g| g.local)
            .max()
            .unwrap_or(0);
        doc.next_guid = Guid {
            session,
            local: local + 1,
        };
        let original = doc.original_blobs as u32;
        let mut changes = Vec::new();
        let base_blobs = match base_blobs {
            Some(n) => n.min(original),
            None => {
                changes.push(EntryChange::set(
                    container::META,
                    meta::BASE_BLOBS,
                    original.to_string(),
                ));
                original
            }
        };
        let collab = Collab {
            session,
            base_blobs,
            blob_keys: HashMap::new(),
            blobs_by_key: HashMap::new(),
            images_shared: doc.images.keys().cloned().collect(),
            synced: HashMap::new(),
            dirty: BTreeSet::new(),
            flags: HashMap::new(),
            pending: HashMap::new(),
            unlinked: HashSet::new(),
        };
        (collab, changes)
    }

    /// The guid session this peer creates nodes in.
    pub fn session(&self) -> u32 {
        self.session
    }

    /// Notes nodes a local step (an edit, undo, or redo) changed, so the
    /// next [`Collab::changes`] reports them. After undo and redo
    /// (`relink`), parents' children are derived again from the nodes'
    /// parent links, as the snapshots they restore predate other peers'
    /// changes; parents that changed are added to `touched`.
    pub fn record(&mut self, doc: &mut Document, touched: &mut Vec<NodeIdx>, relink: bool) {
        for &i in touched.iter() {
            let node = &mut doc.nodes[i as usize];
            let Some(g) = node.props.guid else { continue };
            let f = self.flags.entry(g).or_default();
            *f |= node.edits & !flags::CREATED;
            node.edits |= *f;
            self.dirty.insert(i);
        }
        if relink {
            let mut parents: HashSet<NodeIdx> = touched.iter().copied().collect();
            parents.extend(touched.iter().filter_map(|&i| doc.node(i).parent));
            for p in relink_children(doc, &parents, &HashMap::new()) {
                if !touched.contains(&p) {
                    touched.push(p);
                }
            }
            doc.refresh_pages();
        }
    }

    /// The entry changes that bring the shared maps up to date with this
    /// peer's edits since the last call.
    pub fn changes(&mut self, doc: &Document) -> Vec<EntryChange> {
        let mut nodes = Vec::new();
        let mut extra = Vec::new();
        let dirty = std::mem::take(&mut self.dirty);
        let Collab {
            base_blobs,
            blob_keys,
            blobs_by_key,
            images_shared,
            synced,
            flags: all_flags,
            ..
        } = self;
        for i in dirty {
            let node = doc.node(i);
            let Some(g) = node.props.guid else { continue };
            let known = synced.contains_key(&g);
            let created = node.edits & flags::CREATED != 0;
            // Never shared and back to how the file has it (or gone).
            if !known && (node.edits == 0 || created && node.removed) {
                continue;
            }
            let state = NodeState {
                props: node.props.clone(),
                removed: node.removed,
                listed: node
                    .parent
                    .is_some_and(|p| doc.node(p).children.contains(&i)),
                edits: node.edits | all_flags.get(&g).copied().unwrap_or(0),
                source: node.source,
            };
            let mut new_blobs: Vec<(Arc<str>, u32)> = Vec::new();
            let mut blob = |b: u32| -> BlobRef {
                if b < *base_blobs {
                    return BlobRef::Base(b);
                }
                let key = blob_keys
                    .entry(b)
                    .or_insert_with(|| blob_key(doc.blobs.bytes(b).unwrap_or_default()).into())
                    .clone();
                if !blobs_by_key.contains_key(&key) && !new_blobs.iter().any(|(k, _)| *k == key) {
                    new_blobs.push((key.clone(), b));
                }
                BlobRef::Shared(key)
            };
            let value = base64(&Writer::new(&mut blob).node(&state));
            let h = value_hash(&value);
            if synced.get(&g) == Some(&h) {
                continue;
            }
            synced.insert(g, h);
            for (key, b) in new_blobs {
                let bytes = doc.blobs.bytes(b).unwrap_or_default();
                extra.push(EntryChange::set(container::BLOBS, &*key, base64(bytes)));
                blobs_by_key.insert(key, b);
            }
            let mut hashes = Vec::new();
            codec::image_hashes(&node.props, &mut hashes);
            for hash in hashes {
                if !images_shared.insert(hash.to_string()) {
                    continue;
                }
                if let Some(bytes) = doc.images.get(&*hash)
                    && bytes.len() <= MAX_SHARED_IMAGE_BYTES
                {
                    extra.push(EntryChange::set(
                        container::IMAGES,
                        hash.to_string(),
                        base64(bytes),
                    ));
                }
            }
            nodes.push(EntryChange::set(container::NODES, g.to_string(), value));
        }
        extra.extend(nodes);
        extra
    }

    /// Applies entry changes made by other peers. Entries referencing blobs
    /// that have not arrived wait for them; nodes whose parent has not
    /// arrived stay detached until it does.
    pub fn apply(&mut self, doc: &mut Document, changes: &[EntryChange]) -> Remote {
        let mut remote = Remote::default();
        for c in changes {
            let Some(value) = &c.value else { continue };
            match c.container.as_str() {
                container::IMAGES => {
                    let hash = c.key.to_ascii_lowercase();
                    if !doc.images.contains_key(&hash)
                        && let Some(bytes) = unbase64(value)
                        && doc.add_image(&hash, bytes).is_some()
                    {
                        remote.images.push(hash.clone());
                    }
                    self.images_shared.insert(hash);
                }
                container::BLOBS => {
                    let key: Arc<str> = c.key.as_str().into();
                    if !self.blobs_by_key.contains_key(&key)
                        && let Some(bytes) = unbase64(value)
                    {
                        let at = doc.blobs.push(&bytes);
                        self.blobs_by_key.insert(key.clone(), at);
                        self.blob_keys.insert(at, key);
                    }
                }
                _ => {}
            }
        }

        // The latest value per node: waiting entries first, then these.
        let mut entries: Vec<(Guid, String)> = self.pending.drain().collect();
        for c in changes {
            if c.container != container::NODES {
                continue;
            }
            let (Some(g), Some(value)) = (Guid::parse(&c.key), &c.value) else {
                continue;
            };
            entries.retain(|(e, _)| *e != g);
            entries.push((g, value.clone()));
        }

        let mut states = Vec::new();
        {
            let original = doc.original_blobs as u32;
            let blobs_by_key = &self.blobs_by_key;
            let resolve = |r: &BlobRef| match r {
                BlobRef::Base(i) => (*i < original).then_some(*i),
                BlobRef::Shared(key) => blobs_by_key.get(key).copied(),
            };
            for (g, value) in entries {
                let h = value_hash(&value);
                if self.synced.get(&g) == Some(&h) {
                    continue;
                }
                let Some(bytes) = unbase64(&value) else {
                    continue;
                };
                match Reader::new(&bytes, &resolve).node() {
                    Ok(state) if state.props.guid == Some(g) => states.push((g, h, state)),
                    Err(DecodeError::Missing(_)) => {
                        self.pending.insert(g, value);
                    }
                    // Damaged, or written by a newer layout.
                    Ok(_) | Err(DecodeError::Invalid) => {}
                }
            }
        }

        let mut affected: HashSet<NodeIdx> = HashSet::new();
        let mut placed = Vec::new();
        let mut listed = HashMap::new();
        for (g, h, state) in states {
            let existing = doc.find(g);
            let i = match existing {
                Some(i) => i,
                None => {
                    let i = doc.nodes.len() as NodeIdx;
                    doc.nodes.push(Node {
                        props: Default::default(),
                        parent: None,
                        children: Vec::new(),
                        edits: flags::CREATED,
                        removed: true,
                        source: None,
                    });
                    doc.by_guid.insert(g, i);
                    i
                }
            };
            // Only nodes that changed place need their parents' children
            // derived again (most remote edits change properties alone).
            let old = doc.node(i);
            let moved = existing.is_none()
                || old.removed != state.removed
                || old.props.parent != state.props.parent
                || old.props.position != state.props.position
                || old
                    .parent
                    .is_some_and(|p| doc.node(p).children.contains(&i))
                    != state.listed;
            let f = self.flags.entry(g).or_default();
            *f |= state.edits & !flags::CREATED;
            let node = &mut doc.nodes[i as usize];
            // Whether the node is new to this peer's file decides how saving
            // writes it, whichever file the sender opened.
            let created = node.edits & flags::CREATED;
            if moved && let Some(p) = node.parent {
                affected.insert(p);
            }
            node.props = state.props;
            node.removed = state.removed;
            node.edits = ((node.edits | *f) & !flags::CREATED) | created;
            if created != 0 {
                node.source = state.source;
            }
            if let Some(key) = node.props.override_key {
                doc.by_override_key.insert(key, g);
            }
            self.synced.insert(g, h);
            if moved {
                listed.insert(i, state.listed);
                placed.push(i);
            }
            remote.touched.push(i);
        }
        // Earlier nodes whose parent may have arrived now.
        for g in self.unlinked.clone() {
            if let Some(i) = doc.find(g)
                && !placed.contains(&i)
            {
                placed.push(i);
            }
        }
        for i in placed {
            let parent_guid = doc.props(i).parent;
            let parent = parent_guid.and_then(|g| doc.find(g)).filter(|&p| p != i);
            if let Some(g) = doc.props(i).guid {
                if parent_guid.is_some() && parent.is_none() {
                    self.unlinked.insert(g);
                } else {
                    self.unlinked.remove(&g);
                }
            }
            doc.nodes[i as usize].parent = parent;
            if let Some(p) = parent {
                affected.insert(p);
            }
        }
        for p in relink_children(doc, &affected, &listed) {
            if !remote.touched.contains(&p) {
                remote.touched.push(p);
            }
        }
        doc.refresh_pages();
        remote
    }
}

/// Derives the children of `parents` from the nodes' parent links, ordered
/// by position (then id) as files order them: live nodes, and removed ones
/// that are listed (as `listed` says for nodes that just arrived, as the
/// current children say for the rest). Returns the parents whose children
/// changed.
fn relink_children(
    doc: &mut Document,
    parents: &HashSet<NodeIdx>,
    listed: &HashMap<NodeIdx, bool>,
) -> Vec<NodeIdx> {
    if parents.is_empty() {
        return Vec::new();
    }
    let mut lists: HashMap<NodeIdx, Vec<NodeIdx>> =
        parents.iter().map(|&p| (p, Vec::new())).collect();
    let current: HashMap<NodeIdx, HashSet<NodeIdx>> = parents
        .iter()
        .map(|&p| (p, doc.node(p).children.iter().copied().collect()))
        .collect();
    for (i, n) in doc.nodes.iter().enumerate() {
        let i = i as NodeIdx;
        let Some(p) = n.parent else { continue };
        let Some(list) = lists.get_mut(&p) else {
            continue;
        };
        let keep = !n.removed
            || listed
                .get(&i)
                .copied()
                .unwrap_or_else(|| current[&p].contains(&i));
        if keep {
            list.push(i);
        }
    }
    let mut changed = Vec::new();
    for (p, mut list) in lists {
        list.sort_by(|&a, &b| {
            let pa = &doc.nodes[a as usize].props;
            let pb = &doc.nodes[b as usize].props;
            pa.position
                .as_deref()
                .unwrap_or("")
                .cmp(pb.position.as_deref().unwrap_or(""))
                .then_with(|| pa.guid.cmp(&pb.guid))
        });
        let node = &mut doc.nodes[p as usize];
        if node.children != list {
            node.children = list;
            changed.push(p);
        }
    }
    changed.sort_unstable();
    changed
}

#[cfg(test)]
mod test;
