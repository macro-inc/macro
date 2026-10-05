//! Reading a file into a document. Pages become artboards side by side;
//! optional content groups (Illustrator's top-level layers) become layers;
//! clipping paths become clip groups; forms become groups; and what is
//! painted becomes paths, text, and images, or raw content (drawn as the
//! file draws it) where the model has no equivalent.

mod layers;
mod paint;
mod text;

use crate::error::{AiError, Result};
use crate::file::{self, ARTBOARD_GAP, PageInfo, SourceFile};
use crate::geom::{Affine, PathData, Rect};
use crate::interp::fonts::FontCache;
use crate::interp::{
    ClipPath, Descend, GState, GroupEvent, ImageEvent, Interp, PathEvent, Resources, ShadingEvent,
    ShowEvent, Sink,
};
use crate::marks;
use crate::model::{
    Artboard, Clip, Document, ImageNode, ImageSource, Node, NodeIdx, NodeKind, PathNode, Source,
};
use crate::pdf::content::{self, Op};
use crate::pdf::{Dict, Name, Object, Pdf};
pub use layers::LAYER_COLORS;
use layers::LayerTable;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// A document read from a file, with what could not be read faithfully.
pub struct Opened {
    /// The document.
    pub document: Document,
    /// Things shown differently than other applications show them.
    pub warnings: Vec<String>,
}

/// Opens an Illustrator file (or any PDF).
pub fn open(bytes: &[u8]) -> Result<Opened> {
    let head = &bytes[..bytes.len().min(1024)];
    if find(head, b"%PDF-").is_none() {
        if find(head, b"%!PS-Adobe").is_some() {
            return Err(AiError::Unsupported(
                "Illustrator 8 and earlier files can't be opened; save the file again from a newer Illustrator".into(),
            ));
        }
        return Err(AiError::NotAi);
    }
    let pdf = Pdf::open(Arc::from(bytes))?;
    if pdf.trailer().contains("Encrypt") {
        return Err(AiError::Encrypted);
    }
    let mut pages: Vec<PageInfo> = pdf
        .pages()
        .into_iter()
        .map(|p| PageInfo::new(&pdf, p.obj, p.dict))
        .collect();
    let illustrator = pages.iter().any(|p| file::has_private_data(&pdf, &p.dict));
    let creator = file::creator(&pdf);

    let mut doc = Document::new();
    let mut warnings = Warnings::default();
    let mut placements = Vec::new();
    let mut x = 0.0;
    for (i, page) in pages.iter_mut().enumerate() {
        let (w, h) = page.shown_size();
        page.origin = (x, 0.0);
        let id = doc.allocate_id();
        doc.artboards.push(Artboard {
            id,
            name: format!("Artboard {}", i + 1),
            rect: Rect::from_xywh(x, 0.0, w, h),
            page: Some(i as u32),
            removed: false,
        });
        placements.push(page.to_canvas((x, 0.0)));
        x += w + ARTBOARD_GAP;
    }
    if doc.artboards.is_empty() {
        let id = doc.allocate_id();
        doc.artboards.push(Artboard {
            id,
            name: "Artboard 1".into(),
            rect: Rect::from_xywh(0.0, 0.0, 612.0, 792.0),
            page: None,
            removed: false,
        });
    }

    let mut layers = LayerTable::read(&pdf, &mut doc);
    let mut fonts = FontCache::default();
    let mut table = ResourceTable::default();
    for (i, page) in pages.iter().enumerate() {
        let data = page_content(&pdf, &page.dict);
        let ops = content::parse(&data);
        let res = page
            .dict
            .get("Resources")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_dict().cloned())
            .unwrap_or_default();
        let resources = Resources::new(&pdf, res);
        let artboard = doc.artboards[i].id;
        let mut builder = Builder {
            doc: &mut doc,
            pdf: &pdf,
            page: i as u32,
            artboard,
            to_canvas: placements[i],
            page_box: page.media_box,
            art_box: page.art_box,
            layers: &mut layers,
            table: &mut table,
            warnings: &mut warnings,
            frames: vec![Frame::new(FrameKind::Page, None, 0)],
            marked: Vec::new(),
            text: None,
            skip: 0,
            hidden: 0,
            seen_layer: false,
        };
        let mut interp = Interp::new(&pdf, &mut fonts);
        interp.run(&ops, &resources, GState::default(), &mut builder);
        builder.finish();
    }
    layers.finish(&mut doc);

    doc.file = Some(Arc::new(SourceFile {
        pdf,
        pages,
        resources: table.dicts,
        illustrator,
        creator,
        fonts: Mutex::new(fonts),
    }));
    Ok(Opened {
        document: doc,
        warnings: warnings.list,
    })
}

