use super::*;
use crate::raster::IRect;
use std::time::Instant;

/// A raster of distinct, partly transparent pixels over `rect`.
fn pattern(rect: IRect) -> Raster {
    let mut data = Vec::with_capacity(rect.area() as usize * 4);
    for y in rect.y..rect.bottom() {
        for x in rect.x..rect.right() {
            data.extend_from_slice(&[
                (x * 7 + y * 3) as u8,
                ((x * 13) ^ (y * 5)) as u8,
                (x + y * 11) as u8,
                (128 + (x * y).rem_euclid(128)) as u8,
            ]);
        }
    }
    Raster::from_region(4, rect, &data)
}

/// A smooth opaque image over `rect`.
fn smooth(rect: IRect) -> Raster {
    let mut data = Vec::with_capacity(rect.area() as usize * 4);
    for y in rect.y..rect.bottom() {
        for x in rect.x..rect.right() {
            let (u, v) = (f64::from(x) / 9.0, f64::from(y) / 13.0);
            let q = |t: f64| (127.5 + 100.0 * t.sin()) as u8;
            data.extend_from_slice(&[q(u), q(v), q(u + v), 255]);
        }
    }
    Raster::from_region(4, rect, &data)
}

/// The pixels of `r` over `rect`, canvas-wise.
fn pixels(r: &Raster, rect: IRect) -> Vec<u8> {
    r.read_vec(rect)
}

fn alpha_mass(r: &Raster) -> f64 {
    let Some(b) = r.content_bounds() else {
        return 0.0;
    };
    r.read_vec(b).chunks(4).map(|p| f64::from(p[3])).sum()
}

const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

#[test]
fn identity_and_whole_pixel_moves_are_exact() {
    let rect = IRect::new(-3, 5, 300, 40);
    let src = pattern(rect);
    for interpolation in [
        Interpolation::Nearest,
        Interpolation::Bilinear,
        Interpolation::Bicubic,
    ] {
        let same = transform(&src, IDENTITY, interpolation);
        assert_eq!(pixels(&same, rect), pixels(&src, rect));
        let moved = transform(&src, [1.0, 0.0, 0.0, 1.0, 5.0, -3.0], interpolation);
        assert_eq!(moved.content_bounds(), Some(rect.translate(5, -3)));
        assert_eq!(pixels(&moved, rect.translate(5, -3)), pixels(&src, rect));
    }
    // Nearest neighbor keeps pixels whole through a small shift.
    let nudged = transform(
        &src,
        [1.0, 0.0, 0.0, 1.0, 0.25, 0.0],
        Interpolation::Nearest,
    );
    assert_eq!(pixels(&nudged, rect), pixels(&src, rect));
}

#[test]
fn quarter_turns_are_exact() {
    let rect = IRect::new(10, 20, 37, 23);
    let src = pattern(rect);
    let turned = rotate_quarters(&src, 1, (0.0, 0.0));
    // Clockwise about the origin: pixel (i, j) lands on (-j - 1, i).
    for (i, j) in [(10, 20), (46, 20), (10, 42), (30, 33)] {
        assert_eq!(turned.get(-j - 1, i), src.get(i, j));
    }
    let b = turned.content_bounds().unwrap();
    assert_eq!(b, IRect::new(-43, 10, 23, 37));
    assert_eq!(turned.origin(), (b.x, b.y));
    // Four turns come back; two are both flips.
    let mut round = src.clone();
    for _ in 0..4 {
        round = rotate_quarters(&round, 1, (12.5, 7.0));
    }
    assert_eq!(pixels(&round, rect), pixels(&src, rect));
    let half = rotate_quarters(&src, 2, (30.0, 30.0));
    let flipped = flip_vertical(&flip_horizontal(&src, 30.0), 30.0);
    assert_eq!(half.content_bounds(), flipped.content_bounds());
    assert_eq!(pixels(&half, rect), pixels(&flipped, rect));
    assert_eq!(
        rotate_quarters(&src, -1, (0.0, 0.0)),
        rotate_quarters(&src, 3, (0.0, 0.0))
    );
    // A turn about a pixel's center keeps that pixel in place.
    let about = rotate_quarters(&src, 1, (20.5, 30.5));
    assert_eq!(about.get(20, 30), src.get(20, 30));
    // A free transform that is a quarter turn takes the exact path.
    let (s, c) = 90f64.to_radians().sin_cos();
    let free = transform(&src, [c, s, -s, c, 0.0, 0.0], Interpolation::Bicubic);
    assert_eq!(free.content_bounds(), Some(b));
    assert_eq!(pixels(&free, b), pixels(&turned, b));
    // Off-grid centers shift by half a pixel, still exact.
    let shifted = rotate_quarters(&src, 1, (20.0, 30.5));
    let mut a = pixels(&shifted, shifted.content_bounds().unwrap());
    let mut want = pixels(&src, rect);
    a.sort_unstable();
    want.sort_unstable();
    assert_eq!(a, want);
}

