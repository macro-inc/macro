//! Freeform geometry: replacing a shape's outline with custom geometry
//! (PowerPoint's Edit Points) and merging shapes (Merge Shapes).
//!
//! Both write an `a:custGeom` whose path space is the shape's box in EMU,
//! so the outline stretches with the shape afterwards. When the outline
//! leaves the box, the box moves and resizes to the outline's bounds
//! (keeping rotation and flips), so the outline stays where it is drawn;
//! a stretched picture fill gets its source rectangle moved to match.

mod merge;

pub(super) use merge::merge_shapes;

use super::group::{self, Frame};
use super::ops::{GeometryPath, PathCommand, PathFillMode};
use super::shapes;
use super::xmlutil::{SP_PR_ORDER, ensure_sp_pr, import_fragment};
use crate::boolean::{Pt, Seg};
use crate::error::{Error, Result};
use crate::inspect::geometry::{Resolved, resolve};
use crate::model::presentation::Presentation;
use crate::model::shape::ShapeKind;
use crate::path::Rect;
use crate::render::build::shape_geometry;
use crate::units::EMU_PER_PT;
use crate::xml::{NodeId, Ns, XmlDoc};
use std::f64::consts::PI;
use std::fmt::Write;

/// Largest coordinate accepted (points): far beyond any slide.
const MAX_COORD: f32 = 1.0e6;
/// Most drawing commands in one outline.
const MAX_COMMANDS: usize = 100_000;
/// Box changes below this (points) are rounding noise.
const EPSILON: f64 = 0.5 / EMU_PER_PT;
/// Child order of `a:blipFill`.
const BLIP_FILL_ORDER: &[&str] = &["blip", "srcRect", "tile", "stretch"];

/// Where a custom outline's text goes.
#[derive(Clone, Copy, Debug, PartialEq)]
enum TextArea {
    /// The whole box (`l t r b`), as PowerPoint's freeforms.
    Full,
    /// Fractions `[left, top, right, bottom]` of the box, kept as guides so
    /// the text area scales with the shape.
    Fractions([f64; 4]),
}

/// The index of the slide with id `slide`.
pub(super) fn slide_index(pres: &Presentation, slide: u32) -> Result<usize> {
    pres.slides
        .iter()
        .position(|s| s.id == slide)
        .ok_or_else(|| Error::NotFound(format!("slide {slide}")))
}

fn check_paths(paths: &[GeometryPath]) -> Result<()> {
    let invalid = |m: &str| Err(Error::InvalidEdit(m.to_owned()));
    if paths.is_empty() {
        return invalid("give at least one path");
    }
    let total: usize = paths.iter().map(|p| p.commands.len()).sum();
    if total > MAX_COMMANDS {
        return invalid("the outline has too many commands");
    }
    for p in paths {
        if !matches!(p.commands.first(), Some(PathCommand::MoveTo { .. })) {
            return invalid("every path starts with `moveTo`");
        }
        for c in &p.commands {
            let values: &[f32] = match c {
                PathCommand::MoveTo { x, y } | PathCommand::LineTo { x, y } => &[*x, *y],
                PathCommand::CubicBezTo {
                    x1,
                    y1,
                    x2,
                    y2,
                    x,
                    y,
                } => &[*x1, *y1, *x2, *y2, *x, *y],
                PathCommand::QuadBezTo { x1, y1, x, y } => &[*x1, *y1, *x, *y],
                PathCommand::ArcTo {
                    w_r,
                    h_r,
                    st_ang,
                    sw_ang,
                } => {
                    if *w_r < 0.0 || *h_r < 0.0 {
                        return invalid("arc radii must not be negative");
                    }
                    &[*w_r, *h_r, *st_ang, *sw_ang]
                }
                PathCommand::Close => &[],
            };
            if values.iter().any(|v| !v.is_finite() || v.abs() > MAX_COORD) {
                return invalid("path coordinates must be finite numbers of points");
            }
        }
    }
    Ok(())
}