/// The first position of `needle` in `hay`.
fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// A page's content streams, joined.
fn page_content(pdf: &Pdf, page: &Dict) -> Vec<u8> {
    let Some(contents) = page.get("Contents") else {
        return Vec::new();
    };
    let streams = match pdf.resolve(contents) {
        Object::Array(a) => a.iter().map(|v| pdf.resolve(v)).collect(),
        other => vec![other],
    };
    let mut out = Vec::new();
    for s in streams {
        if let Some(s) = s.as_stream()
            && let Ok(data) = pdf.stream_data(s)
        {
            out.extend_from_slice(&data);
            out.push(b'\n');
        }
    }
    out
}

/// Warnings, each said once.
#[derive(Default)]
struct Warnings {
    list: Vec<String>,
}

impl Warnings {
    fn add(&mut self, w: &str) {
        if !self.list.iter().any(|x| x == w) {
            self.list.push(w.to_string());
        }
    }
}

/// Resource dictionaries nodes refer to, by the serial the interpreter gave
/// them.
#[derive(Default)]
struct ResourceTable {
    dicts: Vec<Dict>,
    by_serial: HashMap<u64, u32>,
}

impl ResourceTable {
    fn index(&mut self, r: &Resources<'_>) -> u32 {
        self.index_shared(r.res())
    }

    fn index_shared(&mut self, r: &crate::interp::ResDict) -> u32 {
        *self.by_serial.entry(r.id).or_insert_with(|| {
            self.dicts.push((*r.dict).clone());
            (self.dicts.len() - 1) as u32
        })
    }
}

/// What a frame of the container stack is.
#[derive(Clone, Copy, Debug, PartialEq)]
enum FrameKind {
    /// The page (objects go in the default layer).
    Page,
    /// A layer.
    Layer,
    /// A form XObject's group.
    Form {
        /// Named by `/MacroGroup` (a group made here): kept as it is.
        named: bool,
    },
    /// A group from `/MacroGroup` marked content.
    Group,
}

/// A container being filled.
struct Frame {
    kind: FrameKind,
    /// Where objects go (`None`: the default layer, made when needed).
    container: Option<NodeIdx>,
    /// Clips before this index belong to outer frames.
    clip_base: usize,
    /// Clip groups open in the frame: the clip's serial, and the group.
    open: Vec<(u64, NodeIdx)>,
    /// The group's own clip is the next one set (`/MacroGroup` with a
    /// clip).
    own_clip: bool,
    /// Nothing has been added yet.
    fresh: bool,
}

impl Frame {
    fn new(kind: FrameKind, container: Option<NodeIdx>, clip_base: usize) -> Frame {
        Frame {
            kind,
            container,
            clip_base,
            open: Vec::new(),
            own_clip: false,
            fresh: true,
        }
    }
}

/// Open marked content.
enum Marked {
    /// A layer's (pops its frame).
    Layer(usize),
    /// Hidden objects'.
    Hidden,
    /// A `/MacroGroup` that made a group (pops its frame).
    Group(usize),
    /// A `/MacroGroup` that named the form it starts (nothing to pop).
    Named,
    /// Edited text's (its content is skipped).
    Text,
    /// Other marked content.
    Other,
}

/// The sink that builds the document.
struct Builder<'a, 'p> {
    doc: &'a mut Document,
    pdf: &'p Pdf,
    page: u32,
    artboard: u32,
    to_canvas: Affine,
    page_box: Rect,
    art_box: Rect,
    layers: &'a mut LayerTable,
    table: &'a mut ResourceTable,
    warnings: &'a mut Warnings,
    frames: Vec<Frame>,
    marked: Vec<Marked>,
    text: Option<text::TextBlock>,
    /// Inside edited text's marked content (its drawing is skipped).
    skip: usize,
    /// Inside hidden objects' marked content.
    hidden: usize,
    /// A layer has started on this page.
    seen_layer: bool,
}

