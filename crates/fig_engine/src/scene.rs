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

mod variables;

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
    /// The layers Figma generates for a FigJam object ([`Props::generated`]),
    /// drawn before its children. They are not layers of the document, so
    /// they are kept apart from `children`.
    pub generated: Vec<SceneIdx>,
    /// Node → page coordinates.
    pub world: Affine,
    /// Page-space bounds of everything the node draws (effects included).
    pub bounds: Rect,
    /// For instance sublayers: the outermost instance and the guid path.
    pub path: Option<(Guid, Arc<[Guid]>)>,
    /// For instances: what their sublayers were built from (see
    /// [`instance_feed`]), to tell a move from a change in what they show.
    feed: u64,
    /// Collection modes at build time, including an explicit empty selection.
    modes: Option<Arc<[(Guid, Guid)]>>,
}

impl SceneNode {
    /// The nodes directly below this one: generated layers and children.
    pub fn below(&self) -> impl Iterator<Item = SceneIdx> + '_ {
        self.generated.iter().chain(&self.children).copied()
    }
}

/// A fingerprint of what an instance's sublayers are built from: its
/// component, overrides, derived layout, and property values (shared, so
/// compared by address).
fn instance_feed(p: &Props) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    p.symbol.as_ref().map(Arc::as_ptr).hash(&mut h);
    p.derived.as_ref().map(|d| d.as_ptr()).hash(&mut h);
    p.prop_assignments.as_ref().map(|a| a.as_ptr()).hash(&mut h);
    p.swapped_symbol.hash(&mut h);
    h.finish()
}