#[test]
fn flips_are_exact() {
    let rect = IRect::new(10, 20, 37, 23);
    let src = pattern(rect);
    let flipped = flip_horizontal(&src, 50.0);
    assert_eq!(flipped.get(89, 25), src.get(10, 25));
    assert_eq!(flipped.content_bounds(), Some(IRect::new(53, 20, 37, 23)));
    assert_eq!(
        pixels(&flip_horizontal(&flipped, 50.0), rect),
        pixels(&src, rect)
    );
    let down = flip_vertical(&src, 0.5);
    assert_eq!(down.get(12, -21), src.get(12, 21));
    // Axes snap to half pixels; bad axes change nothing.
    assert_eq!(flip_horizontal(&src, 50.1), flipped);
    assert_eq!(flip_horizontal(&src, f64::NAN), src);
}

#[test]
fn scaling_up_then_down_gives_back_the_image() {
    let rect = IRect::new(0, 0, 64, 48);
    let src = smooth(rect);
    for interpolation in [Interpolation::Bilinear, Interpolation::Bicubic] {
        let up = transform(&src, [2.0, 0.0, 0.0, 2.0, 0.0, 0.0], interpolation);
        assert_eq!(up.content_bounds(), Some(IRect::new(0, 0, 128, 96)));
        let back = transform(&up, [0.5, 0.0, 0.0, 0.5, 0.0, 0.0], interpolation);
        let inner = IRect::new(2, 2, 60, 44);
        let (a, b) = (pixels(&src, inner), pixels(&back, inner));
        let worst = a
            .iter()
            .zip(&b)
            .map(|(&x, &y)| x.abs_diff(y))
            .max()
            .unwrap();
        assert!(worst <= 4, "{interpolation:?}: {worst}");
    }
}

#[test]
fn bicubic_keeps_a_smooth_gradient_smooth() {
    let rect = IRect::new(0, 0, 256, 8);
    let data: Vec<u8> = (0..8)
        .flat_map(|_| (0..256).flat_map(|x| [x as u8, 255 - x as u8, 128, 255]))
        .collect();
    let src = Raster::from_region(4, rect, &data);
    let scaled = transform(
        &src,
        [1.37, 0.0, 0.0, 1.0, 0.3, 0.0],
        Interpolation::Bicubic,
    );
    let row: Vec<i32> = (4..346).map(|x| i32::from(scaled.get(x, 4)[0])).collect();
    assert!(row.windows(2).all(|w| w[1] >= w[0]), "monotonic: {row:?}");
    assert!(
        row.windows(3).all(|w| (w[2] - 2 * w[1] + w[0]).abs() <= 2),
        "no ripples: {row:?}"
    );
    assert!(row.windows(2).all(|w| w[1] - w[0] <= 2));
}

