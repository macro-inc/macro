//! Rotation and perspective projection.

use glam::{Mat3, Vec2, Vec3};

/// Distance from the camera to the figure's axis, in figure units.
pub(crate) const CAMERA_DISTANCE: f32 = 4.0;

/// How far the figure leans its top toward the camera, so it is seen from a
/// little above (radians, 10°).
pub(crate) const TILT: f32 = 10.0 * std::f32::consts::PI / 180.0;

/// One frame's view: the figure turned by `angle` about its vertical axis,
/// then tilted toward the camera.
#[derive(Clone, Copy, Debug)]
pub(crate) struct View {
    spin: Mat3,
    rotation: Mat3,
}

impl View {
    pub fn new(angle: f32, tilt: f32) -> Self {
        let spin = Mat3::from_rotation_y(angle);
        Self {
            spin,
            rotation: Mat3::from_rotation_x(tilt) * spin,
        }
    }

    /// The point in camera space: `+z` is toward the camera.
    pub fn transform(&self, point: Vec3) -> Vec3 {
        self.rotation * point
    }

    /// How far toward the camera the point has turned, ignoring the tilt:
    /// negative is the far half of the figure. Without the tilt, the front of
    /// a shin still counts as near although the tilt carries the legs back.
    pub fn depth(&self, point: Vec3) -> f32 {
        (self.spin * point).z
    }
}

/// Perspective projection of a camera-space point onto the screen plane
/// through the figure's axis: points nearer the camera (`z > 0`) grow, points
/// behind it shrink, and the axis stays put.
pub(crate) fn project(point: Vec3, camera_distance: f32) -> Vec2 {
    let depth = (camera_distance - point.z).max(f32::EPSILON);
    let scale = camera_distance / depth;
    Vec2::new(point.x * scale, point.y * scale)
}
