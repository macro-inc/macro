//! Image XObjects and inline images: samples of 1 to 16 bits in any color
//! space, `Decode` arrays, stencil masks, soft masks, color-key and
//! explicit masks, and JPEG data (CMYK JPEGs included), decoded to straight
//! RGBA8.

use crate::error::Result;
use crate::pdf::{Dict, Resolve, Stream};

/// A decoded image.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodedImage {
    /// Width in samples.
    pub width: u32,
    /// Height in samples.
    pub height: u32,
    /// Straight RGBA8, row by row, top row first.
    pub rgba: Vec<u8>,
}

/// Decodes an image XObject (or an inline image given as a stream with
/// its abbreviations expanded). A stencil mask (`ImageMask`) paints
/// `fill` (straight sRGB and alpha) where it marks.
pub fn decode(
    pdf: &dyn Resolve,
    image: &Stream,
    resources: &Dict,
    fill: [f32; 4],
) -> Result<DecodedImage> {
    let _ = (pdf, image, resources, fill);
    todo!("image::decode")
}

/// An inline image's dictionary with abbreviated keys and values expanded
/// (`W` to `Width`, `CS` `RGB` to `DeviceRGB`, `F` `Fl` to `FlateDecode`, …).
pub fn expand_inline(dict: &Dict) -> Dict {
    let _ = dict;
    todo!("image::expand_inline")
}
