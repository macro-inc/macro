//! What the editor shows about a document: the layers panel's rows, a
//! node's properties, which object is under a point, what a marquee
//! encloses, the fonts text uses, and image files in and out.

use crate::build::node_bounds;
use crate::geom::{Affine, Point, Rect, distance_to_polylines, polygons_contain};
use crate::model::{BlendMode, Document, NodeIdx, NodeKind, Paint, Stroke, TextAlign};
use serde::Serialize;

/// Curve flattening tolerance for hit tests, in canvas units at scale 1.
const HIT_TOLERANCE: f64 = 0.25;

/// A row of the layers panel.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    /// Node id.
    pub id: u32,
    /// The parent's id.
    pub parent: Option<u32>,
    /// Nesting depth (layers are 0).
    pub depth: usize,
    /// `layer`, `group`, `clipGroup`, `path`, `text`, `image`, or
    /// `artwork`.
    pub kind: &'static str,
    /// Its name, or what it shows when unnamed.
    pub name: String,
    /// Hidden.
    pub hidden: bool,
    /// Locked.
    pub locked: bool,
    /// Children shown in the panel.
    pub children: usize,
    /// A layer's color.
    pub color: Option<[u8; 3]>,
}

/// The kind word of a node.
pub fn kind_word(kind: &NodeKind) -> &'static str {
    match kind {
        NodeKind::Layer { .. } => "layer",
        NodeKind::Group { clip: Some(_), .. } => "clipGroup",
        NodeKind::Group { .. } => "group",
        NodeKind::Path(_) => "path",
        NodeKind::Text(_) => "text",
        NodeKind::Image(_) => "image",
        NodeKind::Raw { .. } => "artwork",
    }
}

/// What a node shows as in the panel when it has no name.
fn label(doc: &Document, i: NodeIdx) -> String {
    let n = doc.node(i);
    if !n.name.is_empty() {
        return n.name.clone();
    }
    match &n.kind {
        NodeKind::Layer { .. } => "Layer".into(),
        NodeKind::Group { clip: Some(_), .. } => "<Clip Group>".into(),
        NodeKind::Group { .. } => "<Group>".into(),
        NodeKind::Path(_) => "<Path>".into(),
        NodeKind::Text(t) => {
            let first: String = t
                .text
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(40)
                .collect();
            if first.trim().is_empty() {
                "<Text>".into()
            } else {
                first
            }
        }
        NodeKind::Image(_) => "<Image>".into(),
        NodeKind::Raw { .. } => "<Artwork>".into(),
    }
}

/// The layers panel: every live node, top to bottom, depth first.
pub fn rows(doc: &Document) -> Vec<Row> {
    fn walk(doc: &Document, stack: &[NodeIdx], depth: usize, out: &mut Vec<Row>) {
        for &i in stack.iter().rev() {
            let n = doc.node(i);
            if n.removed {
                continue;
            }
            out.push(Row {
                id: n.id,
                parent: n.parent.map(|p| doc.node(p).id),
                depth,
                kind: kind_word(&n.kind),
                name: label(doc, i),
                hidden: n.hidden,
                locked: n.locked,
                children: n.children.iter().filter(|&&c| !doc.node(c).removed).count(),
                color: match n.kind {
                    NodeKind::Layer { color, .. } => Some(color),
                    _ => None,
                },
            });
            walk(doc, &n.children, depth + 1, out);
        }
    }
    let mut out = Vec::new();
    walk(doc, &doc.layers, 0, &mut out);
    out
}

/// A text object's settings.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextInfo {
    /// The characters.
    pub text: String,
    /// Font family.
    pub family: String,
    /// Font style.
    pub style: String,
    /// Size in its own space.
    pub size: f64,
    /// Size as shown on the canvas.
    pub shown_size: f64,
    /// Alignment.
    pub align: TextAlign,
    /// Line height (sizes).
    pub line_height: f64,
    /// Tracking.
    pub tracking: f64,
    /// Area text width.
    pub width: Option<f64>,
    /// Still the glyphs the file placed.
    pub from_file: bool,
}

