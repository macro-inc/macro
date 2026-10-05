//! Paints as the editor rebuilds them: an existing paint kept and adjusted,
//! or a new one, switched between solid, gradient, and image kinds as
//! Figma's paint picker does.

use super::{PaintSpec, parse_hex};
use crate::model::{
    Affine, BlendMode, Color, ColorStop, GradientKind, ImagePaint, ImageScaleMode, Paint, PaintKind,
};
use std::sync::Arc;

/// The paints `specs` describe, given the layer's current ones.
pub(super) fn paints(existing: &[Paint], specs: &[PaintSpec]) -> Arc<[Paint]> {
    specs
        .iter()
        .filter_map(|s| {
            let mut paint = match s.keep {
                Some(k) => existing.get(k)?.clone(),
                None => Paint::solid(Color::BLACK),
            };
            if let Some(kind) = &s.kind {
                paint.kind = switch_kind(&paint.kind, kind);
            }
            if let Some(c) = s.color.as_deref().and_then(parse_hex) {
                paint.kind = PaintKind::Solid(c);
            }
            if let Some(stops) = &s.stops
                && let PaintKind::Gradient { stops: current, .. } = &mut paint.kind
            {
                let mut next: Vec<ColorStop> = stops
                    .iter()
                    .filter_map(|st| {
                        Some(ColorStop {
                            color: parse_hex(&st.color)?,
                            position: st.position.clamp(0.0, 1.0),
                        })
                    })
                    .collect();
                next.sort_by(|a, b| a.position.total_cmp(&b.position));
                // A gradient keeps at least one stop.
                if !next.is_empty() {
                    *current = next.into();
                }
            }
            if let Some(hash) = &s.image {
                paint.kind = PaintKind::Image(ImagePaint {
                    hash: Some(hash.to_ascii_lowercase().into()),
                    scale_mode: ImageScaleMode::Fill,
                    transform: Affine::IDENTITY,
                    scale: 1.0,
                    rotation: 0.0,
                    filters: Default::default(),
                    original_size: None,
                });
            }
            if let Some(o) = s.opacity {
                paint.opacity = o.clamp(0.0, 1.0);
            }
            if let Some(v) = s.visible {
                paint.visible = v;
            }
            if let Some(b) = &s.blend_mode {
                paint.blend_mode = BlendMode::parse(b);
            }
            Some(paint)
        })
        .collect()
}

fn gradient_kind(name: &str) -> Option<GradientKind> {
    Some(match name {
        "GRADIENT_LINEAR" => GradientKind::Linear,
        "GRADIENT_RADIAL" => GradientKind::Radial,
        "GRADIENT_ANGULAR" => GradientKind::Angular,
        "GRADIENT_DIAMOND" => GradientKind::Diamond,
        _ => return None,
    })
}

/// A paint of another kind, carrying over what it can as Figma does: a
/// gradient keeps its stops and handles across gradient kinds, a solid
/// becomes its color fading out, and a gradient becomes its first stop.
fn switch_kind(current: &PaintKind, to: &str) -> PaintKind {
    if let Some(kind) = gradient_kind(to) {
        return match current {
            PaintKind::Gradient {
                stops, transform, ..
            } => PaintKind::Gradient {
                kind,
                stops: stops.clone(),
                transform: *transform,
            },
            other => {
                let c = match other {
                    PaintKind::Solid(c) => *c,
                    _ => Color::BLACK,
                };
                PaintKind::Gradient {
                    kind,
                    stops: Arc::from([
                        ColorStop {
                            color: c,
                            position: 0.0,
                        },
                        ColorStop {
                            color: c.with_alpha(0.0),
                            position: 1.0,
                        },
                    ]),
                    transform: Affine::IDENTITY,
                }
            }
        };
    }
    match (to, current) {
        ("SOLID", PaintKind::Gradient { stops, .. }) => PaintKind::Solid(
            stops
                .first()
                .map_or(Color::BLACK, |s| s.color.with_alpha(1.0)),
        ),
        ("SOLID", PaintKind::Solid(c)) => PaintKind::Solid(*c),
        ("SOLID", _) => PaintKind::Solid(Color {
            r: 0.851,
            g: 0.851,
            b: 0.851,
            a: 1.0,
        }),
        _ => current.clone(),
    }
}

#[cfg(test)]
mod test;
