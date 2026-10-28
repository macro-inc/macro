//! Laying paint on pixels: a straight color at a strength over straight
//! RGBA (Normal mode), alpha-locked recoloring, erasing, and one-channel
//! values. Colors are on the `0..=255` scale; strengths are `0..=1`.

/// Rec. 601 luma: the gray a color paints into a one-channel raster.
pub(crate) fn luma(rgb: [f32; 3]) -> f32 {
    0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
}

/// Rounds to a sample, clamping (NaN becomes 0).
pub(crate) fn quantize(v: f32) -> u8 {
    (v + 0.5).clamp(0.0, 255.0) as u8
}

/// `color` over `base` with strength `k` (Normal mode, straight alpha).
pub(crate) fn over(base: [u8; 4], color: [f32; 3], k: f32) -> [u8; 4] {
    if k.is_nan() || k <= 0.0 {
        return base;
    }
    let k = k.min(1.0);
    let a = f32::from(base[3]);
    let alpha = a + (255.0 - a) * k;
    let (wb, wc) = (a * (1.0 - k) / alpha, 255.0 * k / alpha);
    let mix = |b: u8, c: f32| quantize(f32::from(b) * wb + c * wc);
    [
        mix(base[0], color[0]),
        mix(base[1], color[1]),
        mix(base[2], color[2]),
        quantize(alpha),
    ]
}

/// Moves `base`'s color toward `color` by `k`, keeping its alpha (fully
/// transparent pixels stay as they are).
pub(crate) fn recolor(base: [u8; 4], color: [f32; 3], k: f32) -> [u8; 4] {
    if k.is_nan() || k <= 0.0 || base[3] == 0 {
        return base;
    }
    let k = k.min(1.0);
    let mix = |b: u8, c: f32| quantize(f32::from(b) + (c - f32::from(b)) * k);
    [
        mix(base[0], color[0]),
        mix(base[1], color[1]),
        mix(base[2], color[2]),
        base[3],
    ]
}

/// Removes `k` of `base`'s alpha (a pixel left fully transparent is zeroed).
pub(crate) fn erase(base: [u8; 4], k: f32) -> [u8; 4] {
    if k.is_nan() || k <= 0.0 {
        return base;
    }
    let alpha = quantize(f32::from(base[3]) * (1.0 - k.min(1.0)));
    if alpha == 0 {
        return [0; 4];
    }
    [base[0], base[1], base[2], alpha]
}

/// Moves a one-channel value toward `value` by `k`.
pub(crate) fn mix_gray(base: u8, value: f32, k: f32) -> u8 {
    if k.is_nan() || k <= 0.0 {
        return base;
    }
    let b = f32::from(base);
    quantize(b + (value - b) * k.min(1.0))
}

/// How a stroke lays paint on a pixel.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Ink {
    /// Straight color.
    pub color: [f32; 3],
    /// Removes pixels instead (on one channel: paints black).
    pub erase: bool,
    /// Keeps alpha: color changes, transparent pixels stay transparent.
    pub lock_alpha: bool,
}

impl Ink {
    /// An RGBA pixel painted with strength `k`. Erasing where alpha is
    /// locked paints the color instead, as Photoshop's eraser paints the
    /// background color there.
    pub fn rgba(&self, base: [u8; 4], k: f32) -> [u8; 4] {
        if self.lock_alpha {
            recolor(base, self.color, k)
        } else if self.erase {
            erase(base, k)
        } else {
            over(base, self.color, k)
        }
    }

    /// A one-channel pixel painted with strength `k`.
    pub fn gray(&self, base: u8, k: f32) -> u8 {
        let value = if self.erase { 0.0 } else { luma(self.color) };
        mix_gray(base, value, k)
    }
}
