//! A page as it is drawn: the node tree with every component instance
//! expanded, world transforms, and render bounds.
//!
//! Figma does not store an instance's sublayers. They are the main
//! component's subtree with the instance's overrides applied, plus the
//! layout Figma derived for them (sizes, transforms, geometry, text) after
//! auto layout and constraints. Both are keyed by a guid path relative to the
//! instance: the guids of the nested instances on the way down, then the
//! sublayer's own guid. Overrides from outer instances win over inner ones.

use crate::document::{Document, NodeIdx};
use crate::model::text::TextContent;
use crate::model::{Affine, EffectKind, Guid, NodeType, PropField, PropValue, Props, Rect, Vec2};
use std::collections::HashMap;
use std::sync::Arc;

pub type SceneIdx = u32;

/// Where a scene node's properties live.
pub enum PropSource {
    /// Unchanged document node.
    Doc(NodeIdx),
    /// A sublayer of an instance, with overrides and derived layout applied.
    Owned(Box<Props>),
}

pub struct SceneNode {
    /// The document node this one comes from (for instance sublayers, the
    /// node in the main component).
    pub src: NodeIdx,
    pub props: PropSource,
    pub parent: Option<SceneIdx>,
    pub children: Vec<SceneIdx>,
    /// Node → page coordinates.
    pub world: Affine,
    /// Page-space bounds of everything the node draws (effects included).
    pub bounds: Rect,
    /// For instance sublayers: the outermost instance and the guid path.
    pub path: Option<(Guid, Arc<[Guid]>)>,
}

pub struct Scene {
    pub page: NodeIdx,
    pub nodes: Vec<SceneNode>,
    by_guid: HashMap<Guid, SceneIdx>,
}

/// Deepest instance nesting expanded (guards against cyclic components).
const MAX_INSTANCE_DEPTH: usize = 48;

/// Path relative to an instance → indices into one of its lists.
type OverrideMap = HashMap<Vec<Guid>, Vec<u32>>;

struct Level {
    /// Length of the guid path from the outermost instance to this one.
    prefix_len: usize,
    overrides: Arc<[Props]>,
    override_map: OverrideMap,
    derived: Arc<[Props]>,
    derived_map: OverrideMap,
    assignments: Option<Arc<[crate::model::PropAssignment]>>,
    symbol: NodeIdx,
}

struct Builder<'a> {
    doc: &'a Document,
    nodes: Vec<SceneNode>,
    by_guid: HashMap<Guid, SceneIdx>,
}

impl Scene {
    /// Expands a page (an index into [`Document::pages`]).
    pub fn build(doc: &Document, page: NodeIdx) -> Scene {
        let mut b = Builder {
            doc,
            nodes: Vec::new(),
            by_guid: HashMap::new(),
        };
        let root = b.push(page, PropSource::Doc(page), None, None);
        for &child in &doc.node(page).children {
            b.add_doc_node(child, root);
        }
        let mut scene = Scene {
            page,
            nodes: b.nodes,
            by_guid: b.by_guid,
        };
        scene.compute_world(doc);
        scene.compute_bounds(doc);
        scene
    }

    /// Expands one instance alone (under its parent), to read what its
    /// layers show without building the whole page.
    pub fn build_instance(doc: &Document, instance: NodeIdx) -> Scene {
        let mut b = Builder {
            doc,
            nodes: Vec::new(),
            by_guid: HashMap::new(),
        };
        let parent = doc.node(instance).parent.unwrap_or(instance);
        let root = b.push(parent, PropSource::Doc(parent), None, None);
        b.add_doc_node(instance, root);
        let page = doc.page_of(instance).unwrap_or(parent);
        let mut scene = Scene {
            page,
            nodes: b.nodes,
            by_guid: b.by_guid,
        };
        scene.compute_world(doc);
        scene
    }

    pub fn root(&self) -> SceneIdx {
        0
    }

    pub fn node(&self, i: SceneIdx) -> &SceneNode {
        &self.nodes[i as usize]
    }

    pub fn props<'a>(&'a self, doc: &'a Document, i: SceneIdx) -> &'a Props {
        match &self.nodes[i as usize].props {
            PropSource::Doc(n) => doc.props(*n),
            PropSource::Owned(p) => p,
        }
    }

