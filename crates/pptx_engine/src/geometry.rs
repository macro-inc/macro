//! DrawingML shape geometry: preset shapes and custom geometry.
//!
//! Both are described by the same guide language (`avLst`, `gdLst`, `pathLst`,
//! `rect`). Presets come from the ECMA-376 `presetShapeDefinitions.xml`, embedded
//! in minified form; custom geometry is evaluated straight from the shape XML.

mod formula;
mod presets;

use crate::path::{Path, Point, Rect};
use crate::xml::{Ns, NodeId, XmlDoc};
pub use formula::Guides;

/// How a geometry sub-path is filled.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PathFill {
    /// Not filled.
    None,
    /// Filled with the shape fill.
    Norm,
    /// Filled with a lightened shape fill.
    Lighten,
    /// Filled with a slightly lightened shape fill.
    LightenLess,
    /// Filled with a darkened shape fill.
    Darken,
    /// Filled with a slightly darkened shape fill.
    DarkenLess,
}

/// One sub-path of a shape outline.
#[derive(Clone, Debug)]
pub struct GeomPath {
    /// The outline in shape-local points.
    pub path: Path,
    /// Fill treatment.
    pub fill: PathFill,
    /// Whether the outline is stroked.
    pub stroke: bool,
}

/// A connection site where connectors may attach.
#[derive(Clone, Copy, Debug)]
pub struct ConnectionSite {
    /// Position in shape-local points.
    pub pos: Point,
    /// Outgoing angle in degrees.
    pub angle: f64,
}

/// Evaluated geometry of a shape of a particular size.
#[derive(Clone, Debug, Default)]
pub struct ShapeGeometry {
    /// Sub-paths in drawing order.
    pub paths: Vec<GeomPath>,
    /// The text rectangle in shape-local points.
    pub text_rect: Rect,
    /// Connection sites.
    pub connections: Vec<ConnectionSite>,
}

/// An adjust-value override (`<a:gd name="adj" fmla="val 25000"/>`).
pub type Adjust = (String, f64);

/// EMU per point.
const EMU_PER_PT: f64 = 12700.0;

/// Evaluates the preset `name` for a `w`×`h` EMU shape. `None` for unknown presets.
pub fn preset(name: &str, w: f64, h: f64, adjust: &[Adjust]) -> Option<ShapeGeometry> {
    let defs = presets::definitions();
    let def = defs.get(name)?;
    Some(evaluate(&def.doc, def.node, w, h, adjust))
}

/// Whether `name` is a known preset geometry.
pub fn is_preset(name: &str) -> bool {
    presets::definitions().contains_key(name)
}

/// Evaluates a `custGeom` element for a `w`×`h` EMU shape.
pub fn custom(doc: &XmlDoc, cust_geom: NodeId, w: f64, h: f64) -> ShapeGeometry {
    evaluate(doc, cust_geom, w, h, &[])
}

/// Reads the `avLst` overrides of a `prstGeom`/`custGeom` element.
pub fn adjust_values(doc: &XmlDoc, geom: NodeId) -> Vec<Adjust> {
    let Some(av) = doc.child(geom, Ns::A, "avLst") else { return Vec::new() };
    doc.children_named(av, Ns::A, "gd")
        .filter_map(|gd| {
            let name = doc.attr(gd, "name")?.to_owned();
            let fmla = doc.attr(gd, "fmla")?;
            let v = fmla.trim().strip_prefix("val").and_then(|v| v.trim().parse::<f64>().ok())?;
            Some((name, v))
        })
        .collect()
}

