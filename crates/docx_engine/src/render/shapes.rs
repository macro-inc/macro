//! DrawingML and VML shapes: outlines and fills. (Their text is laid out
//! with the page; charts and diagrams are not drawn.)

use super::Renderer;
use crate::layout::drawing::{Drawing, Graphic, css_length};
use crate::xml::{NodeId, Ns, XmlTree};
use pptx_engine::geometry::{self, PathFill, ShapeGeometry};
use pptx_engine::model::color::{ColorContext, ColorMap, Rgba, find_color, preset_color};
use pptx_engine::model::fill::{Fill, LineProps, find_fill, parse_line};
use pptx_engine::path::{Affine, Path, Point, Rect};
use pptx_engine::render::paint::{ImageSource, fill_paint, line_stroke, shade_paint};
use pptx_engine::render::scene::{LineCap, LineJoin, Node, Paint, Raster, Stroke};
use pptx_engine::xml::{NodeId as DmlNode, Ns as DmlNs, XmlDoc};
use std::sync::Arc;

/// EMU per point.
const EMU_PER_PT: f64 = 12_700.0;
/// DrawingML angles are in 60000ths of a degree.
const ANGLE_UNITS: f64 = 60_000.0;
/// VML's default outline width (points).
const VML_STROKE: f32 = 0.75;

/// Draws a non-picture graphic in `rect`.
pub(super) fn graphic_nodes(
    r: &mut Renderer<'_>,
    d: &Drawing,
    rect: Rect,
    _part: &str,
    out: &mut Vec<Node>,
) {
    if d.graphic != Graphic::Shape {
        return;
    }
    if d.vml {
        vml_shape(&d.tree, d.node, rect, out);
        return;
    }
    let t = &d.tree;
    let Some(wsp) = t
        .descendants(d.node)
        .into_iter()
        .find(|&n| t.is(n, Ns::WPS, "wsp"))
    else {
        return;
    };
    let Some((doc, sp)) = drawingml(t, wsp) else {
        return;
    };
    shape_nodes(r, &doc, sp, rect, out);
}

/// Re-reads a DrawingML element with the DrawingML model's reader.
fn drawingml(t: &XmlTree, node: NodeId) -> Option<(XmlDoc, DmlNode)> {
    let mut s = String::from("<_x");
    for d in t.root_decls() {
        if d.prefix.is_empty() {
            s.push_str(" xmlns=\"");
        } else {
            s.push_str(" xmlns:");
            s.push_str(&d.prefix);
            s.push_str("=\"");
        }
        s.push_str(&d.uri.replace('"', "&quot;"));
        s.push('"');
    }
    s.push('>');
    s.push_str(&t.snippet(node));
    s.push_str("</_x>");
    let doc = XmlDoc::parse(s.as_bytes(), "shape").ok()?;
    let sp = doc.children(doc.root()).next()?;
    Some((doc, sp))
}

/// Shapes need no pictures.
struct NoImages;

impl ImageSource for NoImages {
    fn raster(&mut self, _part: &str) -> Option<Arc<Raster>> {
        None
    }
}

/// Draws a `wps:wsp` shape `rect` large.
fn shape_nodes(r: &Renderer<'_>, doc: &XmlDoc, sp: DmlNode, rect: Rect, out: &mut Vec<Node>) {
    let parts = r.doc.parts();
    let map = ColorMap::default();
    let colors = ColorContext {
        scheme: &parts.theme.colors,
        map: &map,
        ph_clr: None,
    };
    let no_rels = |_: &str| None;
    let sp_pr = doc.children(sp).find(|&c| doc.local(c) == "spPr");
    let style = doc.children(sp).find(|&c| doc.local(c) == "style");
    let style_ref = |name: &str| -> Option<(u32, Option<Rgba>)> {
        let s = doc.child(style?, DmlNs::A, name)?;
        let idx = doc.attr_f64(s, "idx").unwrap_or(0.0).max(0.0) as u32;
        Some((idx, find_color(doc, s, &colors)))
    };
    let theme = parts.theme_full.as_deref();
    // Fill: the shape's own, else its style's.
    let fill = sp_pr
        .and_then(|s| find_fill(doc, s, &colors, &no_rels))
        .or_else(|| {
            let (idx, color) = style_ref("fillRef")?;
            let theme = theme?;
            let node = theme.fill_style(idx)?;
            Some(pptx_engine::model::fill::parse_fill(
                &theme.doc,
                node,
                &colors.with_ph(color),
                &|_| None,
            ))
        })
        .unwrap_or(Fill::None);
    // Outline: the shape's own settings over its style's.
    let mut line = sp_pr
        .and_then(|s| doc.child(s, DmlNs::A, "ln"))
        .map(|ln| parse_line(doc, ln, &colors, &no_rels))
        .unwrap_or_default();
    if let Some((idx, color)) = style_ref("lnRef")
        && let Some(theme) = theme
        && let Some(ln) = theme.line_style(idx)
    {
        line.inherit(&parse_line(&theme.doc, ln, &colors.with_ph(color), &|_| {
            None
        }));
    }
    let (w, h) = (f64::from(rect.w), f64::from(rect.h));
    let geom = sp_pr
        .and_then(|s| {
            if let Some(p) = doc.child(s, DmlNs::A, "prstGeom") {
                let name = doc.attr(p, "prst").unwrap_or("rect");
                geometry::preset(
                    name,
                    w * EMU_PER_PT,
                    h * EMU_PER_PT,
                    &geometry::adjust_values(doc, p),
                )
            } else {
                doc.child(s, DmlNs::A, "custGeom")
                    .map(|c| geometry::custom(doc, c, w * EMU_PER_PT, h * EMU_PER_PT))
            }
        })
        .or_else(|| geometry::preset("rect", w * EMU_PER_PT, h * EMU_PER_PT, &[]));
    let Some(geom) = geom else {
        return;
    };
    let xfrm = sp_pr.and_then(|s| doc.child(s, DmlNs::A, "xfrm"));
    let flag = |name: &str| {
        xfrm.and_then(|x| doc.attr(x, name))
            .is_some_and(|v| v == "1" || v == "true")
    };
    let rot = xfrm.and_then(|x| doc.attr_f64(x, "rot")).unwrap_or(0.0) / ANGLE_UNITS;
    let world = placement(rect, rot, flag("flipH"), flag("flipV"));
    paint_geometry(&geom, &fill, &line, rect, &world, out);
}

