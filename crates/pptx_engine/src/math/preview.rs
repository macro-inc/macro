//! Pictures of equations on their own, for an equation editor's live
//! preview and its galleries.

use super::latex::{LatexError, parse_latex};
use super::layout::{MathBox, MathItem, stroke_outline, typeset};
use crate::font::FontDb;
use crate::model::color::Rgba;
use crate::model::fill::{Effects, Fill};
use crate::model::text::{Caps, RunProps, Strike, Underline};
use crate::path::{Affine, Path, Rect};
use crate::render::raster::rasterize;
use crate::render::scene::{Node, Paint, Raster};

/// Run formatting for an equation of `size` points in `color`.
pub fn math_props(size: f32, color: Rgba) -> RunProps {
    RunProps {
        size,
        bold: false,
        italic: false,
        underline: Underline::None,
        strike: Strike::None,
        caps: Caps::None,
        baseline: 0.0,
        spacing: 0.0,
        kern: 0.0,
        latin: "Cambria Math".into(),
        ea: String::new(),
        cs: String::new(),
        sym: String::new(),
        fill: Fill::Solid(color),
        outline: None,
        highlight: None,
        effects: Effects::default(),
        lang: String::new(),
    }
}

/// The display list of a typeset equation with its origin at (`x`, `baseline`).
pub fn math_nodes(bx: &MathBox, x: f32, baseline: f32, fonts: &FontDb) -> Vec<Node> {
    let paint = |fill: &Fill| match fill {
        Fill::Solid(c) => Some(Paint::Solid(*c)),
        other => other.representative_color().map(Paint::Solid),
    };
    let mut out = Vec::new();
    for item in &bx.items {
        match item {
            MathItem::Glyph(g) => {
                let Some(outline) = fonts.outline(g.face, g.glyph) else {
                    continue;
                };
                let skew = if g.synthetic_italic { -0.2 } else { 0.0 };
                let t = Affine::translate(f64::from(x + g.x), f64::from(baseline + g.y))
                    .pre_concat(&Affine {
                        a: 1.0,
                        b: 0.0,
                        c: skew,
                        d: 1.0,
                        e: 0.0,
                        f: 0.0,
                    })
                    .pre_concat(&Affine::scale(f64::from(g.size), f64::from(g.size)));
                if let Some(p) = paint(&g.fill) {
                    out.push(Node::Fill {
                        path: outline.transform(&t),
                        paint: p,
                        even_odd: false,
                    });
                }
            }
            MathItem::Rule { rect, fill } => {
                if let Some(p) = paint(fill) {
                    out.push(Node::Fill {
                        path: Path::rect(Rect::from_xywh(
                            x + rect.x,
                            baseline + rect.y,
                            rect.w,
                            rect.h,
                        )),
                        paint: p,
                        even_odd: false,
                    });
                }
            }
            MathItem::Line {
                from,
                to,
                width,
                fill,
            } => {
                if let Some(p) = paint(fill) {
                    out.push(Node::Fill {
                        path: stroke_outline(*from, *to, *width, x, baseline),
                        paint: p,
                        even_odd: false,
                    });
                }
            }
        }
    }
    out
}

/// Renders linear text as an image at `size` points and `scale` pixels per
/// point, with empty slots shown as dotted boxes. The picture is padded by
/// a tenth of the size on every side.
pub fn render_equation(
    latex: &str,
    display: bool,
    size: f32,
    scale: f32,
    color: Rgba,
    fonts: &FontDb,
) -> Result<Raster, LatexError> {
    let eq = parse_latex(latex, display)?;
    let bx = typeset(&eq, &math_props(size, color), 1.0, fonts, true);
    let pad = size * 0.1;
    let (w, h) = (bx.width + 2.0 * pad, bx.ascent + bx.descent + 2.0 * pad);
    let nodes = math_nodes(&bx, pad, pad + bx.ascent, fonts);
    let px = |v: f32| (v * scale).ceil().clamp(1.0, 4096.0) as u32;
    Ok(rasterize(&nodes, px(w), px(h), scale))
}
