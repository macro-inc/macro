//! The image resources the engine reads and writes: resolution (1005),
//! guides (1032), the thumbnail (1036), global light (1037, 1049), version
//! info (1057, which says whether the merged image is real), the ICC
//! profile (1039), and an indexed file's transparent index (1047).

use crate::file::Resource;
use crate::model::Guide;

/// Pixels per inch (1005), when set.
pub fn resolution(resources: &[Resource]) -> Option<f64> {
    let _ = resources;
    todo!("resources::resolution")
}

/// Sets the resolution (1005), keeping its display units.
pub fn set_resolution(resources: &mut Vec<Resource>, ppi: f64) {
    let _ = (resources, ppi);
    todo!("resources::set_resolution")
}

/// Ruler guides (1032).
pub fn guides(resources: &[Resource]) -> Vec<Guide> {
    let _ = resources;
    todo!("resources::guides")
}

/// Replaces the ruler guides (1032), keeping the grid settings.
pub fn set_guides(resources: &mut Vec<Resource>, guides: &[Guide]) {
    let _ = (resources, guides);
    todo!("resources::set_guides")
}

/// Global light angle (1037) and altitude (1049), in degrees.
pub fn global_light(resources: &[Resource]) -> (Option<i32>, Option<i32>) {
    let _ = resources;
    todo!("resources::global_light")
}

/// Whether the merged image holds a real rendering (1057; files saved
/// without Maximize Compatibility say no).
pub fn has_real_merged_data(resources: &[Resource]) -> Option<bool> {
    let _ = resources;
    todo!("resources::has_real_merged_data")
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
    let _ = resources;
    todo!("resources::thumbnail")
}

/// Replaces the thumbnail (1036, dropping an old 1033).
pub fn set_thumbnail(resources: &mut Vec<Resource>, thumbnail: &Thumbnail) {
    let _ = (resources, thumbnail);
    todo!("resources::set_thumbnail")
}

/// The embedded ICC profile (1039).
pub fn icc_profile(resources: &[Resource]) -> Option<&[u8]> {
    let _ = resources;
    todo!("resources::icc_profile")
}

/// An indexed file's transparent palette index (1047).
pub fn transparency_index(resources: &[Resource]) -> Option<u16> {
    let _ = resources;
    todo!("resources::transparency_index")
}
