//! Copying a library's assets into a file, and updating the copies, as
//! Figma does: a library component becomes a component on the file's
//! internal canvas that keeps its key, its library, its id there, and the
//! version it was copied at; instances in the file show that copy.
//!
//! A package ([`crate::library::package()`]) holds the assets and what
//! they use. Every id in it (nodes, property definitions, modes, override
//! paths) moves into a session range of its own for that library
//! ([`LIBRARY_SESSIONS`] and up), the same for every copy, so a newer
//! version of an asset lands on the same nodes: an update replaces the
//! copy's layers in place, and instances keep their overrides (keyed by
//! those ids). Records come along translated into this file's schema, as
//! pasting does, so saving writes what the engine does not model.

use super::super::paste::{decode_records, translate};
use super::super::{Applied, History, Op, Txn, flags};
use crate::container::{Container, Encoded};
use crate::document::{Document, NodeIdx};
use crate::error::Result;
use crate::kiwi::{Msg, Schema, Value, Writer};
use crate::library::{asset_kind, hash, is_copy};
use crate::model::{
    Guid, LibraryLink, NodeType, Paint, PropValue, Props, StyleRun, TextContent, Variable,
    VariableValue, Vec2,
};
use crate::save::remap_blobs;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Copies of library assets have ids in sessions from here up (above the
/// sessions files and people editing together use).
pub const LIBRARY_SESSIONS: u32 = 1 << 31;

/// Where records of updated copies are kept (see [`crate::document::Node::source`]).
const RECORD_SESSION: u32 = u32::MAX - 1;

/// What [`History::import_library`] does.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySpec {
    /// The library: its document id (kept as the copies' source).
    pub library: String,
    /// Replace copies the file already has whose version differs ("Update");
    /// otherwise they are kept and only missing assets are copied.
    #[serde(default)]
    pub update: bool,
    /// Edits applied after, in the same step: placing an instance, applying
    /// a style, binding a variable. They name assets as `key:<key>`.
    #[serde(default)]
    pub then: Vec<Op>,
}

/// Library ids moved into the library's own sessions.
struct Ids {
    seed: [u8; 20],
    sessions: HashMap<u32, u32>,
}

impl Ids {
    fn new(library: &str) -> Ids {
        Ids {
            seed: hash::sha1(library.as_bytes()),
            sessions: HashMap::new(),
        }
    }

    fn map(&mut self, g: Guid) -> Guid {
        // Zero and all-ones ids mean "none" in places.
        if g == Guid::default() || g.session == u32::MAX {
            return g;
        }
        let seed = self.seed;
        let session = *self.sessions.entry(g.session).or_insert_with(|| {
            let mut data = seed.to_vec();
            data.extend_from_slice(&g.session.to_le_bytes());
            let d = hash::sha1(&data);
            LIBRARY_SESSIONS
                | (u32::from_le_bytes([d[0], d[1], d[2], d[3]]) & (LIBRARY_SESSIONS - 1))
        });
        Guid {
            session,
            local: g.local,
        }
    }
}

fn map_paints(paints: &mut Option<Arc<[Paint]>>, ids: &mut Ids) {
    if let Some(list) = paints
        && list.iter().any(|p| p.color_var.is_some())
    {
        *list = list
            .iter()
            .map(|p| {
                let mut p = p.clone();
                p.color_var = p.color_var.map(|g| ids.map(g));
                p
            })
            .collect();
    }
}

fn map_list(list: &mut Option<Arc<[Props]>>, ids: &mut Ids) {
    if let Some(l) = list {
        *l = l
            .iter()
            .map(|p| {
                let mut p = p.clone();
                map_ids(&mut p, ids);
                p
            })
            .collect();
    }
}

