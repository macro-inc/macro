//! Channel image data: raw samples, PackBits run-length encoding (row byte
//! counts first: 16-bit in `.psd`, 32-bit in `.psb`), and deflate with or
//! without prediction (horizontal differences per row; 32-bit samples are
//! predicted byte-planar, as Photoshop writes them).
//!
//! Samples are the file's: one byte per sample at depth 8, big-endian
//! `u16` at 16, big-endian `f32` at 32, and rows of packed bits at 1.
//!
//! Photoshop compresses 8-bit (and 1-bit) channels with RLE and 16- and
//! 32-bit layer channels with deflate and prediction; the merged image is
//! RLE or raw.

mod rle;
mod zip;

use crate::error::{PsdError, Result};
use crate::file::{Channel, Compression, Header, ImageData};
use std::borrow::Cow;

/// Bytes in one row of `width` samples at `depth` bits.
pub fn row_bytes(width: u32, depth: u16) -> usize {
    match depth {
        1 => (width as usize).div_ceil(8),
        d => (width as usize).saturating_mul(usize::from(d / 8)),
    }
}

/// Decodes a layer channel: `width × height` samples at `depth` bits.
pub fn decode_channel(
    channel: &Channel,
    width: u32,
    height: u32,
    depth: u16,
    psb: bool,
) -> Result<Vec<u8>> {
    let mut planes = decode(
        channel.compression,
        &channel.bytes,
        width,
        height as usize,
        1,
        depth,
        psb,
    )?;
    Ok(planes.pop().unwrap_or_default())
}

/// Encodes a layer channel's samples (`width × height` at `depth` bits)
/// the way Photoshop does for that depth: RLE at 1 and 8 bits, deflate
/// with prediction at 16 and 32, and no data for an empty channel.
/// Missing samples are taken as zeros.
pub fn encode_channel(
    id: i16,
    samples: &[u8],
    width: u32,
    height: u32,
    depth: u16,
    psb: bool,
) -> Channel {
    let compression = match depth {
        16 | 32 => Compression::ZipPrediction,
        _ => Compression::Rle,
    };
    let (compression, bytes) = encode(&[samples], compression, width, height, depth, psb);
    Channel {
        id,
        compression,
        bytes,
    }
}

/// Decodes the merged image into one sample plane per channel.
pub fn decode_image(image: &ImageData, header: &Header) -> Result<Vec<Vec<u8>>> {
    decode(
        image.compression,
        &image.bytes,
        header.width,
        header.height as usize,
        usize::from(header.channels),
        header.depth,
        header.is_psb(),
    )
}

/// Encodes merged-image planes (one per header channel; missing planes and
/// samples are zeros). RLE rows too wide for a `.psd`'s 16-bit row counts
/// are stored raw instead.
pub fn encode_image(planes: &[Vec<u8>], header: &Header, compression: Compression) -> ImageData {
    let planes: Vec<&[u8]> = (0..usize::from(header.channels))
        .map(|c| planes.get(c).map_or(&[][..], Vec::as_slice))
        .collect();
    let (compression, bytes) = encode(
        &planes,
        compression,
        header.width,
        header.height,
        header.depth,
        header.is_psb(),
    );
    ImageData { compression, bytes }
}

/// Decodes `planes` planes of `width × rows` samples stored one after the
/// other (a layer channel is one plane; the merged image has one per
/// channel, compressed as a whole).
fn decode(
    compression: Compression,
    data: &[u8],
    width: u32,
    rows: usize,
    planes: usize,
    depth: u16,
    psb: bool,
) -> Result<Vec<Vec<u8>>> {
    if !matches!(depth, 1 | 8 | 16 | 32) {
        return Err(PsdError::Unsupported(format!("{depth} bits per channel")));
    }
    let row = row_bytes(width, depth);
    let plane = row.checked_mul(rows).ok_or_else(|| too_large(row, rows))?;
    let size = plane
        .checked_mul(planes)
        .ok_or_else(|| too_large(plane, planes))?;
    if size == 0 {
        return Ok(vec![Vec::new(); planes]);
    }
    match compression {
        Compression::Raw => (0..planes)
            .map(|p| {
                data.get(p * plane..(p + 1) * plane)
                    .map(<[u8]>::to_vec)
                    .ok_or_else(|| PsdError::corrupt("raw channel data is cut off"))
            })
            .collect(),
        Compression::Rle => rle::decode(data, row, rows, planes, psb),
        Compression::Zip | Compression::ZipPrediction => {
            let mut all = zip::inflate(data, size)?;
            if compression == Compression::ZipPrediction {
                zip::unpredict(&mut all, width as usize, depth);
            }
            if planes == 1 {
                return Ok(vec![all]);
            }
            Ok(all.chunks_exact(plane).map(<[u8]>::to_vec).collect())
        }
    }
}

/// Encodes planes of `width × height` samples as one stream.
fn encode(
    planes: &[&[u8]],
    compression: Compression,
    width: u32,
    height: u32,
    depth: u16,
    psb: bool,
) -> (Compression, Vec<u8>) {
    let row = row_bytes(width, depth);
    let plane = row.checked_mul(height as usize).unwrap_or(0);
    if plane == 0 {
        return (Compression::Raw, Vec::new());
    }
    let rows = || {
        planes
            .iter()
            .flat_map(move |p| (0..height as usize).map(move |y| padded(p, y * row, row)))
    };
    let raw = || {
        let mut out = Vec::with_capacity(plane.saturating_mul(planes.len()));
        for r in rows() {
            out.extend_from_slice(&r);
        }
        out
    };
    match compression {
        Compression::Raw => (Compression::Raw, raw()),
        Compression::Rle => {
            let rows: Vec<Cow<[u8]>> = rows().collect();
            match rle::encode(rows.iter().map(|r| r.as_ref()), row, psb) {
                Some(bytes) => (Compression::Rle, bytes),
                None => (Compression::Raw, raw()),
            }
        }
        Compression::Zip => (Compression::Zip, zip::deflate(&raw())),
        Compression::ZipPrediction => {
            let mut all = raw();
            zip::predict(&mut all, width as usize, depth);
            (Compression::ZipPrediction, zip::deflate(&all))
        }
    }
}

/// `len` samples at `start`, zero-filled past the end of `samples`.
fn padded(samples: &[u8], start: usize, len: usize) -> Cow<'_, [u8]> {
    match samples.get(start..start + len) {
        Some(row) => Cow::Borrowed(row),
        None => {
            let mut row = samples.get(start..).unwrap_or_default().to_vec();
            row.resize(len, 0);
            Cow::Owned(row)
        }
    }
}

fn too_large(a: usize, b: usize) -> PsdError {
    let bytes = (a as u128) * (b as u128);
    PsdError::TooLarge(u64::try_from(bytes >> 20).unwrap_or(u64::MAX))
}

#[cfg(test)]
mod test;
