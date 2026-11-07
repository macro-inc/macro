//! Tiles shared live: a tile's samples, differenced along each row and
//! deflated, as base64.

use crate::raster::{TILE, tile_bytes};
use fig_engine::collab::codec::{base64, unbase64};

/// The shared form of a tile's samples (`channels` per pixel).
pub fn encode(samples: &[u8], channels: u8) -> String {
    let c = channels as usize;
    let row = TILE as usize * c;
    let mut diff = samples.to_vec();
    for r in diff.chunks_exact_mut(row) {
        for i in (c..row).rev() {
            r[i] = r[i].wrapping_sub(r[i - c]);
        }
    }
    base64(&miniz_oxide::deflate::compress_to_vec(&diff, 6))
}

/// A tile's samples from their shared form.
pub fn decode(text: &str, channels: u8) -> Option<Vec<u8>> {
    let c = channels as usize;
    let size = tile_bytes(channels);
    let packed = unbase64(text)?;
    let mut out = miniz_oxide::inflate::decompress_to_vec_with_limit(&packed, size).ok()?;
    if out.len() != size {
        return None;
    }
    let row = TILE as usize * c;
    for r in out.chunks_exact_mut(row) {
        for i in c..row {
            r[i] = r[i].wrapping_add(r[i - c]);
        }
    }
    Some(out)
}

/// A content hash of a tile's samples.
pub fn hash(samples: &[u8]) -> u64 {
    samples.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// Whether a tile shows nothing (RGBA: fully transparent; gray: zero).
pub fn is_blank(samples: &[u8], channels: u8) -> bool {
    if channels == 4 {
        samples.chunks_exact(4).all(|p| p[3] == 0)
    } else {
        samples.iter().all(|&v| v == 0)
    }
}
