//! Blend mode arithmetic: every Photoshop mode on straight colors in
//! `0..=1`, and compositing a source pixel over a backdrop with a mode.

use crate::model::BlendMode;

/// The blended color of a source over a backdrop (both straight RGB in
/// `0..=1`) before alpha compositing: Photoshop's `B(Cb, Cs)`.
pub fn blend(mode: BlendMode, backdrop: [f32; 3], source: [f32; 3]) -> [f32; 3] {
    let _ = (mode, backdrop, source);
    todo!("blend::blend")
}

/// Composites a straight RGBA source (with `opacity` applied to its alpha)
/// over a straight RGBA backdrop with a blend mode; returns straight RGBA.
pub fn composite(mode: BlendMode, backdrop: [f32; 4], source: [f32; 4], opacity: f32) -> [f32; 4] {
    let _ = (mode, backdrop, source, opacity);
    todo!("blend::composite")
}
