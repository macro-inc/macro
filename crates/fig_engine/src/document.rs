//! A decoded `.fig` file: every node change as a tree, the geometry blobs,
//! and the image files.

use crate::container::{Container, Encoded};
use crate::decode;
use crate::error::{FigError, Result, corrupt};
use crate::geometry::{self, ParsedPath};
use crate::kiwi::{Decoder, Flat, Kind, MsgRef, Reader, Schema};
use crate::model::{Guid, NodeType, Props};
use std::collections::HashMap;
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
        let mut schema = Schema::decode(&container.schema)?;
        decode::restrict_schema(&mut schema);
        let mut table = NodeTable::default();
        let MessageParts {
            blobs: ranges,
            images: embedded,
        } = read_message(&schema, &container.message, &mut table)?;
        let NodeTable {
            mut nodes,
            by_guid,
            by_override_key,
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
        resolve_styles(&mut nodes, &by_guid);
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
        drop(container.message);
        let original_blobs = ranges.len();
        let next_guid = Guid {
            session: nodes
                .iter()
                .filter_map(|n| n.props.guid)
                .map(|g| g.session)
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
        })
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

/// Nodes that use shared styles show the styles' paints and effects, which
/// is what Figma draws: a node's own copy can be stale or empty (when the
/// style's paints came from a library).
fn resolve_styles(nodes: &mut [Node], by_guid: &HashMap<Guid, NodeIdx>) {
    let style = |g: Option<Guid>| by_guid.get(&g?).copied();
    for i in 0..nodes.len() {
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

/// The nodes of a file as its node changes stream in, so each decoded node is
/// moved once rather than staged in a second list of the whole file.
#[derive(Default)]
struct NodeTable {
    nodes: Vec<Node>,
    by_guid: HashMap<Guid, NodeIdx>,
    by_override_key: HashMap<Guid, Guid>,
}

impl NodeTable {
    fn reserve(&mut self, count: usize) {
        self.nodes.reserve(count);
        self.by_guid.reserve(count);
    }

    fn add(&mut self, p: Props) {
        let Some(guid) = p.guid else { return };
        if let Some(key) = p.override_key {
            self.by_override_key.insert(key, guid);
        }
        match self.by_guid.get(&guid) {
            // A later change to the same node (clipboard data) updates it.
            Some(&existing) => self.nodes[existing as usize].props.merge(&p),
            None => {
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
}

/// Reads the top-level `Message`, converting node changes one at a time so
/// the generic decoded form of the whole file never exists at once. Returns
/// the blobs as ranges of `data`, and the image files carried in blobs.
fn read_message(schema: &Schema, data: &[u8], table: &mut NodeTable) -> Result<MessageParts> {
    let root = schema
        .def_index("Message")
        .ok_or_else(|| corrupt("the schema has no Message type"))?;
    let decoder = Decoder::new(schema);
    let mut r = Reader::new(data);
    let mut ranges = Vec::new();
    let mut images = Vec::new();
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
                let count = r.var_uint()? as usize;
                table.reserve(count.min(1 << 20));
                for _ in 0..count {
                    flat.clear();
                    let slot = flat.decode(schema, &mut r, node_def)?;
                    let m = MsgRef::flat(schema, &flat, slot);
                    if !decode::is_removed(&m) {
                        decode::embedded_images(&m, &mut images);
                        table.add(decode::props(m));
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
