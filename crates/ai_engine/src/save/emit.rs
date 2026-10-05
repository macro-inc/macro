//! A page's content written from the document: layers as optional content,
//! groups (transparency groups as forms), unedited objects as the file drew
//! them, and edited ones from the model.

use super::objects::Objects;
use super::paint::{alpha_ops, cm, paint_ops, stroke_ops};
use super::resources::{Resources, rename};
use super::text::{self, InvisibleFont};
use crate::build::node_bounds;
use crate::file::SourceFile;
use crate::geom::{Affine, PathData, Rect, Seg};
use crate::marks::{self, GroupMark};
use crate::model::{
    BlendMode, Document, ImageNode, ImageSource, Node, NodeIdx, NodeKind, PathNode, Source, flags,
};
use crate::pdf::content::Op;
use crate::pdf::{Dict, ObjRef, Object, Stream};
use std::collections::{HashMap, HashSet};

/// Where operators go: a content stream and its resources.
struct Target {
    ops: Vec<Op>,
    res: Resources,
}

/// What every page shares.
pub struct Shared<'a> {
    /// The document.
    pub doc: &'a Document,
    /// The objects being written.
    pub objects: &'a mut Objects,
    /// Each layer's optional content group.
    pub layers: &'a HashMap<NodeIdx, ObjRef>,
    /// The group hidden objects go in.
    pub hidden: Option<ObjRef>,
    /// The font invisible copies of edited text use.
    pub invisible: &'a mut InvisibleFont,
    /// Added images, written once each.
    pub images: &'a mut HashMap<String, ObjRef>,
}

/// Writes one page.
pub struct PageWriter<'a, 'b> {
    shared: &'b mut Shared<'a>,
    /// Canvas to page space.
    c2p: Affine,
    /// Nodes with content on this page.
    on_page: &'b HashSet<NodeIdx>,
    targets: Vec<Target>,
}

fn op(name: &str, operands: Vec<Object>) -> Op {
    Op::new(name, operands)
}

fn num(v: f64) -> Object {
    Object::number(v)
}

/// A path's construction operators.
pub fn path_ops(data: &PathData) -> Vec<Op> {
    let mut out = Vec::with_capacity(data.segs.len());
    for s in &data.segs {
        out.push(match *s {
            Seg::Move { p } => op("m", vec![num(p.x), num(p.y)]),
            Seg::Line { p } => op("l", vec![num(p.x), num(p.y)]),
            Seg::Cubic { c1, c2, p } => op(
                "c",
                vec![
                    num(c1.x),
                    num(c1.y),
                    num(c2.x),
                    num(c2.y),
                    num(p.x),
                    num(p.y),
                ],
            ),
            Seg::Close => op("h", Vec::new()),
        });
    }
    out
}

/// Whether a node is written as the file drew it.
pub fn from_source(n: &Node) -> bool {
    n.source.is_some() && (matches!(n.kind, NodeKind::Raw { .. }) || n.edits & flags::REDRAWN == 0)
}

impl<'a, 'b> PageWriter<'a, 'b> {
    /// A writer for a page whose space `c2p` maps the canvas to.
    pub fn new(
        shared: &'b mut Shared<'a>,
        c2p: Affine,
        on_page: &'b HashSet<NodeIdx>,
    ) -> PageWriter<'a, 'b> {
        PageWriter {
            shared,
            c2p,
            on_page,
            targets: vec![Target {
                ops: Vec::new(),
                res: Resources::new(),
            }],
        }
    }

