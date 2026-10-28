//! A decoded `.fig` file: every node change as a tree, the geometry blobs,
//! and the image files.

use crate::container::{Container, Encoded};
use crate::decode;
use crate::error::{FigError, Result, corrupt};
use crate::geometry::{self, ParsedPath};
use crate::kiwi::{Decoder, Flat, FlatShared, Kind, MsgRef, Reader, Schema};
use crate::model::{Guid, NodeType, PropValue, Props};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

/// Index of a node in [`Document::nodes`].
pub type NodeIdx = u32;

#[derive(Clone)]
pub struct Node {
    pub props: Props,
    pub parent: Option<NodeIdx>,
    pub children: Vec<NodeIdx>,
    /// Which properties were edited since the file was opened
    /// ([`crate::edit::flags`]); saving rewrites only those.
    pub edits: u64,
    /// Deleted by an edit (kept so undo can bring it back).
    pub removed: bool,
    /// For a copy made by an edit: the file node it was copied from, whose
    /// stored record saving starts from.
    pub source: Option<Guid>,
}

/// The binary blobs (path geometry, mostly) a file carries, kept in the
/// decompressed message they arrived in and parsed on first use.
pub struct Blobs {
    data: Vec<u8>,
    ranges: Vec<(u32, u32)>,
    paths: Vec<OnceLock<Option<Arc<ParsedPath>>>>,
}

impl Blobs {
    pub fn len(&self) -> usize {
        self.ranges.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }

    /// Adds a blob (new geometry from an edit); returns its index.
    pub fn push(&mut self, bytes: &[u8]) -> u32 {
        let at = self.data.len() as u32;
        self.data.extend_from_slice(bytes);
        self.ranges.push((at, bytes.len() as u32));
        self.paths.push(OnceLock::new());
        (self.ranges.len() - 1) as u32
    }

    pub fn bytes(&self, index: u32) -> Option<&[u8]> {
        let &(start, len) = self.ranges.get(index as usize)?;
        self.data.get(start as usize..(start + len) as usize)
    }

    /// The path a geometry blob encodes, parsed once.
    pub fn path(&self, index: u32) -> Option<Arc<ParsedPath>> {
        self.paths
            .get(index as usize)?
            .get_or_init(|| {
                self.bytes(index)
                    .and_then(geometry::parse_blob)
                    .map(Arc::new)
            })
            .clone()
    }
}

pub struct Document {
    /// Format version from the file header.
    pub version: u32,
    pub nodes: Vec<Node>,
    pub by_guid: HashMap<Guid, NodeIdx>,
    /// `overrideKey` → the node carrying it, for instance override paths.
    pub by_override_key: HashMap<Guid, Guid>,
    pub root: NodeIdx,
    /// The pages shown in the pages list, in order.
    pub pages: Vec<NodeIdx>,
    pub blobs: Blobs,
    /// Encoded image files by lowercase hex SHA-1.
    pub images: HashMap<String, Encoded>,
    /// Figma's own render of part of the first page.
    pub thumbnail: Option<Vec<u8>>,
    /// The file name Figma saved, from `meta.json`.
    pub file_name: Option<String>,
    /// Blobs the file arrived with; later ones were added by edits.
    pub original_blobs: usize,
    /// The next id for a node an edit creates (a session no node uses).
    pub next_guid: Guid,
    /// Glyph outlines laid out by edits: `(face and axis values, glyph)` → blob.
    pub glyph_cache: HashMap<(u64, u32), Option<u32>>,
    /// Records of layers pasted from another file, in this file's schema,
    /// which saving starts from (as a copy starts from its source's record).
    pub foreign: HashMap<Guid, Arc<[u8]>>,
    /// For a file opened lazily ([`Document::open_lazy`]): the nodes not
    /// decoded yet.
    pending: Option<Box<Pending>>,
}

impl Document {
    /// Decodes a `.fig` file (either container layout).
    pub fn open(bytes: &[u8]) -> Result<Document> {
        let container = Container::open(bytes)?;
        Self::from_container(container)
    }

    /// Decodes a `.fig` file whose image files stay in `bytes` (shared, so
    /// whoever keeps the file for saving does not hold a second copy).
    pub fn open_shared(bytes: &Arc<Vec<u8>>) -> Result<Document> {
        let container = Container::open_shared(bytes)?;
        Self::from_container(container)
    }

