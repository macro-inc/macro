//! Deflate (zlib streams) and the prediction Photoshop applies before it:
//! differences between neighboring samples along each row, 32-bit rows
//! split into byte planes first.

use crate::error::{PsdError, Result};
use miniz_oxide::inflate::TINFLStatus;

/// Photoshop-like compression level (zlib's default).
const LEVEL: u8 = 6;

/// Inflates exactly `size` bytes (raw deflate is accepted too, as some
/// writers leave out the zlib header).
pub(super) fn inflate(data: &[u8], size: usize) -> Result<Vec<u8>> {
    let inflated = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(data, size)
        .or_else(|e| match e.status {
            TINFLStatus::HasMoreOutput => Ok(e.output),
            _ => miniz_oxide::inflate::decompress_to_vec_with_limit(data, size),
        })
        .map_err(|_| PsdError::corrupt("deflate data is damaged"))?;
    if inflated.len() != size {
        return Err(PsdError::corrupt("deflate data is cut off"));
    }
    Ok(inflated)
}

/// Deflates into a zlib stream.
pub(super) fn deflate(data: &[u8]) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec_zlib(data, LEVEL)
}

/// Undoes prediction over rows of `width` samples at `depth` bits.
pub(super) fn unpredict(data: &mut [u8], width: usize, depth: u16) {
    if width == 0 {
        return;
    }
    match depth {
        16 => {
            for row in data.chunks_exact_mut(width * 2) {
                let mut prev = 0u16;
                for s in row.chunks_exact_mut(2) {
                    prev = prev.wrapping_add(u16::from_be_bytes([s[0], s[1]]));
                    s.copy_from_slice(&prev.to_be_bytes());
                }
            }
        }
        32 => {
            let mut planes = vec![0; width * 4];
            for row in data.chunks_exact_mut(width * 4) {
                let mut prev = 0u8;
                for (p, &b) in planes.iter_mut().zip(row.iter()) {
                    prev = prev.wrapping_add(b);
                    *p = prev;
                }
                for (x, sample) in row.chunks_exact_mut(4).enumerate() {
                    for (k, b) in sample.iter_mut().enumerate() {
                        *b = planes[k * width + x];
                    }
                }
            }
        }
        _ => {
            for row in data.chunks_exact_mut(crate::channels::row_bytes(width as u32, depth)) {
                let mut prev = 0u8;
                for b in row {
                    prev = prev.wrapping_add(*b);
                    *b = prev;
                }
            }
        }
    }
}

/// Applies prediction over rows of `width` samples at `depth` bits.
pub(super) fn predict(data: &mut [u8], width: usize, depth: u16) {
    if width == 0 {
        return;
    }
    match depth {
        16 => {
            for row in data.chunks_exact_mut(width * 2) {
                let mut prev = 0u16;
                for s in row.chunks_exact_mut(2) {
                    let v = u16::from_be_bytes([s[0], s[1]]);
                    s.copy_from_slice(&v.wrapping_sub(prev).to_be_bytes());
                    prev = v;
                }
            }
        }
        32 => {
            let mut planes = vec![0; width * 4];
            for row in data.chunks_exact_mut(width * 4) {
                for (x, sample) in row.chunks_exact(4).enumerate() {
                    for (k, &b) in sample.iter().enumerate() {
                        planes[k * width + x] = b;
                    }
                }
                let mut prev = 0u8;
                for (b, &p) in row.iter_mut().zip(planes.iter()) {
                    *b = p.wrapping_sub(prev);
                    prev = p;
                }
            }
        }
        _ => {
            for row in data.chunks_exact_mut(crate::channels::row_bytes(width as u32, depth)) {
                let mut prev = 0u8;
                for b in row {
                    let v = *b;
                    *b = v.wrapping_sub(prev);
                    prev = v;
                }
            }
        }
    }
}