impl Builder<'_, '_> {
    /// Whether a clip is the page's own box (it clips nothing on the
    /// artboard; dropping it shows what lies past the artboard, as
    /// Illustrator does).
    fn is_page_clip(&self, clip: &ClipPath) -> bool {
        if clip.form_box || !is_rectangle(&clip.path) {
            return false;
        }
        let Some(b) = clip.path.bounds() else {
            return false;
        };
        b.contains_rect(&self.page_box.outset(-1.0)) || b.contains_rect(&self.art_box.outset(-1.0))
    }

    /// The container for an object painted with `gs`'s clips: opens and
    /// closes clip groups as the clips change.
    fn container(&mut self, clips: &[ClipPath]) -> NodeIdx {
        let top = self.frames.len() - 1;
        // A group's own clip.
        if self.frames[top].own_clip
            && let Some(clip) = clips.get(self.frames[top].clip_base)
            && let Some(group) = self.frames[top].container
        {
            let path = clip.path.transform(&self.to_canvas);
            if let NodeKind::Group { clip: c, .. } = &mut self.doc.node_mut(group).kind {
                *c = Some(Clip {
                    path,
                    even_odd: clip.even_odd,
                });
            }
            self.frames[top].own_clip = false;
            self.frames[top].clip_base += 1;
        }
        let base = self.frames[top].clip_base;
        let wanted: Vec<&ClipPath> = clips
            .iter()
            .skip(base)
            .filter(|c| !self.is_page_clip(c))
            .collect();
        let frame = &self.frames[top];
        let keep = frame
            .open
            .iter()
            .zip(&wanted)
            .take_while(|((serial, _), c)| *serial == c.serial)
            .count();
        let mut open = std::mem::take(&mut self.frames[top].open);
        open.truncate(keep);
        let mut parent = match open.last() {
            Some(&(_, g)) => g,
            None => self.frame_container(top),
        };
        for clip in wanted.into_iter().skip(keep) {
            let mut group = Node::new(
                0,
                NodeKind::Group {
                    clip: Some(Clip {
                        path: clip.path.transform(&self.to_canvas),
                        even_odd: clip.even_odd,
                    }),
                    isolated: false,
                    knockout: false,
                },
            );
            group.edits = 0;
            let g = self.insert(group, parent);
            open.push((clip.serial, g));
            parent = g;
        }
        self.frames[top].open = open;
        self.frames[top].fresh = false;
        parent
    }

    /// The frame's container, making the default layer when needed.
    fn frame_container(&mut self, frame: usize) -> NodeIdx {
        if let Some(c) = self.frames[frame].container {
            return c;
        }
        let layer = self.layers.default_layer(self.doc, !self.seen_layer);
        self.frames[frame].container = Some(layer);
        layer
    }

    /// Adds a node to the tree under `parent` (it gets the next id).
    fn insert(&mut self, mut node: Node, parent: NodeIdx) -> NodeIdx {
        node.id = self.doc.allocate_id();
        node.parent = Some(parent);
        node.artboard = self.artboard;
        if self.hidden > 0 {
            node.hidden = true;
        }
        let i = self.doc.push(node);
        self.doc.node_mut(parent).children.push(i);
        i
    }

    /// Adds an object painted with `gs`.
    fn add(&mut self, node: Node, gs: &GState) -> NodeIdx {
        let parent = self.container(&gs.clips);
        self.insert(node, parent)
    }

    /// A source for operators drawn in `gs`.
    fn source(
        &mut self,
        ops: &[Op],
        gs: &GState,
        resources: &Resources<'_>,
        transform: Affine,
    ) -> Arc<Source> {
        Arc::new(Source {
            page: self.page,
            ops: ops.to_vec(),
            ctm: gs.ctm,
            base: gs.base,
            state: gs
                .state_ops()
                .into_iter()
                .map(|s| (s.op, self.table.index_shared(&s.res)))
                .collect(),
            resources: self.table.index(resources),
            transform,
        })
    }

