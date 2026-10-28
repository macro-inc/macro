//! PackBits run-length encoding, rows counted up front.
//!
//! The encoder writes what Photoshop does: each row in 128-byte pieces,
//! runs of three or more equal bytes (or two, when no literal is pending)
//! as repeats and the rest as literals. Photoshop also breaks runs where
//! its internal tiles meet, which depends on the layer's history and is
//! not reproduced; the bytes still decode the same.

use crate::error::{PsdError, Result};

/// Bytes Photoshop encodes on their own within a row.
const PIECE: usize = 128;

/// How much PackBits can expand: two bytes repeat at most 128.
const MAX_EXPANSION: usize = 64;

/// Bytes of one row count.
fn count_size(psb: bool) -> usize {
    if psb { 4 } else { 2 }
}

/// Decodes `planes` planes of `rows` rows of `row` bytes from one table of
/// row counts followed by the rows. Damaged rows decode as far as they go,
/// the rest staying zero, as Photoshop and other readers do.
pub(super) fn decode(
    data: &[u8],
    row: usize,
    rows: usize,
    planes: usize,
    psb: bool,
) -> Result<Vec<Vec<u8>>> {
    let all_rows = rows
        .checked_mul(planes)
        .ok_or_else(|| PsdError::corrupt("too many RLE rows"))?;
    let table = all_rows
        .checked_mul(count_size(psb))
        .ok_or_else(|| PsdError::corrupt("too many RLE rows"))?;
    let (counts, mut body) = data
        .split_at_checked(table)
        .ok_or_else(|| PsdError::corrupt("RLE row counts are cut off"))?;
    let plane = row
        .checked_mul(rows)
        .ok_or_else(|| PsdError::corrupt("an RLE channel is too large"))?;
    if plane.saturating_mul(planes) / MAX_EXPANSION > body.len() + all_rows {
        return Err(PsdError::corrupt("RLE data is too short for its size"));
    }
    let mut counts = counts
        .chunks_exact(count_size(psb))
        .map(|c| c.iter().fold(0usize, |n, &b| (n << 8) | usize::from(b)));
    let mut out = Vec::with_capacity(planes);
    for _ in 0..planes {
        let mut samples = vec![0; plane];
        for dst in samples.chunks_exact_mut(row) {
            let n = counts.next().unwrap_or(0).min(body.len());
            let (src, rest) = body.split_at(n);
            unpack(src, dst);
            body = rest;
        }
        out.push(samples);
    }
    Ok(out)
}

/// Unpacks one row, stopping at the end of either side.
fn unpack(src: &[u8], dst: &mut [u8]) {
    let (mut i, mut o) = (0, 0);
    while i < src.len() && o < dst.len() {
        let header = src[i] as i8;
        i += 1;
        if header >= 0 {
            let len = header as usize + 1;
            let n = len.min(src.len() - i).min(dst.len() - o);
            dst[o..o + n].copy_from_slice(&src[i..i + n]);
            i += len;
            o += n;
        } else if header != -128 {
            let Some(&value) = src.get(i) else {
                break;
            };
            i += 1;
            let n = (1 - isize::from(header)) as usize;
            let n = n.min(dst.len() - o);
            dst[o..o + n].fill(value);
            o += n;
        }
    }
}

/// Encodes rows of `row` bytes: the table of row counts, then the rows.
/// `None` when a row does not fit its count (16-bit counts of very wide
/// rows).
pub(super) fn encode<'a>(
    rows: impl ExactSizeIterator<Item = &'a [u8]>,
    row: usize,
    psb: bool,
) -> Option<Vec<u8>> {
    let size = count_size(psb);
    let mut out = vec![0; rows.len() * size];
    out.reserve(rows.len() * (row / 2 + 2));
    for (i, src) in rows.enumerate() {
        let start = out.len();
        for piece in src.chunks(PIECE) {
            pack(piece, &mut out);
        }
        let n = out.len() - start;
        let count = &mut out[i * size..(i + 1) * size];
        if psb {
            count.copy_from_slice(&u32::try_from(n).ok()?.to_be_bytes());
        } else {
            count.copy_from_slice(&u16::try_from(n).ok()?.to_be_bytes());
        }
    }
    Some(out)
}

/// Packs at most 128 bytes.
fn pack(src: &[u8], out: &mut Vec<u8>) {
    // The pending literal: where it starts and how many bytes it has.
    let (mut start, mut len) = (0, 0);
    let mut i = 0;
    while i < src.len() {
        let value = src[i];
        let run = src[i..].iter().take_while(|&&b| b == value).count();
        if run >= 3 || (run == 2 && len == 0) {
            flush(&src[start..start + len], out);
            len = 0;
            out.push((1 - run as isize) as u8);
            out.push(value);
            i += run;
        } else {
            if len == 0 {
                start = i;
            }
            len += 1;
            i += 1;
        }
    }
    flush(&src[start..start + len], out);
}

fn flush(literal: &[u8], out: &mut Vec<u8>) {
    if let Some(last) = literal.len().checked_sub(1) {
        out.push(last as u8);
        out.extend_from_slice(literal);
    }
}
