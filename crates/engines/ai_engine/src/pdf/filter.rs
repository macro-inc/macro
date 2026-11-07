//! Stream filters: `FlateDecode` and `LZWDecode` (with PNG and TIFF
//! predictors), `ASCIIHexDecode`, `ASCII85Decode`, and `RunLengthDecode`;
//! image codecs are reported for the image decoder.
//!
//! Damaged data decodes as far as it goes: a truncated or corrupt deflate
//! stream gives what inflated before the damage.

mod ascii;
mod lzw;
mod predictor;
#[cfg(test)]
mod test;

use super::{Dict, Object};
use crate::error::{AiError, Result};
use miniz_oxide::inflate::TINFLStatus;
use miniz_oxide::inflate::core::{DecompressorOxide, decompress, inflate_flags};
use std::borrow::Cow;

/// The most a stream may decode to.
pub(crate) const MAX_OUTPUT: usize = 1 << 30;

/// The most inflating starts with room for.
const INITIAL_OUTPUT: usize = 1 << 24;

/// An image codec a stream's last filter names.
#[derive(Clone, Debug, PartialEq)]
pub enum ImageCodec {
    /// JPEG (`DCTDecode`), with its parameters.
    Dct(Dict),
    /// JPEG 2000 (`JPXDecode`).
    Jpx,
    /// `JBIG2Decode`, with its parameters.
    Jbig2(Dict),
    /// `CCITTFaxDecode`, with its parameters.
    Ccitt(Dict),
}

/// Undoes one filter (by name, abbreviations included) with its
/// parameters.
pub fn decode(name: &str, data: &[u8], params: Option<&Dict>) -> Result<Vec<u8>> {
    match name {
        "FlateDecode" | "Fl" => Ok(predictor::undo(inflate(data), params)),
        "LZWDecode" | "LZW" => {
            let early = params.and_then(|p| p.i64("EarlyChange")).unwrap_or(1) != 0;
            Ok(predictor::undo(lzw::decode(data, early), params))
        }
        "ASCIIHexDecode" | "AHx" => Ok(ascii::hex(data)),
        "ASCII85Decode" | "A85" => Ok(ascii::base85(data)),
        "RunLengthDecode" | "RL" => Ok(ascii::run_length(data)),
        "Crypt" => Ok(data.to_vec()),
        _ => Err(AiError::Unsupported(format!("filter {name}"))),
    }
}

/// Deflates data (for `FlateDecode` streams the engine writes).
pub fn deflate(data: &[u8]) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec_zlib(data, 6)
}

/// Undoes a stream's filters (`Filter` with `DecodeParms`, names or
/// arrays, resolved with `resolve`) up to an image codec, which is
/// returned with its parameters.
pub(crate) fn decode_chain(
    dict: &Dict,
    data: &[u8],
    resolve: &dyn Fn(&Object) -> Object,
) -> Result<(Vec<u8>, Option<ImageCodec>)> {
    let filters: Vec<Object> = match dict.get("Filter").map(resolve) {
        Some(Object::Array(a)) => a.iter().map(resolve).collect(),
        Some(o @ Object::Name(_)) => vec![o],
        _ => Vec::new(),
    };
    let params: Vec<Option<Dict>> = match dict.get("DecodeParms").map(resolve) {
        Some(Object::Array(a)) => a
            .iter()
            .map(|p| match resolve(p) {
                Object::Dict(d) => Some(d),
                _ => None,
            })
            .collect(),
        Some(Object::Dict(d)) => vec![Some(d)],
        _ => Vec::new(),
    };
    let mut cur = Cow::Borrowed(data);
    for (i, filter) in filters.iter().enumerate() {
        let Some(name) = filter.as_name() else {
            return Err(AiError::corrupt("filter is not a name"));
        };
        let p = params.get(i).and_then(Option::as_ref);
        let owned = || p.cloned().unwrap_or_default();
        let codec = match name.as_bytes() {
            b"DCTDecode" | b"DCT" => Some(ImageCodec::Dct(owned())),
            b"JPXDecode" => Some(ImageCodec::Jpx),
            b"JBIG2Decode" => Some(ImageCodec::Jbig2(owned())),
            b"CCITTFaxDecode" | b"CCF" => Some(ImageCodec::Ccitt(owned())),
            _ => None,
        };
        if codec.is_some() {
            return Ok((cur.into_owned(), codec));
        }
        cur = Cow::Owned(decode(&name.as_str(), &cur, p)?);
    }
    Ok((cur.into_owned(), None))
}

/// Inflates zlib data (raw deflate when the zlib header is missing),
/// keeping what inflated before any damage.
pub(crate) fn inflate(data: &[u8]) -> Vec<u8> {
    let zlib = data.len() >= 2
        && (data[0] & 0x0f) == 8
        && ((u16::from(data[0]) << 8) | u16::from(data[1])) % 31 == 0;
    let out = inflate_with(data, zlib);
    if out.is_empty() && zlib {
        // A header that only looks like zlib's.
        return inflate_with(data, false);
    }
    out
}

fn inflate_with(data: &[u8], zlib: bool) -> Vec<u8> {
    let mut flags = inflate_flags::TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF
        | inflate_flags::TINFL_FLAG_IGNORE_ADLER32;
    if zlib {
        flags |= inflate_flags::TINFL_FLAG_PARSE_ZLIB_HEADER;
    }
    let mut state = Box::<DecompressorOxide>::default();
    // Room for a typical ratio; it doubles as needed.
    let mut out = vec![0u8; data.len().saturating_mul(3).clamp(1024, INITIAL_OUTPUT)];
    let mut input = data;
    let mut pos = 0;
    loop {
        let (status, consumed, written) = decompress(&mut state, input, &mut out, pos, flags);
        pos += written;
        input = input.get(consumed..).unwrap_or_default();
        match status {
            TINFLStatus::HasMoreOutput if out.len() < MAX_OUTPUT => {
                let grown = out.len().saturating_mul(2).min(MAX_OUTPUT);
                out.resize(grown, 0);
            }
            _ => break,
        }
    }
    out.truncate(pos);
    out
}
