//! The content stream interpreter: runs a page's (or form's, or glyph's)
//! operators with a full graphics state and reports what they paint to a
//! [`Sink`]: paths, text, images, shadings, groups (form XObjects), and
//! marked content. Each report carries the operators that drew it and the
//! state it drew in, so a builder can keep them and a renderer can draw.

pub mod fonts;
mod state;

pub use state::{ClipPath, ColorState, GState, ResDict, StateOp, TextState};

use crate::color::ColorSpace;
use crate::geom::{Affine, PathData, Point, Seg};
use crate::model::{BlendMode, LineCap, LineJoin};
use crate::pdf::content::{InlineImage, Op};
use crate::pdf::{Dict, Name, Object, Resolve, Stream};
use fonts::{FontCache, LoadedFont};
use std::sync::Arc;

/// Deepest nesting of forms (and Type 3 glyphs) followed.
const MAX_DEPTH: usize = 16;
/// Deepest `q` nesting kept.
const MAX_SAVES: usize = 256;

/// A painted path.
pub struct PathEvent<'a> {
    /// The path in user space.
    pub path: &'a PathData,
    /// Filled.
    pub fill: bool,
    /// Stroked.
    pub stroke: bool,
    /// Even-odd fill rule.
    pub even_odd: bool,
    /// The state it was painted in.
    pub gs: &'a GState,
    /// The operators: the path's construction and its painting.
    pub ops: &'a [Op],
    /// The resources the operators name things in.
    pub resources: &'a Resources<'a>,
}

/// A glyph shown.
pub struct ShownGlyph {
    /// Its character code.
    pub code: u32,
    /// Bytes the code took in the string.
    pub len: u8,
    /// The text it stands for.
    pub text: String,
    /// Text space (size 1) to page space at the glyph's origin.
    pub trm: Affine,
    /// Advance in text space after scaling (for selection boxes).
    pub advance: f64,
}

/// Glyphs shown by one text-showing operator.
pub struct ShowEvent<'a> {
    /// The font.
    pub font: &'a Arc<LoadedFont>,
    /// The glyphs.
    pub glyphs: Vec<ShownGlyph>,
    /// The state they were shown in.
    pub gs: &'a GState,
    /// The operator.
    pub op: &'a Op,
    /// The resources the operator runs with.
    pub resources: &'a Resources<'a>,
}

/// An image painted.
pub struct ImageEvent<'a> {
    /// Its key (`obj:<number>` or `inline:<index>`).
    pub key: String,
    /// The image stream (an inline image as a stream with expanded keys).
    pub stream: &'a Stream,
    /// The unit square to page space.
    pub ctm: Affine,
    /// The state it was painted in.
    pub gs: &'a GState,
    /// The operator (`Do`, or the inline image's `BI`).
    pub ops: &'a [Op],
    /// The resources the image (and its color space) is named in.
    pub resources: &'a Resources<'a>,
}

/// A shading painted with `sh`.
pub struct ShadingEvent<'a> {
    /// The shading.
    pub shading: Object,
    /// The state it was painted in.
    pub gs: &'a GState,
    /// The operator.
    pub ops: &'a [Op],
    /// The resources it is named in.
    pub resources: &'a Resources<'a>,
}

/// A form XObject starting.
pub struct GroupEvent<'a> {
    /// Its key (`obj:<number>`).
    pub key: String,
    /// Form space to page space.
    pub ctm: Affine,
    /// Its bounding box in form space.
    pub bbox: [f64; 4],
    /// Its transparency group dictionary, when it is one.
    pub group: Option<Dict>,
    /// The state it is painted in.
    pub gs: &'a GState,
    /// The `Do` operator.
    pub ops: &'a [Op],
    /// The resources the form is named in.
    pub resources: &'a Resources<'a>,
    /// The form's own resources (its content names things in them).
    pub inner: &'a Resources<'a>,
}

/// What a sink wants done with a form.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Descend {
    /// Run its content (its paintings are reported inside the group).
    Into,
    /// Skip it (the sink handles the form as a whole).
    Skip,
}

