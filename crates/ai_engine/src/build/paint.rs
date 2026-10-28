//! Colors, gradients, and strokes from the graphics state.

use crate::color::ColorSpace;
use crate::geom::{Affine, Point};
use crate::interp::{ColorState, GState};
use crate::model::{Color, Gradient, GradientStop, Paint, Stroke};
use crate::pdf::{Dict, Object, Resolve};
use crate::shading::{Shading, ShadingGeometry};

/// Largest color difference (per channel, `0..=1`) a gradient stop may be
/// dropped for.
const STOP_TOLERANCE: f32 = 1.0 / 128.0;

/// A color as the model keeps it.
pub fn color(cs: &ColorState) -> Color {
    let c = |i: usize| cs.comps.get(i).copied().unwrap_or(0.0).clamp(0.0, 1.0);
    match &cs.space {
        ColorSpace::Gray => Color::Gray { g: c(0) },
        ColorSpace::Rgb => Color::Rgb {
            r: c(0),
            g: c(1),
            b: c(2),
        },
        ColorSpace::Cmyk => Color::Cmyk {
            c: c(0),
            m: c(1),
            y: c(2),
            k: c(3),
        },
        ColorSpace::Icc { n: 1, .. } => Color::Gray { g: c(0) },
        ColorSpace::Icc { n: 4, .. } => Color::Cmyk {
            c: c(0),
            m: c(1),
            y: c(2),
            k: c(3),
        },
        ColorSpace::Separation { name, .. } if name != "All" && name != "None" => Color::Spot {
            name: name.clone(),
            tint: c(0),
            rgb: cs.rgb(),
        },
        _ => {
            let [r, g, b] = cs.rgb();
            Color::Rgb { r, g, b }
        }
    }
}

/// What a color state paints, or `None` when the model has no equivalent
/// (tiling patterns, mesh shadings).
pub fn paint(pdf: &dyn Resolve, cs: &ColorState, gs: &GState, resources: &Dict) -> Option<Paint> {
    if !matches!(cs.space, ColorSpace::Pattern(_)) {
        return Some(Paint::Solid { color: color(cs) });
    }
    let pattern = cs.pattern.as_ref()?;
    let d = pattern.as_dict()?;
    if d.i64("PatternType") != Some(2) {
        return None;
    }
    if d.contains("ExtGState") {
        return None;
    }
    let shading = Shading::parse(pdf, d.get("Shading")?, resources).ok()?;
    let geometry = shading.geometry()?;
    let samples = shading.stops()?;
    let matrix = d
        .get("Matrix")
        .map(|v| pdf.resolve(v))
        .and_then(|v| v.as_numbers())
        .and_then(|m| Affine::from_slice(&m))
        .unwrap_or(Affine::IDENTITY);
    // Pattern space to the content's base space to page space, then back
    // to user space.
    let transform = matrix.followed_by(&gs.base).followed_by(&gs.ctm.invert()?);
    let stops = simplify(&samples)
        .into_iter()
        .map(|(offset, [r, g, b])| GradientStop {
            offset,
            color: Color::Rgb { r, g, b },
            opacity: 1.0,
        })
        .collect();
    let gradient = match geometry {
        ShadingGeometry::Axial { coords, extend } => Gradient {
            transform,
            radial: false,
            start: Point::new(f64::from(coords[0]), f64::from(coords[1])),
            end: Point::new(f64::from(coords[2]), f64::from(coords[3])),
            start_radius: 0.0,
            end_radius: 0.0,
            stops,
            extend,
        },
        ShadingGeometry::Radial { coords, extend } => Gradient {
            transform,
            radial: true,
            start: Point::new(f64::from(coords[0]), f64::from(coords[1])),
            end: Point::new(f64::from(coords[3]), f64::from(coords[4])),
            start_radius: f64::from(coords[2]),
            end_radius: f64::from(coords[5]),
            stops,
            extend,
        },
    };
    Some(Paint::Gradient { gradient })
}

/// The stroke a graphics state paints, or `None` when its paint has no
/// equivalent in the model.
pub fn stroke(pdf: &dyn Resolve, gs: &GState, resources: &Dict) -> Option<Stroke> {
    Some(Stroke {
        paint: paint(pdf, &gs.stroke, gs, resources)?,
        width: gs.line_width,
        cap: gs.cap,
        join: gs.join,
        miter_limit: gs.miter,
        dash: gs.dash.clone(),
        dash_offset: gs.dash_offset,
    })
}

/// Gradient samples with the stops that linear interpolation between their
/// neighbors reproduces dropped.
pub fn simplify(samples: &[(f32, [f32; 3])]) -> Vec<(f32, [f32; 3])> {
    if samples.len() <= 2 {
        return samples.to_vec();
    }
    let mut out = vec![samples[0]];
    let mut anchor = 0;
    let mut end = 1;
    while end < samples.len() - 1 {
        let next = end + 1;
        let (t0, c0) = samples[anchor];
        let (t1, c1) = samples[next];
        let fits = samples[anchor + 1..next].iter().all(|&(t, c)| {
            let f = if t1 > t0 { (t - t0) / (t1 - t0) } else { 0.0 };
            (0..3).all(|k| (c0[k] + (c1[k] - c0[k]) * f - c[k]).abs() <= STOP_TOLERANCE)
        });
        if !fits {
            out.push(samples[end]);
            anchor = end;
        }
        end = next;
    }
    out.push(samples[samples.len() - 1]);
    out
}

/// A shading object's dictionary (shadings are dictionaries or streams).
pub fn shading_dict(o: &Object) -> Option<&Dict> {
    o.as_dict().or_else(|| o.as_stream().map(|s| &s.dict))
}