    /// Adds content drawn as the file draws it.
    fn add_raw(&mut self, ops: &[Op], gs: &GState, resources: &Resources<'_>, page_bounds: Rect) {
        let mut bounds = page_bounds;
        for c in &gs.clips {
            if let Some(b) = c.path.bounds() {
                bounds = bounds.intersect(&b);
            }
        }
        if bounds.is_empty() {
            return;
        }
        let mut node = Node::new(
            0,
            NodeKind::Raw {
                bounds: bounds.transform(&self.to_canvas),
            },
        );
        node.edits = 0;
        node.transform = self.to_canvas;
        node.source = Some(self.source(ops, gs, resources, self.to_canvas));
        self.add(node, gs);
    }

    /// Closes the page's frames.
    fn finish(&mut self) {
        while self.frames.len() > 1 {
            self.pop_frame();
        }
    }

    /// Closes the top frame, tidying a form's group.
    fn pop_frame(&mut self) {
        let Some(frame) = self.frames.pop() else {
            return;
        };
        if let FrameKind::Form { named } = frame.kind
            && let Some(g) = frame.container
        {
            self.tidy_form_group(g, named);
        }
    }

    /// A form's group: dropped when empty; its box clip dropped when it
    /// clips nothing; replaced by its child when it is only a wrapper.
    fn tidy_form_group(&mut self, g: NodeIdx, named: bool) {
        let children: Vec<NodeIdx> = self.doc.node(g).children.clone();
        let parent = self.doc.node(g).parent;
        if children.is_empty() && !named {
            self.detach(g);
            return;
        }
        if named {
            return;
        }
        // The box clip clips nothing when the content is inside it.
        let content = children
            .iter()
            .filter_map(|&c| node_bounds(self.doc, c))
            .reduce(|a, b| a.union(&b));
        if let NodeKind::Group { clip, .. } = &mut self.doc.node_mut(g).kind
            && let (Some(c), Some(content)) = (clip.as_ref(), content)
            && c.path
                .bounds()
                .is_some_and(|b| b.outset(0.5).contains_rect(&content))
        {
            *clip = None;
        }
        let node = self.doc.node(g);
        let trivial = matches!(
            node.kind,
            NodeKind::Group {
                clip: None,
                isolated: false,
                knockout: false
            }
        ) && node.opacity >= 1.0
            && node.blend == crate::model::BlendMode::Normal;
        if trivial
            && children.len() == 1
            && let Some(p) = parent
        {
            // Put the child where the group was.
            let child = children[0];
            let stack = &mut self.doc.node_mut(p).children;
            if let Some(at) = stack.iter().position(|&x| x == g) {
                stack[at] = child;
            }
            self.doc.node_mut(child).parent = Some(p);
            let n = self.doc.node_mut(g);
            n.children.clear();
            n.removed = true;
        }
    }

    /// Takes a node out of the tree (it stays in the arena, removed).
    fn detach(&mut self, i: NodeIdx) {
        if let Some(p) = self.doc.node(i).parent {
            self.doc.node_mut(p).children.retain(|&c| c != i);
        }
        self.doc.node_mut(i).removed = true;
    }

    fn begin_layer(&mut self, ocg: &Object) -> Marked {
        let Some(layer) = self.layers.layer_for(self.pdf, self.doc, ocg) else {
            return Marked::Other;
        };
        self.seen_layer = true;
        let depth = self.frames.len();
        let mut frame = Frame::new(FrameKind::Layer, Some(layer), 0);
        frame.fresh = true;
        self.frames.push(frame);
        Marked::Layer(depth)
    }
}

/// Whether a path is one axis-aligned rectangle.
fn is_rectangle(path: &PathData) -> bool {
    use crate::geom::Seg;
    let Some(b) = path.bounds() else {
        return false;
    };
    let mut points = 0;
    for s in &path.segs {
        match s {
            Seg::Move { p } | Seg::Line { p } => {
                let on_x = (p.x - b.x0).abs() < 1e-6 || (p.x - b.x1).abs() < 1e-6;
                let on_y = (p.y - b.y0).abs() < 1e-6 || (p.y - b.y1).abs() < 1e-6;
                if !(on_x && on_y) {
                    return false;
                }
                points += 1;
            }
            Seg::Cubic { .. } => return false,
            Seg::Close => {}
        }
    }
    (4..=6).contains(&points)
}

