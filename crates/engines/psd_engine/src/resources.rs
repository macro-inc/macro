//! The image resources the engine reads and writes: resolution (1005),
//! guides (1032), the thumbnail (1036), global light (1037, 1049), version
//! info (1057, which says whether the merged image is real), the ICC
//! profile (1039), and an indexed file's transparent index (1047).

use crate::binary::{Reader, Writer};
use crate::file::Resource;
use crate::model::Guide;

// Resource ids.
const RESOLUTION: u16 = 1005;
const GUIDES: u16 = 1032;
const OLD_THUMBNAIL: u16 = 1033;
const THUMBNAIL: u16 = 1036;
const GLOBAL_ANGLE: u16 = 1037;
const ICC_PROFILE: u16 = 1039;
const TRANSPARENCY_INDEX: u16 = 1047;
const GLOBAL_ALTITUDE: u16 = 1049;
const VERSION_INFO: u16 = 1057;

/// Guide positions are stored in 1/32 pixel.
const GUIDE_UNITS: f64 = 32.0;
/// Photoshop's default grid cycle (18 pixels, in 1/32 pixel).
const DEFAULT_GRID: u32 = 18 * 32;
/// Bytes before a thumbnail's JPEG data.
const THUMBNAIL_HEADER: usize = 28;
/// Thumbnails are stored as JPEG (`kJpegRGB`).
const JPEG_FORMAT: u32 = 1;
/// Quality of a converted thumbnail.
const THUMBNAIL_QUALITY: u8 = 90;

fn data(resources: &[Resource], id: u16) -> Option<&[u8]> {
    resources
        .iter()
        .find(|r| r.id == id)
        .map(|r| r.data.as_slice())
}

/// Replaces the data of the first resource with `id` (dropping later
/// ones), or adds one at the end.
fn set(resources: &mut Vec<Resource>, id: u16, data: Vec<u8>) {
    match resources.iter().position(|r| r.id == id) {
        Some(at) => {
            resources[at].data = data;
            let mut seen = 0;
            resources.retain(|r| {
                seen += usize::from(r.id == id);
                r.id != id || seen == 1
            });
        }
        None => resources.push(Resource::new(id, data)),
    }
}

/// Pixels per inch (1005), when set.
pub fn resolution(resources: &[Resource]) -> Option<f64> {
    let ppi = Reader::new(data(resources, RESOLUTION)?).fixed().ok()?;
    (ppi > 0.0).then_some(ppi)
}

/// Sets the resolution (1005), keeping its display units.
pub fn set_resolution(resources: &mut Vec<Resource>, ppi: f64) {
    // Display units: pixels per inch, sizes in inches.
    let mut units = [1; 4];
    if let Some(old) = data(resources, RESOLUTION) {
        let mut r = Reader::new(old);
        if let (Ok(_), Ok(h), Ok(width), Ok(_), Ok(v), Ok(height)) =
            (r.fixed(), r.u16(), r.u16(), r.fixed(), r.u16(), r.u16())
        {
            units = [h, width, v, height];
        }
    }
    let mut w = Writer::new();
    for pair in units.chunks_exact(2) {
        w.fixed(ppi);
        w.u16(pair[0]);
        w.u16(pair[1]);
    }
    set(resources, RESOLUTION, w.into_bytes());
}

/// Ruler guides (1032).
pub fn guides(resources: &[Resource]) -> Vec<Guide> {
    let Some(data) = data(resources, GUIDES) else {
        return Vec::new();
    };
    let mut r = Reader::new(data);
    let (Ok(1), Ok(_), Ok(count)) = (r.u32(), r.u64(), r.u32()) else {
        return Vec::new();
    };
    (0..count)
        .map_while(|_| {
            let position = f64::from(r.i32().ok()?) / GUIDE_UNITS;
            let vertical = r.u8().ok()? == 0;
            Some(Guide { vertical, position })
        })
        .collect()
}