/// What the interpreter reports to.
pub trait Sink {
    /// A path was painted.
    fn path(&mut self, e: &PathEvent<'_>);
    /// A text block (`BT`) started.
    fn begin_text(&mut self, _gs: &GState) {}
    /// Glyphs were shown.
    fn show(&mut self, e: &ShowEvent<'_>);
    /// A text block ended; `ops` are its operators from `BT` to `ET`.
    fn end_text(&mut self, _ops: &[Op], _gs: &GState, _resources: &Resources<'_>) {}
    /// An image was painted.
    fn image(&mut self, e: &ImageEvent<'_>);
    /// A shading was painted.
    fn shading(&mut self, e: &ShadingEvent<'_>);
    /// A form starts.
    fn begin_group(&mut self, _e: &GroupEvent<'_>) -> Descend {
        Descend::Into
    }
    /// A form ends.
    fn end_group(&mut self) {}
    /// Marked content starts; `props` is its property list (a reference
    /// when the resources name one).
    fn begin_marked(&mut self, _tag: &Name, _props: Option<&Object>, _gs: &GState) {}
    /// Marked content ends.
    fn end_marked(&mut self) {}
    /// Whether to show Type 3 glyphs by running their procedures (a
    /// renderer does; a model builder keeps the text block).
    fn wants_type3_glyphs(&self) -> bool {
        false
    }
}

/// A resource dictionary and what it resolves through.
pub struct Resources<'a> {
    pdf: &'a dyn Resolve,
    res: ResDict,
}

/// Serials for resource dictionaries, so sinks can tell them apart.
static RESOURCE_SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

impl<'a> Resources<'a> {
    /// Resources from a dictionary value.
    pub fn new(pdf: &'a dyn Resolve, dict: Dict) -> Resources<'a> {
        let id = RESOURCE_SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Resources {
            pdf,
            res: ResDict {
                id,
                dict: Arc::new(dict),
            },
        }
    }

    /// Resources sharing a dictionary already read.
    pub fn shared(pdf: &'a dyn Resolve, res: ResDict) -> Resources<'a> {
        Resources { pdf, res }
    }

    /// The dictionary.
    pub fn dict(&self) -> &Dict {
        &self.res.dict
    }

    /// The dictionary, shared.
    pub fn res(&self) -> &ResDict {
        &self.res
    }

    /// A serial telling this dictionary apart from others read.
    pub fn id(&self) -> u64 {
        self.res.id
    }

    /// A named resource of a category (`Font`, `XObject`, …), as stored
    /// (references unresolved).
    pub fn raw(&self, category: &str, name: &Name) -> Option<Object> {
        let cat = self.pdf.resolve(self.res.dict.get(category)?);
        let d = cat.as_dict()?;
        d.iter()
            .find(|(k, _)| k.as_bytes() == name.as_bytes())
            .map(|(_, v)| v.clone())
    }

    /// A named resource, resolved.
    pub fn get(&self, category: &str, name: &Name) -> Option<Object> {
        self.raw(category, name).map(|v| self.pdf.resolve(&v))
    }
}

/// The interpreter.
pub struct Interp<'a> {
    pdf: &'a dyn Resolve,
    fonts: &'a mut FontCache,
    depth: usize,
    inline_count: usize,
    clip_serial: u64,
}

fn name_operand(op: &Op, i: usize) -> Option<&Name> {
    op.operands.get(i).and_then(Object::as_name)
}

fn point(op: &Op, i: usize) -> Point {
    Point::new(op.num(i), op.num(i + 1))
}

/// The bytes of a text-showing operand (strings) and its numbers (`TJ`).
enum ShowItem<'b> {
    Text(&'b [u8]),
    Adjust(f64),
}

impl<'a> Interp<'a> {
    /// An interpreter over a file's objects.
    pub fn new(pdf: &'a dyn Resolve, fonts: &'a mut FontCache) -> Interp<'a> {
        Interp {
            pdf,
            fonts,
            depth: 0,
            inline_count: 0,
            clip_serial: 0,
        }
    }

    fn next_clip(&mut self) -> u64 {
        self.clip_serial += 1;
        self.clip_serial
    }

    /// Runs content in a graphics state (user space mapped to page space by
    /// `gs.ctm`), with resources, reporting to `sink`.
    pub fn run(
        &mut self,
        ops: &[Op],
        resources: &Resources<'_>,
        gs: GState,
        sink: &mut dyn Sink,
    ) -> GState {
        let mut gs = gs;
        let mut saved: Vec<GState> = Vec::new();
        let mut path = PathData::default();
        let mut path_start: Option<usize> = None;
        let mut current = Point::default();
        let mut start = Point::default();
        let mut pending_clip: Option<bool> = None;
        let mut text_matrix = Affine::IDENTITY;
        let mut line_matrix = Affine::IDENTITY;
        let mut text_start: Option<usize> = None;
        // Glyph outlines of text shown in a clipping render mode, in page
        // space; they clip what follows the text block.
        let mut text_clip: Option<PathData> = None;
        let mut marked = 0usize;

        for (k, op) in ops.iter().enumerate() {
            let o = op.operator.as_slice();
            match o {
                b"q" => {
                    if saved.len() < MAX_SAVES {
                        saved.push(gs.clone());
                    }
                }
                b"Q" => {
                    if let Some(s) = saved.pop() {
                        gs = s;
                    }
                }
                b"cm" => {
                    if let Some(m) = op
                        .operands
                        .iter()
                        .map(Object::as_f64)
                        .collect::<Option<Vec<_>>>()
                        && let Some(m) = Affine::from_slice(&m)
                    {
                        gs.ctm = m.followed_by(&gs.ctm);
                    }
                }
                b"w" => {
                    gs.line_width = op.num(0).abs();
                    gs.remember(op, resources.res());
                }
                b"J" => {
                    gs.cap = match op.num(0) as i64 {
                        1 => LineCap::Round,
                        2 => LineCap::Square,
                        _ => LineCap::Butt,
                    };
                    gs.remember(op, resources.res());
                }
                b"j" => {
                    gs.join = match op.num(0) as i64 {
                        1 => LineJoin::Round,
                        2 => LineJoin::Bevel,
                        _ => LineJoin::Miter,
                    };
                    gs.remember(op, resources.res());
                }
                b"M" => {
                    gs.miter = op.num(0);
                    gs.remember(op, resources.res());
                }
                b"d" => {
                    gs.dash = op
                        .operands
                        .first()
                        .and_then(Object::as_numbers)
                        .unwrap_or_default();
                    gs.dash_offset = op.num(1);
                    gs.remember(op, resources.res());
                }
                b"ri" | b"i" => gs.remember(op, resources.res()),
                b"gs" => {
                    if let Some(n) = name_operand(op, 0)
                        && let Some(Object::Dict(d)) = resources.get("ExtGState", n)
                    {
                        self.ext_gstate(&d, &mut gs);
                    }
                    gs.remember(op, resources.res());
                }
                // Colors.
                b"CS" | b"cs" => {
                    let space = op
                        .operands
                        .first()
                        .and_then(|v| ColorSpace::parse(self.pdf, v, resources.dict()).ok())
                        .unwrap_or(ColorSpace::Gray);
                    let target = if o == b"CS" {
                        &mut gs.stroke
                    } else {
                        &mut gs.fill
                    };
                    *target = ColorState::initial(space);
                    target.ops = vec![StateOp {
                        op: op.clone(),
                        res: resources.res().clone(),
                    }];
                }
                b"SC" | b"SCN" | b"sc" | b"scn" => {
                    let stroke = o[0] == b'S';
                    let pattern = op
                        .operands
                        .last()
                        .and_then(Object::as_name)
                        .and_then(|n| resources.get("Pattern", n));
                    let target = if stroke { &mut gs.stroke } else { &mut gs.fill };
                    target.comps = op
                        .operands
                        .iter()
                        .filter_map(Object::as_f64)
                        .map(|v| v as f32)
                        .collect();
                    target.pattern = pattern;
                    target.ops.truncate(1);
                    if target
                        .ops
                        .first()
                        .is_some_and(|f| !f.op.is("CS") && !f.op.is("cs"))
                    {
                        target.ops.clear();
                    }
                    target.ops.push(StateOp {
                        op: op.clone(),
                        res: resources.res().clone(),
                    });
                }
                b"G" | b"g" | b"RG" | b"rg" | b"K" | b"k" => {
                    let space = match o {
                        b"G" | b"g" => ColorSpace::Gray,
                        b"RG" | b"rg" => ColorSpace::Rgb,
                        _ => ColorSpace::Cmyk,
                    };
                    let stroke = o[0].is_ascii_uppercase();
                    let target = if stroke { &mut gs.stroke } else { &mut gs.fill };
                    target.space = space;
                    target.comps = op
                        .operands
                        .iter()
                        .filter_map(Object::as_f64)
                        .map(|v| v as f32)
                        .collect();
                    target.pattern = None;
                    target.ops = vec![StateOp {
                        op: op.clone(),
                        res: resources.res().clone(),
                    }];
                }
                // Path construction.
                b"m" | b"l" | b"c" | b"v" | b"y" | b"h" | b"re" => {
                    if path_start.is_none() {
                        path_start = Some(k);
                    }
                    match o {
                        b"m" => {
                            current = point(op, 0);
                            start = current;
                            path.segs.push(Seg::Move { p: current });
                        }
                        b"l" => {
                            current = point(op, 0);
                            path.segs.push(Seg::Line { p: current });
                        }
                        b"c" => {
                            let (c1, c2, p) = (point(op, 0), point(op, 2), point(op, 4));
                            path.segs.push(Seg::Cubic { c1, c2, p });
                            current = p;
                        }
                        b"v" => {
                            let (c2, p) = (point(op, 0), point(op, 2));
                            path.segs.push(Seg::Cubic { c1: current, c2, p });
                            current = p;
                        }
                        b"y" => {
                            let (c1, p) = (point(op, 0), point(op, 2));
                            path.segs.push(Seg::Cubic { c1, c2: p, p });
                            current = p;
                        }
                        b"h" => {
                            path.segs.push(Seg::Close);
                            current = start;
                        }
                        _ => {
                            let (x, y, w, h) = (op.num(0), op.num(1), op.num(2), op.num(3));
                            path.segs.extend([
                                Seg::Move {
                                    p: Point::new(x, y),
                                },
                                Seg::Line {
                                    p: Point::new(x + w, y),
                                },
                                Seg::Line {
                                    p: Point::new(x + w, y + h),
                                },
                                Seg::Line {
                                    p: Point::new(x, y + h),
                                },
                                Seg::Close,
                            ]);
                            current = Point::new(x, y);
                            start = current;
                        }
                    }
                }
                b"W" => pending_clip = Some(false),
                b"W*" => pending_clip = Some(true),
                // Path painting.
                b"S" | b"s" | b"f" | b"F" | b"f*" | b"B" | b"B*" | b"b" | b"b*" | b"n" => {
                    if matches!(o, b"s" | b"b" | b"b*") {
                        path.segs.push(Seg::Close);
                    }
                    let fill = matches!(o, b"f" | b"F" | b"f*" | b"B" | b"B*" | b"b" | b"b*");
                    let stroke = matches!(o, b"S" | b"s" | b"B" | b"B*" | b"b" | b"b*");
                    let even_odd = matches!(o, b"f*" | b"B*" | b"b*");
                    if (fill || stroke) && !path.segs.is_empty() {
                        let from = path_start.unwrap_or(k);
                        sink.path(&PathEvent {
                            path: &path,
                            fill,
                            stroke,
                            even_odd,
                            gs: &gs,
                            ops: &ops[from..=k],
                            resources,
                        });
                    }
                    if let Some(eo) = pending_clip.take() {
                        let serial = self.next_clip();
                        gs.clips.push(ClipPath {
                            path: path.transform(&gs.ctm),
                            even_odd: eo,
                            serial,
                            form_box: false,
                        });
                    }
                    path = PathData::default();
                    path_start = None;
                }
                // Text.
                b"BT" => {
                    text_matrix = Affine::IDENTITY;
                    line_matrix = Affine::IDENTITY;
                    text_start = Some(k);
                    text_clip = None;
                    sink.begin_text(&gs);
                }
                b"ET" => {
                    if let Some(s) = text_start.take() {
                        sink.end_text(&ops[s..=k], &gs, resources);
                    }
                    if let Some(clip) = text_clip.take() {
                        let serial = self.next_clip();
                        gs.clips.push(ClipPath {
                            path: clip,
                            even_odd: false,
                            serial,
                            form_box: false,
                        });
                    }
                }
                b"Tc" => {
                    gs.text.char_spacing = op.num(0);
                    state::remember_text(&mut gs.text, op, resources.res());
                }
                b"Tw" => {
                    gs.text.word_spacing = op.num(0);
                    state::remember_text(&mut gs.text, op, resources.res());
                }
                b"Tz" => {
                    gs.text.h_scale = op.num(0) / 100.0;
                    state::remember_text(&mut gs.text, op, resources.res());
                }
                b"TL" => {
                    gs.text.leading = op.num(0);
                    state::remember_text(&mut gs.text, op, resources.res());
                }
                b"Ts" => {
                    gs.text.rise = op.num(0);
                    state::remember_text(&mut gs.text, op, resources.res());
                }
                b"Tr" => {
                    gs.text.render = op.num(0).clamp(0.0, 7.0) as u8;
                    state::remember_text(&mut gs.text, op, resources.res());
                }
                b"Tf" => {
                    gs.text.size = op.num(1);
                    gs.text.font = name_operand(op, 0)
                        .and_then(|n| resources.raw("Font", n))
                        .and_then(|f| self.fonts.load(self.pdf, &f));
                    state::remember_text(&mut gs.text, op, resources.res());
                }
                b"Td" | b"TD" => {
                    let (tx, ty) = (op.num(0), op.num(1));
                    if o == b"TD" {
                        gs.text.leading = -ty;
                        // Text after this block depends on it (`T*`, `'`).
                        let set = Op::new("TL", vec![Object::number(-ty)]);
                        state::remember_text(&mut gs.text, &set, resources.res());
                    }
                    line_matrix = Affine::translate(tx, ty).followed_by(&line_matrix);
                    text_matrix = line_matrix;
                }
                b"Tm" => {
                    if let Some(m) = op
                        .operands
                        .iter()
                        .map(Object::as_f64)
                        .collect::<Option<Vec<_>>>()
                        && let Some(m) = Affine::from_slice(&m)
                    {
                        line_matrix = m;
                        text_matrix = m;
                    }
                }
                b"T*" => {
                    line_matrix =
                        Affine::translate(0.0, -gs.text.leading).followed_by(&line_matrix);
                    text_matrix = line_matrix;
                }
                b"Tj" | b"TJ" | b"'" | b"\"" => {
                    if o == b"'" || o == b"\"" {
                        if o == b"\"" {
                            gs.text.word_spacing = op.num(0);
                            gs.text.char_spacing = op.num(1);
                            for (name, v) in [("Tw", op.num(0)), ("Tc", op.num(1))] {
                                let set = Op::new(name, vec![Object::number(v)]);
                                state::remember_text(&mut gs.text, &set, resources.res());
                            }
                        }
                        line_matrix =
                            Affine::translate(0.0, -gs.text.leading).followed_by(&line_matrix);
                        text_matrix = line_matrix;
                    }
                    let items: Vec<ShowItem<'_>> = match o {
                        b"TJ" => op
                            .operands
                            .first()
                            .and_then(Object::as_array)
                            .unwrap_or_default()
                            .iter()
                            .filter_map(|v| match v {
                                Object::String(s) => Some(ShowItem::Text(s)),
                                v => v.as_f64().map(ShowItem::Adjust),
                            })
                            .collect(),
                        _ => op
                            .operands
                            .last()
                            .and_then(Object::as_bytes)
                            .map(|s| vec![ShowItem::Text(s)])
                            .unwrap_or_default(),
                    };
                    self.show(
                        &items,
                        &mut text_matrix,
                        &gs,
                        op,
                        resources,
                        &mut text_clip,
                        sink,
                    );
                }
                // External objects, shadings, inline images.
                b"Do" => {
                    let Some(n) = name_operand(op, 0) else {
                        continue;
                    };
                    let Some(raw) = resources.raw("XObject", n) else {
                        continue;
                    };
                    let key = match &raw {
                        Object::Ref(r) => format!("obj:{}", r.num),
                        _ => format!("xobject:{}", n.as_str()),
                    };
                    let resolved = self.pdf.resolve(&raw);
                    let Some(stream) = resolved.as_stream() else {
                        continue;
                    };
                    if stream.dict.is("Subtype", "Image") {
                        sink.image(&ImageEvent {
                            key,
                            stream,
                            ctm: gs.ctm,
                            gs: &gs,
                            ops: &ops[k..=k],
                            resources,
                        });
                    } else if stream.dict.is("Subtype", "Form") {
                        self.form(key, stream, &gs, resources, &ops[k..=k], sink);
                    }
                }
                b"sh" => {
                    if let Some(n) = name_operand(op, 0)
                        && let Some(shading) = resources.get("Shading", n)
                    {
                        sink.shading(&ShadingEvent {
                            shading,
                            gs: &gs,
                            ops: &ops[k..=k],
                            resources,
                        });
                    }
                }
                b"BI" => {
                    if let Some(InlineImage { dict, data }) = &op.inline_image {
                        let expanded = crate::image::expand_inline(dict);
                        let stream = Stream::new(expanded, data.clone());
                        self.inline_count += 1;
                        sink.image(&ImageEvent {
                            key: format!("inline:{}", self.inline_count),
                            stream: &stream,
                            ctm: gs.ctm,
                            gs: &gs,
                            ops: &ops[k..=k],
                            resources,
                        });
                    }
                }
                // Marked content.
                b"BMC" | b"BDC" => {
                    marked += 1;
                    let tag = name_operand(op, 0).cloned().unwrap_or_default();
                    let props = match op.operands.get(1) {
                        Some(Object::Name(n)) => resources.raw("Properties", n),
                        Some(Object::Dict(d)) => Some(Object::Dict(d.clone())),
                        _ => None,
                    };
                    sink.begin_marked(&tag, props.as_ref(), &gs);
                }
                b"EMC" => {
                    if marked > 0 {
                        marked -= 1;
                        sink.end_marked();
                    }
                }
                _ => {}
            }
        }
        // Balance marked content a damaged stream left open.
        for _ in 0..marked {
            sink.end_marked();
        }
        // The state as the content leaves it (`q` without `Q` undone).
        saved.into_iter().next().unwrap_or(gs)
    }

    fn ext_gstate(&mut self, d: &Dict, gs: &mut GState) {
        let num = |k: &str| {
            d.get(k)
                .map(|v| self.pdf.resolve(v))
                .and_then(|v| v.as_f64())
        };
        if let Some(v) = num("LW") {
            gs.line_width = v.abs();
        }
        if let Some(v) = num("LC") {
            gs.cap = match v as i64 {
                1 => LineCap::Round,
                2 => LineCap::Square,
                _ => LineCap::Butt,
            };
        }
        if let Some(v) = num("LJ") {
            gs.join = match v as i64 {
                1 => LineJoin::Round,
                2 => LineJoin::Bevel,
                _ => LineJoin::Miter,
            };
        }
        if let Some(v) = num("ML") {
            gs.miter = v;
        }
        if let Some(v) = num("CA") {
            gs.stroke_alpha = v.clamp(0.0, 1.0) as f32;
        }
        if let Some(v) = num("ca") {
            gs.fill_alpha = v.clamp(0.0, 1.0) as f32;
        }
        if let Some(bm) = d.get("BM").map(|v| self.pdf.resolve(v)) {
            let name = match &bm {
                Object::Name(n) => Some(n.as_str().into_owned()),
                Object::Array(a) => a
                    .first()
                    .and_then(Object::as_name)
                    .map(|n| n.as_str().into_owned()),
                _ => None,
            };
            if let Some(n) = name {
                gs.blend = BlendMode::from_pdf(&n);
            }
        }
        match d.get("SMask").map(|v| self.pdf.resolve(v)) {
            Some(Object::Dict(m)) => gs.soft_mask = Some((m, gs.ctm)),
            Some(Object::Name(n)) if n == "None" => gs.soft_mask = None,
            _ => {}
        }
        if let Some(Object::Array(dash)) = d.get("D").map(|v| self.pdf.resolve(v))
            && let Some(lengths) = dash.first().and_then(Object::as_numbers)
        {
            gs.dash = lengths;
            gs.dash_offset = dash.get(1).and_then(Object::as_f64).unwrap_or(0.0);
        }
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "the text state the operator runs in"
    )]
    fn show(
        &mut self,
        items: &[ShowItem<'_>],
        tm: &mut Affine,
        gs: &GState,
        op: &Op,
        resources: &Resources<'_>,
        text_clip: &mut Option<PathData>,
        sink: &mut dyn Sink,
    ) {
        let Some(font) = gs.text.font.clone() else {
            return;
        };
        let t = &gs.text;
        let mut glyphs = Vec::new();
        for item in items {
            match item {
                ShowItem::Adjust(n) => {
                    let tx = -n / 1000.0 * t.size * t.h_scale;
                    *tm = Affine::translate(tx, 0.0).followed_by(tm);
                }
                ShowItem::Text(bytes) => {
                    for code in font.font.decode(bytes) {
                        let scale = Affine([t.size * t.h_scale, 0.0, 0.0, t.size, 0.0, t.rise]);
                        let trm = scale.followed_by(tm).followed_by(&gs.ctm);
                        let w0 = f64::from(font.font.width(code.code)) / 1000.0;
                        let spacing = t.char_spacing
                            + if font.font.is_space(code) {
                                t.word_spacing
                            } else {
                                0.0
                            };
                        let tx = (w0 * t.size + spacing) * t.h_scale;
                        glyphs.push(ShownGlyph {
                            code: code.code,
                            len: code.len,
                            text: font.font.unicode(code.code).unwrap_or_default(),
                            trm,
                            advance: tx,
                        });
                        *tm = Affine::translate(tx, 0.0).followed_by(tm);
                    }
                }
            }
        }
        if glyphs.is_empty() {
            return;
        }
        if t.render >= 4 && font.type3.is_none() {
            let clip = text_clip.get_or_insert_with(PathData::default);
            for g in &glyphs {
                if let Some(outline) = font.font.outline(g.code) {
                    let glyph = PathData::from_skia(&outline).transform(&g.trm);
                    clip.segs.extend(glyph.segs);
                }
            }
        }
        if t.render == 7 {
            return;
        }
        if let Some(t3) = &font.type3
            && sink.wants_type3_glyphs()
            && self.depth < MAX_DEPTH
        {
            // Type 3 glyphs are content streams in glyph space.
            let res = Resources::new(
                self.pdf,
                if t3.resources.is_empty() {
                    resources.dict().clone()
                } else {
                    t3.resources.clone()
                },
            );
            let fm = Affine(t3.matrix);
            for g in &glyphs {
                let Some(name) = font.font.type3_glyph(g.code) else {
                    continue;
                };
                let Some(data) = t3.procs.get(name) else {
                    continue;
                };
                let ops = crate::pdf::content::parse(data);
                let mut glyph_gs = gs.clone();
                // The size is already in `trm`; the font matrix maps glyph space.
                glyph_gs.ctm = fm.followed_by(&g.trm);
                self.depth += 1;
                self.run(&ops, &res, glyph_gs, sink);
                self.depth -= 1;
            }
            return;
        }
        sink.show(&ShowEvent {
            font: &font,
            glyphs,
            gs,
            op,
            resources,
        });
    }

    fn form(
        &mut self,
        key: String,
        stream: &Stream,
        gs: &GState,
        resources: &Resources<'_>,
        ops: &[Op],
        sink: &mut dyn Sink,
    ) {
        if self.depth >= MAX_DEPTH {
            return;
        }
        let d = &stream.dict;
        let matrix = d
            .get("Matrix")
            .map(|v| self.pdf.resolve(v))
            .and_then(|v| v.as_numbers())
            .and_then(|m| Affine::from_slice(&m))
            .unwrap_or(Affine::IDENTITY);
        let bbox: [f64; 4] = d
            .get("BBox")
            .map(|v| self.pdf.resolve(v))
            .and_then(|v| v.as_numbers())
            .and_then(|b| b.try_into().ok())
            .unwrap_or([0.0, 0.0, 0.0, 0.0]);
        let group = d
            .get("Group")
            .map(|v| self.pdf.resolve(v))
            .and_then(|v| v.as_dict().cloned());
        let ctm = matrix.followed_by(&gs.ctm);
        let res = match d.get("Resources").map(|v| self.pdf.resolve(v)) {
            Some(Object::Dict(r)) => Resources::new(self.pdf, r),
            _ => Resources::new(self.pdf, resources.dict().clone()),
        };
        let event = GroupEvent {
            key,
            ctm,
            bbox,
            group,
            gs,
            ops,
            resources,
            inner: &res,
        };
        if sink.begin_group(&event) == Descend::Skip {
            return;
        }
        let content = self.pdf.stream_data(stream).unwrap_or_default();
        let form_ops = crate::pdf::content::parse(&content);
        let mut inner = gs.clone();
        inner.ctm = ctm;
        inner.base = ctm;
        // Groups start with their own opacity and blending.
        if event.group.is_some() {
            inner.fill_alpha = 1.0;
            inner.stroke_alpha = 1.0;
            inner.blend = BlendMode::Normal;
            inner.soft_mask = None;
        }
        let [x0, y0, x1, y1] = bbox;
        let rect = crate::geom::Rect::new(x0, y0, x1, y1);
        if !rect.is_empty() {
            let clip = PathData::rect(rect);
            let serial = self.next_clip();
            inner.clips.push(ClipPath {
                path: clip.transform(&ctm),
                even_odd: false,
                serial,
                form_box: true,
            });
        }
        self.depth += 1;
        self.run(&form_ops, &res, inner, sink);
        self.depth -= 1;
        sink.end_group();
    }
}

#[cfg(test)]
mod test;