/// A node's bounds on the canvas (strokes included roughly).
pub fn node_bounds(doc: &Document, i: NodeIdx) -> Option<Rect> {
    let n = doc.node(i);
    if n.removed {
        return None;
    }
    match &n.kind {
        NodeKind::Layer { .. } | NodeKind::Group { .. } => {
            let inner = n
                .children
                .iter()
                .filter_map(|&c| node_bounds(doc, c))
                .reduce(|a, b| a.union(&b))?;
            match &n.kind {
                NodeKind::Group { clip: Some(c), .. } => {
                    let r = c.path.bounds()?.intersect(&inner);
                    (!r.is_empty()).then_some(r)
                }
                _ => Some(inner),
            }
        }
        NodeKind::Path(p) => {
            let b = p.data.transform(&n.transform).bounds()?;
            let half = p
                .stroke
                .as_ref()
                .map_or(0.0, |s| s.width / 2.0 * n.transform.scale_factor());
            Some(b.outset(half))
        }
        NodeKind::Text(t) => crate::text::bounds(t).map(|b| b.transform(&n.transform)),
        NodeKind::Image(_) => Some(Rect::new(0.0, 0.0, 1.0, 1.0).transform(&n.transform)),
        NodeKind::Raw { bounds } => {
            let at = n.source.as_ref().map_or(n.transform, |s| s.transform);
            // Raw bounds are on the canvas as read; a move maps them along.
            let delta = at.invert().map(|inv| inv.followed_by(&n.transform));
            Some(match delta {
                Some(d) => bounds.transform(&d),
                None => *bounds,
            })
        }
    }
}

impl Sink for Builder<'_, '_> {
    fn path(&mut self, e: &PathEvent<'_>) {
        if self.skip > 0 {
            return;
        }
        if e.gs.soft_mask.is_some() {
            let bounds = page_bounds_of_path(e);
            self.add_raw(e.ops, e.gs, e.resources, bounds);
            return;
        }
        let fill = if e.fill {
            match paint::paint(self.pdf, &e.gs.fill, e.gs, e.resources.dict()) {
                Some(p) => Some(p),
                None => {
                    let bounds = page_bounds_of_path(e);
                    self.add_raw(e.ops, e.gs, e.resources, bounds);
                    return;
                }
            }
        } else {
            None
        };
        let stroke = if e.stroke {
            match paint::stroke(self.pdf, e.gs, e.resources.dict()) {
                Some(s) => Some(s),
                None => {
                    let bounds = page_bounds_of_path(e);
                    self.add_raw(e.ops, e.gs, e.resources, bounds);
                    return;
                }
            }
        } else {
            None
        };
        let transform = e.gs.ctm.followed_by(&self.to_canvas);
        let mut node = Node::new(
            0,
            NodeKind::Path(PathNode {
                data: e.path.clone(),
                fill,
                even_odd: e.even_odd,
                stroke,
            }),
        );
        node.edits = 0;
        node.opacity = if e.fill {
            e.gs.fill_alpha
        } else {
            e.gs.stroke_alpha
        };
        node.blend = e.gs.blend;
        node.transform = transform;
        node.source = Some(self.source(e.ops, e.gs, e.resources, transform));
        self.add(node, e.gs);
    }

    fn begin_text(&mut self, gs: &GState) {
        if self.skip > 0 {
            return;
        }
        self.text = Some(text::TextBlock::new(gs));
    }

    fn show(&mut self, e: &ShowEvent<'_>) {
        if self.skip > 0 {
            return;
        }
        if let Some(block) = &mut self.text {
            block.show(self.pdf, e);
        }
    }

