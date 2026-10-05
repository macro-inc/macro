//! Channel image data: raw samples, PackBits run-length encoding (row byte
//! counts first: 16-bit in `.psd`, 32-bit in `.psb`), and deflate with or
//! without prediction (horizontal differences per row; 32-bit samples are
//! predicted byte-planar, as Photoshop writes them).
//!
//! Samples are the file's: one byte per sample at depth 8, big-endian
//! `u16` at 16, big-endian `f32` at 32, and rows of packed bits at 1.

use crate::error::Result;
use crate::file::{Channel, Compression, Header, ImageData};

/// Bytes in one row of `width` samples at `depth` bits.
pub fn row_bytes(width: u32, depth: u16) -> usize {
    match depth {
        1 => (width as usize).div_ceil(8),
        d => width as usize * (d as usize / 8),
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
    let _ = (channel, width, height, depth, psb);
    todo!("channels::decode_channel")
}

/// Encodes a layer channel's samples (`width × height` at `depth` bits)
/// the way Photoshop does for that depth.
pub fn encode_channel(
    id: i16,
    samples: &[u8],
    width: u32,
    height: u32,
    depth: u16,
    psb: bool,
) -> Channel {
    let _ = (id, samples, width, height, depth, psb);
    todo!("channels::encode_channel")
}

/// Decodes the merged image into one sample plane per channel.
pub fn decode_image(image: &ImageData, header: &Header) -> Result<Vec<Vec<u8>>> {
    let _ = (image, header);
    todo!("channels::decode_image")
}

/// Encodes merged-image planes (one per header channel).
pub fn encode_image(planes: &[Vec<u8>], header: &Header, compression: Compression) -> ImageData {
    let _ = (planes, header, compression);
    todo!("channels::encode_image")
}