/// A node's properties for the properties panel.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    /// Node id.
    pub id: u32,
    /// The kind word.
    pub kind: &'static str,
    /// Its name.
    pub name: String,
    /// Hidden.
    pub hidden: bool,
    /// Locked (or in something locked).
    pub locked: bool,
    /// Opacity.
    pub opacity: f32,
    /// Blend mode.
    pub blend: BlendMode,
    /// Canvas bounds.
    pub bounds: Option<Rect>,
    /// Object space to canvas.
    pub transform: Affine,
    /// Fill (paths and text).
    pub fill: Option<Paint>,
    /// Stroke (paths and text).
    pub stroke: Option<Stroke>,
    /// Paths: even-odd fill rule.
    pub even_odd: bool,
    /// Paths: the outline (object space), for point editing.
    pub path: Option<crate::geom::PathData>,
    /// Text settings.
    pub text: Option<TextInfo>,
    /// Images: pixel size.
    pub image_size: Option<(u32, u32)>,
    /// Groups: clipped.
    pub clipped: bool,
    /// The artboard it belongs to.
    pub artboard: u32,
}

/// A node's properties.
pub fn info(doc: &Document, id: u32) -> Option<Info> {
    let i = doc.find(id)?;
    let n = doc.node(i);
    if n.removed {
        return None;
    }
    let (fill, stroke, even_odd, path) = match &n.kind {
        NodeKind::Path(p) => (
            p.fill.clone(),
            p.stroke.clone(),
            p.even_odd,
            Some(p.data.clone()),
        ),
        NodeKind::Text(t) => (t.fill.clone(), t.stroke.clone(), false, None),
        _ => (None, None, false, None),
    };
    Some(Info {
        id,
        kind: kind_word(&n.kind),
        name: label(doc, i),
        hidden: n.hidden,
        locked: doc.is_locked(i),
        opacity: n.opacity,
        blend: n.blend,
        bounds: node_bounds(doc, i),
        transform: n.transform,
        fill,
        stroke,
        even_odd,
        path,
        text: match &n.kind {
            NodeKind::Text(t) => Some(TextInfo {
                text: t.text.clone(),
                family: t.family.clone(),
                style: t.style.clone(),
                size: t.size,
                shown_size: t.size * n.transform.scale_factor(),
                align: t.align,
                line_height: t.line_height,
                tracking: t.tracking,
                width: t.width,
                from_file: t.runs.is_some(),
            }),
            _ => None,
        },
        image_size: match &n.kind {
            NodeKind::Image(img) => Some((img.width, img.height)),
            _ => None,
        },
        clipped: matches!(n.kind, NodeKind::Group { clip: Some(_), .. }),
        artboard: n.artboard,
    })
}

/// Whether a leaf object covers a canvas point (`slop` canvas units of
/// leeway for thin strokes).
fn covers(doc: &Document, i: NodeIdx, p: Point, slop: f64) -> bool {
    let n = doc.node(i);
    let Some(b) = node_bounds(doc, i) else {
        return false;
    };
    if !b.outset(slop).contains(p) {
        return false;
    }
    let Some(inv) = n.transform.invert() else {
        return false;
    };
    let local = inv.apply(p);
    let local_slop = slop / n.transform.scale_factor().max(1e-9);
    match &n.kind {
        NodeKind::Path(path) => {
            let polys = path
                .data
                .flatten(HIT_TOLERANCE / n.transform.scale_factor().max(1e-9));
            let filled = path.fill.is_some() && polygons_contain(&polys, local, path.even_odd);
            let half = path.stroke.as_ref().map_or(0.0, |s| s.width / 2.0);
            filled || distance_to_polylines(&polys, local) <= half + local_slop
        }
        NodeKind::Text(t) => match &t.runs {
            Some(runs) => runs.iter().any(|run| {
                run.glyphs.iter().any(|g| {
                    let r = Rect::new(g.x, -0.25, g.x + g.advance.max(0.3), 0.9);
                    run.matrix
                        .invert()
                        .is_some_and(|m| r.outset(0.05).contains(m.apply(local)))
                })
            }),
            None => crate::text::bounds(t).is_some_and(|r| r.outset(local_slop).contains(local)),
        },
        NodeKind::Image(_) => Rect::new(0.0, 0.0, 1.0, 1.0).contains(local),
        NodeKind::Raw { .. } => true,
        NodeKind::Layer { .. } | NodeKind::Group { .. } => false,
    }
}

/// Whether a group's clip lets a canvas point through.
fn clip_lets(doc: &Document, i: NodeIdx, p: Point) -> bool {
    match &doc.node(i).kind {
        NodeKind::Group { clip: Some(c), .. } => {
            polygons_contain(&c.path.flatten(HIT_TOLERANCE), p, c.even_odd)
        }
        _ => true,
    }
}

