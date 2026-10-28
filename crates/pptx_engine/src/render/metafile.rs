//! Windows metafiles (EMF and WMF) converted to display lists.
//!
//! Both formats are recordings of GDI calls. The players in `emf` and `wmf`
//! decode records and drive a shared device-context model (`gdi`) that tracks
//! objects, transforms, clipping, and path brackets, and emits scene nodes in
//! the device space of the reference device; the nodes are finally mapped
//! onto the picture frame. Shapes, text, bitmaps, and regions live in their
//! own modules. Unknown or malformed records are skipped, so damaged files
//! still render whatever is intact.

mod bitmap;
mod bytes;
mod charset;
mod emf;
mod gdi;
mod objects;
mod output;
mod region;
mod shapes;
mod text;
mod wmf;

use super::scene::Node;
use crate::error::{Error, Result};
use crate::font::FontDb;

/// A metafile converted to vector nodes.
#[derive(Clone, Debug)]
pub struct Metafile {
    /// Natural width in points.
    pub width_pt: f32,
    /// Natural height in points.
    pub height_pt: f32,
    /// Nodes in picture space: the picture spans (0, 0)–(`width_pt`, `height_pt`).
    pub nodes: Vec<Node>,
}

/// Parses an EMF or WMF file.
///
/// EMF+ records in comments are skipped in favor of the EMF records that
/// follow them; a file with nothing but EMF+ content is `Error::Unsupported`.
pub fn parse(bytes: &[u8], fonts: &FontDb) -> Result<Metafile> {
    if emf::sniff(bytes) {
        emf::parse(bytes, fonts)
    } else if wmf::sniff(bytes) {
        wmf::parse(bytes, fonts)
    } else {
        Err(Error::Unsupported("not a Windows metafile".into()))
    }
}

#[cfg(test)]
mod test;