#[test]
fn downscales_average_instead_of_aliasing() {
    let rect = IRect::new(0, 0, 64, 64);
    let checks: Vec<u8> = (0..64)
        .flat_map(|y| {
            (0..64).flat_map(move |x| {
                if (x + y) % 2 == 0 {
                    [0, 0, 0, 255]
                } else {
                    [255; 4]
                }
            })
        })
        .collect();
    let src = Raster::from_region(4, rect, &checks);
    let quarter = [0.25, 0.0, 0.0, 0.25, 0.0, 0.0];
    let smooth = transform(&src, quarter, Interpolation::Bicubic);
    let inner = pixels(&smooth, IRect::new(1, 1, 14, 14));
    assert!(
        inner
            .chunks(4)
            .all(|p| p[0].abs_diff(128) <= 2 && p[3] == 255),
        "{inner:?}"
    );
    let hard = transform(&src, quarter, Interpolation::Nearest);
    assert!(
        pixels(&hard, IRect::new(0, 0, 16, 16))
            .chunks(4)
            .all(|p| p[0] == 0 || p[0] == 255)
    );
    // Shrinking and turning at once still averages.
    let (s, c) = 0.5f64.sin_cos();
    let turned = transform(
        &src,
        [0.2 * c, 0.2 * s, -0.2 * s, 0.2 * c, 0.0, 0.0],
        Interpolation::Bilinear,
    );
    let b = turned.content_bounds().unwrap();
    let middle = turned.get(b.x + b.w / 2, b.y + b.h / 2);
    assert!(middle[0].abs_diff(128) <= 8, "{middle:?}");
}

