//! The value types of the freeform geometry operations: `setCustomGeometry`
//! (PowerPoint's Edit Points) and `mergeShapes` (Merge Shapes).

use serde::{Deserialize, Serialize};

/// One drawing command of a [`GeometryPath`], in shape-local points:
/// `(0, 0)` is the top-left corner of the shape's box before rotation and
/// flips, x grows to the right and y downward.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "cmd",
    deny_unknown_fields
)]
pub enum PathCommand {
    /// Starts a sub-path at a point (every path starts with one).
    MoveTo {
        /// X (points).
        x: f32,
        /// Y (points).
        y: f32,
    },
    /// A straight line to a point.
    LineTo {
        /// X (points).
        x: f32,
        /// Y (points).
        y: f32,
    },
    /// A cubic Bézier curve to `(x, y)` with control points `(x1, y1)` and `(x2, y2)`.
    CubicBezTo {
        /// First control point X (points).
        x1: f32,
        /// First control point Y (points).
        y1: f32,
        /// Second control point X (points).
        x2: f32,
        /// Second control point Y (points).
        y2: f32,
        /// End X (points).
        x: f32,
        /// End Y (points).
        y: f32,
    },
    /// A quadratic Bézier curve to `(x, y)` with control point `(x1, y1)`.
    QuadBezTo {
        /// Control point X (points).
        x1: f32,
        /// Control point Y (points).
        y1: f32,
        /// End X (points).
        x: f32,
        /// End Y (points).
        y: f32,
    },
    /// An elliptical arc continuing from the current point, as DrawingML's
    /// `arcTo`: the ellipse has radii `wR` and `hR`, the arc starts at angle
    /// `stAng` on it and sweeps `swAng` (degrees, clockwise on screen; 0° is
    /// the ellipse's rightmost point).
    ArcTo {
        /// Horizontal radius (points).
        w_r: f32,
        /// Vertical radius (points).
        h_r: f32,
        /// Start angle in degrees.
        st_ang: f32,
        /// Sweep in degrees (negative sweeps counter-clockwise).
        sw_ang: f32,
    },
    /// Closes the sub-path with a straight line back to its start.
    Close,
}

/// How a [`GeometryPath`] is filled (DrawingML's path `fill`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum PathFillMode {
    /// With the shape fill.
    #[default]
    Norm,
    /// Not filled (an outline only).
    None,
    /// With the shape fill, lightened.
    Lighten,
    /// With the shape fill, slightly lightened.
    LightenLess,
    /// With the shape fill, darkened.
    Darken,
    /// With the shape fill, slightly darkened.
    DarkenLess,
}

/// One path of a shape's outline: sub-paths filled together (a sub-path
/// inside another and running the other way is a hole) and outlined.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeometryPath {
    /// The drawing commands; each sub-path starts with `moveTo`.
    pub commands: Vec<PathCommand>,
    /// How the path is filled; `norm` (the shape fill) when omitted.
    #[serde(default)]
    pub fill: Option<PathFillMode>,
    /// Whether the shape outline draws this path; true when omitted.
    #[serde(default)]
    pub stroke: Option<bool>,
}

/// How `mergeShapes` combines the shapes (PowerPoint's Merge Shapes).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum MergeMode {
    /// One shape covering everything any of the shapes covers.
    Union,
    /// One shape covering what an odd number of the shapes cover: the
    /// overlaps are cut out.
    Combine,
    /// Every region the outlines cut each other into, as separate shapes.
    Fragment,
    /// One shape covering only what all the shapes cover.
    Intersect,
    /// The first shape with the others cut out of it.
    Subtract,
}
