//! Shadings (smooth gradients): function-based, axial, radial, and the
//! meshes (free-form and lattice triangles, Coons and tensor patches),
//! drawn into device pixels.

use crate::color::ColorSpace;
use crate::error::Result;
use crate::pdf::{Dict, Object, Resolve};

/// A shading.
#[derive(Clone, Debug, PartialEq)]
pub struct Shading {
    /// The color space of its colors.
    pub color_space: ColorSpace,
    /// Painted outside the shape when the shading paints the whole clip
    /// (`sh`): `Background`, as sRGB.
    pub background: Option<[f32; 3]>,
    /// `BBox`, in shading space.
    pub bbox: Option<[f32; 4]>,
}

impl Shading {
    /// Reads a shading dictionary or stream.
    pub fn parse(pdf: &dyn Resolve, value: &Object, resources: &Dict) -> Result<Shading> {
        let _ = (pdf, value, resources);
        todo!("Shading::parse")
    }

    /// Paints the shading into `pixmap`: `transform` maps shading space to
    /// device pixels; only where `clip` covers when given; `alpha`
    /// multiplies its opacity. `sh` paints its whole extent; patterns pass
    /// the filled shape as the clip.
    pub fn paint(
        &self,
        pixmap: &mut tiny_skia::PixmapMut<'_>,
        transform: tiny_skia::Transform,
        clip: Option<&tiny_skia::Mask>,
        alpha: f32,
    ) {
        let _ = (pixmap, transform, clip, alpha);
        todo!("Shading::paint")
    }

    /// Axial and radial shadings: colors along the gradient (`t` in
    /// `0..=1` from the start), sampled finely enough to redraw it as a
    /// gradient elsewhere (SVG, editing); `None` for other types.
    pub fn stops(&self) -> Option<Vec<(f32, [f32; 3])>> {
        todo!("Shading::stops")
    }

    /// Axial: start and end points; radial: start center and radius, end
    /// center and radius. `None` for other types.
    pub fn geometry(&self) -> Option<ShadingGeometry> {
        todo!("Shading::geometry")
    }
}

/// Where an axial or radial shading runs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ShadingGeometry {
    /// From `(x0, y0)` to `(x1, y1)`, extended past either end when set.
    Axial {
        /// Coordinates `[x0, y0, x1, y1]`.
        coords: [f32; 4],
        /// Extend before the start, after the end.
        extend: [bool; 2],
    },
    /// Between two circles.
    Radial {
        /// Coordinates `[x0, y0, r0, x1, y1, r1]`.
        coords: [f32; 6],
        /// Extend before the start, after the end.
        extend: [bool; 2],
    },
}