    /// The node's id as Figma writes it: `12:34` for document nodes,
    /// `I12:34;56:78` for instance sublayers.
    pub fn id(&self, doc: &Document, i: SceneIdx) -> String {
        let node = &self.nodes[i as usize];
        match &node.path {
            Some((root, path)) => {
                let mut s = format!("I{root}");
                for g in path.iter() {
                    s.push(';');
                    s.push_str(&g.to_string());
                }
                s
            }
            None => doc
                .props(node.src)
                .guid
                .map(|g| g.to_string())
                .unwrap_or_default(),
        }
    }

    /// Finds a node by the id [`Scene::id`] gives it.
    pub fn find(&self, doc: &Document, id: &str) -> Option<SceneIdx> {
        if let Some(rest) = id.strip_prefix('I') {
            let mut parts = rest.split(';');
            let root = Guid::parse(parts.next()?)?;
            let path: Vec<Guid> = parts.map(Guid::parse).collect::<Option<_>>()?;
            let start = *self.by_guid.get(&root)?;
            return self.find_sublayer(doc, start, root, &path);
        }
        self.by_guid.get(&Guid::parse(id)?).copied()
    }

    fn find_sublayer(
        &self,
        doc: &Document,
        start: SceneIdx,
        root: Guid,
        path: &[Guid],
    ) -> Option<SceneIdx> {
        let mut stack = vec![start];
        while let Some(i) = stack.pop() {
            let node = &self.nodes[i as usize];
            if let Some((r, p)) = &node.path
                && *r == root
                && p.as_ref() == path
            {
                return Some(i);
            }
            let _ = doc;
            stack.extend(node.children.iter().copied());
        }
        None
    }

    /// Ancestors from the page's child down to `i` (inclusive).
    pub fn ancestry(&self, i: SceneIdx) -> Vec<SceneIdx> {
        let mut chain = vec![i];
        let mut at = i;
        while let Some(p) = self.nodes[at as usize].parent {
            if p == self.root() {
                break;
            }
            chain.push(p);
            at = p;
        }
        chain.reverse();
        chain
    }

    fn compute_world(&mut self, doc: &Document) {
        // Parents precede children in `nodes`, so one forward pass suffices.
        for i in 0..self.nodes.len() {
            let local = if i == 0 {
                Affine::IDENTITY
            } else {
                self.props(doc, i as SceneIdx).transform()
            };
            let world = match self.nodes[i].parent {
                Some(p) => self.nodes[p as usize].world.mul(&local),
                None => local,
            };
            self.nodes[i].world = if world.is_finite() {
                world
            } else {
                Affine::IDENTITY
            };
        }
    }

    /// Bounds of node `i` from its own geometry and its children's bounds.
    fn node_bounds(&self, doc: &Document, i: SceneIdx) -> Rect {
        let own = self.own_bounds(doc, i);
        let props = self.props(doc, i);
        let node = &self.nodes[i as usize];
        let mut content = Rect::EMPTY;
        if props.node_type().draws_children() {
            for &c in &node.children {
                content = content.union(&self.nodes[c as usize].bounds);
            }
            if props.clips_content() && !content.is_empty() {
                let size = props.size();
                let clip = node.world.map_rect(&Rect::new(0.0, 0.0, size.x, size.y));
                content = content.intersect(&clip);
            }
        }
        let mut bounds = own.union(&content);
        if !bounds.is_empty() {
            bounds = bounds.outset(effect_outset(props, &node.world));
        }
        if !props.visible() {
            bounds = Rect::EMPTY;
        }
        bounds
    }

    fn compute_bounds(&mut self, doc: &Document) {
        // Children follow parents, so a reverse pass sees children first.
        for i in (1..self.nodes.len()).rev() {
            self.nodes[i].bounds = self.node_bounds(doc, i as SceneIdx);
        }
        self.page_bounds();
    }

    fn page_bounds(&mut self) {
        let mut page = Rect::EMPTY;
        for &c in &self.nodes[0].children {
            page = page.union(&self.nodes[c as usize].bounds);
        }
        self.nodes[0].bounds = page;
    }