    pub fn from_container(container: Container) -> Result<Document> {
        Self::decode_container(container, false)
    }

    /// Opens a `.fig` file (as [`Document::open_shared`]) decoding only what
    /// its first page shows: every node's place in the tree is read, but
    /// only the pages, the internal canvas (styles, variables), the first
    /// page, and the components those use are decoded in full. The rest is
    /// decoded by [`Document::decode_page`], [`Document::decode_some`], or
    /// [`Document::complete`]; until [`Document::is_complete`], only scenes
    /// of decoded pages may be built, and nothing else may read the nodes.
    pub fn open_lazy(bytes: &Arc<Vec<u8>>) -> Result<Document> {
        let container = Container::open_shared(bytes)?;
        let mut doc = Self::decode_container(container, true)?;
        // The page picker needs every page's name and canvas color even
        // before its layers are decoded. These seeds do not expand children.
        doc.decode_closure(
            std::iter::once(doc.root)
                .chain(doc.pages.iter().copied())
                .collect(),
        )?;
        if let Some(&first) = doc.pages.first() {
            doc.decode_page(first)?;
        }
        Ok(doc)
    }

    fn decode_container(container: Container, lazy: bool) -> Result<Document> {
        let mut schema = Schema::decode(&container.schema)?;
        decode::restrict_schema(&mut schema);
        // Lazily, node changes are first read for their skeleton only.
        let skeleton = if lazy {
            let mut skeleton = Schema::decode(&container.schema)?;
            skeleton.keep_only("NodeChange", decode::SKELETON_FIELDS);
            Some(skeleton)
        } else {
            None
        };
        let assets = decode::assets::AssetIds::read(&container.schema, &container.message)?;
        let mut table = NodeTable::default();
        let MessageParts {
            blobs: ranges,
            images: embedded,
            node_def,
        } = read_message(
            &schema,
            skeleton.as_ref(),
            &container.message,
            &mut table,
            &assets,
        )?;
        let NodeTable {
            mut nodes,
            by_guid,
            by_override_key,
            starts,
            more,
        } = table;

        // Link parents; children are ordered by their fractional position.
        let mut root = None;
        for i in 0..nodes.len() {
            let parent = nodes[i].props.parent.and_then(|g| by_guid.get(&g).copied());
            match parent {
                Some(p) if p as usize != i => {
                    nodes[i].parent = Some(p);
                    nodes[p as usize].children.push(i as NodeIdx);
                }
                _ => {
                    if nodes[i].props.node_type() == NodeType::Document && root.is_none() {
                        root = Some(i as NodeIdx);
                    }
                }
            }
        }
        for i in 0..nodes.len() {
            if nodes[i].children.len() > 1 {
                let mut children = std::mem::take(&mut nodes[i].children);
                children.sort_by(|&a, &b| {
                    let pa = &nodes[a as usize].props;
                    let pb = &nodes[b as usize].props;
                    pa.position
                        .as_deref()
                        .unwrap_or("")
                        .cmp(pb.position.as_deref().unwrap_or(""))
                        .then_with(|| pa.guid.cmp(&pb.guid))
                });
                nodes[i].children = children;
            }
        }
        if !lazy {
            let all = 0..nodes.len() as NodeIdx;
            resolve_styles(&mut nodes, &by_guid, all);
        }
        let root = root
            .or_else(|| {
                nodes
                    .iter()
                    .position(|n| n.parent.is_none())
                    .map(|i| i as NodeIdx)
            })
            .ok_or_else(|| corrupt("the file has no document node"))?;
        let pages: Vec<NodeIdx> = nodes[root as usize]
            .children
            .iter()
            .copied()
            .filter(|&c| {
                let p = &nodes[c as usize].props;
                p.node_type() == NodeType::Canvas && !p.internal_only.unwrap_or(false)
            })
            .collect();
        if pages.is_empty() {
            return Err(FigError::Unsupported("the file has no pages".into()));
        }

        let file_name = container
            .meta
            .as_ref()
            .and_then(|m| m.get("file_name"))
            .and_then(|n| n.as_str())
            .map(str::to_owned);
        // Keep only the blob bytes; the rest of the message has been read.
        let total: usize = ranges.iter().map(|&(_, len)| len as usize).sum();
        let mut data = Vec::with_capacity(total);
        let ranges: Vec<(u32, u32)> = ranges
            .into_iter()
            .map(|(start, len)| {
                let at = data.len() as u32;
                let bytes = container
                    .message
                    .get(start as usize..(start + len) as usize)
                    .unwrap_or_default();
                data.extend_from_slice(bytes);
                (at, bytes.len() as u32)
            })
            .collect();
        let mut images = container.images;
        for (hash, blob) in embedded {
            if let Some(&(start, len)) = ranges.get(blob as usize) {
                images.entry(hash).or_insert_with(|| {
                    Encoded::Owned(data[start as usize..(start + len) as usize].to_vec())
                });
            }
        }
        let pending = match node_def {
            Some(node_def) if lazy => {
                let remaining = starts.iter().filter(|&&s| s != DECODED).count();
                let expanded = vec![false; nodes.len()];
                Some(Box::new(Pending {
                    schema,
                    node_def,
                    message: container.message,
                    starts,
                    more,
                    expanded,
                    remaining,
                    cursor: 0,
                    shared: FlatShared::default(),
                    assets,
                }))
            }
            _ => {
                drop(container.message);
                None
            }
        };
        let original_blobs = ranges.len();
        let next_guid = Guid {
            session: nodes
                .iter()
                .filter_map(|n| n.props.guid)
                .map(|g| g.session)
                // Copies of library assets keep sessions of their own.
                .filter(|&s| s < crate::edit::LIBRARY_SESSIONS)
                .max()
                .unwrap_or(0)
                .saturating_add(1),
            local: 1,
        };
        let paths = (0..ranges.len()).map(|_| OnceLock::new()).collect();
        Ok(Document {
            version: container.version,
            nodes,
            by_guid,
            by_override_key,
            root,
            pages,
            blobs: Blobs {
                data,
                ranges,
                paths,
            },
            images,
            thumbnail: container.thumbnail,
            file_name,
            original_blobs,
            next_guid,
            glyph_cache: HashMap::new(),
            foreign: HashMap::new(),
            pending,
        })
    }