/// Moves every id `p` holds into the library's sessions.
fn map_ids(p: &mut Props, ids: &mut Ids) {
    let one = |g: &mut Option<Guid>, ids: &mut Ids| *g = g.map(|g| ids.map(g));
    one(&mut p.guid, ids);
    one(&mut p.parent, ids);
    one(&mut p.swapped_symbol, ids);
    one(&mut p.override_key, ids);
    one(&mut p.fill_style, ids);
    one(&mut p.stroke_style, ids);
    one(&mut p.effect_style, ids);
    one(&mut p.text_style_id, ids);
    one(&mut p.prototype_start, ids);
    map_paints(&mut p.fills, ids);
    map_paints(&mut p.strokes, ids);
    if let Some(s) = &p.symbol {
        let mut s = (**s).clone();
        s.symbol_id = s.symbol_id.map(|g| ids.map(g));
        let mut overrides = Some(s.overrides.clone());
        map_list(&mut overrides, ids);
        s.overrides = overrides.unwrap_or_else(|| Arc::from([]));
        p.symbol = Some(Arc::new(s));
    }
    map_list(&mut p.derived, ids);
    map_list(&mut p.generated, ids);
    let value = |v: &PropValue, ids: &mut Ids| match v {
        PropValue::Symbol(g) => PropValue::Symbol(ids.map(*g)),
        other => other.clone(),
    };
    if let Some(list) = &p.prop_assignments {
        p.prop_assignments = Some(
            list.iter()
                .map(|a| {
                    let mut a = a.clone();
                    a.def_id = ids.map(a.def_id);
                    a.value = value(&a.value, ids);
                    a
                })
                .collect(),
        );
    }
    if let Some(list) = &p.prop_refs {
        p.prop_refs = Some(
            list.iter()
                .map(|r| {
                    let mut r = r.clone();
                    r.def_id = ids.map(r.def_id);
                    r
                })
                .collect(),
        );
    }
    if let Some(list) = &p.prop_defs {
        p.prop_defs = Some(
            list.iter()
                .map(|d| {
                    let mut d = d.clone();
                    d.id = ids.map(d.id);
                    d.initial = d.initial.as_ref().map(|v| value(v, ids));
                    d
                })
                .collect(),
        );
    }
    if let Some(list) = &p.variant_specs {
        p.variant_specs = Some(
            list.iter()
                .map(|v| {
                    let mut v = v.clone();
                    v.def_id = ids.map(v.def_id);
                    v
                })
                .collect(),
        );
    }
    if let Some(path) = &p.guid_path {
        p.guid_path = Some(path.iter().map(|&g| ids.map(g)).collect());
    }
    if let Some(v) = &p.variable {
        p.variable = Some(Arc::new(Variable {
            set: v.set.map(|g| ids.map(g)),
            resolved_type: v.resolved_type,
            values: v
                .values
                .iter()
                .map(|(mode, value)| {
                    let value = match value {
                        VariableValue::Alias(g) => VariableValue::Alias(ids.map(*g)),
                        other => other.clone(),
                    };
                    (ids.map(*mode), value)
                })
                .collect(),
        }));
    }
    if let Some(modes) = &p.variable_modes {
        p.variable_modes = Some(
            modes
                .iter()
                .map(|m| {
                    let mut m = m.clone();
                    m.id = ids.map(m.id);
                    m
                })
                .collect(),
        );
    }
    if let Some(list) = &p.mode_by_set {
        p.mode_by_set = Some(
            list.iter()
                .map(|&(set, mode)| (ids.map(set), ids.map(mode)))
                .collect(),
        );
    }
    if let Some(t) = &p.text_content
        && t.styles.iter().any(|s| {
            s.fills
                .as_deref()
                .is_some_and(|f| f.iter().any(|x| x.color_var.is_some()))
        })
    {
        let styles: Arc<[StyleRun]> = t
            .styles
            .iter()
            .map(|s| {
                let mut s = s.clone();
                map_paints(&mut s.fills, ids);
                s
            })
            .collect();
        p.text_content = Some(Arc::new(TextContent {
            styles,
            ..(**t).clone()
        }));
    }
    if let Some(list) = &p.interactions {
        p.interactions = Some(
            list.iter()
                .map(|i| {
                    let mut i = i.clone();
                    i.id = i.id.map(|g| ids.map(g));
                    i.actions = i
                        .actions
                        .iter()
                        .map(|a| {
                            let mut a = a.clone();
                            a.destination = a.destination.map(|g| ids.map(g));
                            a
                        })
                        .collect();
                    i
                })
                .collect(),
        );
    }
}

