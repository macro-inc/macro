//! The legacy layer style block (`lrFX`, Photoshop 5–6), read when a layer
//! has no descriptor-based one: a version, a count, then effects each
//! introduced by `8BIM`, a key, and a length.
//!
//! Sizes and bevel angles are 16.16 fixed point; shadow angles and
//! distances are whole numbers; opacities run `0..=255`; colors are the
//! binary color structure; blend modes are layer blend keys.

use crate::binary::Reader;
use crate::codec::paint::color;
use crate::error::{PsdError, Result};
use crate::model::{
    Bevel, BevelStyle, BevelTechnique, BlendMode, Contour, Effects, Fill, Glow, GlowSource,
    GlowTechnique, Overlay, Shadow,
};

fn blend(r: &mut Reader<'_>) -> Result<BlendMode> {
    r.sig()?;
    Ok(BlendMode::from_key(&r.sig()?).unwrap_or_default())
}

fn opacity(r: &mut Reader<'_>) -> Result<f32> {
    Ok(f32::from(r.u8()?) / 255.0)
}

fn fixed(r: &mut Reader<'_>) -> Result<f32> {
    Ok(r.fixed()? as f32)
}

/// Reads an `lrFX` block.
pub(super) fn decode(data: &[u8]) -> Result<Effects> {
    let mut r = Reader::new(data);
    let version = r.u16()?;
    if version != 0 {
        return Err(PsdError::Unsupported(format!(
            "legacy effects version {version}"
        )));
    }
    let count = r.u16()?;
    let mut effects = Effects::default();
    for _ in 0..count {
        if r.remaining() < 12 {
            break;
        }
        r.sig()?;
        let key = r.sig()?;
        let size = r.u32()? as usize;
        let mut e = r.take(size.min(r.remaining()))?;
        match &key {
            b"cmnS" => {
                e.u32()?;
                effects.enabled = e.u8()? != 0;
            }
            b"dsdw" | b"isdw" => {
                e.u32()?;
                let size = fixed(&mut e)?;
                e.u32()?; // intensity
                let angle = e.i32()? as f32;
                let distance = e.i32()? as f32;
                let color = color::read_binary(&mut e)?;
                let blend = blend(&mut e)?;
                let enabled = e.u8()? != 0;
                let use_global_light = e.u8()? != 0;
                let opacity = opacity(&mut e)?;
                let shadow = Shadow {
                    enabled,
                    blend,
                    color,
                    opacity,
                    angle,
                    use_global_light,
                    distance,
                    spread: 0.0,
                    size,
                    noise: 0.0,
                    contour: Contour::default(),
                    knocks_out: key == *b"dsdw",
                };
                if key == *b"dsdw" {
                    effects.drop_shadows.push(shadow);
                } else {
                    effects.inner_shadows.push(shadow);
                }
            }
            b"oglw" | b"iglw" => {
                e.u32()?;
                let size = fixed(&mut e)?;
                e.u32()?; // intensity
                let color = color::read_binary(&mut e)?;
                let blend = blend(&mut e)?;
                let enabled = e.u8()? != 0;
                let opacity = opacity(&mut e)?;
                let glow = Glow {
                    enabled,
                    blend,
                    color,
                    gradient: None,
                    opacity,
                    noise: 0.0,
                    technique: GlowTechnique::Softer,
                    spread: 0.0,
                    size,
                    contour: Contour::default(),
                    range: 0.5,
                    jitter: 0.0,
                    source: GlowSource::Edge,
                };
                if key == *b"oglw" {
                    effects.outer_glows.push(glow);
                } else {
                    effects.inner_glows.push(glow);
                }
            }
            b"bevl" => {
                e.u32()?;
                let angle = fixed(&mut e)?;
                fixed(&mut e)?; // strength, in pixels: no counterpart in depth
                let size = fixed(&mut e)?;
                let highlight_blend = blend(&mut e)?;
                let shadow_blend = blend(&mut e)?;
                let highlight_color = color::read_binary(&mut e)?;
                let shadow_color = color::read_binary(&mut e)?;
                let style = match e.u8()? {
                    1 => BevelStyle::OuterBevel,
                    3 => BevelStyle::Emboss,
                    4 => BevelStyle::PillowEmboss,
                    5 => BevelStyle::StrokeEmboss,
                    _ => BevelStyle::InnerBevel,
                };
                let highlight_opacity = opacity(&mut e)?;
                let shadow_opacity = opacity(&mut e)?;
                let enabled = e.u8()? != 0;
                let use_global_light = e.u8()? != 0;
                let up = e.u8()? == 0;
                effects.bevels.push(Bevel {
                    enabled,
                    style,
                    technique: BevelTechnique::Smooth,
                    depth: 1.0,
                    up,
                    size,
                    soften: 0.0,
                    angle,
                    altitude: 30.0,
                    use_global_light,
                    highlight_blend,
                    highlight_color,
                    highlight_opacity,
                    shadow_blend,
                    shadow_color,
                    shadow_opacity,
                    gloss: Contour::default(),
                    contour: None,
                });
            }
            b"sofi" => {
                e.u32()?;
                let blend = blend(&mut e)?;
                let color = color::read_binary(&mut e)?;
                let opacity = opacity(&mut e)?;
                let enabled = e.u8()? != 0;
                effects.color_overlays.push(Overlay {
                    enabled,
                    blend,
                    opacity,
                    fill: Fill::Solid { color },
                });
            }
            _ => {}
        }
    }
    Ok(effects)
}