    /// Whether every node is decoded (always, unless opened lazily).
    pub fn is_complete(&self) -> bool {
        self.pending.is_none()
    }

    /// Whether node `index` is decoded.
    pub fn is_decoded(&self, index: NodeIdx) -> bool {
        self.pending
            .as_ref()
            .is_none_or(|p| p.starts.get(index as usize) == Some(&DECODED))
    }

    /// Decodes a page (or any subtree) of a lazily opened file, with the
    /// components and styles it uses.
    pub fn decode_page(&mut self, page: NodeIdx) -> Result<()> {
        if self.is_complete() {
            return Ok(());
        }
        let mut seeds = Vec::new();
        let mut stack = vec![page];
        while let Some(n) = stack.pop() {
            seeds.push(n);
            stack.extend(&self.nodes[n as usize].children);
        }
        self.decode_closure(seeds)
    }

    /// Decodes about `count` more nodes of a lazily opened file (with what
    /// they use); returns whether the file is complete.
    pub fn decode_some(&mut self, count: usize) -> Result<bool> {
        let Some(pending) = &mut self.pending else {
            return Ok(true);
        };
        let mut seeds = Vec::with_capacity(count.min(pending.remaining));
        while seeds.len() < count && pending.cursor < pending.starts.len() {
            if pending.starts[pending.cursor] != DECODED {
                seeds.push(pending.cursor as NodeIdx);
            }
            pending.cursor += 1;
        }
        self.decode_closure(seeds)?;
        Ok(self.is_complete())
    }

    /// Decodes everything a lazily opened file has not decoded yet.
    pub fn complete(&mut self) -> Result<()> {
        while !self.decode_some(usize::MAX)? {}
        Ok(())
    }

    /// Decodes the pending nodes among `seeds`, then what they use: the
    /// components their instances (and swaps) show, whole and with their
    /// ancestors (component sets), and their shared styles.
    fn decode_closure(&mut self, seeds: Vec<NodeIdx>) -> Result<()> {
        let Some(mut pending) = self.pending.take() else {
            return Ok(());
        };
        let result = self.decode_with(&mut pending, seeds);
        if pending.remaining > 0 {
            self.pending = Some(pending);
        }
        result
    }