    /// Updates the scene in place after edits that changed `touched` nodes'
    /// properties but not the tree: their transforms, sizes, and bounds (and
    /// their ancestors' bounds) are recomputed. Returns `false`, leaving the
    /// scene unchanged, when that is not enough (layers were added, removed,
    /// or moved; or a component an instance shows changed), and the scene
    /// must be built again.
    pub fn refresh(&mut self, doc: &Document, touched: &[NodeIdx]) -> bool {
        let mut starts = Vec::new();
        for &t in touched {
            let node = doc.node(t);
            if node.removed || node.props.node_type() == NodeType::Canvas && t != self.page {
                return false;
            }
            if t == self.page {
                continue;
            }
            let Some(&i) = node.props.guid.and_then(|g| self.by_guid.get(&g)) else {
                // Not on this page (or new): only fine if it is elsewhere.
                if doc.page_of(t) == Some(self.page) {
                    return false;
                }
                continue;
            };
            let sn = &self.nodes[i as usize];
            // Instances and components feed copies made at build time.
            if !matches!(sn.props, PropSource::Doc(_))
                || sn.path.is_some()
                || matches!(
                    node.props.node_type(),
                    NodeType::Instance | NodeType::Symbol
                )
                || self.inside_component(doc, t)
            {
                return false;
            }
            // Same parent and children as when built.
            let parent_src = sn.parent.map(|p| self.nodes[p as usize].src);
            if parent_src != node.parent {
                return false;
            }
            let live_children: Vec<NodeIdx> = node
                .children
                .iter()
                .copied()
                .filter(|&c| !doc.node(c).removed)
                .collect();
            let scene_children: Vec<NodeIdx> = sn
                .children
                .iter()
                .map(|&c| self.nodes[c as usize].src)
                .collect();
            if live_children != scene_children {
                return false;
            }
            starts.push(i);
        }
        let mut dirty = std::collections::HashSet::new();
        for &i in &starts {
            // World transforms down the subtree.
            let mut stack = vec![i];
            let mut order = Vec::new();
            while let Some(n) = stack.pop() {
                let local = self.props(doc, n).transform();
                let world = match self.nodes[n as usize].parent {
                    Some(p) => self.nodes[p as usize].world.mul(&local),
                    None => local,
                };
                self.nodes[n as usize].world = if world.is_finite() {
                    world
                } else {
                    Affine::IDENTITY
                };
                order.push(n);
                stack.extend(self.nodes[n as usize].children.iter().copied());
            }
            // Bounds bottom-up within the subtree.
            for &n in order.iter().rev() {
                self.nodes[n as usize].bounds = self.node_bounds(doc, n);
            }
            dirty.insert(i);
        }
        // Ancestors' bounds, nearest first.
        for &i in &starts {
            let mut at = self.nodes[i as usize].parent;
            while let Some(p) = at {
                if p == self.root() {
                    break;
                }
                self.nodes[p as usize].bounds = self.node_bounds(doc, p);
                at = self.nodes[p as usize].parent;
            }
        }
        self.page_bounds();
        true
    }

    /// Whether a document node sits inside a main component (its edits show
    /// in instances, which copy it at build time).
    fn inside_component(&self, doc: &Document, mut i: NodeIdx) -> bool {
        while let Some(p) = doc.node(i).parent {
            if doc.props(p).node_type() == NodeType::Symbol {
                return true;
            }
            i = p;
        }
        false
    }

    /// World bounds of the node's own geometry (fills, strokes, text), or of
    /// its box when it has none.
    pub fn own_bounds(&self, doc: &Document, i: SceneIdx) -> Rect {
        let node = &self.nodes[i as usize];
        let props = self.props(doc, i);
        let world = &node.world;
        let mut local = Rect::EMPTY;
        let has_fills = props.has_visible_fills();
        let has_strokes = props.has_visible_strokes();
        if has_fills {
            for path in props.fill_geometry() {
                if let Some(p) = doc.blobs.path(path.blob) {
                    local = local.union(&p.bounds());
                }
            }
        }
        if has_strokes {
            for path in props.stroke_geometry() {
                if let Some(p) = doc.blobs.path(path.blob) {
                    local = local.union(&p.bounds());
                }
            }
        }
        let size = props.size();
        let node_type = props.node_type();
        if node_type == NodeType::Text {
            local = local.union(&text_bounds(props, size));
        } else if (has_fills || has_strokes || !props.effects().is_empty())
            && local.is_empty()
            && size.x > 0.0
            && size.y > 0.0
        {
            local = Rect::new(0.0, 0.0, size.x, size.y);
        }
        if local.is_empty() {
            return Rect::EMPTY;
        }
        world.map_rect(&local)
    }

    /// The node's frame (0, 0, width, height) in page coordinates, as an
    /// axis-aligned box.
    pub fn frame_bounds(&self, doc: &Document, i: SceneIdx) -> Rect {
        let size = self.props(doc, i).size();
        self.nodes[i as usize]
            .world
            .map_rect(&Rect::new(0.0, 0.0, size.x, size.y))
    }

