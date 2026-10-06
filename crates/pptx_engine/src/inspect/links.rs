//! Where a slide's hyperlinks are, so a slide show can follow a click.

use super::TextLayoutInfo;
use crate::edit::{CellRef, link_string};
use crate::error::Result;
use crate::font::FontDb;
use crate::model::presentation::Presentation;
use crate::model::shape::{
    Graphic, Inherit, Shape, ShapeKind, WalkCtx, c_nv_pr, resolve_tree, sp_tree,
};
use crate::model::text::read_link;
use crate::path::{Affine, Point};
use crate::xml::{NodeId, Ns, XmlDoc};
use serde::Serialize;

/// A clickable area of a slide.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRegion {
    /// The shape the link belongs to.
    pub shape: u32,
    /// The link, as `formatText` and `setShapeLink` take it.
    pub link: String,
    /// Its ScreenTip.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tip: Option<String>,
    /// Corners in slide points, `[x0, y0, x1, y1, x2, y2, x3, y3]`, clockwise
    /// from the top left of the unrotated area.
    pub quad: [f32; 8],
}

/// Whether `node` holds linked text.
fn has_text_link(doc: &XmlDoc, node: NodeId) -> bool {
    doc.descendants(node).into_iter().any(|n| {
        doc.local(n) == "hlinkClick" && doc.parent(n).is_some_and(|p| doc.local(p) == "rPr")
    })
}

fn quad(t: &Affine, x0: f32, y0: f32, x1: f32, y1: f32) -> [f32; 8] {
    let mut out = [0.0; 8];
    for (i, (x, y)) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        .into_iter()
        .enumerate()
    {
        let p = t.apply(Point::new(x, y));
        out[2 * i] = p.x;
        out[2 * i + 1] = p.y;
    }
    out
}

/// What to collect from a shape tree: shape links now, text to lay out later.
struct Walk<'a> {
    slides: &'a [crate::model::presentation::SlideEntry],
    shapes: Vec<LinkRegion>,
    text: Vec<(u32, Option<CellRef>)>,
}

impl Walk<'_> {
    fn visit(&mut self, shapes: &[Shape], parent: Affine) {
        for s in shapes.iter().filter(|s| !s.hidden) {
            let doc = &s.part.doc;
            let local = parent.pre_concat(&s.xfrm.local_to_parent());
            if let Some(link) = c_nv_pr(doc, s.node)
                .and_then(|nv| doc.child(nv, Ns::A, "hlinkClick"))
                .and_then(|h| read_link(&s.part, h))
                && let Some(target) = link_string(self.slides, &link)
            {
                self.shapes.push(LinkRegion {
                    shape: s.id,
                    link: target,
                    tip: link.tooltip,
                    quad: quad(&local, 0.0, 0.0, s.xfrm.w, s.xfrm.h),
                });
            }
            match &s.kind {
                ShapeKind::Group(children) => {
                    self.visit(children, local.pre_concat(&s.xfrm.child_to_local()));
                }
                ShapeKind::Shape if has_text_link(doc, s.node) => self.text.push((s.id, None)),
                ShapeKind::Frame(Graphic::Table(tbl)) => {
                    for (row, tr) in doc.children_named(*tbl, Ns::A, "tr").enumerate() {
                        for (col, tc) in doc.children_named(tr, Ns::A, "tc").enumerate() {
                            if has_text_link(doc, tc) {
                                self.text.push((s.id, Some(CellRef { row, col })));
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// The areas of laid-out text that runs with links cover, a box per line.
fn text_regions(shape: u32, lay: &TextLayoutInfo, out: &mut Vec<LinkRegion>) {
    let [a, b, c, d, e, f] = lay.transform;
    let t = Affine { a, b, c, d, e, f };
    for line in &lay.lines {
        let (Some(first), Some(last)) = (line.stops.first(), line.stops.last()) else {
            continue;
        };
        let x_at = |i: usize| {
            line.stops
                .iter()
                .find(|s| s.index == i)
                .map_or(if i <= first.index { first.x } else { last.x }, |s| s.x)
        };
        let Some(style) = lay.styles.get(line.paragraph) else {
            continue;
        };
        for run in &style.runs {
            let Some(link) = &run.link else {
                continue;
            };
            let (from, to) = (run.start.max(first.index), run.end.min(last.index));
            if from >= to {
                continue;
            }
            let (x0, x1) = (x_at(from), x_at(to));
            out.push(LinkRegion {
                shape,
                link: link.clone(),
                tip: run.link_tip.clone(),
                quad: quad(&t, x0.min(x1), line.top, x0.max(x1), line.bottom),
            });
        }
    }
}

impl Presentation {
    /// The clickable areas of the slide at `index`: linked text first (one
    /// box per line a link covers), then whole linked shapes. Where areas
    /// overlap, the earlier one wins, as text links win over their shape's
    /// own link in PowerPoint.
    pub fn link_regions(&mut self, index: usize, fonts: &FontDb) -> Result<Vec<LinkRegion>> {
        let ctx = self.slide_context(index)?;
        let walk_ctx = WalkCtx {
            ctx: &ctx,
            inherit: Inherit::Slide,
        };
        let shapes = sp_tree(&ctx.slide.doc)
            .map(|t| resolve_tree(&walk_ctx, &ctx.slide, t))
            .unwrap_or_default();
        let mut walk = Walk {
            slides: &self.slides,
            shapes: Vec::new(),
            text: Vec::new(),
        };
        walk.visit(&shapes, Affine::IDENTITY);
        let Walk {
            shapes: shape_regions,
            text,
            ..
        } = walk;
        let mut out = Vec::new();
        for (shape, cell) in text {
            if let Some(lay) = self.text_layout(index, shape, cell, fonts)? {
                text_regions(shape, &lay, &mut out);
            }
        }
        out.extend(shape_regions);
        Ok(out)
    }
}
