//! Groups of shapes and pictures (`wpg:wgp`) and drawing canvases
//! (`wpc:wpc`), drawn child by child.

use super::{EMU_PER_PT, drawingml, shape_nodes};
use crate::render::Renderer;
use crate::render::drawing::{pic_blip, picture, target};
use crate::xml::{NodeId, Ns, XmlTree, parse_int};
use pptx_engine::path::Rect;
use pptx_engine::render::scene::Node;

/// How a group's child coordinates map to the page.
#[derive(Clone, Copy, Debug)]
struct Space {
    /// The child coordinates at `origin`.
    from: (f64, f64),
    /// Page points per child unit.
    scale: (f64, f64),
    /// The page point of `from` (points).
    origin: (f64, f64),
}

impl Space {
    /// The space of a group drawn in `rect` whose children span `ext` from
    /// `off`.
    fn within(rect: Rect, off: (f64, f64), ext: (f64, f64)) -> Self {
        let scale = |page: f32, ext: f64| {
            if ext > 0.0 {
                f64::from(page) / ext
            } else {
                1.0 / EMU_PER_PT
            }
        };
        Space {
            from: off,
            scale: (scale(rect.w, ext.0), scale(rect.h, ext.1)),
            origin: (f64::from(rect.x), f64::from(rect.y)),
        }
    }

    /// The page rectangle of a child at `off` sized `ext`.
    fn rect(&self, off: (f64, f64), ext: (f64, f64)) -> Rect {
        Rect::from_xywh(
            (self.origin.0 + (off.0 - self.from.0) * self.scale.0) as f32,
            (self.origin.1 + (off.1 - self.from.1) * self.scale.1) as f32,
            (ext.0 * self.scale.0) as f32,
            (ext.1 * self.scale.1) as f32,
        )
    }
}

/// An `a:xfrm`: offset and extent, and the span of a group's children.
#[derive(Clone, Copy, Debug)]
struct Xfrm {
    off: (f64, f64),
    ext: (f64, f64),
    child_off: (f64, f64),
    child_ext: (f64, f64),
}

/// The transform in a child's shape properties (`spPr`, `grpSpPr`).
fn xfrm(t: &XmlTree, node: NodeId) -> Option<Xfrm> {
    let props = t
        .children(node)
        .find(|&c| matches!(t.local(c), "spPr" | "grpSpPr"))?;
    let x = t.child(props, Ns::A, "xfrm")?;
    let pair = |name: &str, a: &str, b: &str| {
        t.child(x, Ns::A, name).map(|n| {
            let v = |k: &str| t.attr(n, Ns::NONE, k).and_then(parse_int).unwrap_or(0) as f64;
            (v(a), v(b))
        })
    };
    let off = pair("off", "x", "y").unwrap_or_default();
    let ext = pair("ext", "cx", "cy").unwrap_or_default();
    Some(Xfrm {
        off,
        ext,
        child_off: pair("chOff", "x", "y").unwrap_or(off),
        child_ext: pair("chExt", "cx", "cy").unwrap_or(ext),
    })
}

/// Draws group or canvas `node` in `rect`; `part` resolves its pictures.
pub(super) fn group_nodes(
    r: &mut Renderer<'_>,
    t: &XmlTree,
    node: NodeId,
    rect: Rect,
    part: &str,
    out: &mut Vec<Node>,
) {
    let space = match xfrm(t, node) {
        // A group spreads its children's span over its extent.
        Some(x) => Space::within(rect, x.child_off, x.child_ext),
        // A canvas places its children in EMU from its corner.
        None => Space::within(
            rect,
            (0.0, 0.0),
            (
                f64::from(rect.w) * EMU_PER_PT,
                f64::from(rect.h) * EMU_PER_PT,
            ),
        ),
    };
    children(r, t, node, space, part, out);
}

/// Draws the shapes, pictures and groups in `node`.
fn children(
    r: &mut Renderer<'_>,
    t: &XmlTree,
    node: NodeId,
    space: Space,
    part: &str,
    out: &mut Vec<Node>,
) {
    for c in t.children(node) {
        let Some(x) = xfrm(t, c) else {
            continue;
        };
        let rect = space.rect(x.off, x.ext);
        if t.is(c, Ns::WPS, "wsp") {
            if let Some((doc, sp)) = drawingml(t, c) {
                shape_nodes(r, &doc, sp, rect, out);
            }
        } else if t.is(c, Ns::WPG, "grpSp") {
            let inner = Space::within(rect, x.child_off, x.child_ext);
            children(r, t, c, inner, part, out);
        } else if t.is(c, Ns::PIC, "pic")
            && let Some((rid, crop, rot, flip_h, flip_v)) = pic_blip(t, c)
            && let Some(image) = target(r, part, &rid)
        {
            picture(r, &image, rect, crop, rot, (flip_h, flip_v), out);
        }
    }
}