    /// The four corners of the node's frame in page coordinates.
    pub fn frame_corners(&self, doc: &Document, i: SceneIdx) -> [Vec2; 4] {
        let size = self.props(doc, i).size();
        let w = &self.nodes[i as usize].world;
        [
            w.apply(Vec2::new(0.0, 0.0)),
            w.apply(Vec2::new(size.x, 0.0)),
            w.apply(Vec2::new(size.x, size.y)),
            w.apply(Vec2::new(0.0, size.y)),
        ]
    }
}

fn text_bounds(props: &Props, size: Vec2) -> Rect {
    let mut r = Rect::new(0.0, 0.0, size.x.max(0.0), size.y.max(0.0));
    if let Some(layout) = &props.text_layout {
        for g in layout.glyphs.iter() {
            let fs = f64::from(g.font_size);
            r = r.union(&Rect::new(
                f64::from(g.x) - fs * 0.25,
                f64::from(g.y) - fs * 1.25,
                fs * (f64::from(g.advance).max(0.0) + 0.5),
                fs * 1.75,
            ));
        }
    }
    r
}

/// How far effects reach beyond the node's geometry, in page units.
fn effect_outset(props: &Props, world: &Affine) -> f64 {
    let mut outset: f64 = 0.0;
    for e in props.effects().iter().filter(|e| e.is_visible()) {
        let reach = match e.kind {
            EffectKind::DropShadow => {
                f64::from(e.radius) * 1.5
                    + f64::from(e.spread.max(0.0))
                    + e.offset.x.abs().max(e.offset.y.abs())
            }
            EffectKind::LayerBlur => f64::from(e.radius) * 1.5,
            _ => 0.0,
        };
        outset = outset.max(reach);
    }
    if outset > 0.0 {
        outset * world.scale_factor().max(1e-6)
    } else {
        0.0
    }
}

impl<'a> Builder<'a> {
    fn push(
        &mut self,
        src: NodeIdx,
        props: PropSource,
        parent: Option<SceneIdx>,
        path: Option<(Guid, Arc<[Guid]>)>,
    ) -> SceneIdx {
        let i = self.nodes.len() as SceneIdx;
        if path.is_none()
            && let Some(g) = self.doc.props(src).guid
        {
            self.by_guid.insert(g, i);
        }
        self.nodes.push(SceneNode {
            src,
            props,
            parent,
            children: Vec::new(),
            world: Affine::IDENTITY,
            bounds: Rect::EMPTY,
            path,
        });
        if let Some(p) = parent {
            self.nodes[p as usize].children.push(i);
        }
        i
    }

    /// Adds a document node (not inside an instance) and its subtree.
    fn add_doc_node(&mut self, idx: NodeIdx, parent: SceneIdx) {
        let doc = self.doc;
        let i = self.push(idx, PropSource::Doc(idx), Some(parent), None);
        let props = doc.props(idx);
        if props.node_type() == NodeType::Instance {
            let Some(root) = props.guid else { return };
            let mut levels = Vec::new();
            self.expand_instance(props, i, &mut levels, &[], root);
        } else {
            for &c in &doc.node(idx).children {
                self.add_doc_node(c, i);
            }
        }
    }

    fn normalize(&self, path: &[Guid]) -> Vec<Guid> {
        path.iter()
            .map(|g| {
                if self.doc.by_guid.contains_key(g) {
                    *g
                } else {
                    self.doc.by_override_key.get(g).copied().unwrap_or(*g)
                }
            })
            .collect()
    }

    fn override_map(&self, list: &[Props]) -> OverrideMap {
        let mut map: OverrideMap = HashMap::new();
        for (i, p) in list.iter().enumerate() {
            if let Some(path) = &p.guid_path
                && !path.is_empty()
            {
                map.entry(self.normalize(path)).or_default().push(i as u32);
            }
        }
        map
    }

    /// Adds the sublayers of the instance at scene node `at`, whose effective
    /// properties are `props` and whose guid path from the outermost instance
    /// `root` is `path`.
    fn expand_instance(
        &mut self,
        props: &Props,
        at: SceneIdx,
        levels: &mut Vec<Level>,
        path: &[Guid],
        root: Guid,
    ) {
        let doc = self.doc;
        let symbol_id = props
            .swapped_symbol
            .or_else(|| props.symbol.as_ref().and_then(|s| s.symbol_id));
        let Some(symbol) = symbol_id.and_then(|g| doc.find(g)) else {
            return;
        };
        if levels.len() >= MAX_INSTANCE_DEPTH || levels.iter().any(|l| l.symbol == symbol) {
            return;
        }
        let empty = || Arc::from([] as [Props; 0]);
        let overrides = props
            .symbol
            .as_ref()
            .map(|s| s.overrides.clone())
            .unwrap_or_else(empty);
        let derived = props.derived.clone().unwrap_or_else(empty);
        levels.push(Level {
            prefix_len: path.len(),
            override_map: self.override_map(&overrides),
            overrides,
            derived_map: self.override_map(&derived),
            derived,
            assignments: props.prop_assignments.clone(),
            symbol,
        });
        for &child in &doc.node(symbol).children {
            self.instantiate(child, at, levels, path, root);
        }
        levels.pop();
    }

