//! Shadings (smooth gradients): function-based, axial, radial, and the
//! meshes (free-form and lattice triangles, Coons and tensor patches),
//! drawn into device pixels.
//!
//! Axial and radial shadings are drawn by mapping each pixel back into
//! shading space through a color table over `t`; function-based ones by
//! interpolating colors evaluated on a grid; meshes by cutting patches
//! into triangles and filling those with colors interpolated in the color
//! space (or `t`, through the function). `AntiAlias` is ignored.

mod mesh;
mod paint;
mod raster;

use crate::color::ColorSpace;
use crate::error::{AiError, Result};
use crate::function::Function;
use crate::function::read::{dict_int, dict_numbers, get};
use crate::pdf::{Dict, Object, Resolve};

/// A shading.
#[derive(Clone, Debug, PartialEq)]
pub struct Shading {
    /// The color space of its colors.
    pub color_space: ColorSpace,
    /// `Background`, as sRGB: shading patterns fill the painted shape with
    /// it before drawing the shading; `sh` ignores it, and
    /// [`Shading::paint`] never draws it.
    pub background: Option<[f32; 3]>,
    /// `BBox`, in shading space (`[x0 y0 x1 y1]`, normalized): nothing is
    /// drawn outside it.
    pub bbox: Option<[f32; 4]>,
    kind: Kind,
}

#[derive(Clone, Debug, PartialEq)]
enum Kind {
    /// Type 1: colors from a function of `(x, y)` over `domain`
    /// (`[x0 x1 y0 y1]`), mapped into shading space by `matrix`.
    Function {
        domain: [f32; 4],
        matrix: [f32; 6],
        function: Function,
    },
    /// Type 2.
    Axial {
        coords: [f32; 4],
        domain: [f32; 2],
        function: Function,
        extend: [bool; 2],
    },
    /// Type 3.
    Radial {
        coords: [f32; 6],
        domain: [f32; 2],
        function: Function,
        extend: [bool; 2],
    },
    /// Types 4 to 7.
    Mesh(mesh::Mesh),
}

fn corrupt(what: &str) -> AiError {
    AiError::corrupt(format!("shading: {what}"))
}

/// A fixed-length number array.
fn fixed<const N: usize>(values: Option<Vec<f32>>) -> Option<[f32; N]> {
    values.and_then(|v| v.get(..N).and_then(|v| v.try_into().ok()))
}