    fn doc(&self) -> &'a Document {
        self.shared.doc
    }

    fn file(&self) -> Option<&'a SourceFile> {
        self.shared.doc.file.as_deref()
    }

    fn top(&mut self) -> &mut Target {
        self.targets.last_mut().expect("the page's target")
    }

    fn push(&mut self, o: Op) {
        self.top().ops.push(o);
    }

    fn extend(&mut self, ops: Vec<Op>) {
        self.top().ops.extend(ops);
    }

    /// The page's content and resources.
    pub fn finish(mut self) -> (Vec<u8>, Dict) {
        let t = self.targets.pop().expect("the page's target");
        (crate::pdf::content::write(&t.ops), t.res.into_dict())
    }

    /// Writes the layers' content on this page.
    pub fn layers(&mut self) {
        for &l in &self.doc().layers {
            let n = self.doc().node(l);
            if n.removed || !self.on_page.contains(&l) {
                continue;
            }
            let Some(&ocg) = self.shared.layers.get(&l) else {
                continue;
            };
            let props = self.top().res.name("Properties", Object::Ref(ocg));
            self.push(op("BDC", vec![Object::name("OC"), Object::Name(props)]));
            for &c in &n.children {
                self.node(c);
            }
            self.push(op("EMC", Vec::new()));
        }
    }

    fn node(&mut self, i: NodeIdx) {
        let doc = self.doc();
        let n = doc.node(i);
        if n.removed || !self.on_page.contains(&i) {
            return;
        }
        let hidden = n.hidden && !n.is_layer();
        if hidden && let Some(h) = self.shared.hidden {
            let props = self.top().res.name("Properties", Object::Ref(h));
            self.push(op("BDC", vec![Object::name("OC"), Object::Name(props)]));
        }
        match &n.kind {
            NodeKind::Layer { .. } => {}
            NodeKind::Group { .. } => self.group(i),
            _ if from_source(n) => {
                let wrap = matches!(n.kind, NodeKind::Raw { .. })
                    && (n.opacity < 1.0 || n.blend != BlendMode::Normal);
                if wrap {
                    self.begin_form();
                }
                if let Some(source) = &n.source {
                    self.source(n, source);
                }
                if wrap {
                    let bounds = node_bounds(doc, i);
                    self.end_form(n.opacity, n.blend, false, false, bounds);
                }
            }
            NodeKind::Path(p) => self.path(n, p),
            NodeKind::Text(t) if t.runs.is_some() => {
                let to_page = n.transform.followed_by(&self.c2p);
                let Target { ops, res } = self.targets.last_mut().expect("target");
                let file = self.shared.doc.file.as_deref();
                text::runs(n, t, &to_page, file, ops, res, self.shared.objects);
            }
            NodeKind::Text(t) => {
                let to_page = n.transform.followed_by(&self.c2p);
                let Target { ops, res } = self.targets.last_mut().expect("target");
                text::laid_out(
                    n,
                    t,
                    &to_page,
                    ops,
                    res,
                    self.shared.objects,
                    self.shared.invisible,
                );
            }
            NodeKind::Image(img) => self.image(n, img),
            NodeKind::Raw { .. } => {}
        }
        if hidden && self.shared.hidden.is_some() {
            self.push(op("EMC", Vec::new()));
        }
    }

    /// A group: marked, clipped, and (when it has opacity, blending, or
    /// isolation) a transparency group form.
    fn group(&mut self, i: NodeIdx) {
        let doc = self.doc();
        let n = doc.node(i);
        let NodeKind::Group {
            clip,
            isolated,
            knockout,
        } = &n.kind
        else {
            return;
        };
        let form = n.opacity < 1.0 || n.blend != BlendMode::Normal || *isolated || *knockout;
        if form {
            self.begin_form();
        }
        let mark = marks::group_props(&GroupMark {
            name: n.name.clone(),
            clip: clip.is_some(),
        });
        self.push(op(
            "BDC",
            vec![Object::name(marks::GROUP), Object::Dict(mark)],
        ));
        self.push(op("q", Vec::new()));
        if let Some(c) = clip {
            let ops = path_ops(&c.path.transform(&self.c2p));
            self.extend(ops);
            self.push(op(if c.even_odd { "W*" } else { "W" }, Vec::new()));
            self.push(op("n", Vec::new()));
        }
        for &c in &n.children {
            self.node(c);
        }
        self.push(op("Q", Vec::new()));
        self.push(op("EMC", Vec::new()));
        if form {
            let bounds = node_bounds(doc, i);
            self.end_form(n.opacity, n.blend, *isolated, *knockout, bounds);
        }
    }

    /// Starts a form's content.
    fn begin_form(&mut self) {
        self.targets.push(Target {
            ops: Vec::new(),
            res: Resources::new(),
        });
    }

    /// Ends a form: it is drawn as a transparency group with an opacity and
    /// blend mode.
    fn end_form(
        &mut self,
        opacity: f32,
        blend: BlendMode,
        isolated: bool,
        knockout: bool,
        bounds: Option<Rect>,
    ) {
        let Some(t) = self.targets.pop() else { return };
        let bbox = bounds
            .map(|b| b.transform(&self.c2p).outset(4.0))
            .filter(|b| !b.is_empty() && b.width().is_finite())
            .unwrap_or(Rect::new(-1.0e5, -1.0e5, 1.0e5, 1.0e5));
        let mut group = Dict::new();
        group.set("Type", Object::name("Group"));
        group.set("S", Object::name("Transparency"));
        group.set("I", Object::Bool(isolated));
        group.set("K", Object::Bool(knockout));
        let mut d = Dict::new();
        d.set("Type", Object::name("XObject"));
        d.set("Subtype", Object::name("Form"));
        d.set(
            "BBox",
            Object::Array(vec![num(bbox.x0), num(bbox.y0), num(bbox.x1), num(bbox.y1)]),
        );
        d.set("Group", Object::Dict(group));
        d.set("Resources", Object::Dict(t.res.into_dict()));
        let data = crate::pdf::content::write(&t.ops);
        let stream = super::compressed(d, &data);
        let form = self.shared.objects.add(Object::Stream(stream));
        let name = self.top().res.name("XObject", Object::Ref(form));
        let mut ops = vec![op("q", Vec::new())];
        let gs = {
            let res = &mut self.top().res;
            alpha_ops(opacity, blend, res)
        };
        ops.extend(gs);
        ops.push(op("Do", vec![Object::Name(name)]));
        ops.push(op("Q", Vec::new()));
        self.extend(ops);
    }

    /// The canvas move since reading, as a page-space matrix for this
    /// page.
    fn delta(&self, n: &Node, source: &Source) -> Affine {
        let Some(page) = self.file().and_then(|f| f.pages.get(source.page as usize)) else {
            return Affine::IDENTITY;
        };
        let Some(inv) = source.transform.invert() else {
            return Affine::IDENTITY;
        };
        page.read_to_canvas()
            .followed_by(&inv)
            .followed_by(&n.transform)
            .followed_by(&self.c2p)
    }

    /// A node written with the operators that drew it.
    fn source(&mut self, n: &Node, source: &Source) {
        let Some(file) = self.file() else { return };
        let delta = self.delta(n, source);
        let src_res = file.resources(source.resources).clone();
        let mut ops = vec![op("q", Vec::new()), cm(&source.ctm.followed_by(&delta))];
        {
            let Target { res, .. } = self.targets.last_mut().expect("target");
            for (o, r) in &source.state {
                ops.push(rename(
                    o,
                    &file.pdf,
                    file.resources(*r),
                    res,
                    self.shared.objects,
                ));
            }
            for o in &source.ops {
                ops.push(rename(o, &file.pdf, &src_res, res, self.shared.objects));
            }
        }
        ops.push(op("Q", Vec::new()));
        self.extend(ops);
    }

    /// A path written from the model.
    fn path(&mut self, n: &Node, p: &PathNode) {
        let to_page = n.transform.followed_by(&self.c2p);
        let mut ops = vec![op("q", Vec::new()), cm(&to_page)];
        {
            let Target { res, .. } = self.targets.last_mut().expect("target");
            ops.extend(alpha_ops(n.opacity, n.blend, res));
            if let Some(f) = &p.fill {
                ops.extend(paint_ops(f, false, &to_page, res, self.shared.objects));
            }
            if let Some(s) = &p.stroke {
                ops.extend(stroke_ops(s, &to_page, res, self.shared.objects));
            }
        }
        ops.extend(path_ops(&p.data));
        let paint = match (p.fill.is_some(), p.stroke.is_some(), p.even_odd) {
            (true, true, false) => "B",
            (true, true, true) => "B*",
            (true, false, false) => "f",
            (true, false, true) => "f*",
            (false, true, _) => "S",
            (false, false, _) => "n",
        };
        ops.push(op(paint, Vec::new()));
        ops.push(op("Q", Vec::new()));
        self.extend(ops);
    }

    /// An image written from the model.
    fn image(&mut self, n: &Node, img: &ImageNode) {
        let to_page = n.transform.followed_by(&self.c2p);
        let mut ops = vec![op("q", Vec::new()), cm(&to_page)];
        {
            let Target { res, .. } = self.targets.last_mut().expect("target");
            ops.extend(alpha_ops(n.opacity, n.blend, res));
        }
        match &img.source {
            ImageSource::File { .. } => {
                let (Some(file), Some(source)) = (self.file(), n.source.as_ref()) else {
                    return;
                };
                let src_res = file.resources(source.resources).clone();
                let Some(draw) = source.ops.first() else {
                    return;
                };
                let Target { res, .. } = self.targets.last_mut().expect("target");
                ops.push(rename(draw, &file.pdf, &src_res, res, self.shared.objects));
            }
            ImageSource::Added { hash } => {
                let Some(xobject) = self.added_image(hash) else {
                    return;
                };
                let name = self.top().res.name("XObject", Object::Ref(xobject));
                ops.push(op("Do", vec![Object::Name(name)]));
            }
        }
        ops.push(op("Q", Vec::new()));
        self.extend(ops);
    }

    /// An added image's XObject (written once).
    fn added_image(&mut self, hash: &str) -> Option<ObjRef> {
        if let Some(&r) = self.shared.images.get(hash) {
            return Some(r);
        }
        let img = self.doc().images.get(hash)?;
        let mut d = Dict::new();
        d.set("Type", Object::name("XObject"));
        d.set("Subtype", Object::name("Image"));
        d.set("Width", i64::from(img.width));
        d.set("Height", i64::from(img.height));
        d.set("ColorSpace", Object::name("DeviceRGB"));
        d.set("BitsPerComponent", 8);
        let opaque = img.rgba.chunks_exact(4).all(|p| p[3] == 255);
        if !opaque {
            let alpha: Vec<u8> = img.rgba.chunks_exact(4).map(|p| p[3]).collect();
            let mut m = Dict::new();
            m.set("Type", Object::name("XObject"));
            m.set("Subtype", Object::name("Image"));
            m.set("Width", i64::from(img.width));
            m.set("Height", i64::from(img.height));
            m.set("ColorSpace", Object::name("DeviceGray"));
            m.set("BitsPerComponent", 8);
            let mask = self
                .shared
                .objects
                .add(Object::Stream(super::compressed(m, &alpha)));
            d.set("SMask", Object::Ref(mask));
        }
        let stream = match &img.jpeg {
            Some(jpeg) if opaque => {
                d.set("Filter", Object::name("DCTDecode"));
                Stream::new(d, jpeg.to_vec())
            }
            _ => {
                let rgb: Vec<u8> = img
                    .rgba
                    .chunks_exact(4)
                    .flat_map(|p| [p[0], p[1], p[2]])
                    .collect();
                super::compressed(d, &rgb)
            }
        };
        let r = self.shared.objects.add(Object::Stream(stream));
        self.shared.images.insert(hash.to_string(), r);
        Some(r)
    }
}