    /// An override that only names a shared style takes the style's paints.
    fn apply_styles(&self, p: &mut Props, o: &Props) {
        let style = |g: Option<Guid>| g.and_then(|g| self.doc.find(g)).map(|i| self.doc.props(i));
        if o.fills.is_none()
            && let Some(s) = style(o.fill_style)
            && s.fills.is_some()
        {
            p.fills = s.fills.clone();
        }
        if o.strokes.is_none()
            && let Some(s) = style(o.stroke_style)
            && s.fills.is_some()
        {
            p.strokes = s.fills.clone();
        }
        if o.effects.is_none()
            && let Some(s) = style(o.effect_style)
            && s.effects.is_some()
        {
            p.effects = s.effects.clone();
        }
    }

    fn instantiate(
        &mut self,
        idx: NodeIdx,
        parent: SceneIdx,
        levels: &mut Vec<Level>,
        prefix: &[Guid],
        root: Guid,
    ) {
        let doc = self.doc;
        let base = doc.props(idx);
        let Some(guid) = base.guid else { return };
        let mut path = Vec::with_capacity(prefix.len() + 1);
        path.extend_from_slice(prefix);
        path.push(guid);

        let mut props: Option<Props> = None;
        for level in levels.iter().rev() {
            if let Some(list) = level.override_map.get(&path[level.prefix_len..]) {
                let p = props.get_or_insert_with(|| base.clone());
                for &o in list {
                    let o = &level.overrides[o as usize];
                    p.merge(o);
                    self.apply_styles(p, o);
                }
            }
        }
        // Component properties of the innermost instance (whose component
        // this node belongs to) drive visibility, text, and swaps.
        let refs = props
            .as_ref()
            .map_or(base.prop_refs.as_ref(), |p| p.prop_refs.as_ref());
        if let (Some(refs), Some(level)) = (refs.cloned(), levels.last())
            && let Some(assignments) = &level.assignments
        {
            for r in refs.iter() {
                let Some(a) = assignments.iter().find(|a| a.def_id == r.def_id) else {
                    continue;
                };
                let p = props.get_or_insert_with(|| base.clone());
                match (&r.field, &a.value) {
                    (PropField::Visible, PropValue::Bool(b)) => p.visible = Some(*b),
                    (PropField::Text, PropValue::Text(t)) => {
                        p.text_content = Some(Arc::new(TextContent {
                            characters: t.clone(),
                            ..TextContent::default()
                        }));
                    }
                    (PropField::SwappedSymbol, PropValue::Symbol(g)) => {
                        p.swapped_symbol = Some(*g);
                    }
                    _ => {}
                }
            }
        }
        for level in levels.iter().rev() {
            if let Some(list) = level.derived_map.get(&path[level.prefix_len..]) {
                let p = props.get_or_insert_with(|| base.clone());
                for &d in list {
                    p.merge(&level.derived[d as usize]);
                }
            }
        }

        let path_arc: Arc<[Guid]> = Arc::from(path.as_slice());
        let source = match props {
            Some(p) => PropSource::Owned(Box::new(p)),
            None => PropSource::Doc(idx),
        };
        let i = self.push(idx, source, Some(parent), Some((root, path_arc)));
        let is_instance = match &self.nodes[i as usize].props {
            PropSource::Owned(p) => p.node_type() == NodeType::Instance,
            PropSource::Doc(n) => doc.props(*n).node_type() == NodeType::Instance,
        };
        if is_instance {
            // Borrow the effective props out of the arena for the recursion.
            let effective = match &self.nodes[i as usize].props {
                PropSource::Owned(p) => (**p).clone(),
                PropSource::Doc(n) => doc.props(*n).clone(),
            };
            self.expand_instance(&effective, i, levels, &path, root);
        } else {
            for &c in &doc.node(idx).children {
                self.instantiate(c, i, levels, prefix, root);
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod test;
