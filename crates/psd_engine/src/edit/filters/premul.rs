//! Pixels as filters and resamplers work on them: RGBA premultiplied, or
//! one gray value, as floats on the `0..=255` scale, so averaging pixels
//! never lets transparent ones darken their neighbors.

use crate::edit::paint::tiles::rewrite;
use crate::raster::{IRect, Raster, Selection};

/// Rounds and clamps to a sample.
#[inline]
pub(crate) fn quantize(v: f32) -> u8 {
    (v + 0.5).clamp(0.0, 255.0) as u8
}

/// A pixel's samples (`C` of them: 4 or 1) as filter values.
#[inline]
pub(crate) fn load<const C: usize>(px: &[u8]) -> [f32; C] {
    let mut out = [0.0f32; C];
    let o: &mut [f32] = &mut out;
    if o.len() == 4 {
        let a = f32::from(px[3]);
        let k = a / 255.0;
        o[0] = f32::from(px[0]) * k;
        o[1] = f32::from(px[1]) * k;
        o[2] = f32::from(px[2]) * k;
        o[3] = a;
    } else {
        o[0] = f32::from(px[0]);
    }
    out
}

/// Filter values back to samples: colors unpremultiplied by the alpha as
/// it came out (so a filter's overshoot in alpha does not shift hues), then
/// everything clamped (a pixel left transparent is zeroed).
#[inline]
pub(crate) fn store<const C: usize>(v: [f32; C], px: &mut [u8]) {
    let v: &[f32] = &v;
    if v.len() == 4 {
        let alpha = quantize(v[3]);
        if alpha == 0 {
            px[..4].fill(0);
            return;
        }
        let k = 255.0 / v[3];
        for (p, &c) in px.iter_mut().zip(&v[..3]) {
            *p = quantize(c * k);
        }
        px[3] = alpha;
    } else {
        px[0] = quantize(v[0]);
    }
}

/// `acc += v · w`.
#[inline]
pub(crate) fn add_scaled<const C: usize>(acc: &mut [f32; C], v: &[f32; C], w: f32) {
    *acc = std::array::from_fn(|i| acc[i] + v[i] * w);
}

/// `acc += src · w`, value by value (over `acc`'s length; flat, so it
/// vectorizes).
#[inline]
pub(crate) fn add_rows<const C: usize>(acc: &mut [[f32; C]], src: &[[f32; C]], w: f32) {
    let acc = acc.as_flattened_mut();
    let src = &src.as_flattened()[..acc.len()];
    for (a, &s) in acc.iter_mut().zip(src) {
        *a += s * w;
    }
}

/// `area` within the selection's bounds, unless empty.
pub(crate) fn limit(area: IRect, selection: Option<&Selection>) -> Option<IRect> {
    let area = match selection {
        Some(s) => area.intersect(&s.mask.bounds()?),
        None => area,
    };
    (!area.is_empty()).then_some(area)
}

/// Filters `rect` of `target` pixel by pixel: `value(x, y, samples)` gives
/// a pixel's new filter value (`None` leaves it), which replaces the pixel
/// where the selection is full and mixes with it where partial. Missing
/// tiles are passed over when `skip_missing`. Returns the area that
/// changed.
pub(crate) fn apply<const C: usize>(
    target: &mut Raster,
    selection: Option<&Selection>,
    rect: IRect,
    skip_missing: bool,
    mut value: impl FnMut(i32, i32, &[u8]) -> Option<[f32; C]>,
) -> Option<IRect> {
    if target.channels() as usize != C {
        return None;
    }
    let mut sel = Vec::new();
    rewrite(target, rect, skip_missing, |part, samples| {
        let w = part.w as usize;
        if let Some(s) = selection {
            sel.resize(w * part.h as usize, 0);
            s.mask.read(part, &mut sel);
        }
        for (y, row) in samples.chunks_exact_mut(w * C).enumerate() {
            for (x, px) in row.chunks_exact_mut(C).enumerate() {
                let s = if selection.is_some() {
                    sel[y * w + x]
                } else {
                    255
                };
                if s == 0 {
                    continue;
                }
                let Some(v) = value(part.x + x as i32, part.y + y as i32, px) else {
                    continue;
                };
                if s == 255 {
                    store(v, px);
                } else {
                    let k = f32::from(s) / 255.0;
                    let mut mixed = load::<C>(px);
                    for (m, &n) in mixed.iter_mut().zip(&v) {
                        *m += (n - *m) * k;
                    }
                    store(mixed, px);
                }
            }
        }
    })
}

/// Writes a block of filter values (`values` holds `rect`'s pixels row by
/// row) with [`apply`], leaving the pixels `keep` names.
pub(crate) fn write_block<const C: usize>(
    target: &mut Raster,
    selection: Option<&Selection>,
    rect: IRect,
    values: &[[f32; C]],
    keep: impl Fn(&[u8]) -> bool,
) -> Option<IRect> {
    let w = rect.w as usize;
    apply(target, selection, rect, false, |x, y, px| {
        if keep(px) {
            return None;
        }
        Some(values[(y - rect.y) as usize * w + (x - rect.x) as usize])
    })
}

/// The union of two optional areas.
pub(crate) fn union(a: Option<IRect>, b: Option<IRect>) -> Option<IRect> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.union(&b)),
        (a, b) => a.or(b),
    }
}