impl Shading {
    /// Reads a shading dictionary or stream.
    pub fn parse(pdf: &dyn Resolve, value: &Object, resources: &Dict) -> Result<Shading> {
        let value = pdf.resolve(value);
        let dict = value.as_dict().ok_or_else(|| corrupt("not a dictionary"))?;
        let shading_type =
            dict_int(pdf, dict, "ShadingType").ok_or_else(|| corrupt("no ShadingType"))?;
        let color_space = ColorSpace::parse(pdf, &get(pdf, dict, "ColorSpace"), resources)?;
        if matches!(color_space, ColorSpace::Pattern(_)) {
            return Err(corrupt("a shading cannot be in a pattern space"));
        }
        let function = match dict.get("Function") {
            Some(f) => Some(Function::parse(pdf, f)?),
            None => None,
        };
        let n = color_space.components();
        let background = dict_numbers(pdf, dict, "Background")
            .filter(|b| b.len() == n)
            .map(|b| color_space.to_rgb(&b));
        let bbox = fixed::<4>(dict_numbers(pdf, dict, "BBox"))
            .map(|[x0, y0, x1, y1]| [x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)]);
        let extend = || {
            let e = get(pdf, dict, "Extend");
            let e = e.as_array().unwrap_or(&[]);
            let flag = |i: usize| e.get(i).and_then(|o| pdf.resolve(o).as_bool()) == Some(true);
            [flag(0), flag(1)]
        };
        let domain = || fixed::<2>(dict_numbers(pdf, dict, "Domain")).unwrap_or([0.0, 1.0]);
        let need_function = || function.clone().ok_or_else(|| corrupt("no Function"));
        let kind = match shading_type {
            1 => Kind::Function {
                domain: fixed::<4>(dict_numbers(pdf, dict, "Domain"))
                    .unwrap_or([0.0, 1.0, 0.0, 1.0]),
                matrix: fixed::<6>(dict_numbers(pdf, dict, "Matrix"))
                    .unwrap_or([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]),
                function: need_function()?,
            },
            2 => Kind::Axial {
                coords: fixed::<4>(dict_numbers(pdf, dict, "Coords"))
                    .ok_or_else(|| corrupt("axial without Coords"))?,
                domain: domain(),
                function: need_function()?,
                extend: extend(),
            },
            3 => {
                let coords = fixed::<6>(dict_numbers(pdf, dict, "Coords"))
                    .filter(|c| c[2] >= 0.0 && c[5] >= 0.0)
                    .ok_or_else(|| corrupt("radial without Coords"))?;
                Kind::Radial {
                    coords,
                    domain: domain(),
                    function: need_function()?,
                    extend: extend(),
                }
            }
            4..=7 => {
                let stream = value
                    .as_stream()
                    .ok_or_else(|| corrupt("mesh shading is not a stream"))?;
                Kind::Mesh(mesh::Mesh::parse(
                    pdf,
                    stream,
                    shading_type as u8,
                    n,
                    function,
                )?)
            }
            _ => return Err(corrupt("unknown ShadingType")),
        };
        Ok(Shading {
            color_space,
            background,
            bbox,
            kind,
        })
    }

    /// `ShadingType`: 1 function-based, 2 axial, 3 radial, 4 free-form
    /// triangles, 5 lattice triangles, 6 Coons patches, 7 tensor patches.
    pub fn shading_type(&self) -> u8 {
        match &self.kind {
            Kind::Function { .. } => 1,
            Kind::Axial { .. } => 2,
            Kind::Radial { .. } => 3,
            Kind::Mesh(m) => m.shading_type,
        }
    }

    /// Paints the shading into `pixmap`: `transform` maps shading space to
    /// device pixels; only where `clip` covers when given; `alpha`
    /// multiplies its opacity. `sh` paints its whole extent; patterns pass
    /// the filled shape as the clip.
    ///
    /// Colors are blended source-over (the caller paints into a scratch
    /// pixmap for other blend modes). Nothing is drawn in an invisible
    /// color space (a `None` separation).
    pub fn paint(
        &self,
        pixmap: &mut tiny_skia::PixmapMut<'_>,
        transform: tiny_skia::Transform,
        clip: Option<&tiny_skia::Mask>,
        alpha: f32,
    ) {
        if self.color_space.is_invisible() || alpha.is_nan() || alpha <= 0.0 {
            return;
        }
        let (width, height) = (pixmap.width(), pixmap.height());
        let mut target = paint::Target::new(pixmap.data_mut(), width, height, clip, alpha);
        let Some(to_device) = paint::Affine::from_transform(transform) else {
            return;
        };
        match &self.kind {
            Kind::Axial {
                coords,
                domain,
                function,
                extend,
            } => paint::axial(
                self,
                &mut target,
                to_device,
                *coords,
                *domain,
                function,
                *extend,
            ),
            Kind::Radial {
                coords,
                domain,
                function,
                extend,
            } => paint::radial(
                self,
                &mut target,
                to_device,
                *coords,
                *domain,
                function,
                *extend,
            ),
            Kind::Function {
                domain,
                matrix,
                function,
            } => paint::function_based(self, &mut target, to_device, *domain, *matrix, function),
            Kind::Mesh(mesh) => raster::mesh(self, mesh, &mut target, to_device),
        }
    }

    /// Axial and radial shadings: colors along the gradient (`t` in
    /// `0..=1` from the start), sampled finely enough to redraw it as a
    /// gradient elsewhere (SVG, editing); `None` for other types.
    ///
    /// Stops lie where the colors bend away from a straight line between
    /// their neighbors (within half a level of 8-bit color), and in pairs
    /// at the same `t` where a stitching function jumps.
    pub fn stops(&self) -> Option<Vec<(f32, [f32; 3])>> {
        let (domain, function) = match &self.kind {
            Kind::Axial {
                domain, function, ..
            }
            | Kind::Radial {
                domain, function, ..
            } => (*domain, function),
            _ => return None,
        };
        Some(paint::stops(&self.color_space, function, domain))
    }

    /// Axial: start and end points; radial: start center and radius, end
    /// center and radius. `None` for other types.
    pub fn geometry(&self) -> Option<ShadingGeometry> {
        match &self.kind {
            Kind::Axial { coords, extend, .. } => Some(ShadingGeometry::Axial {
                coords: *coords,
                extend: *extend,
            }),
            Kind::Radial { coords, extend, .. } => Some(ShadingGeometry::Radial {
                coords: *coords,
                extend: *extend,
            }),
            _ => None,
        }
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

#[cfg(test)]
mod test;
