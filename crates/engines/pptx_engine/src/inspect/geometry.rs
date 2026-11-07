//! A shape's outline as editable paths (for Edit Points), and the resolved
//! shapes and transforms the freeform edits start from.

use crate::edit::{GeometryPath, PathCommand, PathFillMode};
use crate::error::{Error, Result};
use crate::geometry::PathFill;
use crate::model::presentation::Presentation;
use crate::model::shape::{GeometryRef, Inherit, Shape, ShapeKind, WalkCtx, resolve_tree, sp_tree};
use crate::path::{Affine, PathEl};
use crate::render::build::shape_geometry;
use serde::Serialize;

/// A shape's outline as paths in shape-local points, with where they land
/// on the slide.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeGeometryInfo {
    /// Shape id.
    pub shape: u32,
    /// Width of the shape's box (points).
    pub w: f32,
    /// Height of the shape's box (points).
    pub h: f32,
    /// Shape-local points → slide points, `[a, b, c, d, e, f]` mapping
    /// `(x, y)` to `(a x + c y + e, b x + d y + f)` (rotation, flips, and
    /// group transforms included).
    pub transform: [f64; 6],
    /// The preset the outline comes from (`rect`, `ellipse`...), or none for
    /// custom geometry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    /// The paths (arcs already turned into cubic curves).
    pub paths: Vec<GeometryPath>,
}

/// A resolved slide shape and its shape-local → slide transform.
pub(crate) struct Resolved {
    pub shape: Shape,
    pub to_slide: Affine,
}

/// Resolves shape `id` (also inside groups) on the slide at `index`.
pub(crate) fn resolve(pres: &mut Presentation, index: usize, id: u32) -> Result<Resolved> {
    let ctx = pres.slide_context(index)?;
    let walk = WalkCtx {
        ctx: &ctx,
        inherit: Inherit::Slide,
    };
    let shapes = sp_tree(&ctx.slide.doc)
        .map(|t| resolve_tree(&walk, &ctx.slide, t))
        .unwrap_or_default();
    find(&shapes, id, Affine::IDENTITY)
        .map(|(shape, parent)| Resolved {
            to_slide: parent.pre_concat(&shape.xfrm.local_to_parent()),
            shape: shape.clone(),
        })
        .ok_or_else(|| Error::NotFound(format!("shape {id}")))
}

fn find(shapes: &[Shape], id: u32, parent: Affine) -> Option<(&Shape, Affine)> {
    for s in shapes {
        if s.id == id {
            return Some((s, parent));
        }
        if let ShapeKind::Group(children) = &s.kind {
            let inner = parent
                .pre_concat(&s.xfrm.local_to_parent())
                .pre_concat(&s.xfrm.child_to_local());
            if let Some(found) = find(children, id, inner) {
                return Some(found);
            }
        }
    }
    None
}

/// DrawingML's path fill as the operation's value.
pub(crate) fn fill_mode(fill: PathFill) -> PathFillMode {
    match fill {
        PathFill::None => PathFillMode::None,
        PathFill::Norm => PathFillMode::Norm,
        PathFill::Lighten => PathFillMode::Lighten,
        PathFill::LightenLess => PathFillMode::LightenLess,
        PathFill::Darken => PathFillMode::Darken,
        PathFill::DarkenLess => PathFillMode::DarkenLess,
    }
}

/// The evaluated outline of a resolved shape as operation paths.
pub(crate) fn outline_paths(shape: &Shape) -> Vec<GeometryPath> {
    shape_geometry(shape)
        .paths
        .iter()
        .map(|g| GeometryPath {
            commands: g
                .path
                .els
                .iter()
                .map(|el| match *el {
                    PathEl::MoveTo(p) => PathCommand::MoveTo { x: p.x, y: p.y },
                    PathEl::LineTo(p) => PathCommand::LineTo { x: p.x, y: p.y },
                    PathEl::QuadTo(c, p) => PathCommand::QuadBezTo {
                        x1: c.x,
                        y1: c.y,
                        x: p.x,
                        y: p.y,
                    },
                    PathEl::CubicTo(a, b, p) => PathCommand::CubicBezTo {
                        x1: a.x,
                        y1: a.y,
                        x2: b.x,
                        y2: b.y,
                        x: p.x,
                        y: p.y,
                    },
                    PathEl::Close => PathCommand::Close,
                })
                .collect(),
            fill: Some(fill_mode(g.fill)),
            stroke: Some(g.stroke),
        })
        .collect()
}

impl Presentation {
    /// The outline of shape `shape` on the slide at `index` as editable
    /// paths (a preset evaluated at the shape's size with its adjustments,
    /// or its custom geometry). `None` for groups, tables, charts, and other
    /// graphic frames, which have no outline of their own.
    pub fn geometry_paths(
        &mut self,
        index: usize,
        shape: u32,
    ) -> Result<Option<ShapeGeometryInfo>> {
        let Resolved { shape: s, to_slide } = resolve(self, index, shape)?;
        if matches!(s.kind, ShapeKind::Group(_) | ShapeKind::Frame(_)) {
            return Ok(None);
        }
        let t = to_slide;
        Ok(Some(ShapeGeometryInfo {
            shape: s.id,
            w: s.xfrm.w,
            h: s.xfrm.h,
            transform: [t.a, t.b, t.c, t.d, t.e, t.f],
            preset: match &s.geometry {
                GeometryRef::Preset(name, _) => Some(name.clone()),
                GeometryRef::Custom(..) => None,
            },
            paths: outline_paths(&s),
        }))
    }
}