/// The transform from shape-local points to the page: rotated and flipped
/// about the shape's center.
fn placement(rect: Rect, rot: f64, flip_h: bool, flip_v: bool) -> Affine {
    let (cx, cy) = (f64::from(rect.w) / 2.0, f64::from(rect.h) / 2.0);
    Affine::translate(f64::from(rect.x) + cx, f64::from(rect.y) + cy)
        .pre_concat(&Affine::rotate(rot))
        .pre_concat(&Affine::scale(
            if flip_h { -1.0 } else { 1.0 },
            if flip_v { -1.0 } else { 1.0 },
        ))
        .pre_concat(&Affine::translate(-cx, -cy))
}

/// Fills and strokes a shape's sub-paths.
fn paint_geometry(
    geom: &ShapeGeometry,
    fill: &Fill,
    line: &LineProps,
    rect: Rect,
    world: &Affine,
    out: &mut Vec<Node>,
) {
    let bbox = Rect::from_xywh(0.0, 0.0, rect.w, rect.h);
    if let Some(paint) = fill_paint(fill, bbox, world, &mut NoImages) {
        for gp in &geom.paths {
            let paint = match gp.fill {
                PathFill::None => continue,
                PathFill::Norm => paint.clone(),
                PathFill::Lighten => shade_paint(paint.clone(), 0.4, true),
                PathFill::LightenLess => shade_paint(paint.clone(), 0.2, true),
                PathFill::Darken => shade_paint(paint.clone(), 0.6, false),
                PathFill::DarkenLess => shade_paint(paint.clone(), 0.8, false),
            };
            out.push(Node::Fill {
                path: gp.path.transform(world),
                paint,
                even_odd: false,
            });
        }
    }
    let Some(line) = line.resolve() else {
        return;
    };
    let Some(paint) = fill_paint(&line.fill, bbox, world, &mut NoImages) else {
        return;
    };
    let stroke = line_stroke(&line, 1.0);
    for gp in geom.paths.iter().filter(|p| p.stroke) {
        out.push(Node::Stroke {
            path: gp.path.transform(world),
            paint: paint.clone(),
            stroke: stroke.clone(),
        });
    }
}

/// A VML color (`#rrggbb`, `#rgb`, a color name, maybe followed by a
/// `[index]` or a transformation).
fn vml_color(v: &str) -> Option<Rgba> {
    let v = v.split_whitespace().next()?.split('[').next()?.trim();
    if let Some(hex) = v.strip_prefix('#') {
        if hex.len() == 3 {
            let long: String = hex.chars().flat_map(|c| [c, c]).collect();
            return Rgba::from_hex(&long);
        }
        return Rgba::from_hex(hex);
    }
    match v.to_ascii_lowercase().as_str() {
        "window" | "background" => Some(Rgba::WHITE),
        "windowtext" | "black" => Some(Rgba::BLACK),
        name => preset_color(name),
    }
}

/// Whether a VML on/off attribute is on.
fn vml_on(v: Option<&str>, default: bool) -> bool {
    v.map_or(default, |v| {
        !matches!(v.trim(), "f" | "false" | "0" | "off" | "False")
    })
}