    fn decode_with(&mut self, pending: &mut Pending, mut work: Vec<NodeIdx>) -> Result<()> {
        let Pending {
            schema,
            node_def,
            message,
            starts,
            more,
            expanded,
            remaining,
            shared,
            assets,
            ..
        } = pending;
        let mut flat = Flat::with_shared(message, std::mem::take(shared));
        let mut decoded = Vec::new();
        let mut embedded = Vec::new();
        let mut refs = Vec::new();
        let mut seen = HashSet::new();
        let mut failed = None;
        // Seeds first, in order: what they use is pushed after them.
        work.reverse();
        while let Some(i) = work.pop() {
            let at = i as usize;
            if starts[at] == DECODED {
                continue;
            }
            if decoded.len() % RESERVE_EVERY == 0 {
                reserve_heap(RESERVE_BYTES);
            }
            let later = more.get(&i).map(Vec::as_slice).unwrap_or_default();
            let mut props: Option<Props> = None;
            for &start in std::iter::once(&starts[at]).chain(later) {
                flat.clear();
                let mut r = Reader {
                    bytes: message,
                    at: start as usize,
                };
                let slot = match flat.decode(schema, &mut r, *node_def) {
                    Ok(slot) => slot,
                    Err(e) => {
                        failed.get_or_insert(e);
                        continue;
                    }
                };
                let m = MsgRef::flat(schema, &flat, slot);
                decode::embedded_images(&m, &mut embedded);
                let p = decode::props_with_assets(m, assets);
                match &mut props {
                    Some(first) => first.merge(&p),
                    None => props = Some(p),
                }
            }
            starts[at] = DECODED;
            *remaining -= 1;
            let Some(props) = props else { continue };
            refs.clear();
            references(&props, &mut refs, &mut seen);
            self.nodes[at].props = props;
            decoded.push(i);
            for g in &refs {
                let Some(&r) = self.by_guid.get(g) else {
                    continue;
                };
                // A component's whole subtree is instantiated, and its
                // ancestors (a component set) describe its variants.
                if std::mem::replace(&mut expanded[r as usize], true) {
                    continue;
                }
                let mut stack = vec![r];
                while let Some(n) = stack.pop() {
                    if starts[n as usize] != DECODED {
                        work.push(n);
                    }
                    stack.extend(&self.nodes[n as usize].children);
                }
                let mut up = self.nodes[r as usize].parent;
                while let Some(a) = up {
                    if starts[a as usize] != DECODED {
                        work.push(a);
                    }
                    up = self.nodes[a as usize].parent;
                }
            }
        }
        *shared = flat.into_shared();
        decoded.sort_unstable();
        resolve_styles(&mut self.nodes, &self.by_guid, decoded.iter().copied());
        for (hash, blob) in embedded {
            if let Some(bytes) = self.blobs.bytes(blob) {
                let bytes = bytes.to_vec();
                self.images.entry(hash).or_insert(Encoded::Owned(bytes));
            }
        }
        failed.map_or(Ok(()), Err)
    }

    /// Adds an encoded image (PNG, JPEG, GIF, or WebP) for image fills,
    /// under its SHA-1 `hash` (hex). Returns its pixel size, or `None` when
    /// it does not decode.
    pub fn add_image(&mut self, hash: &str, bytes: Vec<u8>) -> Option<(u32, u32)> {
        let pixmap = crate::images::decode(&bytes)?;
        self.images
            .insert(hash.to_ascii_lowercase(), Encoded::Owned(bytes));
        Some((pixmap.width(), pixmap.height()))
    }

    /// Recomputes [`Document::pages`] after edits added or removed pages.
    pub fn refresh_pages(&mut self) {
        let root = self.root;
        self.pages = self.nodes[root as usize]
            .children
            .iter()
            .copied()
            .filter(|&c| {
                let n = &self.nodes[c as usize];
                n.props.node_type() == NodeType::Canvas
                    && !n.removed
                    && !n.props.internal_only.unwrap_or(false)
            })
            .collect();
    }

    /// A fresh node id.
    pub fn new_guid(&mut self) -> Guid {
        let g = self.next_guid;
        self.next_guid.local += 1;
        g
    }