/// The commands as chains of segments (arcs as cubics), for bounds.
fn command_segments(commands: &[PathCommand]) -> Vec<Seg> {
    let p = |x: f32, y: f32| Pt::new(f64::from(x), f64::from(y));
    let mut out = Vec::new();
    let (mut cur, mut start) = (Pt::default(), Pt::default());
    for c in commands {
        match *c {
            PathCommand::MoveTo { x, y } => {
                cur = p(x, y);
                start = cur;
            }
            PathCommand::LineTo { x, y } => {
                out.push(Seg::Line(cur, p(x, y)));
                cur = p(x, y);
            }
            PathCommand::CubicBezTo {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => {
                out.push(Seg::Cubic(cur, p(x1, y1), p(x2, y2), p(x, y)));
                cur = p(x, y);
            }
            PathCommand::QuadBezTo { x1, y1, x, y } => {
                let (c, e) = (p(x1, y1), p(x, y));
                out.push(quad_to_cubic(cur, c, e));
                cur = e;
            }
            PathCommand::ArcTo {
                w_r,
                h_r,
                st_ang,
                sw_ang,
            } => {
                for seg in arc_segments(
                    cur,
                    f64::from(w_r),
                    f64::from(h_r),
                    f64::from(st_ang),
                    f64::from(sw_ang),
                ) {
                    cur = seg.end();
                    out.push(seg);
                }
            }
            PathCommand::Close => {
                out.push(Seg::Line(cur, start));
                cur = start;
            }
        }
    }
    out
}

/// A quadratic Bézier as the equal cubic.
pub(super) fn quad_to_cubic(a: Pt, c: Pt, b: Pt) -> Seg {
    let k = 2.0 / 3.0;
    Seg::Cubic(
        a,
        Pt::new(a.x + k * (c.x - a.x), a.y + k * (c.y - a.y)),
        Pt::new(b.x + k * (c.x - b.x), b.y + k * (c.y - b.y)),
        b,
    )
}

/// DrawingML `arcTo` from `cur` as cubic segments (as the renderer draws it).
fn arc_segments(cur: Pt, rx: f64, ry: f64, st_deg: f64, sw_deg: f64) -> Vec<Seg> {
    if rx <= 0.0 || ry <= 0.0 || sw_deg == 0.0 {
        return Vec::new();
    }
    let param = |deg: f64| {
        let th = deg.to_radians();
        (rx * th.sin()).atan2(ry * th.cos())
    };
    let t0 = param(st_deg);
    let mut t1 = param(st_deg + sw_deg);
    let sweep = sw_deg.to_radians();
    if sweep.abs() >= 2.0 * PI - 1e-9 {
        t1 = t0 + 2.0 * PI * sweep.signum();
    } else {
        while sweep > 0.0 && t1 < t0 {
            t1 += 2.0 * PI;
        }
        while sweep < 0.0 && t1 > t0 {
            t1 -= 2.0 * PI;
        }
    }
    let (cx, cy) = (cur.x - rx * t0.cos(), cur.y - ry * t0.sin());
    let dt = t1 - t0;
    let n = (dt.abs() / (PI / 2.0)).ceil().max(1.0) as usize;
    let step = dt / n as f64;
    let k = 4.0 / 3.0 * (step / 4.0).tan();
    (0..n)
        .map(|i| {
            let t = t0 + step * i as f64;
            let (s0, c0) = t.sin_cos();
            let (s1, c1) = (t + step).sin_cos();
            Seg::Cubic(
                Pt::new(cx + rx * c0, cy + ry * s0),
                Pt::new(cx + rx * (c0 - k * s0), cy + ry * (s0 + k * c0)),
                Pt::new(cx + rx * (c1 + k * s1), cy + ry * (s1 - k * c1)),
                Pt::new(cx + rx * c1, cy + ry * s1),
            )
        })
        .collect()
}

/// `[left, top, right, bottom]` of the paths, curves counted exactly.
fn paths_bounds(paths: &[GeometryPath]) -> Option<[f64; 4]> {
    let segs: Vec<Seg> = paths
        .iter()
        .flat_map(|p| {
            let mut segs = command_segments(&p.commands);
            // A lone point still counts.
            if let Some(PathCommand::MoveTo { x, y }) = p.commands.first() {
                let at = Pt::new(f64::from(*x), f64::from(*y));
                segs.push(Seg::Line(at, at));
            }
            segs
        })
        .collect();
    crate::boolean::bounds(&segs)
}

/// The text area for a new outline spanning `bounds`, keeping the current
/// text rectangle `rect` (of a `w`×`h` box) where it is on the slide.
fn text_area(rect: Rect, w: f64, h: f64, bounds: [f64; 4]) -> TextArea {
    let r = [
        f64::from(rect.x),
        f64::from(rect.y),
        f64::from(rect.right()),
        f64::from(rect.bottom()),
    ];
    let near = |a: f64, b: f64| (a - b).abs() < 0.01;
    // A text area filling the box keeps filling it.
    if near(r[0], 0.0) && near(r[1], 0.0) && near(r[2], w) && near(r[3], h) {
        return TextArea::Full;
    }
    let [x0, y0, x1, y1] = bounds;
    let (bw, bh) = (x1 - x0, y1 - y0);
    let (l, t, rr, b) = (r[0].max(x0), r[1].max(y0), r[2].min(x1), r[3].min(y1));
    if bw <= 0.0 || bh <= 0.0 || rr <= l || b <= t {
        return TextArea::Full;
    }
    let f = [(l - x0) / bw, (t - y0) / bh, (rr - x0) / bw, (b - y0) / bh];
    if near(f[0], 0.0) && near(f[1], 0.0) && near(f[2], 1.0) && near(f[3], 1.0) {
        TextArea::Full
    } else {
        TextArea::Fractions(f)
    }
}

fn emu(pt: f64) -> i64 {
    (pt * EMU_PER_PT).round() as i64
}

/// The `a:custGeom` markup for `paths` (local points) in the box `bounds`.
fn cust_geom_xml(paths: &[GeometryPath], bounds: [f64; 4], text: TextArea) -> String {
    let [x0, y0, x1, y1] = bounds;
    let (w, h) = (emu(x1 - x0), emu(y1 - y0));
    let mut s = String::from("<a:custGeom><a:avLst/>");
    match text {
        TextArea::Full => s.push_str("<a:gdLst/>"),
        TextArea::Fractions(f) => {
            s.push_str("<a:gdLst>");
            for (name, dim, v) in [
                ("txL", "w", f[0]),
                ("txT", "h", f[1]),
                ("txR", "w", f[2]),
                ("txB", "h", f[3]),
            ] {
                let _ = write!(
                    s,
                    r#"<a:gd name="{name}" fmla="*/ {dim} {} 100000"/>"#,
                    (v * 100_000.0).round() as i64
                );
            }
            s.push_str("</a:gdLst>");
        }
    }
    s.push_str("<a:ahLst/><a:cxnLst/>");
    s.push_str(match text {
        TextArea::Full => r#"<a:rect l="l" t="t" r="r" b="b"/>"#,
        TextArea::Fractions(_) => r#"<a:rect l="txL" t="txT" r="txR" b="txB"/>"#,
    });
    s.push_str("<a:pathLst>");
    let px = |v: f32| emu(f64::from(v) - x0);
    let py = |v: f32| emu(f64::from(v) - y0);
    let pt = |s: &mut String, x: f32, y: f32| {
        let _ = write!(s, r#"<a:pt x="{}" y="{}"/>"#, px(x), py(y));
    };
    for p in paths {
        s.push_str("<a:path");
        if w > 0 {
            let _ = write!(s, r#" w="{w}""#);
        }
        if h > 0 {
            let _ = write!(s, r#" h="{h}""#);
        }
        let fill = match p.fill.unwrap_or_default() {
            PathFillMode::Norm => "",
            PathFillMode::None => "none",
            PathFillMode::Lighten => "lighten",
            PathFillMode::LightenLess => "lightenLess",
            PathFillMode::Darken => "darken",
            PathFillMode::DarkenLess => "darkenLess",
        };
        if !fill.is_empty() {
            let _ = write!(s, r#" fill="{fill}""#);
        }
        if p.stroke == Some(false) {
            s.push_str(r#" stroke="0""#);
        }
        s.push('>');
        for c in &p.commands {
            match *c {
                PathCommand::MoveTo { x, y } => {
                    s.push_str("<a:moveTo>");
                    pt(&mut s, x, y);
                    s.push_str("</a:moveTo>");
                }
                PathCommand::LineTo { x, y } => {
                    s.push_str("<a:lnTo>");
                    pt(&mut s, x, y);
                    s.push_str("</a:lnTo>");
                }
                PathCommand::CubicBezTo {
                    x1,
                    y1,
                    x2,
                    y2,
                    x,
                    y,
                } => {
                    s.push_str("<a:cubicBezTo>");
                    pt(&mut s, x1, y1);
                    pt(&mut s, x2, y2);
                    pt(&mut s, x, y);
                    s.push_str("</a:cubicBezTo>");
                }
                PathCommand::QuadBezTo { x1, y1, x, y } => {
                    s.push_str("<a:quadBezTo>");
                    pt(&mut s, x1, y1);
                    pt(&mut s, x, y);
                    s.push_str("</a:quadBezTo>");
                }
                PathCommand::ArcTo {
                    w_r,
                    h_r,
                    st_ang,
                    sw_ang,
                } => {
                    let angle = |deg: f32| (f64::from(deg) * 60_000.0).round() as i64;
                    let _ = write!(
                        s,
                        r#"<a:arcTo wR="{}" hR="{}" stAng="{}" swAng="{}"/>"#,
                        emu(f64::from(w_r)),
                        emu(f64::from(h_r)),
                        angle(st_ang),
                        angle(sw_ang)
                    );
                }
                PathCommand::Close => s.push_str("<a:close/>"),
            }
        }
        s.push_str("</a:path>");
    }
    s.push_str("</a:pathLst></a:custGeom>");
    s
}

/// Replaces the geometry of `node` with a custom outline.
fn write_cust_geom(
    doc: &mut XmlDoc,
    node: NodeId,
    paths: &[GeometryPath],
    bounds: [f64; 4],
    text: TextArea,
) -> Result<()> {
    let geom = import_fragment(doc, &cust_geom_xml(paths, bounds, text))?;
    let sp_pr = ensure_sp_pr(doc, node);
    doc.remove_children_named(sp_pr, Ns::A, "prstGeom");
    doc.remove_children_named(sp_pr, Ns::A, "custGeom");
    doc.insert_in_order(sp_pr, geom, SP_PR_ORDER);
    Ok(())
}

/// The frame of a shape whose outline now spans `bounds` (local points of
/// `frame`'s box): the same rotation and flips, the outline in place.
fn reboxed(frame: &Frame, bounds: [f64; 4]) -> Frame {
    let [x0, y0, x1, y1] = bounds;
    let (cx, cy) = frame.map_local((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    let (w, h) = (x1 - x0, y1 - y0);
    Frame {
        x: cx - w / 2.0,
        y: cy - h / 2.0,
        w,
        h,
        ..*frame
    }
}

/// The stretched picture fill of a shape or picture, if it has one.
fn stretched_blip(doc: &XmlDoc, node: NodeId) -> Option<NodeId> {
    let blip = doc
        .children(node)
        .find(|&c| doc.local(c) == "blipFill")
        .or_else(|| {
            let sp_pr = doc.children(node).find(|&c| doc.local(c) == "spPr")?;
            doc.child(sp_pr, Ns::A, "blipFill")
        })?;
    doc.child(blip, Ns::A, "stretch").map(|_| blip)
}

/// A picture fill's crop `[l, t, r, b]` as fractions.
fn src_rect(doc: &XmlDoc, blip: NodeId) -> [f64; 4] {
    let rect = doc.child(blip, Ns::A, "srcRect");
    ["l", "t", "r", "b"].map(|a| {
        rect.and_then(|r| doc.attr_f64(r, a))
            .map_or(0.0, |v| v / 100_000.0)
    })
}

/// The crop that keeps a stretched image in place when the `w`×`h` box
/// becomes `bounds` (local points).
fn reboxed_src_rect(src: [f64; 4], w: f64, h: f64, bounds: [f64; 4]) -> Option<[f64; 4]> {
    let [l, t, r, b] = src;
    let (kx, ky) = (1.0 - l - r, 1.0 - t - b);
    if kx <= 0.0 || ky <= 0.0 || w <= 0.0 || h <= 0.0 {
        return None;
    }
    // The whole image in local points.
    let (iw, ih) = (w / kx, h / ky);
    let (ix, iy) = (-l * iw, -t * ih);
    let [x0, y0, x1, y1] = bounds;
    Some([
        (x0 - ix) / iw,
        (y0 - iy) / ih,
        (ix + iw - x1) / iw,
        (iy + ih - y1) / ih,
    ])
}

fn write_src_rect(doc: &mut XmlDoc, blip: NodeId, crop: [f64; 4]) {
    let rect = doc.ensure_child(blip, Ns::A, "srcRect", BLIP_FILL_ORDER);
    for (name, v) in ["l", "t", "r", "b"].into_iter().zip(crop) {
        let v = (v * 100_000.0).round() as i64;
        if v == 0 {
            doc.remove_attr(rect, name);
        } else {
            doc.set_attr(rect, name, &v.to_string());
        }
    }
}

/// Moves and resizes `node` from `frame` (its box, `w`×`h`) to the local
/// `bounds`, keeping a stretched picture fill where it was.
fn apply_box(
    doc: &mut XmlDoc,
    node: NodeId,
    frame: &Frame,
    src: Option<[f64; 4]>,
    bounds: [f64; 4],
) {
    let next = reboxed(frame, bounds);
    let xfrm = shapes::ensure_xfrm(doc, node);
    next.write(doc, xfrm, true);
    if let (Some(blip), Some(src)) = (stretched_blip(doc, node), src)
        && let Some(crop) = reboxed_src_rect(src, frame.w, frame.h, bounds)
    {
        write_src_rect(doc, blip, crop);
    }
    group::refit_ancestors(doc, node);
}

/// Replaces a shape's outline with `paths` (local points); with `fit`, the
/// box follows the paths' bounds.
pub(super) fn set_custom_geometry(
    pres: &mut Presentation,
    slide: u32,
    shape: u32,
    paths: &[GeometryPath],
    fit: bool,
) -> Result<()> {
    check_paths(paths)?;
    let index = slide_index(pres, slide)?;
    let Resolved { shape: s, .. } = resolve(pres, index, shape)?;
    match s.kind {
        ShapeKind::Group(_) => {
            return Err(Error::InvalidEdit(
                "a group has no outline of its own; edit its shapes".into(),
            ));
        }
        ShapeKind::Frame(_) => {
            return Err(Error::InvalidEdit(
                "tables, charts, and other graphic frames have no editable outline".into(),
            ));
        }
        _ => {}
    }
    let (w, h) = (f64::from(s.xfrm.w), f64::from(s.xfrm.h));
    let full = [0.0, 0.0, w, h];
    let bounds = if fit {
        paths_bounds(paths).unwrap_or(full)
    } else {
        full
    };
    let text = text_area(shape_geometry(&s).text_rect, w, h, bounds);
    let frame = Frame::from_xfrm(&s.xfrm);
    let part = pres.slide_part(slide)?;
    let doc = pres.xml_mut(&part)?;
    let node = shapes::find(doc, shape)?;
    let src = stretched_blip(doc, node).map(|b| src_rect(doc, b));
    write_cust_geom(doc, node, paths, bounds, text)?;
    if bounds
        .iter()
        .zip(full)
        .any(|(a, b)| (a - b).abs() > EPSILON)
    {
        apply_box(doc, node, &frame, src, bounds);
    }
    Ok(())
}

#[cfg(test)]
mod test;