/// The topmost visible, unlocked object at a canvas point: the object
/// itself (`deep`), or the outermost group holding it under its layer.
/// `scale` is pixels per canvas unit (for the leeway around thin lines).
pub fn hit_test(doc: &Document, x: f64, y: f64, scale: f64, deep: bool) -> Option<u32> {
    let p = Point::new(x, y);
    let slop = 3.0 / scale.max(1e-9);
    fn walk(doc: &Document, stack: &[NodeIdx], p: Point, slop: f64) -> Option<NodeIdx> {
        for &i in stack.iter().rev() {
            let n = doc.node(i);
            if n.removed || n.hidden || n.locked {
                continue;
            }
            if n.is_container() {
                if !clip_lets(doc, i, p) {
                    continue;
                }
                if let Some(hit) = walk(doc, &n.children, p, slop) {
                    return Some(hit);
                }
            } else if covers(doc, i, p, slop) {
                return Some(i);
            }
        }
        None
    }
    let hit = walk(doc, &doc.layers, p, slop)?;
    if deep {
        return Some(doc.node(hit).id);
    }
    // The outermost group below the layer.
    let mut at = hit;
    while let Some(parent) = doc.node(at).parent {
        if doc.node(parent).is_layer() {
            break;
        }
        at = parent;
    }
    Some(doc.node(at).id)
}

/// The objects (outermost under their layers) a canvas rectangle
/// touches.
pub fn in_rect(doc: &Document, r: Rect, deep: bool) -> Vec<u32> {
    let mut out = Vec::new();
    for &l in &doc.layers {
        let layer = doc.node(l);
        if layer.removed || layer.hidden || layer.locked {
            continue;
        }
        fn walk(doc: &Document, stack: &[NodeIdx], r: Rect, deep: bool, out: &mut Vec<u32>) {
            for &i in stack {
                let n = doc.node(i);
                if n.removed || n.hidden || n.locked {
                    continue;
                }
                if deep && n.is_container() {
                    walk(doc, &n.children, r, deep, out);
                } else if node_bounds(doc, i).is_some_and(|b| b.intersects(&r)) {
                    out.push(n.id);
                }
            }
        }
        walk(doc, &layer.children, r, deep, &mut out);
    }
    out
}

/// The canvas bounds of nodes together.
pub fn bounds(doc: &Document, ids: &[u32]) -> Option<Rect> {
    ids.iter()
        .filter_map(|&id| doc.find(id))
        .filter_map(|i| node_bounds(doc, i))
        .reduce(|a, b| a.union(&b))
}

/// A font a text object uses.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontUse {
    /// Family.
    pub family: String,
    /// Style.
    pub style: String,
    /// Laid out here (rather than shown with the file's glyphs), so the
    /// family needs registering to show right.
    pub laid_out: bool,
}

/// The fonts text objects use.
pub fn fonts(doc: &Document) -> Vec<FontUse> {
    let mut out: Vec<FontUse> = doc
        .paint_order()
        .into_iter()
        .filter_map(|i| match &doc.node(i).kind {
            NodeKind::Text(t) => Some(FontUse {
                family: t.family.clone(),
                style: t.style.clone(),
                laid_out: t.runs.is_none(),
            }),
            _ => None,
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// A PNG of straight RGBA.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let pixmap = crate::render::canvas::premultiplied(width, height, rgba)?;
    let png = fig_engine::images::encode_png(&pixmap);
    (!png.is_empty()).then_some(png)
}

/// An image file (PNG, JPEG, GIF, or WebP) as straight RGBA.
pub fn decode_image(bytes: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let pixmap = fig_engine::images::decode(bytes)?;
    Some((
        pixmap.width(),
        pixmap.height(),
        crate::render::canvas::unpremultiply(&pixmap),
    ))
}

/// A summary of the document.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// Artboards.
    pub artboards: Vec<crate::model::Artboard>,
    /// The canvas around every artboard.
    pub canvas: Rect,
    /// Objects (not layers or groups).
    pub objects: usize,
    /// Illustrator kept its own copy of the artwork in the file (saving
    /// leaves it out).
    pub illustrator: bool,
    /// The application that made the file.
    pub creator: Option<String>,
}

/// The document's summary.
pub fn summary(doc: &Document) -> Summary {
    Summary {
        artboards: doc
            .artboards
            .iter()
            .filter(|a| !a.removed)
            .cloned()
            .collect(),
        canvas: doc.canvas(),
        objects: doc
            .paint_order()
            .into_iter()
            .filter(|&i| !doc.node(i).is_container())
            .count(),
        illustrator: doc.file.as_ref().is_some_and(|f| f.illustrator),
        creator: doc.file.as_ref().and_then(|f| f.creator.clone()),
    }
}

#[cfg(test)]
mod test;