    /// Node → page transform (document nodes; pages are the identity).
    pub fn world(&self, index: NodeIdx) -> crate::model::Affine {
        let mut chain = Vec::new();
        let mut at = Some(index);
        while let Some(i) = at {
            let t = self.props(i).node_type();
            if matches!(t, NodeType::Canvas | NodeType::Document) {
                break;
            }
            chain.push(i);
            at = self.nodes[i as usize].parent;
        }
        chain
            .iter()
            .rev()
            .fold(crate::model::Affine::IDENTITY, |acc, &i| {
                acc.mul(&self.props(i).transform())
            })
    }

    /// The page a node is on, if it is attached to one.
    pub fn page_of(&self, index: NodeIdx) -> Option<NodeIdx> {
        let mut at = index;
        loop {
            if self.props(at).node_type() == NodeType::Canvas {
                return Some(at);
            }
            at = self.nodes[at as usize].parent?;
        }
    }

    pub fn node(&self, index: NodeIdx) -> &Node {
        &self.nodes[index as usize]
    }

    pub fn props(&self, index: NodeIdx) -> &Props {
        &self.nodes[index as usize].props
    }

    pub fn find(&self, guid: Guid) -> Option<NodeIdx> {
        self.by_guid.get(&guid).copied()
    }

    /// The page's canvas color.
    pub fn page_background(&self, page: NodeIdx) -> crate::model::Color {
        self.props(page)
            .background_color
            .unwrap_or(crate::model::Color {
                r: 0.96,
                g: 0.96,
                b: 0.96,
                a: 1.0,
            })
    }
}

/// In the browser, makes sure the heap has `bytes` free, growing it at once
/// if not. The wasm allocator otherwise grows memory a page at a time as
/// nodes arrive, and every growth costs the browser a new view of all of
/// memory: a large file paid seconds for them.
fn reserve_heap(bytes: usize) {
    #[cfg(target_arch = "wasm32")]
    {
        // Freed at once: the allocator keeps the memory and hands it out
        // again (wasm memory never shrinks).
        drop(std::hint::black_box(Vec::<u8>::with_capacity(bytes)));
    }
    #[cfg(not(target_arch = "wasm32"))]
    let _ = bytes;
}

/// How often decoding makes room ahead ([`reserve_heap`]), in node changes,
/// and how much.
const RESERVE_EVERY: usize = 1024;
const RESERVE_BYTES: usize = 8 << 20;

/// Nodes that use shared styles show the styles' paints and effects, which
/// is what Figma draws: a node's own copy can be stale or empty (when the
/// style's paints came from a library).
fn resolve_styles(
    nodes: &mut [Node],
    by_guid: &HashMap<Guid, NodeIdx>,
    which: impl Iterator<Item = NodeIdx>,
) {
    let style = |g: Option<Guid>| by_guid.get(&g?).copied();
    for i in which {
        let i = i as usize;
        let p = &nodes[i].props;
        let (fill, stroke, effect) = (
            style(p.fill_style),
            style(p.stroke_style),
            style(p.effect_style),
        );
        if let Some(s) = fill
            && let Some(fills) = nodes[s as usize].props.fills.clone()
        {
            nodes[i].props.fills = Some(fills);
        }
        if let Some(s) = stroke
            && let Some(fills) = nodes[s as usize].props.fills.clone()
        {
            nodes[i].props.strokes = Some(fills);
        }
        if let Some(s) = effect
            && let Some(effects) = nodes[s as usize].props.effects.clone()
        {
            nodes[i].props.effects = Some(effects);
        }
    }
}

/// [`Pending::starts`] of a node that is decoded.
const DECODED: u32 = u32::MAX;

/// What a lazily opened file has not decoded yet: the message, and where
/// each node's records are in it.
struct Pending {
    /// The schema nodes are decoded with ([`decode::restrict_schema`]).
    schema: Schema,
    node_def: u32,
    message: Vec<u8>,
    /// Per node, where its first record starts in `message` ([`DECODED`]
    /// once it is decoded).
    starts: Vec<u32>,
    /// Later records of the same nodes (clipboard data), in file order.
    more: HashMap<NodeIdx, Vec<u32>>,
    /// Nodes whose whole subtree was decoded for what uses them.
    expanded: Vec<bool>,
    /// How many nodes are not decoded.
    remaining: usize,
    /// Where [`Document::decode_some`] goes on from.
    cursor: usize,
    /// What decoded node changes share ([`MsgRef::shared`]).
    shared: FlatShared,
    assets: decode::assets::AssetIds,
}