    fn end_text(&mut self, ops: &[Op], gs: &GState, resources: &Resources<'_>) {
        if self.skip > 0 {
            return;
        }
        let Some(block) = self.text.take() else {
            return;
        };
        match block.finish(self.to_canvas) {
            text::Finished::Empty => {}
            text::Finished::Raw(bounds) => {
                self.warnings.add(
                    "Some text uses fonts drawn by the file (Type 3) and can't be edited as text",
                );
                self.add_raw(ops, block.gs(), resources, bounds);
            }
            text::Finished::Text {
                node: kind,
                transform,
                opacity,
                blend,
            } => {
                let mut node = Node::new(0, NodeKind::Text(kind));
                node.edits = 0;
                node.transform = transform;
                node.opacity = opacity;
                node.blend = blend;
                let start_gs = block.gs().clone();
                node.source = Some(self.source(ops, &start_gs, resources, transform));
                let _ = gs;
                self.add(node, &start_gs);
            }
        }
    }

    fn image(&mut self, e: &ImageEvent<'_>) {
        if self.skip > 0 {
            return;
        }
        let unit = Rect::new(0.0, 0.0, 1.0, 1.0);
        let stencil = e
            .stream
            .dict
            .get("ImageMask")
            .map(|v| self.pdf.resolve(v))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if stencil || e.gs.soft_mask.is_some() {
            self.add_raw(e.ops, e.gs, e.resources, unit.transform(&e.ctm));
            return;
        }
        let dim = |k: &str, short: &str| {
            e.stream
                .dict
                .get(k)
                .or_else(|| e.stream.dict.get(short))
                .map(|v| self.pdf.resolve(v))
                .and_then(|v| v.as_i64())
                .unwrap_or(0)
                .max(0) as u32
        };
        let (width, height) = (dim("Width", "W"), dim("Height", "H"));
        if width == 0 || height == 0 {
            return;
        }
        let key = if e.key.starts_with("inline:") {
            format!("inline:{}:{}", self.page, &e.key["inline:".len()..])
        } else {
            e.key.clone()
        };
        let transform = e.ctm.followed_by(&self.to_canvas);
        let mut node = Node::new(
            0,
            NodeKind::Image(ImageNode {
                source: ImageSource::File { key },
                width,
                height,
            }),
        );
        node.edits = 0;
        node.opacity = e.gs.fill_alpha;
        node.blend = e.gs.blend;
        node.transform = transform;
        node.source = Some(self.source(e.ops, e.gs, e.resources, transform));
        self.add(node, e.gs);
    }

    fn shading(&mut self, e: &ShadingEvent<'_>) {
        if self.skip > 0 {
            return;
        }
        let bbox = paint::shading_dict(&e.shading)
            .and_then(|d| d.get("BBox"))
            .map(|v| self.pdf.resolve(v))
            .and_then(|v| v.as_numbers())
            .filter(|b| b.len() == 4)
            .map(|b| Rect::new(b[0], b[1], b[2], b[3]).transform(&e.gs.ctm));
        let bounds = bbox.unwrap_or(self.page_box);
        self.add_raw(e.ops, e.gs, e.resources, bounds);
    }

    fn begin_group(&mut self, e: &GroupEvent<'_>) -> Descend {
        if self.skip > 0 {
            return Descend::Skip;
        }
        if e.gs.soft_mask.is_some() {
            let [x0, y0, x1, y1] = e.bbox;
            let bounds = Rect::new(x0, y0, x1, y1).transform(&e.ctm);
            self.add_raw(e.ops, e.gs, e.resources, bounds);
            return Descend::Skip;
        }
        let group = e.group.as_ref();
        let flag = |k: &str| {
            group
                .and_then(|g| g.get(k))
                .map(|v| self.pdf.resolve(v))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        };
        let transparency = group.is_some_and(|g| g.is("S", "Transparency"));
        let [x0, y0, x1, y1] = e.bbox;
        let rect = Rect::new(x0, y0, x1, y1);
        let clip = (!rect.is_empty()).then(|| Clip {
            path: PathData::rect(rect).transform(&e.ctm.followed_by(&self.to_canvas)),
            even_odd: false,
        });
        let mut node = Node::new(
            0,
            NodeKind::Group {
                clip,
                isolated: flag("I"),
                knockout: flag("K"),
            },
        );
        node.edits = 0;
        if transparency {
            node.opacity = e.gs.fill_alpha;
            node.blend = e.gs.blend;
        }
        let g = self.add(node, e.gs);
        let base = e.gs.clips.len() + usize::from(!rect.is_empty());
        self.frames
            .push(Frame::new(FrameKind::Form { named: false }, Some(g), base));
        Descend::Into
    }

