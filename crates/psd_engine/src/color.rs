//! Converting a file's samples (any color mode and depth) to the engine's
//! 8-bit straight RGBA, and RGBA back to an RGB or grayscale file's samples.
//!
//! CMYK samples are stored inverted (255 is no ink); Lab is converted
//! through D50 XYZ to sRGB; 16-bit samples span `0..=65535`; 32-bit samples
//! are linear floats, encoded with the sRGB curve; bitmap samples are
//! packed bits with 1 for black; indexed samples look up the palette (the
//! color mode data: 256 reds, then greens, then blues).

use crate::model::ColorMode;

/// Straight RGBA8 for `width × height` pixels: `color` holds the mode's
/// color channels in file order (raw samples at `depth`), `alpha` the
/// transparency channel (opaque when absent), `palette` an indexed file's
/// color mode data.
pub fn to_rgba(
    mode: ColorMode,
    depth: u16,
    width: u32,
    height: u32,
    color: &[&[u8]],
    alpha: Option<&[u8]>,
    palette: &[u8],
) -> Vec<u8> {
    let _ = (mode, depth, width, height, color, alpha, palette);
    todo!("color::to_rgba")
}

/// 8-bit samples of one channel stored at `depth` (masks, alpha channels).
pub fn to_gray(depth: u16, width: u32, height: u32, samples: &[u8]) -> Vec<u8> {
    let _ = (depth, width, height, samples);
    todo!("color::to_gray")
}

/// An RGB or grayscale file's samples at `depth` for RGBA8 pixels: the
/// mode's color channels, then transparency.
pub fn from_rgba(
    mode: ColorMode,
    depth: u16,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Vec<Vec<u8>> {
    let _ = (mode, depth, width, height, rgba);
    todo!("color::from_rgba")
}

/// Samples at `depth` for 8-bit gray samples.
pub fn from_gray(depth: u16, width: u32, height: u32, gray: &[u8]) -> Vec<u8> {
    let _ = (depth, width, height, gray);
    todo!("color::from_gray")
}