/// The nodes `p` draws from besides its subtree: the components its
/// instance, overrides, and property values show, and its shared styles.
/// `seen` skips lists shared by many nodes after the first.
fn references(p: &Props, out: &mut Vec<Guid>, seen: &mut HashSet<usize>) {
    out.extend(p.swapped_symbol);
    for paint in p
        .fills()
        .iter()
        .chain(p.strokes())
        .chain(
            p.text_content
                .iter()
                .flat_map(|t| t.styles.iter())
                .flat_map(|s| s.fills.iter().flat_map(|p| p.iter())),
        )
        .chain(
            p.vector_styles
                .iter()
                .flat_map(|s| s.iter())
                .flat_map(|s| s.fills.iter().flat_map(|p| p.iter())),
        )
    {
        if let crate::model::PaintKind::Pattern(pattern) = &paint.kind {
            out.push(pattern.source);
        }
    }
    out.extend(
        p.fills()
            .iter()
            .chain(p.strokes())
            .filter_map(|p| p.color_var),
    );
    for style in p
        .text_content
        .iter()
        .flat_map(|t| t.styles.iter())
        .chain(p.vector_styles.iter().flat_map(|s| s.iter()))
    {
        out.extend(
            style
                .fills
                .iter()
                .flat_map(|f| f.iter())
                .filter_map(|p| p.color_var),
        );
    }
    if let Some(variable) = &p.variable {
        out.extend(variable.set);
        out.extend(variable.values.iter().filter_map(|(_, value)| match value {
            crate::model::VariableValue::Alias(id) => Some(*id),
            _ => None,
        }));
    }
    out.extend(
        p.mode_by_set
            .iter()
            .flat_map(|m| m.iter())
            .map(|(set, _)| *set),
    );
    out.extend(
        [
            p.fill_style,
            p.stroke_style,
            p.effect_style,
            p.text_style_id,
        ]
        .into_iter()
        .flatten(),
    );
    for a in p.prop_assignments.iter().flat_map(|a| a.iter()) {
        if let PropValue::Symbol(g) = a.value {
            out.push(g);
        }
    }
    for d in p.prop_defs.iter().flat_map(|d| d.iter()) {
        if let Some(PropValue::Symbol(g)) = d.initial {
            out.push(g);
        }
    }
    if let Some(s) = &p.symbol {
        out.extend(s.symbol_id);
        if seen.insert(s.overrides.as_ptr() as usize) {
            for o in s.overrides.iter() {
                references(o, out, seen);
            }
        }
    }
    for list in [&p.derived, &p.generated].into_iter().flatten() {
        if seen.insert(list.as_ptr() as usize) {
            for d in list.iter() {
                references(d, out, seen);
            }
        }
    }
}

/// The nodes of a file as its node changes stream in, so each decoded node is
/// moved once rather than staged in a second list of the whole file.
#[derive(Default)]
struct NodeTable {
    nodes: Vec<Node>,
    by_guid: HashMap<Guid, NodeIdx>,
    by_override_key: HashMap<Guid, Guid>,
    /// Read lazily: where each node's first record starts.
    starts: Vec<u32>,
    /// Read lazily: later records of the same nodes.
    more: HashMap<NodeIdx, Vec<u32>>,
}

impl NodeTable {
    fn reserve(&mut self, count: usize) {
        self.nodes.reserve(count);
        self.by_guid.reserve(count);
    }

    /// Adds a decoded node, or (`start`, read lazily) a node's skeleton
    /// and where its record starts.
    fn add(&mut self, p: Props, start: Option<u32>) {
        let Some(guid) = p.guid else { return };
        if let Some(key) = p.override_key {
            self.by_override_key.insert(key, guid);
        }
        match self.by_guid.get(&guid) {
            // A later change to the same node (clipboard data) updates it.
            Some(&existing) => {
                self.nodes[existing as usize].props.merge(&p);
                if let Some(start) = start {
                    self.more.entry(existing).or_default().push(start);
                }
            }
            None => {
                if let Some(start) = start {
                    self.starts.push(start);
                }
                self.by_guid.insert(guid, self.nodes.len() as NodeIdx);
                self.nodes.push(Node {
                    props: p,
                    parent: None,
                    children: Vec::new(),
                    edits: 0,
                    removed: false,
                    source: None,
                });
            }
        }
    }
}

