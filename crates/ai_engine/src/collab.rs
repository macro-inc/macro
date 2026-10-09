//! Collaborative editing: a document shared as CRDT maps of node states.
//!
//! Every person opens the stored file, then applies the shared entries:
//!
//! | container | key | value |
//! | --- | --- | --- |
//! | `aiMeta` | `format` | entry layout version |
//! | `aiMeta` | `base`, `file:<fingerprint>`, `saved` | the stored files the entries apply to (the web app) |
//! | `aiDoc` | `state` | the artboards and document edit flags |
//! | `aiNodes` | node id | the node's whole state (JSON): properties, transform, parent and position, removed or not, edit flags, and its content when it is not as the stored file has it |
//! | `aiImages` | content hash | an image placed during the session (PNG or JPEG, base64) |
//!
//! A node state is absolute, so applying it is idempotent and concurrent
//! edits to one node resolve last-writer-wins. Order comes from fractional
//! positions, so concurrent moves and inserts merge. Node ids are the same
//! for everyone who opens a stored file (they are given in reading
//! order); new nodes get ids in the creator's session.

use crate::build::node_bounds;
use crate::edit::Applied;
use crate::geom::{Affine, Rect};
use crate::model::{AddedImage, Artboard, BlendMode, Document, Node, NodeIdx, NodeKind, flags};
use fig_engine::collab::position;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

pub use fig_engine::collab::EntryChange;

/// Version of the entry layout, stored in `aiMeta.format`.
pub const FORMAT_VERSION: u32 = 1;

/// Names of the maps that hold a collaborative document.
pub mod container {
    /// Format metadata and stored files.
    pub const META: &str = "aiMeta";
    /// Document-level state.
    pub const DOC: &str = "aiDoc";
    /// Node id → node state.
    pub const NODES: &str = "aiNodes";
    /// Content hash → placed image.
    pub const IMAGES: &str = "aiImages";
    /// Every container.
    pub const ALL: [&str; 4] = [META, DOC, NODES, IMAGES];
}

/// Keys of the `aiMeta` map the engine reads and writes.
pub mod meta {
    /// The entry layout version.
    pub const FORMAT: &str = "format";
}

/// The key of the document state in `aiDoc`.
pub const DOC_STATE: &str = "state";

/// Bits of a node id below its session.
const SESSION_SHIFT: u32 = 20;
/// The largest session.
pub const MAX_SESSION: u16 = 4095;

/// Edits after which a node's content is shared (else everyone has it
/// from the stored file).
const CONTENT: u64 =
    flags::CREATED | flags::GEOMETRY | flags::FILL | flags::STROKE | flags::TEXT | flags::CLIP;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeState {
    id: u32,
    parent: Option<u32>,
    position: String,
    removed: bool,
    edits: u64,
    name: String,
    hidden: bool,
    locked: bool,
    opacity: f32,
    blend: BlendMode,
    transform: Affine,
    artboard: u32,
    /// The node's content, when it is not as the stored file has it.
    kind: Option<NodeKind>,
    /// The stored file's node whose operators it draws with (a copy's
    /// original).
    source: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocState {
    artboards: Vec<Artboard>,
    edits: u64,
}

/// A placed image as shared.
#[derive(Serialize, Deserialize)]
struct ImageEntry {
    width: u32,
    height: u32,
    /// PNG of the pixels, or the JPEG they came from; base64.
    data: String,
    jpeg: bool,
}

/// What applying other people's changes did.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    /// Nodes that changed (indices).
    #[serde(skip)]
    pub touched: Vec<NodeIdx>,
    /// Canvas area to draw again.
    pub dirty: Option<Rect>,
    /// The layer tree or artboards changed.
    pub structure: bool,
}

