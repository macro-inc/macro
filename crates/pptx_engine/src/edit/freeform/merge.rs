//! Merge Shapes: Union, Combine, Fragment, Intersect, and Subtract.

use super::{
    TextArea, apply_box, quad_to_cubic, slide_index, src_rect, stretched_blip, write_cust_geom,
};
use crate::boolean::{self, FillPath, MAX_OPERANDS, Operand, Pt, Seg};
use crate::edit::group::Frame;
use crate::edit::ops::{GeometryPath, MergeMode, PathCommand};
use crate::edit::shapes;
use crate::error::{Error, Result};
use crate::geometry::PathFill;
use crate::inspect::geometry::{Resolved, resolve};
use crate::model::presentation::Presentation;
use crate::model::shape::{ShapeKind, c_nv_pr, placeholder_of};
use crate::path::{Affine, Path, PathEl, Point};
use crate::render::build::shape_geometry;
use crate::xml::{NodeId, XmlDoc};

impl From<MergeMode> for boolean::MergeMode {
    fn from(mode: MergeMode) -> Self {
        match mode {
            MergeMode::Union => Self::Union,
            MergeMode::Combine => Self::Combine,
            MergeMode::Fragment => Self::Fragment,
            MergeMode::Intersect => Self::Intersect,
            MergeMode::Subtract => Self::Subtract,
        }
    }
}

fn map(t: &Affine, p: Point) -> Pt {
    let (x, y) = (f64::from(p.x), f64::from(p.y));
    Pt::new(t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f)
}

fn map_pt(t: &Affine, p: Pt) -> Pt {
    Pt::new(t.a * p.x + t.c * p.y + t.e, t.b * p.x + t.d * p.y + t.f)
}

/// A path's sub-paths as loops of segments through `t`.
fn loops_of(path: &Path, t: &Affine) -> Vec<Vec<Seg>> {
    let mut loops = Vec::new();
    let mut current: Vec<Seg> = Vec::new();
    let (mut cur, mut start) = (Pt::default(), Pt::default());
    for el in &path.els {
        match *el {
            PathEl::MoveTo(p) => {
                if !current.is_empty() {
                    loops.push(std::mem::take(&mut current));
                }
                cur = map(t, p);
                start = cur;
            }
            PathEl::LineTo(p) => {
                let q = map(t, p);
                current.push(Seg::Line(cur, q));
                cur = q;
            }
            PathEl::QuadTo(c, p) => {
                let q = map(t, p);
                current.push(quad_to_cubic(cur, map(t, c), q));
                cur = q;
            }
            PathEl::CubicTo(a, b, p) => {
                let q = map(t, p);
                current.push(Seg::Cubic(cur, map(t, a), map(t, b), q));
                cur = q;
            }
            PathEl::Close => {
                if !current.is_empty() {
                    loops.push(std::mem::take(&mut current));
                }
                cur = start;
            }
        }
    }
    if !current.is_empty() {
        loops.push(current);
    }
    loops
}

/// A shape's filled area in slide space.
fn operand(r: &Resolved) -> Operand {
    Operand {
        paths: shape_geometry(&r.shape)
            .paths
            .iter()
            .filter(|g| g.fill != PathFill::None)
            .map(|g| FillPath {
                loops: loops_of(&g.path, &r.to_slide),
            })
            .collect(),
    }
}

/// Loops (each ending where it starts) as one filled, outlined path.
fn loops_path(loops: &[Vec<Seg>]) -> GeometryPath {
    let p = |q: Pt| (q.x as f32, q.y as f32);
    let mut commands = Vec::new();
    for lp in loops {
        let Some(first) = lp.first() else { continue };
        let (x, y) = p(first.start());
        commands.push(PathCommand::MoveTo { x, y });
        for (i, s) in lp.iter().enumerate() {
            match *s {
                // The last side is the closing line.
                Seg::Line(..) if i + 1 == lp.len() => {}
                Seg::Line(_, b) => {
                    let (x, y) = p(b);
                    commands.push(PathCommand::LineTo { x, y });
                }
                Seg::Cubic(_, c1, c2, b) => {
                    let ((x1, y1), (x2, y2), (x, y)) = (p(c1), p(c2), p(b));
                    commands.push(PathCommand::CubicBezTo {
                        x1,
                        y1,
                        x2,
                        y2,
                        x,
                        y,
                    });
                }
            }
        }
        commands.push(PathCommand::Close);
    }
    GeometryPath {
        commands,
        fill: None,
        stroke: None,
    }
}

fn check_kind(r: &Resolved) -> Result<()> {
    let refuse = |m: &str| Err(Error::InvalidEdit(format!("shape {}: {m}", r.shape.id)));
    match r.shape.kind {
        ShapeKind::Shape | ShapeKind::Picture(_) => Ok(()),
        ShapeKind::Connector => refuse("lines and connectors cannot be merged"),
        ShapeKind::Group(_) => refuse("groups cannot be merged; ungroup them first"),
        ShapeKind::Frame(_) => refuse("tables, charts, and other graphic frames cannot be merged"),
    }
}