/// Moves every id in a record (any `GUID` value) into the library's
/// sessions.
fn map_record_ids(schema: &Schema, v: &mut Value, ids: &mut Ids) {
    match v {
        Value::Msg(m) => {
            if schema.def(m.def).name == "GUID" {
                let part = |m: &Msg, f| match m.get(schema, f) {
                    Some(Value::Uint(x)) => *x,
                    _ => 0,
                };
                let g = ids.map(Guid {
                    session: part(m, "sessionID"),
                    local: part(m, "localID"),
                });
                m.set(schema, "sessionID", Value::Uint(g.session));
                m.set(schema, "localID", Value::Uint(g.local));
                return;
            }
            for (_, field) in m.fields.iter_mut() {
                map_record_ids(schema, field, ids);
            }
        }
        Value::List(items) => {
            for item in items {
                map_record_ids(schema, item, ids);
            }
        }
        _ => {}
    }
}

/// A package, opened.
struct Package {
    doc: Document,
    schema: Schema,
    records: HashMap<Guid, Msg>,
    /// The assets at its top, in order.
    roots: Vec<NodeIdx>,
}

impl Package {
    fn open(bytes: &[u8]) -> Result<Package> {
        let doc = Document::open(bytes)?;
        let container = Container::open_without_images(bytes)?;
        let schema = Schema::decode(&container.schema)?;
        let records = decode_records(&schema, &container.message)?;
        let roots = doc
            .node(doc.root)
            .children
            .iter()
            .filter(|&&c| doc.props(c).node_type() == NodeType::Canvas)
            .flat_map(|&c| doc.node(c).children.clone())
            .filter(|&n| !doc.node(n).removed)
            .collect();
        Ok(Package {
            doc,
            schema,
            records,
            roots,
        })
    }

    fn version(&self, n: NodeIdx) -> Option<Arc<str>> {
        let l = self.doc.props(n).library.as_ref()?;
        l.published_version.clone().or_else(|| l.version.clone())
    }
}

/// What an import shares while it walks the package.
struct Import<'a> {
    pkg: &'a Package,
    /// The file's schema (records are written in it).
    schema: &'a Schema,
    node_def: Option<u32>,
    library: &'a str,
    ids: Ids,
    blobs: HashMap<u32, u32>,
    /// Nodes placed (or replaced) so far.
    placed: HashSet<NodeIdx>,
}

/// What a step's records keep as they arrived, as pasting does: what makes
/// an instance (in older files partly under other names).
const KEPT_FROM_RECORD: u64 =
    flags::INSTANCE_OF | flags::OVERRIDES | flags::DERIVED | flags::PROP_ASSIGNMENTS;

impl History {
    /// Copies the assets of a library `package` (a `.fig` document from
    /// [`crate::library::package()`]; `images`, a ZIP of the images it
    /// uses) into `doc`, or updates the copies it has, as one undoable step
    /// (see [`LibrarySpec`]). `original` is the file `doc` was opened from.
    pub fn import_library(
        &mut self,
        doc: &mut Document,
        original: &[u8],
        package: &[u8],
        images: Option<&[u8]>,
        spec: &LibrarySpec,
    ) -> Result<Applied> {
        let pkg = Package::open(package)?;
        let container = Container::open_without_images(original)?;
        let schema = Schema::decode(&container.schema)?;
        if let Some(zip) = images.filter(|z| !z.is_empty()) {
            let archive = crate::zip::ZipArchive::new(zip)?;
            for entry in archive.entries() {
                if let Some(hash) = entry.name.strip_prefix("images/")
                    && !doc.images.contains_key(hash)
                {
                    let bytes = archive.read(entry)?;
                    doc.images
                        .insert(hash.to_ascii_lowercase(), Encoded::Owned(bytes));
                }
            }
        }
        for (hash, bytes) in &pkg.doc.images {
            doc.images
                .entry(hash.clone())
                .or_insert_with(|| bytes.clone());
        }
        self.run(doc, None, |txn| txn.import_library(&pkg, &schema, spec))
    }
}

