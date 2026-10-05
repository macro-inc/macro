use super::*;

fn solid(w: u32, h: u32, rgb: [u8; 3]) -> Raster {
    let mut r = Raster::new(w, h);
    for px in r.pixels.chunks_exact_mut(4) {
        px.copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
    }
    r
}

fn with_square(mut r: Raster, x0: u32, y0: u32, size: u32) -> Raster {
    for y in y0..y0 + size {
        for x in x0..x0 + size {
            let i = ((y * r.width + x) * 4) as usize;
            r.pixels[i..i + 4].copy_from_slice(&[0, 0, 0, 255]);
        }
    }
    r
}

#[test]
fn identical_images_score_perfectly() {
    let a = with_square(solid(64, 48, [255, 255, 255]), 10, 10, 12);
    let s = compare(&a, &a.clone());
    assert!((s.ssim - 1.0).abs() < 1e-6 && s.mismatch == 0.0, "{s:?}");
}

#[test]
fn moved_content_lowers_the_score() {
    let a = with_square(solid(64, 48, [255, 255, 255]), 10, 10, 12);
    let b = with_square(solid(64, 48, [255, 255, 255]), 30, 20, 12);
    let s = compare(&a, &b);
    assert!(s.ssim < 0.9 && s.mismatch > 0.05, "{s:?}");
    let d = diff_image(&a, &b);
    assert_eq!((d.width, d.height), (64, 48));
}

#[test]
fn references_of_another_size_are_resampled() {
    let a = solid(64, 48, [10, 200, 30]);
    let b = solid(128, 96, [10, 200, 30]);
    assert!(compare(&a, &b).ssim > 0.999);
}

#[test]
fn transparent_pixels_count_as_white() {
    let a = Raster::new(16, 16);
    let b = solid(16, 16, [255, 255, 255]);
    assert_eq!(compare(&a, &b).mismatch, 0.0);
}

#[test]
fn fingerprints_track_layout_changes() {
    let a = with_square(solid(320, 180, [255, 255, 255]), 20, 20, 60);
    let b = with_square(solid(320, 180, [255, 255, 255]), 200, 100, 60);
    let (fa, fb) = (fingerprint(&a), fingerprint(&b));
    assert_eq!(fa.len(), 32 * 18);
    assert_eq!(fingerprint_distance(&fa, &fa), (0.0, 0));
    let (mean, max) = fingerprint_distance(&fa, &fb);
    assert!(mean > 0.5 && max == 15, "{mean} {max}");
    assert_eq!(fingerprint_distance(&fa, "abc").1, u32::MAX);
}
