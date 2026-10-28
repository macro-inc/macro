use super::*;
use crate::render::raster::rasterize;
use crate::render::scene::Raster;
use crate::test_support::fonts;

mod builder;
mod emf_more;
mod emf_tests;
mod fixtures;
mod robust;
mod wmf_tests;

pub(super) use builder::Emf;

/// Renders a parsed metafile at `scale` pixels per point.
pub(super) fn render(m: &Metafile, scale: f32) -> Raster {
    let w = (m.width_pt * scale).ceil().max(1.0) as u32;
    let h = (m.height_pt * scale).ceil().max(1.0) as u32;
    rasterize(&m.nodes, w, h, scale)
}

/// Straight RGBA of a pixel.
pub(super) fn px(r: &Raster, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * r.width + x) * 4) as usize;
    let p = &r.pixels[i..i + 4];
    if p[3] == 0 {
        return [0, 0, 0, 0];
    }
    let un = |c: u8| ((u32::from(c) * 255 + u32::from(p[3]) / 2) / u32::from(p[3])).min(255) as u8;
    [un(p[0]), un(p[1]), un(p[2]), p[3]]
}

/// Whether a pixel is close to an opaque color.
pub(super) fn near(p: [u8; 4], rgb: [u8; 3]) -> bool {
    p[3] > 200 && (0..3).all(|i| (i32::from(p[i]) - i32::from(rgb[i])).abs() <= 40)
}

/// Parses with the bundled fonts.
pub(super) fn load(bytes: &[u8]) -> Metafile {
    parse(bytes, fonts()).expect("metafile parses")
}

/// The committed fixtures in `tests/fixtures/metafiles`, sorted by name.
pub(super) fn fixture_files() -> Vec<(String, Vec<u8>)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/metafiles");
    let mut out: Vec<(String, Vec<u8>)> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| {
                    Some((
                        e.file_name().into_string().ok()?,
                        std::fs::read(e.path()).ok()?,
                    ))
                })
                .filter(|(n, _)| n.ends_with(".emf") || n.ends_with(".wmf"))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}