fn hash(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h = (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// One person's view of the shared maps.
pub struct Collab {
    session: u32,
    positions: HashMap<u32, String>,
    /// Hash of each node state as last written or applied.
    states: HashMap<u32, u64>,
    /// Nodes changed here since the last [`Collab::changes`].
    dirty: BTreeSet<u32>,
    doc_state: u64,
    /// Images shared or received.
    images: BTreeSet<String>,
    /// Edit flags of every node changed during the collaboration.
    flags: HashMap<u32, u64>,
    /// Nodes whose parent has not arrived, with the parent's id.
    unlinked: HashMap<u32, u32>,
}

impl Collab {
    /// Starts collaborating on an opened document. New nodes get ids in
    /// `session` (`1..=4095`, unique among the people editing): its ids
    /// are `session << 20` and up, above the ids of a stored file's
    /// nodes.
    pub fn new(doc: &mut Document, session: u16) -> Collab {
        let session = u32::from(session.clamp(1, MAX_SESSION));
        let first = session << SESSION_SHIFT;
        let used = doc
            .nodes
            .iter()
            .map(|n| n.id)
            .chain(doc.artboards.iter().map(|a| a.id))
            .filter(|&id| id >> SESSION_SHIFT == session)
            .max();
        doc.next_id = used.map_or(first + 1, |m| m + 1);
        let mut collab = Collab {
            session,
            positions: HashMap::new(),
            states: HashMap::new(),
            dirty: BTreeSet::new(),
            doc_state: 0,
            images: doc.images.keys().cloned().collect(),
            flags: HashMap::new(),
            unlinked: HashMap::new(),
        };
        let stacks: Vec<Vec<NodeIdx>> = std::iter::once(doc.layers.clone())
            .chain(
                doc.nodes
                    .iter()
                    .filter(|n| n.is_container())
                    .map(|n| n.children.clone()),
            )
            .collect();
        for stack in stacks {
            for (&i, key) in stack.iter().zip(position::spread(stack.len())) {
                collab.positions.insert(doc.node(i).id, key);
            }
        }
        collab
    }

    /// The id session this person creates nodes in.
    pub fn session(&self) -> u32 {
        self.session
    }

    /// The entries a new shared document starts with.
    pub fn seed(&mut self, doc: &Document) -> Vec<EntryChange> {
        self.doc_state = 0;
        let mut out = vec![EntryChange {
            container: container::META.into(),
            key: meta::FORMAT.into(),
            value: Some(FORMAT_VERSION.to_string()),
        }];
        out.extend(self.changes(doc));
        out
    }

    /// Notes what a local step (an edit, undo, or redo) changed, so the
    /// next [`Collab::changes`] shares it.
    pub fn record(&mut self, doc: &Document, applied: &Applied) {
        for &i in &applied.touched {
            let n = doc.node(i);
            *self.flags.entry(n.id).or_default() |= n.edits;
            self.dirty.insert(n.id);
        }
        if applied.structure {
            self.reposition(doc, &applied.touched);
        }
    }

    /// Gives nodes whose stack order no longer matches their positions new
    /// positions between their neighbors.
    fn reposition(&mut self, doc: &Document, touched: &[NodeIdx]) {
        let mut stacks: Vec<Option<NodeIdx>> = vec![None];
        for &i in touched {
            let p = doc.node(i).parent;
            if !stacks.contains(&p) {
                stacks.push(p);
            }
            if doc.node(i).is_container() && !stacks.contains(&Some(i)) {
                stacks.push(Some(i));
            }
        }
        for parent in stacks {
            let stack: Vec<NodeIdx> = match parent {
                Some(p) => doc.node(p).children.clone(),
                None => doc.layers.clone(),
            };
            let ids: Vec<u32> = stack.iter().map(|&i| doc.node(i).id).collect();
            for k in 0..ids.len() {
                let below = (k > 0)
                    .then(|| self.positions.get(&ids[k - 1]).cloned())
                    .flatten();
                let above = ids[k + 1..]
                    .iter()
                    .find_map(|id| self.positions.get(id).cloned())
                    .filter(|a| below.as_ref().is_none_or(|b| b < a));
                let current = self.positions.get(&ids[k]);
                let fits = current.is_some_and(|c| {
                    below.as_ref().is_none_or(|b| b < c) && above.as_ref().is_none_or(|a| c < a)
                });
                if !fits {
                    let key = position::between(below.as_deref(), above.as_deref());
                    self.positions.insert(ids[k], key);
                    self.dirty.insert(ids[k]);
                }
            }
        }
    }

    fn state_of(&self, doc: &Document, n: &Node) -> NodeState {
        let edits = n.edits | self.flags.get(&n.id).copied().unwrap_or(0);
        NodeState {
            id: n.id,
            parent: n.parent.map(|p| doc.node(p).id),
            position: self.positions.get(&n.id).cloned().unwrap_or_default(),
            removed: n.removed,
            edits,
            name: n.name.clone(),
            hidden: n.hidden,
            locked: n.locked,
            opacity: n.opacity,
            blend: n.blend,
            transform: n.transform,
            artboard: n.artboard,
            kind: (edits & CONTENT != 0).then(|| n.kind.clone()),
            source: n.source.as_ref().map(|s| s.origin),
        }
    }

    /// The entry changes that bring the shared maps up to date with this
    /// person's steps since the last call.
    pub fn changes(&mut self, doc: &Document) -> Vec<EntryChange> {
        let mut out = Vec::new();
        for (hash_key, img) in &doc.images {
            if self.images.contains(hash_key) {
                continue;
            }
            self.images.insert(hash_key.clone());
            if let Some(value) = image_entry(img) {
                out.push(EntryChange {
                    container: container::IMAGES.into(),
                    key: hash_key.clone(),
                    value: Some(value),
                });
            }
        }
        let state = DocState {
            artboards: doc.artboards.clone(),
            edits: doc.edits,
        };
        if let Ok(json) = serde_json::to_string(&state) {
            let h = hash(&json);
            if h != self.doc_state {
                self.doc_state = h;
                out.push(EntryChange {
                    container: container::DOC.into(),
                    key: DOC_STATE.into(),
                    value: Some(json),
                });
            }
        }
        let dirty = std::mem::take(&mut self.dirty);
        for id in dirty {
            let Some(i) = doc.find(id) else { continue };
            let state = self.state_of(doc, doc.node(i));
            if let Ok(json) = serde_json::to_string(&state) {
                let h = hash(&json);
                if self.states.get(&id) != Some(&h) {
                    self.states.insert(id, h);
                    out.push(EntryChange {
                        container: container::NODES.into(),
                        key: id.to_string(),
                        value: Some(json),
                    });
                }
            }
        }
        out
    }

    /// Applies entry changes made by other people.
    pub fn apply(&mut self, doc: &mut Document, changes: &[EntryChange]) -> Remote {
        let mut remote = Remote::default();
        let mut dirty: Option<Rect> = None;
        let grow = |r: Option<Rect>, d: &mut Option<Rect>| {
            if let Some(r) = r.filter(|r| !r.is_empty()) {
                *d = Some(d.map_or(r, |x| x.union(&r)));
            }
        };

        // Images first: nodes show them.
        for c in changes.iter().filter(|c| c.container == container::IMAGES) {
            let Some(value) = &c.value else { continue };
            if doc.images.contains_key(&c.key) {
                continue;
            }
            if let Some(img) = read_image_entry(value) {
                doc.images.insert(c.key.clone(), img);
                self.images.insert(c.key.clone());
            }
        }

        for c in changes.iter().filter(|c| c.container == container::DOC) {
            let Some(value) = &c.value else { continue };
            let h = hash(value);
            if h == self.doc_state {
                continue;
            }
            let Ok(state) = serde_json::from_str::<DocState>(value) else {
                continue;
            };
            self.doc_state = h;
            for a in doc.artboards.iter().chain(&state.artboards) {
                grow(Some(a.rect), &mut dirty);
            }
            doc.artboards = state.artboards;
            doc.edits |= state.edits;
            for a in &doc.artboards {
                if a.id >> SESSION_SHIFT == self.session {
                    doc.next_id = doc.next_id.max(a.id + 1);
                }
            }
            remote.structure = true;
        }

        // Node states, the newest per node.
        let mut states: BTreeMap<u32, NodeState> = BTreeMap::new();
        for c in changes.iter().filter(|c| c.container == container::NODES) {
            let (Ok(id), Some(value)) = (c.key.parse::<u32>(), &c.value) else {
                continue;
            };
            let h = hash(value);
            if self.states.get(&id) == Some(&h) {
                continue;
            }
            if let Ok(state) = serde_json::from_str::<NodeState>(value) {
                self.states.insert(id, h);
                states.insert(id, state);
            }
        }
        let mut parents: BTreeSet<Option<NodeIdx>> = BTreeSet::new();
        for (id, state) in states {
            let existing = doc.find(id);
            let i = match existing {
                Some(i) => i,
                None => {
                    let Some(kind) = state.kind.clone() else {
                        // A node of a stored file this person doesn't have.
                        continue;
                    };
                    let mut node = Node::new(id, kind);
                    node.removed = true;
                    doc.push(node)
                }
            };
            grow(node_bounds(doc, i), &mut dirty);
            let old_parent = doc.node(i).parent;
            let was_listed = !doc.node(i).removed;
            *self.flags.entry(id).or_default() |= state.edits;
            let new_parent = state.parent.and_then(|p| doc.find(p));
            match state.parent {
                Some(p) if new_parent.is_none() => {
                    self.unlinked.insert(id, p);
                }
                _ => {
                    self.unlinked.remove(&id);
                }
            }
            self.positions.insert(id, state.position.clone());
            let source = state
                .source
                .and_then(|origin| doc.find(origin).and_then(|o| doc.node(o).source.clone()));
            {
                let n = doc.node_mut(i);
                if let Some(kind) = state.kind {
                    n.kind = kind;
                }
                n.name = state.name;
                n.hidden = state.hidden;
                n.locked = state.locked;
                n.opacity = state.opacity;
                n.blend = state.blend;
                n.transform = state.transform;
                n.artboard = state.artboard;
                n.edits |= state.edits;
                n.removed = state.removed;
                n.parent = new_parent;
                if n.source.is_none() {
                    n.source = source;
                }
            }
            let moved =
                old_parent != new_parent || was_listed == state.removed || existing.is_none();
            if moved {
                parents.insert(old_parent);
                parents.insert(new_parent);
                remote.structure = true;
            }
            grow(node_bounds(doc, i), &mut dirty);
            remote.touched.push(i);
            if id >> SESSION_SHIFT == self.session {
                doc.next_id = doc.next_id.max(id + 1);
            }
        }
        for (id, parent_id) in self.unlinked.clone() {
            let (Some(i), Some(p)) = (doc.find(id), doc.find(parent_id)) else {
                continue;
            };
            doc.node_mut(i).parent = Some(p);
            parents.insert(Some(p));
            self.unlinked.remove(&id);
            remote.structure = true;
        }
        if !parents.is_empty() {
            self.relink(doc, &parents);
        }
        remote.dirty = dirty;
        remote
    }

    /// Rebuilds stacks from parents and positions.
    fn relink(&self, doc: &mut Document, parents: &BTreeSet<Option<NodeIdx>>) {
        for &parent in parents {
            let mut members: Vec<(String, u32, NodeIdx)> = doc
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| n.parent == parent && !n.removed)
                .filter(|(_, n)| parent.is_some() || n.is_layer())
                .map(|(k, n)| {
                    (
                        self.positions.get(&n.id).cloned().unwrap_or_default(),
                        n.id,
                        k as NodeIdx,
                    )
                })
                .collect();
            members.sort();
            let stack: Vec<NodeIdx> = members.into_iter().map(|(_, _, i)| i).collect();
            match parent {
                Some(p) => doc.node_mut(p).children = stack,
                None => doc.layers = stack,
            }
        }
    }
}

/// A placed image as an entry value.
fn image_entry(img: &AddedImage) -> Option<String> {
    let (data, jpeg) = match &img.jpeg {
        Some(j) => (j.to_vec(), true),
        None => (
            crate::inspect::encode_png(img.width, img.height, &img.rgba)?,
            false,
        ),
    };
    serde_json::to_string(&ImageEntry {
        width: img.width,
        height: img.height,
        data: base64_encode(&data),
        jpeg,
    })
    .ok()
}

/// A placed image from an entry value.
fn read_image_entry(value: &str) -> Option<AddedImage> {
    let e: ImageEntry = serde_json::from_str(value).ok()?;
    let bytes = base64_decode(&e.data)?;
    let decoded = crate::inspect::decode_image(&bytes)?;
    if decoded.0 != e.width || decoded.1 != e.height {
        return None;
    }
    Some(AddedImage {
        width: e.width,
        height: e.height,
        rgba: decoded.2.into(),
        jpeg: e.jpeg.then(|| bytes.into()),
    })
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Base64 (standard alphabet, padded).
pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Decodes base64 (`None` on bad input).
pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        if c == b'=' {
            break;
        }
        let v = B64.iter().position(|&x| x == c)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod test;