/// Replaces the ruler guides (1032), keeping the grid settings.
pub fn set_guides(resources: &mut Vec<Resource>, guides: &[Guide]) {
    let old = data(resources, GUIDES);
    if old.is_none() && guides.is_empty() {
        return;
    }
    let grid = old
        .and_then(|d| d.get(4..12))
        .map(<[u8]>::to_vec)
        .unwrap_or_else(|| [DEFAULT_GRID.to_be_bytes(), DEFAULT_GRID.to_be_bytes()].concat());
    let mut w = Writer::new();
    w.u32(1);
    w.bytes(&grid);
    w.u32(guides.len() as u32);
    for g in guides {
        w.i32((g.position * GUIDE_UNITS).round() as i32);
        w.u8(u8::from(!g.vertical));
    }
    set(resources, GUIDES, w.into_bytes());
}

/// Global light angle (1037) and altitude (1049), in degrees.
pub fn global_light(resources: &[Resource]) -> (Option<i32>, Option<i32>) {
    let read = |id| Reader::new(data(resources, id)?).i32().ok();
    (read(GLOBAL_ANGLE), read(GLOBAL_ALTITUDE))
}

/// Whether the merged image holds a real rendering (1057; files saved
/// without Maximize Compatibility say no).
pub fn has_real_merged_data(resources: &[Resource]) -> Option<bool> {
    let mut r = Reader::new(data(resources, VERSION_INFO)?);
    r.u32().ok()?;
    Some(r.u8().ok()? != 0)
}

/// A JPEG thumbnail: width, height, and the JFIF bytes (1036, or 1033's
/// older BGR form converted).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Thumbnail {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// The JPEG file.
    pub jpeg: Vec<u8>,
}

/// The thumbnail.
pub fn thumbnail(resources: &[Resource]) -> Option<Thumbnail> {
    if let Some(data) = data(resources, THUMBNAIL) {
        return parse_thumbnail(data);
    }
    let old = parse_thumbnail(data(resources, OLD_THUMBNAIL)?)?;
    let image = fig_engine::images::decode(&old.jpeg)?;
    let mut rgba = image.data().to_vec();
    for px in rgba.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    let jpeg =
        fig_engine::export::jpeg::encode(&rgba, image.width(), image.height(), THUMBNAIL_QUALITY);
    Some(Thumbnail { jpeg, ..old })
}

fn parse_thumbnail(data: &[u8]) -> Option<Thumbnail> {
    let mut r = Reader::new(data);
    let (format, width, height) = (r.u32().ok()?, r.u32().ok()?, r.u32().ok()?);
    // Row bytes, total size.
    r.skip(8).ok()?;
    let size = r.u32().ok()? as usize;
    if format != JPEG_FORMAT {
        return None;
    }
    let jpeg = data.get(THUMBNAIL_HEADER..)?;
    let jpeg = jpeg.get(..size).unwrap_or(jpeg).to_vec();
    Some(Thumbnail {
        width,
        height,
        jpeg,
    })
}

/// Replaces the thumbnail (1036, dropping an old 1033).
pub fn set_thumbnail(resources: &mut Vec<Resource>, thumbnail: &Thumbnail) {
    let row = (thumbnail.width as usize * 24).div_ceil(32) * 4;
    let mut w = Writer::new();
    w.u32(JPEG_FORMAT);
    w.u32(thumbnail.width);
    w.u32(thumbnail.height);
    w.u32(row as u32);
    w.u32((row * thumbnail.height as usize) as u32);
    w.u32(thumbnail.jpeg.len() as u32);
    // Bits per pixel, planes.
    w.u16(24);
    w.u16(1);
    w.bytes(&thumbnail.jpeg);
    let data = w.into_bytes();
    if !resources.iter().any(|r| r.id == THUMBNAIL)
        && let Some(old) = resources.iter_mut().find(|r| r.id == OLD_THUMBNAIL)
    {
        old.id = THUMBNAIL;
    }
    resources.retain(|r| r.id != OLD_THUMBNAIL);
    set(resources, THUMBNAIL, data);
}

/// The embedded ICC profile (1039).
pub fn icc_profile(resources: &[Resource]) -> Option<&[u8]> {
    data(resources, ICC_PROFILE).filter(|d| !d.is_empty())
}

/// An indexed file's transparent palette index (1047).
pub fn transparency_index(resources: &[Resource]) -> Option<u16> {
    Reader::new(data(resources, TRANSPARENCY_INDEX)?).u16().ok()
}

#[cfg(test)]
mod test;
