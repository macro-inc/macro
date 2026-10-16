//! Predictors (ISO 32000-1 §7.4.4.4): PNG (10–15, a filter type byte
//! before each row) and TIFF 2 (horizontal differencing), by `Colors`,
//! `BitsPerComponent`, and `Columns`.

use crate::pdf::Dict;

/// Undoes the predictor `params` name, if any.
pub(super) fn undo(data: Vec<u8>, params: Option<&Dict>) -> Vec<u8> {
    let Some(p) = params else {
        return data;
    };
    let predictor = p.i64("Predictor").unwrap_or(1);
    if predictor != 2 && predictor < 10 {
        return data;
    }
    let colors = p.i64("Colors").unwrap_or(1).clamp(1, 32) as usize;
    let bpc = match p.i64("BitsPerComponent").unwrap_or(8) {
        v @ (1 | 2 | 4 | 8 | 16) => v as usize,
        _ => 8,
    };
    // Columns past the data only make one partial row.
    let columns = usize::try_from(p.i64("Columns").unwrap_or(1))
        .unwrap_or(1)
        .clamp(1, data.len().saturating_mul(8).max(1));
    let row = (colors * bpc).saturating_mul(columns).div_ceil(8);
    if predictor == 2 {
        tiff(data, colors, bpc, columns, row)
    } else {
        png(&data, (colors * bpc).div_ceil(8), row)
    }
}

/// PNG rows: a filter type byte, then `row` bytes.
fn png(data: &[u8], bpp: usize, row: usize) -> Vec<u8> {
    let row = row.min(data.len()).max(1);
    let mut out = Vec::with_capacity(data.len());
    let mut prev = vec![0u8; row];
    let mut cur = vec![0u8; row];
    for chunk in data.chunks(row + 1) {
        let Some((&kind, src)) = chunk.split_first() else {
            continue;
        };
        let n = src.len();
        let cur = &mut cur[..n];
        match kind {
            1 => {
                for i in 0..n {
                    let a = if i >= bpp { cur[i - bpp] } else { 0 };
                    cur[i] = src[i].wrapping_add(a);
                }
            }
            2 => {
                for i in 0..n {
                    cur[i] = src[i].wrapping_add(prev[i]);
                }
            }
            3 => {
                for i in 0..n {
                    let a = if i >= bpp { cur[i - bpp] } else { 0 };
                    let avg = (u16::from(a) + u16::from(prev[i])) / 2;
                    cur[i] = src[i].wrapping_add(avg as u8);
                }
            }
            4 => {
                for i in 0..n {
                    let (a, c) = if i >= bpp {
                        (cur[i - bpp], prev[i - bpp])
                    } else {
                        (0, 0)
                    };
                    cur[i] = src[i].wrapping_add(paeth(a, prev[i], c));
                }
            }
            _ => cur.copy_from_slice(src),
        }
        out.extend_from_slice(cur);
        prev[..n].copy_from_slice(cur);
    }
    out
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let p = i16::from(a) + i16::from(b) - i16::from(c);
    let pa = (p - i16::from(a)).abs();
    let pb = (p - i16::from(b)).abs();
    let pc = (p - i16::from(c)).abs();
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

/// TIFF predictor 2: each sample is stored as the difference from the
/// same component of the sample before it in the row.
fn tiff(mut data: Vec<u8>, colors: usize, bpc: usize, columns: usize, row: usize) -> Vec<u8> {
    let row = row.max(1);
    for r in data.chunks_mut(row) {
        match bpc {
            8 => {
                for i in colors..r.len() {
                    r[i] = r[i].wrapping_add(r[i - colors]);
                }
            }
            16 => {
                for s in colors..r.len() / 2 {
                    let left = u16::from_be_bytes([r[2 * (s - colors)], r[2 * (s - colors) + 1]]);
                    let v = u16::from_be_bytes([r[2 * s], r[2 * s + 1]]).wrapping_add(left);
                    r[2 * s..2 * s + 2].copy_from_slice(&v.to_be_bytes());
                }
            }
            _ => {
                let samples = colors
                    .saturating_mul(columns)
                    .min(r.len().saturating_mul(8) / bpc);
                for s in colors..samples {
                    let v = sample(r, s, bpc).wrapping_add(sample(r, s - colors, bpc));
                    set_sample(r, s, bpc, v);
                }
            }
        }
    }
    data
}

/// Sample `s` of `bpc` (1, 2, or 4) bits.
fn sample(row: &[u8], s: usize, bpc: usize) -> u8 {
    let bit = s * bpc;
    let shift = 8 - bpc - bit % 8;
    (row[bit / 8] >> shift) & ((1 << bpc) - 1)
}

fn set_sample(row: &mut [u8], s: usize, bpc: usize, v: u8) {
    let bit = s * bpc;
    let shift = 8 - bpc - bit % 8;
    let mask = ((1u8 << bpc) - 1) << shift;
    row[bit / 8] = (row[bit / 8] & !mask) | ((v << shift) & mask);
}