/// Names a merged drawn shape as PowerPoint does ("Freeform: Shape 7").
fn rename(doc: &mut XmlDoc, node: NodeId, id: u32) {
    if doc.local(node) != "sp" || placeholder_of(doc, node).is_some() {
        return;
    }
    if let Some(nv) = c_nv_pr(doc, node) {
        doc.set_attr(
            nv,
            "name",
            &format!("Freeform: Shape {}", id.saturating_sub(1)),
        );
    }
}

/// Makes a fragment copy a plain piece: no placeholder role, no text.
fn strip_copy(doc: &mut XmlDoc, node: NodeId) {
    let doomed: Vec<NodeId> = doc
        .descendants(node)
        .into_iter()
        .filter(|&n| {
            (doc.local(n) == "ph" && doc.parent(n).is_some_and(|p| doc.local(p) == "nvPr"))
                || (doc.local(n) == "txBody" && doc.parent(n) == Some(node))
        })
        .collect();
    for n in doomed {
        doc.detach(n);
    }
}

/// Merges shapes; returns the ids of the resulting shapes (the first is the
/// first shape's).
pub(crate) fn merge_shapes(
    pres: &mut Presentation,
    slide: u32,
    ids: &[u32],
    mode: MergeMode,
) -> Result<Vec<u32>> {
    let mut unique: Vec<u32> = Vec::new();
    for &id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    if unique.len() < 2 {
        return Err(Error::InvalidEdit(
            "merging needs at least two shapes".into(),
        ));
    }
    if unique.len() > MAX_OPERANDS {
        return Err(Error::InvalidEdit(format!(
            "at most {MAX_OPERANDS} shapes can be merged at once"
        )));
    }
    let index = slide_index(pres, slide)?;
    let resolved = unique
        .iter()
        .map(|&id| resolve(pres, index, id))
        .collect::<Result<Vec<_>>>()?;
    for r in &resolved {
        check_kind(r)?;
    }
    let operands: Vec<Operand> = resolved.iter().map(operand).collect();
    let pieces = boolean::merge(&operands, mode.into());
    if pieces.is_empty() {
        let why = match mode {
            MergeMode::Intersect => "the shapes do not overlap",
            MergeMode::Subtract => "the other shapes cover the first one",
            _ => "the shapes cover no area",
        };
        return Err(Error::InvalidEdit(format!("nothing would remain: {why}")));
    }
    // The result lives in the first shape's frame (its rotation and flips).
    let first = &resolved[0];
    let to_local = first.to_slide.invert().ok_or_else(|| {
        Error::InvalidEdit(format!("shape {} cannot be merged into", first.shape.id))
    })?;
    let frame = Frame::from_xfrm(&first.shape.xfrm);
    let locals: Vec<(GeometryPath, [f64; 4])> = pieces
        .iter()
        .filter_map(|piece| {
            let loops: Vec<Vec<Seg>> = piece
                .loops
                .iter()
                .map(|lp| {
                    lp.iter()
                        .map(|s| match *s {
                            Seg::Line(a, b) => {
                                Seg::Line(map_pt(&to_local, a), map_pt(&to_local, b))
                            }
                            Seg::Cubic(a, b, c, d) => Seg::Cubic(
                                map_pt(&to_local, a),
                                map_pt(&to_local, b),
                                map_pt(&to_local, c),
                                map_pt(&to_local, d),
                            ),
                        })
                        .collect()
                })
                .collect();
            let all: Vec<Seg> = loops.iter().flatten().copied().collect();
            boolean::bounds(&all).map(|b| (loops_path(&loops), b))
        })
        .collect();
    let part = pres.slide_part(slide)?;
    let first_id = unique[0];
    // Fragment's extra pieces start as copies of the untouched first shape.
    let mut out = vec![first_id];
    for _ in 1..locals.len() {
        out.push(shapes::duplicate_shape(pres, &part, first_id, 0.0, 0.0)?);
    }
    let doc = pres.xml_mut(&part)?;
    let src = {
        let node = shapes::find(doc, first_id)?;
        stretched_blip(doc, node).map(|b| src_rect(doc, b))
    };
    for (&id, (path, bounds)) in out.iter().zip(&locals) {
        let node = shapes::find(doc, id)?;
        write_cust_geom(
            doc,
            node,
            std::slice::from_ref(path),
            *bounds,
            TextArea::Full,
        )?;
        apply_box(doc, node, &frame, src, *bounds);
        if id != first_id {
            strip_copy(doc, node);
        }
        rename(doc, node, id);
    }
    for &id in &unique[1..] {
        let node = shapes::find(doc, id)?;
        shapes::delete_shape(doc, node);
    }
    Ok(out)
}