impl Txn<'_> {
    fn import_library(&mut self, pkg: &Package, schema: &Schema, spec: &LibrarySpec) -> Result<()> {
        let mut cx = Import {
            pkg,
            schema,
            node_def: schema.def_index("NodeChange"),
            library: &spec.library,
            ids: Ids::new(&spec.library),
            blobs: HashMap::new(),
            placed: HashSet::new(),
        };
        let canvas = self.internal_canvas();
        let mut old_sizes: HashMap<NodeIdx, Vec2> = HashMap::new();
        let mut restyled = Vec::new();
        let mut revalued = false;
        for &r in &pkg.roots {
            let Some(g) = pkg.doc.props(r).guid else {
                continue;
            };
            let target = cx.ids.map(g);
            match self.doc.find(target).filter(|&c| !self.doc.node(c).removed) {
                Some(c) => {
                    let current = self
                        .doc
                        .props(c)
                        .library
                        .as_ref()
                        .and_then(|l| l.version.clone());
                    if !spec.update || current == pkg.version(r) {
                        continue;
                    }
                    let old = self.subtree(c);
                    for &n in &old {
                        if self.doc.props(n).node_type() == NodeType::Symbol {
                            old_sizes.insert(n, self.doc.props(n).size());
                        }
                    }
                    self.place(&mut cx, r, None)?;
                    self.drop_unplaced(&cx, &old, canvas);
                    match asset_kind(self.doc, c) {
                        Some(crate::library::AssetKind::Style) => restyled.push(c),
                        Some(
                            crate::library::AssetKind::Variable
                            | crate::library::AssetKind::Collection,
                        ) => revalued = true,
                        _ => {}
                    }
                }
                None => {
                    let at = self.doc.node(canvas).children.len();
                    self.place(&mut cx, r, Some((canvas, at)))?;
                }
            }
        }
        if !old_sizes.is_empty() {
            self.follow_components(&old_sizes)?;
        }
        for s in restyled {
            self.propagate_style(s)?;
        }
        if revalued {
            let root = self.doc.root;
            self.refresh_bound(root);
        }
        for op in &spec.then {
            self.apply(op)?;
        }
        Ok(())
    }

    /// `i` and its live descendants.
    fn subtree(&self, i: NodeIdx) -> Vec<NodeIdx> {
        let mut out = Vec::new();
        let mut stack = vec![i];
        while let Some(n) = stack.pop() {
            out.push(n);
            for &c in &self.doc.node(n).children {
                if !self.doc.node(c).removed {
                    stack.push(c);
                }
            }
        }
        out
    }

    /// The package's node `n` as this file has it.
    fn package_props(&mut self, cx: &mut Import, n: NodeIdx) -> Props {
        let source = cx.pkg.doc.props(n);
        let mut p = source.clone();
        let doc = &mut *self.doc;
        let pkg_doc = &cx.pkg.doc;
        let blobs = &mut cx.blobs;
        crate::edit::remap_props(&mut p, &mut |b| {
            *blobs.entry(b).or_insert_with(|| {
                let bytes = pkg_doc.blobs.bytes(b).unwrap_or_default().to_vec();
                doc.blobs.push(&bytes)
            })
        });
        map_ids(&mut p, &mut cx.ids);
        // Assets remember where they came from; other layers nothing.
        p.library = (p.key.is_some() && asset_kind(&cx.pkg.doc, n).is_some()).then(|| {
            Arc::new(LibraryLink {
                publishable: Some(false),
                version: cx.pkg.version(n),
                published_version: None,
                source: Some(cx.library.into()),
                publish_id: source.guid,
            })
        });
        p.macro_data = None;
        p
    }

    /// The package's record of node `n`, in this file's schema with its
    /// ids and blobs moved.
    fn package_record(&mut self, cx: &mut Import, n: NodeIdx) -> Option<Arc<[u8]>> {
        let def = cx.node_def?;
        let g = cx.pkg.doc.props(n).guid?;
        let m = cx.pkg.records.get(&g)?;
        let mut m = translate(&cx.pkg.schema, cx.schema, m, def);
        let mut v = Value::Msg(Box::new(std::mem::replace(&mut m, Msg::new(def))));
        map_record_ids(cx.schema, &mut v, &mut cx.ids);
        let doc = &mut *self.doc;
        let pkg_doc = &cx.pkg.doc;
        let blobs = &mut cx.blobs;
        remap_blobs(cx.schema, &mut v, &mut |b| {
            *blobs.entry(b).or_insert_with(|| {
                let bytes = pkg_doc.blobs.bytes(b).unwrap_or_default().to_vec();
                doc.blobs.push(&bytes)
            })
        });
        let Value::Msg(m) = v else { return None };
        let mut w = Writer::default();
        cx.schema.encode(&m, &mut w);
        Some(w.bytes.into())
    }

    /// Places the package's node `n` (and what it holds) in `parent` at
    /// an index, or, for the root of an update (`None`), where its copy is.
    fn place(
        &mut self,
        cx: &mut Import,
        n: NodeIdx,
        parent: Option<(NodeIdx, usize)>,
    ) -> Result<NodeIdx> {
        let mut props = self.package_props(cx, n);
        let record = self.package_record(cx, n);
        let guid = props.guid.unwrap_or_default();
        let i = match self.doc.find(guid) {
            Some(i) => {
                let node = self.touch(i);
                if parent.is_none() {
                    props.parent = node.props.parent;
                    props.position = node.props.position.clone();
                }
                node.props = props;
                node.removed = false;
                node.children.clear();
                node.edits |= !KEPT_FROM_RECORD & !flags::CREATED;
                let created = node.edits & flags::CREATED != 0;
                if let Some(bytes) = record {
                    if created {
                        self.doc.foreign.insert(guid, bytes);
                    } else {
                        // Saving starts from this record rather than the
                        // file's (undo puts the old one back).
                        let key = Guid {
                            session: RECORD_SESSION,
                            local: self.doc.foreign.len() as u32,
                        };
                        self.doc.foreign.insert(key, bytes);
                        self.touch(i).source = Some(key);
                    }
                }
                i
            }
            None => {
                let i = self.new_node(props);
                if let Some(bytes) = record {
                    self.doc.foreign.insert(guid, bytes);
                    self.touch(i).edits = !KEPT_FROM_RECORD;
                }
                i
            }
        };
        if let Some(key) = self.doc.props(i).override_key {
            self.doc.by_override_key.insert(key, guid);
        }
        if let Some((p, at)) = parent {
            self.attach(i, p, at, false);
        }
        cx.placed.insert(i);
        let children: Vec<NodeIdx> = cx
            .pkg
            .doc
            .node(n)
            .children
            .iter()
            .copied()
            .filter(|&c| !cx.pkg.doc.node(c).removed)
            .collect();
        for (k, c) in children.into_iter().enumerate() {
            self.place(cx, c, Some((i, k)))?;
        }
        Ok(i)
    }

    /// After an update: the copy's old layers the new version lacks go,
    /// but components the file's instances still show stay (on the
    /// internal canvas).
    fn drop_unplaced(&mut self, cx: &Import, old: &[NodeIdx], canvas: NodeIdx) {
        let shown: HashSet<Guid> = self
            .doc
            .nodes
            .iter()
            .filter(|n| !n.removed && n.props.node_type() == NodeType::Instance)
            .filter_map(|n| n.props.symbol.as_ref().and_then(|s| s.symbol_id))
            .collect();
        for &n in old {
            if cx.placed.contains(&n) {
                continue;
            }
            let p = self.doc.props(n);
            if p.node_type() == NodeType::Symbol && p.guid.is_some_and(|g| shown.contains(&g)) {
                let at = self.doc.node(canvas).children.len();
                self.attach(n, canvas, at, true);
                continue;
            }
            let node = self.touch(n);
            node.removed = true;
            node.edits |= flags::PARENT;
        }
    }

    /// Instances of updated components (and of the file's components that
    /// hold them) are laid out again, keeping their overrides.
    fn follow_components(&mut self, old_sizes: &HashMap<NodeIdx, Vec2>) -> Result<()> {
        let symbol_of = |p: &Props| {
            p.swapped_symbol
                .or_else(|| p.symbol.as_ref().and_then(|s| s.symbol_id))
        };
        let mut affected: HashSet<Guid> = old_sizes
            .keys()
            .filter_map(|&i| self.doc.props(i).guid)
            .collect();
        loop {
            let mut grew = false;
            for i in 0..self.doc.nodes.len() as NodeIdx {
                let p = self.doc.props(i);
                if self.doc.node(i).removed
                    || p.node_type() != NodeType::Symbol
                    || is_copy(p)
                    || p.guid.is_none_or(|g| affected.contains(&g))
                {
                    continue;
                }
                let holds = self.subtree(i).iter().any(|&n| {
                    let q = self.doc.props(n);
                    q.node_type() == NodeType::Instance
                        && symbol_of(q).is_some_and(|s| affected.contains(&s))
                });
                if holds && let Some(g) = p.guid {
                    affected.insert(g);
                    grew = true;
                }
            }
            if !grew {
                break;
            }
        }
        let targets: Vec<NodeIdx> = (0..self.doc.nodes.len() as NodeIdx)
            .filter(|&i| {
                let p = self.doc.props(i);
                !self.doc.node(i).removed
                    && p.node_type() == NodeType::Instance
                    && symbol_of(p).is_some_and(|s| affected.contains(&s))
                    && !self.inside_copy(i)
            })
            .collect();
        for i in targets {
            let p = self.doc.props(i).clone();
            let Some(comp) = symbol_of(&p).and_then(|g| self.doc.find(g)) else {
                continue;
            };
            let new = self.doc.props(comp).size();
            let old = old_sizes.get(&comp).copied().unwrap_or(new);
            // An axis keeps the instance's size when it was resized.
            let pick = |n: f64, o: f64, c: f64| if (n - o).abs() < 1e-6 { c } else { n };
            let now = p.size();
            let size = Vec2::new(pick(now.x, old.x, new.x), pick(now.y, old.y, new.y));
            // Overridden text is laid out again in the new layers' style.
            let retext: Vec<Vec<Guid>> = p
                .symbol
                .iter()
                .flat_map(|s| s.overrides.iter())
                .filter(|o| o.text_content.is_some())
                .filter_map(|o| {
                    o.guid_path.as_deref().map(|path| {
                        path.iter()
                            .map(|&g| super::super::guid_of(self.doc, g))
                            .collect()
                    })
                })
                .collect();
            let props = self.edit(i, flags::DERIVED | flags::SIZE);
            props.derived = Some(Arc::from([]));
            props.size = Some(size);
            self.relayout_instance_with(i, new, &[], &retext)?;
        }
        Ok(())
    }

    /// Whether `i` is inside a copy of a library asset (whose layout came
    /// with it).
    fn inside_copy(&self, i: NodeIdx) -> bool {
        let mut at = self.doc.node(i).parent;
        while let Some(p) = at {
            if self.doc.props(p).library_source().is_some() {
                return true;
            }
            at = self.doc.node(p).parent;
        }
        false
    }
}