/// What [`read_message`] returns besides the nodes.
struct MessageParts {
    /// The blobs, as ranges of the message.
    blobs: Vec<(u32, u32)>,
    /// Image files carried in blobs: hash and blob index.
    images: Vec<(String, u32)>,
    /// The `NodeChange` definition, when there were node changes.
    node_def: Option<u32>,
}

/// Reads the top-level `Message`, converting node changes one at a time so
/// the generic decoded form of the whole file never exists at once. Returns
/// the blobs as ranges of `data`, and the image files carried in blobs.
/// With a `skeleton` schema, node changes are read only for their skeleton
/// ([`decode::skeleton`]) and where they start.
fn read_message(
    schema: &Schema,
    skeleton: Option<&Schema>,
    data: &[u8],
    table: &mut NodeTable,
    assets: &decode::assets::AssetIds,
) -> Result<MessageParts> {
    let root = schema
        .def_index("Message")
        .ok_or_else(|| corrupt("the schema has no Message type"))?;
    let decoder = Decoder::new(schema);
    let mut r = Reader::new(data);
    let mut ranges = Vec::new();
    let mut images = Vec::new();
    let mut node_type = None;
    let mut flat = Flat::new(data);
    let def = schema.def(root);
    loop {
        let id = r.var_uint()?;
        if id == 0 {
            break;
        }
        let field = def
            .field_by_id(id)
            .ok_or_else(|| corrupt(format!("kiwi: Message has no field {id}")))?;
        match (field.name.as_str(), field.ty) {
            ("nodeChanges", crate::kiwi::Ty::Def(node_def)) if field.array => {
                node_type = Some(node_def);
                let count = r.var_uint()? as usize;
                table.reserve(count.min(1 << 20));
                for i in 0..count {
                    if i % RESERVE_EVERY == 0 {
                        reserve_heap(RESERVE_BYTES);
                    }
                    flat.clear();
                    let start = r.at as u32;
                    let slot = flat.decode(skeleton.unwrap_or(schema), &mut r, node_def)?;
                    let m = MsgRef::flat(skeleton.unwrap_or(schema), &flat, slot);
                    if decode::is_removed(&m) {
                        continue;
                    }
                    if skeleton.is_some() {
                        table.add(decode::skeleton(m), Some(start));
                    } else {
                        decode::embedded_images(&m, &mut images);
                        table.add(decode::props_with_assets(m, assets), None);
                    }
                }
            }
            ("blobs", crate::kiwi::Ty::Def(blob_def)) if field.array => {
                let count = r.var_uint()? as usize;
                ranges.reserve(count.min(1 << 20));
                for _ in 0..count {
                    ranges.push(read_blob(schema, &decoder, &mut r, blob_def)?);
                }
            }
            _ => decoder.skip_field(&mut r, field, 0)?,
        }
    }
    Ok(MessageParts {
        blobs: ranges,
        images,
        node_def: node_type,
    })
}

fn read_blob(
    schema: &Schema,
    decoder: &Decoder,
    r: &mut Reader,
    blob_def: u32,
) -> Result<(u32, u32)> {
    let def = schema.def(blob_def);
    let mut range = (0, 0);
    let mut read_field = |r: &mut Reader, field: &crate::kiwi::Field| -> Result<()> {
        if field.name == "bytes" && field.array && field.ty == crate::kiwi::Ty::Byte {
            let len = r.var_uint()?;
            let start = r.at as u32;
            r.take(len as usize)?;
            range = (start, len);
            Ok(())
        } else {
            decoder.skip_field(r, field, 0)
        }
    };
    match def.kind {
        Kind::Struct => {
            for field in &def.fields {
                read_field(r, field)?;
            }
        }
        Kind::Message => loop {
            let id = r.var_uint()?;
            if id == 0 {
                break;
            }
            let field = def
                .field_by_id(id)
                .ok_or_else(|| corrupt(format!("kiwi: Blob has no field {id}")))?;
            read_field(r, field)?;
        },
        Kind::Enum => return Err(corrupt("kiwi: Blob is an enum")),
    }
    Ok(range)
}

#[cfg(test)]
mod test;