fn evaluate(doc: &XmlDoc, geom: NodeId, w: f64, h: f64, adjust: &[Adjust]) -> ShapeGeometry {
    let mut guides = Guides::new(w, h);
    // Shape defaults first, then caller overrides; later guides may reference both.
    if let Some(av) = child_any(doc, geom, "avLst") {
        for gd in doc.children(av).filter(|&g| doc.local(g) == "gd") {
            let (Some(name), Some(fmla)) = (doc.attr(gd, "name"), doc.attr(gd, "fmla")) else { continue };
            match adjust.iter().find(|(n, _)| n == name) {
                Some((_, v)) => guides.set(name, *v),
                None => guides.define(name, fmla),
            }
        }
    }
    for (name, v) in adjust {
        if !guides.has(name) {
            guides.set(name, *v);
        }
    }
    if let Some(gl) = child_any(doc, geom, "gdLst") {
        for gd in doc.children(gl).filter(|&g| doc.local(g) == "gd") {
            if let (Some(name), Some(fmla)) = (doc.attr(gd, "name"), doc.attr(gd, "fmla")) {
                guides.define(name, fmla);
            }
        }
    }
    let to_pt = |v: f64| (v / EMU_PER_PT) as f32;
    let text_rect = child_any(doc, geom, "rect").map_or(
        Rect::from_xywh(0.0, 0.0, to_pt(w), to_pt(h)),
        |r| {
            let g = |a: &str, d: f64| doc.attr(r, a).map_or(d, |v| guides.get(v));
            let (l, t, rr, b) = (g("l", 0.0), g("t", 0.0), g("r", w), g("b", h));
            Rect::from_ltrb(to_pt(l.min(rr)), to_pt(t.min(b)), to_pt(rr.max(l)), to_pt(b.max(t)))
        },
    );
    let mut connections = Vec::new();
    if let Some(cl) = child_any(doc, geom, "cxnLst") {
        for cxn in doc.children(cl).filter(|&c| doc.local(c) == "cxn") {
            let Some(pos) = doc.children(cxn).find(|&p| doc.local(p) == "pos") else { continue };
            let x = doc.attr(pos, "x").map_or(0.0, |v| guides.get(v));
            let y = doc.attr(pos, "y").map_or(0.0, |v| guides.get(v));
            let ang = doc.attr(cxn, "ang").map_or(0.0, |v| guides.get(v)) / 60000.0;
            connections.push(ConnectionSite { pos: Point::new(to_pt(x), to_pt(y)), angle: ang });
        }
    }
    let mut paths = Vec::new();
    if let Some(pl) = child_any(doc, geom, "pathLst") {
        for p in doc.children(pl).filter(|&c| doc.local(c) == "path") {
            paths.push(build_path(doc, p, &guides, w, h));
        }
    }
    ShapeGeometry { paths, text_rect, connections }
}

fn child_any(doc: &XmlDoc, parent: NodeId, local: &str) -> Option<NodeId> {
    // Preset definitions use the DrawingML namespace via default declarations;
    // match by local name so both sources work.
    doc.children(parent).find(|&c| doc.local(c) == local)
}

fn build_path(doc: &XmlDoc, p: NodeId, guides: &Guides, w: f64, h: f64) -> GeomPath {
    let pw = doc.attr_f64(p, "w").filter(|&v| v > 0.0);
    let ph = doc.attr_f64(p, "h").filter(|&v| v > 0.0);
    // Path coordinates are in their own space when w/h are given.
    let sx = pw.map_or(1.0, |pw| w / pw);
    let sy = ph.map_or(1.0, |ph| h / ph);
    let fill = match doc.attr(p, "fill") {
        Some("none") => PathFill::None,
        Some("lighten") => PathFill::Lighten,
        Some("lightenLess") => PathFill::LightenLess,
        Some("darken") => PathFill::Darken,
        Some("darkenLess") => PathFill::DarkenLess,
        _ => PathFill::Norm,
    };
    let stroke = doc.attr_bool(p, "stroke").unwrap_or(true);
    let to_pt = |v: f64| (v / EMU_PER_PT) as f32;
    let pt = |node: NodeId| -> Point {
        let x = doc.attr(node, "x").map_or(0.0, |v| guides.get(v)) * sx;
        let y = doc.attr(node, "y").map_or(0.0, |v| guides.get(v)) * sy;
        Point::new(to_pt(x), to_pt(y))
    };
    let mut path = Path::new();
    for cmd in doc.children(p) {
        let pts: Vec<Point> = doc.children(cmd).filter(|&c| doc.local(c) == "pt").map(pt).collect();
        match doc.local(cmd) {
            "moveTo" => {
                if let Some(&a) = pts.first() {
                    path.move_to(a);
                }
            }
            "lnTo" => {
                if let Some(&a) = pts.first() {
                    path.line_to(a);
                }
            }
            "quadBezTo" => {
                if pts.len() >= 2 {
                    path.quad_to(pts[0], pts[1]);
                }
            }
            "cubicBezTo" => {
                if pts.len() >= 3 {
                    path.cubic_to(pts[0], pts[1], pts[2]);
                }
            }
            "arcTo" => {
                let g = |a: &str| doc.attr(cmd, a).map_or(0.0, |v| guides.get(v));
                let wr = g("wR") * sx;
                let hr = g("hR") * sy;
                let st = g("stAng") / 60000.0;
                let sw = g("swAng") / 60000.0;
                path.arc_to_ooxml(to_pt(wr), to_pt(hr), st, sw);
            }
            "close" => path.close(),
            _ => {}
        }
    }
    GeomPath { path, fill, stroke }
}

#[cfg(test)]
mod test;