pub struct Scene {
    pub page: NodeIdx,
    pub nodes: Vec<SceneNode>,
    by_guid: HashMap<Guid, SceneIdx>,
    /// See [`Scene::paint_times`]; computed on first use. Edits that change
    /// the tree rebuild the scene, so the times stay valid across
    /// [`Scene::refresh`].
    paint_times: std::sync::OnceLock<Box<[(u32, u32)]>>,
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
            paint_times: std::sync::OnceLock::new(),
        };
        variables::resolve(doc, &mut scene);
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
            paint_times: std::sync::OnceLock::new(),
        };
        variables::resolve(doc, &mut scene);
        scene.compute_world(doc);
        scene.compute_bounds(doc);
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

    /// When each node paints, as a walk of the tree in paint order meets it:
    /// `(enter, exit)` per scene node, all distinct. A node's fills (and
    /// generated layers) paint when it is entered, the strokes it draws over
    /// its children when it is left, and everything it holds in between, so
    /// one node painted before another has the smaller time. Renders of a
    /// paint-order window ([`crate::render::Layers::Window`]) compare these.
    pub fn paint_times(&self) -> &[(u32, u32)] {
        self.paint_times.get_or_init(|| {
            let mut times = vec![(0u32, 0u32); self.nodes.len()];
            let mut clock = 0u32;
            // (node, whether its subtree was walked)
            let mut stack = vec![(self.root(), false)];
            while let Some((i, walked)) = stack.pop() {
                if walked {
                    times[i as usize].1 = clock;
                    clock += 1;
                    continue;
                }
                times[i as usize].0 = clock;
                clock += 1;
                stack.push((i, true));
                // Pushed in reverse so the first below is walked first.
                let below: Vec<SceneIdx> = self.nodes[i as usize].below().collect();
                stack.extend(below.into_iter().rev().map(|c| (c, false)));
            }
            times.into_boxed_slice()
        })
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
        let mut own = self.own_bounds(doc, i);
        let props = self.props(doc, i);
        let node = &self.nodes[i as usize];
        for &g in &node.generated {
            own = own.union(&self.nodes[g as usize].bounds);
        }
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
            if node.props.variable.is_some() || node.props.variable_modes.is_some() {
                return false;
            }
            if node.removed || node.props.node_type() == NodeType::Canvas && t != self.page {
                return false;
            }
            if t == self.page {
                if self.nodes[0].modes != node.props.mode_by_set {
                    return false;
                }
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
            // Layers in components feed copies made at build time (the
            // component itself does not: instances keep their own root
            // properties); an instance whose sources changed shows other
            // layers.
            if sn.modes != node.props.mode_by_set
                || !matches!(sn.props, PropSource::Doc(_))
                || sn.path.is_some()
                || (node.props.node_type() == NodeType::Instance
                    && sn.feed != instance_feed(&node.props))
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
            // (An instance's scene children are its component's layers.)
            if live_children != scene_children && node.props.node_type() != NodeType::Instance {
                return false;
            }
            starts.push(i);
        }
        let mut dirty = std::collections::HashSet::new();
        for &i in &starts {
            // A layer that only moved carries its subtree along: the
            // descendants' transforms and bounds shift by the same amount.
            let old = self.nodes[i as usize].world;
            let local = self.props(doc, i).transform();
            let new = match self.nodes[i as usize].parent {
                Some(p) => self.nodes[p as usize].world.mul(&local),
                None => local,
            };
            if new.is_finite()
                && old.is_finite()
                && (new.m00, new.m01, new.m10, new.m11) == (old.m00, old.m01, old.m10, old.m11)
            {
                let (dx, dy) = (new.m02 - old.m02, new.m12 - old.m12);
                self.nodes[i as usize].world = new;
                let mut stack: Vec<SceneIdx> = if dx == 0.0 && dy == 0.0 {
                    Vec::new()
                } else {
                    self.nodes[i as usize].below().collect()
                };
                while let Some(n) = stack.pop() {
                    let node = &mut self.nodes[n as usize];
                    node.world.m02 += dx;
                    node.world.m12 += dy;
                    if !node.bounds.is_empty() {
                        node.bounds = node.bounds.translate(dx, dy);
                    }
                    stack.extend(node.below());
                }
                self.nodes[i as usize].bounds = self.node_bounds(doc, i);
                dirty.insert(i);
                continue;
            }
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
                stack.extend(self.nodes[n as usize].below());
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

    /// Page bounds of everything drawn from document `nodes`: their scene
    /// nodes, and the copies instances make of component layers.
    pub fn bounds_of(&self, doc: &Document, nodes: &[NodeIdx]) -> Rect {
        if nodes.iter().any(|&n| self.inside_component(doc, n)) {
            let set: std::collections::HashSet<NodeIdx> = nodes.iter().copied().collect();
            return self
                .nodes
                .iter()
                .skip(1)
                .filter(|n| set.contains(&n.src))
                .fold(Rect::EMPTY, |acc, n| acc.union(&n.bounds));
        }
        // Outside components each node is drawn once, found by its guid.
        nodes
            .iter()
            .filter_map(|&n| self.by_guid.get(&doc.props(n).guid?))
            .filter(|&&i| i != self.root())
            .fold(Rect::EMPTY, |acc, &i| {
                acc.union(&self.nodes[i as usize].bounds)
            })
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
        if node_type.is_text() {
            local = local.union(&text_bounds(props, size));
        } else if (has_fills || has_strokes || !props.effects().is_empty())
            && local.is_empty()
            && size.x > 0.0
            && (size.y > 0.0 || node_type == NodeType::Line)
        {
            local = Rect::new(0.0, 0.0, size.x, size.y);
        }
        if local.is_empty() {
            return Rect::EMPTY;
        }
        // Strokes drawn from the shape (no stored outline) reach beyond it.
        if has_strokes && props.stroke_geometry().is_empty() {
            let w = f64::from(props.stroke_weight());
            let reach = if node_type == NodeType::Line {
                w / 2.0 + (w * 3.5).max(6.0)
            } else {
                match props.stroke_align() {
                    crate::model::StrokeAlign::Inside => 0.0,
                    crate::model::StrokeAlign::Center => w / 2.0,
                    crate::model::StrokeAlign::Outside => w,
                }
            };
            local = local.outset(reach);
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
    // An empty box (a FigJam object's unused label) covers nothing.
    let mut r = if size.x > 0.0 || size.y > 0.0 {
        Rect::new(0.0, 0.0, size.x.max(0.0), size.y.max(0.0))
    } else {
        Rect::EMPTY
    };
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
    let (mut blur, mut shadow): (f64, f64) = (0.0, 0.0);
    for e in props.effects().iter().filter(|e| e.is_visible()) {
        match e.kind {
            EffectKind::DropShadow => {
                shadow = shadow.max(
                    f64::from(e.radius) * 1.5
                        + if props.supports_shadow_spread() {
                            f64::from(e.spread.max(0.0))
                        } else {
                            0.0
                        }
                        + e.offset.x.abs().max(e.offset.y.abs()),
                );
            }
            EffectKind::LayerBlur => blur += f64::from(e.radius.max(0.0)) * 1.5,
            _ => {}
        }
    }
    // Blurs apply one after another, and drop shadows are cast from the
    // blurred layer: their reaches add up.
    let outset = blur + shadow;
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
            generated: Vec::new(),
            world: Affine::IDENTITY,
            bounds: Rect::EMPTY,
            path,
            feed: 0,
            modes: self.doc.props(src).mode_by_set.clone(),
        });
        if let Some(p) = parent {
            self.nodes[p as usize].children.push(i);
        }
        i
    }

    /// Adds the generated layers of the FigJam object at scene node `at`.
    fn add_generated(&mut self, at: SceneIdx) {
        let node = &self.nodes[at as usize];
        let props = match &node.props {
            PropSource::Doc(n) => self.doc.props(*n),
            PropSource::Owned(p) => p,
        };
        let Some(layers) = props.generated.clone() else {
            return;
        };
        let src = node.src;
        let (root, prefix): (Guid, Arc<[Guid]>) = match &node.path {
            Some((root, path)) => (*root, path.clone()),
            None => (props.guid.unwrap_or_default(), Arc::from([] as [Guid; 0])),
        };
        for layer in layers.iter() {
            let mut path = prefix.to_vec();
            path.extend(layer.guid_path.iter().flat_map(|p| p.iter().copied()));
            let i = self.nodes.len() as SceneIdx;
            self.nodes.push(SceneNode {
                src,
                props: PropSource::Owned(Box::new(layer.clone())),
                parent: Some(at),
                children: Vec::new(),
                generated: Vec::new(),
                world: Affine::IDENTITY,
                bounds: Rect::EMPTY,
                path: Some((root, path.into())),
                feed: 0,
                modes: self.doc.props(src).mode_by_set.clone(),
            });
            self.nodes[at as usize].generated.push(i);
        }
    }

    /// Adds a document node (not inside an instance) and its subtree.
    fn add_doc_node(&mut self, idx: NodeIdx, parent: SceneIdx) {
        let doc = self.doc;
        let i = self.push(idx, PropSource::Doc(idx), Some(parent), None);
        self.add_generated(i);
        let props = doc.props(idx);
        if props.node_type() == NodeType::Instance {
            self.nodes[i as usize].feed = instance_feed(props);
            let Some(root) = props.guid else { return };
            let mut levels = Vec::new();
            self.expand_instance(props, i, &mut levels, &[], root);
        } else {
            for &c in &doc.node(idx).children {
                self.add_doc_node(c, i);
            }
        }
    }

    fn normalize(&self, path: &[Guid], mut symbol: NodeIdx) -> Vec<Guid> {
        path.iter()
            .map(|g| {
                // Imported components keep their original ids as override
                // keys. Those ids can also name unrelated nodes in this file;
                // resolve each segment inside its component first.
                let direct = self.doc.find(*g);
                let imported = self
                    .doc
                    .by_override_key
                    .get(g)
                    .and_then(|g| self.doc.find(*g));
                let within = |mut node| loop {
                    if node == symbol {
                        return true;
                    }
                    let Some(parent) = self.doc.node(node).parent else {
                        return false;
                    };
                    node = parent;
                };
                let node = direct.filter(|&n| within(n)).or_else(|| {
                    imported.filter(|&n| within(n)).or_else(|| {
                        // More than one imported component can reuse a key,
                        // so the document-wide index need not hold this copy.
                        let mut pending = vec![symbol];
                        while let Some(n) = pending.pop() {
                            if self.doc.props(n).override_key == Some(*g) {
                                return Some(n);
                            }
                            pending.extend(&self.doc.node(n).children);
                        }
                        None
                    })
                });
                // A swapped nested instance can reference another component's
                // nodes. Keep accepting those globally unique paths too.
                let Some(node) = node.or(direct).or(imported) else {
                    return *g;
                };
                let props = self.doc.props(node);
                if let Some(next) = props
                    .swapped_symbol
                    .or_else(|| props.symbol.as_ref().and_then(|s| s.symbol_id))
                    .and_then(|g| self.doc.find(g))
                {
                    symbol = next;
                }
                props.guid.unwrap_or(*g)
            })
            .collect()
    }

    fn override_map(&self, list: &[Props], symbol: NodeIdx) -> OverrideMap {
        let mut map: OverrideMap = HashMap::new();
        for (i, p) in list.iter().enumerate() {
            if let Some(path) = &p.guid_path
                && !path.is_empty()
            {
                map.entry(self.normalize(path, symbol))
                    .or_default()
                    .push(i as u32);
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
            override_map: self.override_map(&overrides, symbol),
            overrides,
            derived_map: self.override_map(&derived, symbol),
            derived,
            assignments: props.prop_assignments.clone(),
            symbol,
        });
        for &child in &doc.node(symbol).children {
            self.instantiate(child, at, levels, path, root);
        }
        levels.pop();
    }

    /// An override that names a shared style takes the style's paints (its
    /// own copy may be stale, as on nodes; see `document::resolve_styles`).
    fn apply_styles(&self, p: &mut Props, o: &Props) {
        let style = |g: Option<Guid>| g.and_then(|g| self.doc.find(g)).map(|i| self.doc.props(i));
        if let Some(s) = style(o.fill_style)
            && s.fills.is_some()
        {
            p.fills = s.fills.clone();
        }
        if let Some(s) = style(o.stroke_style)
            && s.fills.is_some()
        {
            p.strokes = s.fills.clone();
        }
        if let Some(s) = style(o.effect_style)
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
        self.add_generated(i);
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
