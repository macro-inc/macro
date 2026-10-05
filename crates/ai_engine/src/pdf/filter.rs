//! Stream filters: `FlateDecode` and `LZWDecode` (with PNG and TIFF
//! predictors), `ASCIIHexDecode`, `ASCII85Decode`, and `RunLengthDecode`;
//! image codecs are reported for the image decoder.

use super::Dict;
use crate::error::Result;

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

/// Undoes one filter (by name) with its parameters.
pub fn decode(name: &str, data: &[u8], params: Option<&Dict>) -> Result<Vec<u8>> {
    let _ = (name, data, params);
    todo!("filter::decode")
}

/// Deflates data (for `FlateDecode` streams the engine writes).
pub fn deflate(data: &[u8]) -> Vec<u8> {
    let _ = data;
    todo!("filter::deflate")
}