    fn end_group(&mut self) {
        // Close frames opened inside the form that marked content left
        // open, then the form's own.
        while let Some(f) = self.frames.last() {
            let is_form = matches!(f.kind, FrameKind::Form { .. });
            self.pop_frame();
            if is_form || self.frames.len() <= 1 {
                break;
            }
        }
    }

    fn begin_marked(&mut self, tag: &Name, props: Option<&Object>, gs: &GState) {
        if self.skip > 0 {
            self.marked.push(Marked::Other);
            return;
        }
        let mark = match tag.as_bytes() {
            b"OC" => {
                let ocg = props.map(|p| self.pdf.resolve(p));
                let hidden = ocg
                    .as_ref()
                    .and_then(|o| o.as_dict())
                    .is_some_and(|d| marks::is_hidden_group(self.pdf, d));
                if hidden {
                    self.hidden += 1;
                    Marked::Hidden
                } else if self.frames.len() == 1
                    && let Some(p) = props
                {
                    self.begin_layer(p)
                } else {
                    Marked::Other
                }
            }
            t if t == marks::GROUP.as_bytes() => {
                let mark = marks::read_group(self.pdf, props);
                let top = self.frames.len() - 1;
                if let FrameKind::Form { named: false } = self.frames[top].kind
                    && self.frames[top].fresh
                    && let Some(g) = self.frames[top].container
                {
                    // The group's transparency form: the mark names it.
                    self.frames[top].kind = FrameKind::Form { named: true };
                    self.frames[top].own_clip = mark.clip;
                    let n = self.doc.node_mut(g);
                    n.name = mark.name;
                    if let NodeKind::Group { clip, .. } = &mut n.kind {
                        *clip = None;
                    }
                    Marked::Named
                } else {
                    let mut node = Node::new(
                        0,
                        NodeKind::Group {
                            clip: None,
                            isolated: false,
                            knockout: false,
                        },
                    );
                    node.edits = 0;
                    node.name = mark.name;
                    let g = self.add(node, gs);
                    let depth = self.frames.len();
                    let mut frame = Frame::new(FrameKind::Group, Some(g), gs.clips.len());
                    frame.own_clip = mark.clip;
                    self.frames.push(frame);
                    Marked::Group(depth)
                }
            }
            t if t == marks::TEXT.as_bytes() => {
                if let Some((kind, to_page)) = marks::read_text(self.pdf, props) {
                    let mut node = Node::new(0, NodeKind::Text(kind));
                    node.edits = 0;
                    node.transform = to_page.followed_by(&self.to_canvas);
                    node.opacity = gs.fill_alpha;
                    node.blend = gs.blend;
                    self.add(node, gs);
                }
                self.skip += 1;
                Marked::Text
            }
            _ => Marked::Other,
        };
        self.marked.push(mark);
    }

    fn end_marked(&mut self) {
        match self.marked.pop() {
            Some(Marked::Layer(depth)) | Some(Marked::Group(depth)) => {
                while self.frames.len() > depth.max(1) {
                    self.pop_frame();
                }
            }
            Some(Marked::Hidden) => self.hidden = self.hidden.saturating_sub(1),
            Some(Marked::Text) => self.skip = self.skip.saturating_sub(1),
            Some(Marked::Named) | Some(Marked::Other) | None => {}
        }
    }
}

/// A painted path's bounds in page space, its stroke included.
fn page_bounds_of_path(e: &PathEvent<'_>) -> Rect {
    let b = e.path.transform(&e.gs.ctm).bounds().unwrap_or_default();
    if e.stroke {
        b.outset(e.gs.line_width * e.gs.ctm.scale_factor() / 2.0 + 1.0)
    } else {
        b
    }
}

#[cfg(test)]
mod test;