#[test]
fn rotations_cover_the_turned_bounds_and_keep_coverage() {
    let rect = IRect::new(100, 50, 120, 80);
    let src = smooth(rect);
    let (s, c) = 30f64.to_radians().sin_cos();
    let m = [c, s, -s, c, 10.0, -20.0];
    for interpolation in [
        Interpolation::Nearest,
        Interpolation::Bilinear,
        Interpolation::Bicubic,
    ] {
        let out = transform(&src, m, interpolation);
        let b = out.content_bounds().unwrap();
        // The grid starts at the turned bounds, at most a pixel out.
        let (ox, oy) = out.origin();
        assert!(b.x - ox <= 1 && b.y - oy <= 1 && b.x >= ox && b.y >= oy);
        for (x, y) in [(100.0, 50.0), (220.0, 50.0), (100.0, 130.0), (220.0, 130.0)] {
            let (u, v) = (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
            assert!(u >= f64::from(b.x) - 1.0 && u <= f64::from(b.right()) + 1.0);
            assert!(v >= f64::from(b.y) - 1.0 && v <= f64::from(b.bottom()) + 1.0);
        }
        let ratio = alpha_mass(&out) / alpha_mass(&src);
        assert!((ratio - 1.0).abs() < 0.01, "{interpolation:?}: {ratio}");
    }
}

#[test]
fn transparent_edges_do_not_darken() {
    let rect = IRect::new(0, 0, 20, 20);
    let src = Raster::from_region(4, rect, &[255, 200, 0, 255].repeat(400));
    let (s, c) = 0.3f64.sin_cos();
    let out = transform(
        &src,
        [1.3 * c, 1.3 * s, -1.3 * s, 1.3 * c, 0.5, 0.25],
        Interpolation::Bicubic,
    );
    let b = out.content_bounds().unwrap();
    for p in out.read_vec(b).chunks(4).filter(|p| p[3] > 16) {
        assert!(p[0] >= 250 && p[1].abs_diff(200) <= 6 && p[2] <= 4, "{p:?}");
    }
}

#[test]
fn one_channel_rasters_transform_too() {
    let rect = IRect::new(0, 0, 50, 30);
    let data: Vec<u8> = (0..1500).map(|i| (i % 50 * 5) as u8).collect();
    let mask = Raster::from_region(1, rect, &data);
    let flipped = flip_horizontal(&mask, 25.0);
    assert_eq!(flipped.get(0, 3)[0], mask.get(49, 3)[0]);
    let scaled = transform(
        &mask,
        [2.0, 0.0, 0.0, 2.0, 0.0, 0.0],
        Interpolation::Bicubic,
    );
    assert_eq!(scaled.channels(), 1);
    // Column 0 is zero, so not content.
    assert_eq!(scaled.content_bounds(), Some(IRect::new(2, 0, 98, 60)));
    let v = i32::from(scaled.get(50, 30)[0]);
    assert!((v - 125).abs() <= 4, "{v}");
}

#[test]
fn degenerate_maps() {
    let src = pattern(IRect::new(0, 0, 10, 10));
    assert_eq!(
        transform(
            &src,
            [f64::NAN, 0.0, 0.0, 1.0, 0.0, 0.0],
            Interpolation::Bicubic
        ),
        src
    );
    assert!(transform(&src, [0.0, 0.0, 0.0, 1.0, 3.0, 0.0], Interpolation::Bicubic).is_empty());
    assert!(transform(&src, [1e6, 0.0, 0.0, 1e6, 0.0, 0.0], Interpolation::Bicubic).is_empty());
    let tiny = transform(
        &src,
        [1e-6, 0.0, 0.0, 1e-6, 0.0, 0.0],
        Interpolation::Bicubic,
    );
    assert!(tiny.content_bounds().is_none_or(|b| b.w <= 1 && b.h <= 1));
    assert!(
        transform(
            &Raster::rgba(),
            [2.0, 0.0, 0.0, 2.0, 0.0, 0.0],
            Interpolation::Bicubic
        )
        .is_empty()
    );
}

#[test]
fn extreme_downscales_sample_sparsely() {
    // Each 20 × 20 output block maps back to 4 million pixels: too many
    // to read whole, so the samples are read one by one.
    let rect = IRect::new(0, 0, 2000, 2000);
    let src = Raster::from_region(4, rect, &[100, 150, 200, 255].repeat(4_000_000));
    for interpolation in [Interpolation::Nearest, Interpolation::Bicubic] {
        let small = transform(&src, [0.01, 0.0, 0.0, 0.01, 0.0, 0.0], interpolation);
        assert_eq!(small.content_bounds(), Some(IRect::new(0, 0, 20, 20)));
        let px = small.read_vec(IRect::new(0, 0, 20, 20));
        assert!(
            px.chunks(4).all(|p| p == [100, 150, 200, 255]),
            "{interpolation:?}"
        );
    }
}

/// Times a free rotation of a 2000 × 2000 layer.
#[test]
#[ignore = "benchmark: cargo test -p psd_engine --release -- --ignored --nocapture"]
fn bench_rotation() {
    let src = smooth(IRect::new(0, 0, 2000, 2000));
    let (s, c) = 30f64.to_radians().sin_cos();
    for interpolation in [
        Interpolation::Bicubic,
        Interpolation::Bilinear,
        Interpolation::Nearest,
    ] {
        let start = Instant::now();
        let out = transform(&src, [c, s, -s, c, 0.0, 0.0], interpolation);
        println!(
            "transform: 2000×2000 rotated 30° ({interpolation:?}): {:.1} ms, {} tiles",
            start.elapsed().as_secs_f64() * 1e3,
            out.tile_count()
        );
    }
    let start = Instant::now();
    let _ = transform(&src, [0.3, 0.0, 0.0, 0.3, 0.0, 0.0], Interpolation::Bicubic);
    println!(
        "transform: 2000×2000 scaled to 30%: {:.1} ms",
        start.elapsed().as_secs_f64() * 1e3
    );
    let start = Instant::now();
    let _ = rotate_quarters(&src, 1, (1000.0, 1000.0));
    println!(
        "transform: 2000×2000 quarter turn: {:.1} ms",
        start.elapsed().as_secs_f64() * 1e3
    );
}