/// Draws a VML shape (rectangle, rounded rectangle, oval, line, text box).
fn vml_shape(t: &XmlTree, node: NodeId, rect: Rect, out: &mut Vec<Node>) {
    let attr = |n: NodeId, name: &str| t.attr(n, Ns::NONE, name);
    let fill_el = t.children(node).find(|&c| t.is(c, Ns::V, "fill"));
    let stroke_el = t.children(node).find(|&c| t.is(c, Ns::V, "stroke"));
    let local = t.local(node);
    let is_line = local == "line";
    let filled = !is_line
        && vml_on(attr(node, "filled"), true)
        && fill_el.is_none_or(|f| vml_on(attr(f, "on"), true));
    let stroked = vml_on(attr(node, "stroked"), true)
        && stroke_el.is_none_or(|s| vml_on(attr(s, "on"), true));
    let path = match local {
        "oval" => ellipse(rect),
        "roundrect" => {
            let arc = attr(node, "arcsize")
                .and_then(|a| {
                    let a = a.trim();
                    match a.strip_suffix('f') {
                        Some(f) => f.parse::<f32>().ok().map(|v| v / 65_536.0),
                        None => a
                            .trim_end_matches('%')
                            .parse::<f32>()
                            .ok()
                            .map(|v| if v > 1.0 { v / 100.0 } else { v }),
                    }
                })
                .unwrap_or(0.2);
            rounded(rect, rect.w.min(rect.h) * arc / 2.0 * 2.0)
        }
        "line" => {
            let point = |name: &str, default: (f32, f32)| {
                attr(node, name).map_or(default, |v| {
                    let mut it = v.split(',').map(|p| css_length(p).unwrap_or(0.0));
                    (it.next().unwrap_or(0.0), it.next().unwrap_or(0.0))
                })
            };
            let (x0, y0) = point("from", (0.0, 0.0));
            let (x1, y1) = point("to", (rect.w, 0.0));
            let mut p = Path::new();
            p.move_to(Point::new(rect.x + x0, rect.y + y0));
            p.line_to(Point::new(rect.x + x1, rect.y + y1));
            p
        }
        _ => Path::rect(rect),
    };
    if filled {
        let color = attr(node, "fillcolor")
            .or_else(|| fill_el.and_then(|f| attr(f, "color")))
            .map_or(Some(Rgba::WHITE), vml_color);
        if let Some(c) = color {
            out.push(Node::Fill {
                path: path.clone(),
                paint: Paint::Solid(c),
                even_odd: false,
            });
        }
    }
    if stroked {
        let color = attr(node, "strokecolor")
            .or_else(|| stroke_el.and_then(|s| attr(s, "color")))
            .map_or(Some(Rgba::BLACK), vml_color);
        let width = attr(node, "strokeweight")
            .or_else(|| stroke_el.and_then(|s| attr(s, "weight")))
            .and_then(css_length)
            .unwrap_or(VML_STROKE);
        let dashed = stroke_el
            .and_then(|s| attr(s, "dashstyle"))
            .is_some_and(|d| d != "solid");
        if let Some(c) = color {
            out.push(Node::Stroke {
                path,
                paint: Paint::Solid(c),
                stroke: Stroke {
                    width,
                    cap: LineCap::Butt,
                    join: LineJoin::Miter,
                    miter_limit: 4.0,
                    dash: dashed.then(|| vec![width * 4.0, width * 3.0]),
                },
            });
        }
    }
}

/// An ellipse inscribed in `r`.
fn ellipse(r: Rect) -> Path {
    // Four cubic arcs with the usual control distance.
    const K: f32 = 0.552_284_8;
    let (cx, cy) = (r.x + r.w / 2.0, r.y + r.h / 2.0);
    let (rx, ry) = (r.w / 2.0, r.h / 2.0);
    let mut p = Path::new();
    p.move_to(Point::new(cx + rx, cy));
    p.cubic_to(
        Point::new(cx + rx, cy + ry * K),
        Point::new(cx + rx * K, cy + ry),
        Point::new(cx, cy + ry),
    );
    p.cubic_to(
        Point::new(cx - rx * K, cy + ry),
        Point::new(cx - rx, cy + ry * K),
        Point::new(cx - rx, cy),
    );
    p.cubic_to(
        Point::new(cx - rx, cy - ry * K),
        Point::new(cx - rx * K, cy - ry),
        Point::new(cx, cy - ry),
    );
    p.cubic_to(
        Point::new(cx + rx * K, cy - ry),
        Point::new(cx + rx, cy - ry * K),
        Point::new(cx + rx, cy),
    );
    p.close();
    p
}

/// A rectangle with corners rounded by `radius`.
fn rounded(r: Rect, radius: f32) -> Path {
    let w = f64::from(r.w);
    let h = f64::from(r.h);
    let rad = f64::from(radius).min(w / 2.0).min(h / 2.0).max(0.0);
    let geom = geometry::preset(
        "roundRect",
        w * EMU_PER_PT,
        h * EMU_PER_PT,
        &[(
            "adj".to_owned(),
            if w.min(h) > 0.0 {
                rad / w.min(h) * 100_000.0
            } else {
                0.0
            },
        )],
    );
    match geom.and_then(|g| g.paths.into_iter().next()) {
        Some(gp) => gp
            .path
            .transform(&Affine::translate(f64::from(r.x), f64::from(r.y))),
        None => Path::rect(r),
    }
}

#[cfg(test)]
mod test;
