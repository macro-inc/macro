//! Chart user shapes: text boxes and pictures drawn over a chart
//! (`c:userShapes` → a chart drawing part of `cdr:` anchors).

use crate::model::presentation::{PartRef, SlideContext};
use crate::model::shape::{Inherit, WalkCtx, resolve_shape};
use crate::path::{Affine, Rect};
use crate::render::build::Builder;
use crate::render::scene::Node;
use crate::units::emu_to_pt;
use crate::xml::{NodeId, Ns, XmlDoc};

/// Most anchors drawn from one chart drawing.
const MAX_SHAPES: usize = 1000;

/// A fractional anchor coordinate (`cdr:x`/`cdr:y` children of `node`).
fn frac(doc: &XmlDoc, node: Option<NodeId>, name: &str) -> Option<f32> {
    let n = doc.child(node?, Ns::CDR, name)?;
    doc.text(n)
        .trim()
        .parse::<f32>()
        .ok()
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(-1.0, 2.0))
}

/// Appends the user shapes of `chart` (frame-local `bbox`, mapped by `world`).
pub(crate) fn user_shapes(
    b: &mut Builder<'_>,
    ctx: &SlideContext,
    chart: &PartRef,
    bbox: Rect,
    world: &Affine,
    out: &mut Vec<Node>,
) {
    let doc = &chart.doc;
    let Some(us) = doc.child(doc.root(), Ns::C, "userShapes") else {
        return;
    };
    let Some(target) = doc.attr_ns(us, Ns::R, "id").and_then(|id| chart.target(id)) else {
        return;
    };
    let Some(drawing) = b.loader.part(&target) else {
        return;
    };
    let d = &drawing.doc;
    let walk = WalkCtx {
        ctx,
        inherit: Inherit::Master,
    };
    for anchor in d.children(d.root()).take(MAX_SHAPES) {
        let from = d.child(anchor, Ns::CDR, "from");
        let (Some(fx), Some(fy)) = (frac(d, from, "x"), frac(d, from, "y")) else {
            continue;
        };
        let (x, y) = (bbox.x + fx * bbox.w, bbox.y + fy * bbox.h);
        let rect = match d.local(anchor) {
            "relSizeAnchor" => {
                let to = d.child(anchor, Ns::CDR, "to");
                let (Some(tx), Some(ty)) = (frac(d, to, "x"), frac(d, to, "y")) else {
                    continue;
                };
                Rect::from_ltrb(x, y, bbox.x + tx * bbox.w, bbox.y + ty * bbox.h)
            }
            "absSizeAnchor" => {
                let Some(ext) = d.child(anchor, Ns::CDR, "ext") else {
                    continue;
                };
                let size = |a: &str| d.attr_f64(ext, a).map_or(0.0, emu_to_pt).max(0.0);
                Rect::from_xywh(x, y, size("cx"), size("cy"))
            }
            _ => continue,
        };
        let Some(node) = d
            .children(anchor)
            .find(|&c| matches!(d.local(c), "sp" | "pic" | "cxnSp" | "grpSp"))
        else {
            continue;
        };
        let Some(mut shape) = resolve_shape(&walk, &drawing, node) else {
            continue;
        };
        // The anchor is authoritative; the shape's own offset may predate a resize.
        shape.xfrm.x = rect.x;
        shape.xfrm.y = rect.y;
        shape.xfrm.w = rect.w;
        shape.xfrm.h = rect.h;
        b.shape(ctx, &shape, world, None, out);
    }
}
