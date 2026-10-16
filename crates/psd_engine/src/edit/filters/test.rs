use super::*;
use crate::edit::select;
use std::time::Instant;

/// A raster holding `px` over `rect`.
fn solid(rect: IRect, px: [u8; 4]) -> Raster {
    Raster::from_region(4, rect, &px.repeat(rect.area() as usize))
}

/// Shapes in several colors and opacities.
fn shapes() -> Raster {
    let mut r = solid(IRect::new(20, 30, 60, 40), [200, 40, 10, 255]);
    r.write(IRect::new(50, 50, 30, 30), &[10, 90, 250, 128].repeat(900));
    r.write(IRect::new(90, 20, 5, 70), &[255, 255, 255, 255].repeat(350));
    r
}

/// Total premultiplied red, green, blue and alpha.
fn mass(r: &Raster) -> [f64; 4] {
    let Some(b) = r.content_bounds() else {
        return [0.0; 4];
    };
    let mut out = [0.0; 4];
    for p in r.read_vec(b).chunks(4) {
        let a = f64::from(p[3]);
        for (o, &v) in out.iter_mut().zip(&p[..3]) {
            *o += f64::from(v) * a / 255.0;
        }
        out[3] += a;
    }
    out
}

fn close(got: f64, want: f64, share: f64) -> bool {
    (got - want).abs() <= want.abs() * share
}

fn selection(shape: Raster) -> Selection {
    Selection { mask: shape }
}

#[test]
fn blurs_keep_the_premultiplied_mass() {
    let src = shapes();
    let before = mass(&src);
    // Wide blurs lose a little to faint tails rounding to nothing.
    for (radius, share) in [
        (0.7, 0.002),
        (2.5, 0.002),
        (6.0, 0.003),
        (30.0, 0.006),
        (80.0, 0.03),
    ] {
        let mut r = src.clone();
        let changed = gaussian_blur(&mut r, None, radius).unwrap();
        let after = mass(&r);
        for (a, b) in after.iter().zip(&before) {
            assert!(
                close(*a, *b, share),
                "radius {radius}: {after:?} vs {before:?}"
            );
        }
        // The content spreads about three radii, no further.
        let spread = r.content_bounds().unwrap();
        let reach = (3.0 * radius).ceil() as i32 + 1;
        assert!(
            IRect::new(20, 20, 75, 70)
                .outset(reach)
                .contains_rect(&spread),
            "{radius}: {spread:?}"
        );
        assert!(changed.contains_rect(&spread));
    }
}

#[test]
fn blurs_are_symmetric_and_keep_edges_their_color() {
    let mut dot = solid(IRect::new(50, 50, 1, 1), [255, 255, 255, 255]);
    gaussian_blur(&mut dot, None, 2.0);
    for d in 1..6 {
        assert_eq!(dot.get(50 - d, 50), dot.get(50 + d, 50));
        assert_eq!(dot.get(50, 50 - d), dot.get(50, 50 + d));
        assert_eq!(dot.get(50 - d, 50), dot.get(50, 50 - d));
    }
    // Transparent surroundings fade the edge without darkening it.
    let mut red = solid(IRect::new(10, 10, 30, 30), [230, 20, 0, 255]);
    gaussian_blur(&mut red, None, 4.0);
    let edge = red.read_vec(IRect::new(0, 25, 50, 1));
    for p in edge.chunks(4).filter(|p| p[3] >= 8) {
        assert!(
            p[0].abs_diff(230) <= 2 && p[1].abs_diff(20) <= 2 && p[2] == 0,
            "{p:?}"
        );
    }
    assert!(edge.chunks(4).any(|p| p[3] > 0 && p[3] < 255));
}

#[test]
fn blurs_stay_within_the_selection() {
    let src = shapes();
    let mut s = selection(select::rect((40.0, 0.0, 30.0, 100.0)));
    let mut faint = select::rect((70.0, 0.0, 30.0, 100.0));
    faint.write(IRect::new(70, 0, 30, 100), &[128; 3000]);
    select::combine(&mut s, faint, select::SelectMode::Add);
    let mut r = src.clone();
    let changed = gaussian_blur(&mut r, Some(&s), 5.0).unwrap();
    assert!(IRect::new(40, 0, 60, 100).contains_rect(&changed));
    for y in 0..100 {
        for x in (0..40).chain(100..120) {
            assert_eq!(r.get(x, y), src.get(x, y));
        }
    }
    // Partial selection: half way (premultiplied) between the original
    // and the blur.
    let mut full = src.clone();
    gaussian_blur(&mut full, None, 5.0);
    let premultiplied = |p: [u8; 4]| {
        let a = f64::from(p[3]);
        [0, 1, 2]
            .map(|i| f64::from(p[i]) * a / 255.0)
            .into_iter()
            .chain([a])
    };
    for (x, y) in [(75, 40), (88, 50), (92, 30)] {
        let (o, b, h) = (src.get(x, y), full.get(x, y), r.get(x, y));
        for ((o, b), h) in premultiplied(o).zip(premultiplied(b)).zip(premultiplied(h)) {
            assert!((h - (o + b) / 2.0).abs() <= 2.0, "{o} {b} {h}");
        }
    }
    // An empty selection selects nothing.
    let mut r = src.clone();
    assert_eq!(gaussian_blur(&mut r, Some(&Selection::none()), 5.0), None);
    assert_eq!(r, src);
}

#[test]
fn masks_blur_their_values() {
    let mut mask = Raster::from_region(1, IRect::new(10, 10, 20, 20), &[200; 400]);
    gaussian_blur(&mut mask, None, 3.0);
    let b = mask.content_bounds().unwrap();
    let total: f64 = mask.read_vec(b).iter().map(|&v| f64::from(v)).sum();
    assert!(close(total, 400.0 * 200.0, 0.002), "{total}");
    assert_eq!(mask.get(20, 20)[0], 200);
    assert!(mask.get(8, 20)[0] > 0);
}

#[test]
fn degenerate_blurs() {
    let src = shapes();
    let mut r = src.clone();
    assert_eq!(gaussian_blur(&mut r, None, 0.01), None);
    assert_eq!(gaussian_blur(&mut r, None, f32::NAN), None);
    assert_eq!(gaussian_blur(&mut r, None, -4.0), None);
    assert_eq!(r, src);
    assert_eq!(gaussian_blur(&mut Raster::rgba(), None, 5.0), None);
    // Huge radii clamp; a small spot fades to nothing.
    let mut spot = solid(IRect::new(0, 0, 4, 4), [255; 4]);
    gaussian_blur(&mut spot, None, 1e9);
    assert!(spot.content_bounds().is_none());
}

/// A step from dark to light gray at x = 20.
fn step() -> Raster {
    let mut r = solid(IRect::new(0, 0, 40, 10), [60, 60, 60, 255]);
    r.write(IRect::new(20, 0, 20, 10), &[190, 190, 190, 255].repeat(200));
    r
}

#[test]
fn unsharp_mask_raises_edge_contrast() {
    let src = step();
    let mut r = src.clone();
    let changed = unsharp_mask(&mut r, None, 1.0, 2.0, 0).unwrap();
    assert!(
        r.get(19, 5)[0] < 60 && r.get(20, 5)[0] > 190,
        "{:?} {:?}",
        r.get(19, 5),
        r.get(20, 5)
    );
    assert_eq!(r.get(2, 5), src.get(2, 5), "flat areas stay");
    assert_eq!(r.get(19, 5)[3], 255);
    assert_eq!(r.content_bounds(), src.content_bounds(), "nothing spreads");
    assert!(IRect::new(0, 0, 40, 10).contains_rect(&changed));
    // Stronger amounts push further; a high threshold leaves it alone.
    let mut strong = src.clone();
    unsharp_mask(&mut strong, None, 3.0, 2.0, 0);
    assert!(strong.get(19, 5)[0] < r.get(19, 5)[0]);
    let mut calm = src.clone();
    assert_eq!(unsharp_mask(&mut calm, None, 1.0, 2.0, 200), None);
    assert_eq!(unsharp_mask(&mut calm, None, 0.0, 2.0, 0), None);
    // Masks sharpen their values.
    let mut mask = Raster::from_region(1, IRect::new(0, 0, 40, 10), &[60; 400]);
    mask.write(IRect::new(20, 0, 20, 10), &[190; 200]);
    unsharp_mask(&mut mask, None, 1.0, 2.0, 0);
    assert!(mask.get(19, 5)[0] < 60 && mask.get(20, 5)[0] > 190);
}

#[test]
fn noise_is_deterministic() {
    let mut src = solid(IRect::new(0, 0, 64, 64), [128, 128, 128, 255]);
    src.write(IRect::new(0, 0, 8, 8), &[0; 256]);
    let noisy = |seed: u64, gaussian: bool, monochrome: bool| {
        let mut r = src.clone();
        add_noise(&mut r, None, 0.2, gaussian, monochrome, seed);
        r
    };
    assert_eq!(noisy(7, false, false), noisy(7, false, false));
    assert_ne!(noisy(7, false, false), noisy(8, false, false));
    let r = noisy(7, false, true);
    let values = r.read_vec(IRect::new(8, 8, 56, 56));
    assert!(
        values
            .chunks(4)
            .all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255)
    );
    assert!(values.chunks(4).all(|p| p[0].abs_diff(128) <= 52));
    assert!(values.chunks(4).any(|p| p[0].abs_diff(128) > 40));
    assert_eq!(r.get(3, 3), [0; 4], "transparent pixels stay");
    // Colored noise moves channels apart; Gaussian noise has the asked
    // spread.
    let colored = noisy(7, false, false).read_vec(IRect::new(8, 8, 56, 56));
    assert!(colored.chunks(4).any(|p| p[0] != p[1]));
    let g = noisy(3, true, true).read_vec(IRect::new(8, 8, 56, 56));
    let n = (g.len() / 4) as f64;
    let var = g
        .chunks(4)
        .map(|p| (f64::from(p[0]) - 128.0).powi(2))
        .sum::<f64>()
        / n;
    assert!((var.sqrt() - 25.5).abs() < 3.0, "{}", var.sqrt());
    // The same noise lands on the same canvas pixel wherever the grid
    // starts.
    let mut moved = src.realigned((-100, 3));
    add_noise(&mut moved, None, 0.2, false, false, 7);
    let rect = IRect::new(0, 0, 64, 64);
    assert_eq!(moved.read_vec(rect), noisy(7, false, false).read_vec(rect));
}

#[test]
fn mosaic_averages_cells() {
    let rect = IRect::new(3, 5, 29, 27);
    let data: Vec<u8> = (rect.y..rect.bottom())
        .flat_map(|y| {
            (rect.x..rect.right()).flat_map(move |x| [(x * 8) as u8, (y * 8) as u8, 100, 255])
        })
        .collect();
    let mut r = Raster::from_region(4, rect, &data);
    let changed = mosaic(&mut r, None, 8).unwrap();
    // Cells line up with the canvas origin; edge cells take in the
    // transparency around the content.
    assert_eq!(changed, IRect::new(0, 0, 32, 32));
    let cell = r.read_vec(IRect::new(8, 8, 8, 8));
    assert!(cell.chunks(4).all(|p| p == &cell[..4]));
    assert_eq!(&cell[..4], &[92, 92, 100, 255]);
    let corner = r.get(0, 0);
    assert_eq!(corner[3], 60, "15 of 64 pixels: {corner:?}");
    assert_eq!(mosaic(&mut r, None, 1), None);
}

#[test]
fn motion_blur_smears_along_its_angle() {
    let line = |rect: IRect| solid(rect, [255, 255, 255, 255]);
    // A vertical bar smeared sideways, five pixels each way.
    let src = line(IRect::new(50, 20, 6, 40));
    let mut r = src.clone();
    motion_blur(&mut r, None, 0.0, 10.0).unwrap();
    let row: Vec<u8> = (40..66).map(|x| r.get(x, 40)[3]).collect();
    assert_eq!(row.iter().filter(|&&a| a > 0).count(), 16, "{row:?}");
    assert_eq!(r.get(50, 19)[3], 0, "no spread across the motion");
    assert!(close(mass(&r)[3], mass(&src)[3], 0.01));
    // Plumb.
    let src = line(IRect::new(20, 50, 40, 1));
    let mut r = src.clone();
    motion_blur(&mut r, None, 90.0, 10.0).unwrap();
    assert!(r.get(40, 45)[3] > 0 && r.get(19, 50)[3] == 0);
    // Long blurs at an angle keep their mass and run along the angle.
    for (angle, distance) in [(30.0, 100.0), (0.0, 120.0), (-90.0, 80.0)] {
        let src = solid(IRect::new(100, 100, 6, 6), [255, 255, 255, 255]);
        let mut r = src.clone();
        motion_blur(&mut r, None, angle, distance).unwrap();
        assert!(
            close(mass(&r)[3], mass(&src)[3], 0.03),
            "{angle}: {:?}",
            mass(&r)
        );
        let (s, c) = f64::from(angle).to_radians().sin_cos();
        let (x, y) = (103.0 + 35.0 * c, 103.0 - 35.0 * s);
        assert!(r.get(x as i32, y as i32)[3] > 0, "{angle}: along");
        let (x, y) = (103.0 + 35.0 * s, 103.0 + 35.0 * c);
        assert_eq!(r.get(x as i32, y as i32)[3], 0, "{angle}: across");
    }
    let mut r = shapes();
    assert_eq!(motion_blur(&mut r, None, 0.0, 0.5), None);
    assert_eq!(motion_blur(&mut r, None, f32::NAN, 5.0), None);
}

#[test]
fn map_pixels_blends_by_selection() {
    let src = shapes();
    let mut r = src.clone();
    let mut s = selection(select::rect((0.0, 0.0, 50.0, 100.0)));
    let mut half = select::rect((50.0, 0.0, 50.0, 100.0));
    half.write(IRect::new(50, 0, 50, 100), &[128; 5000]);
    select::combine(&mut s, half, select::SelectMode::Add);
    let mut invert = |px: &mut [u8]| {
        for v in &mut px[..3] {
            *v = 255 - *v;
        }
    };
    let changed = map_pixels(&mut r, Some(&s), &mut invert).unwrap();
    assert_eq!(r.get(30, 40), [55, 215, 245, 255]);
    assert_eq!(r.get(70, 40), [127, 128, 128, 255]);
    assert_eq!(r.get(10, 10), [0; 4], "transparent stays");
    assert_eq!(r.get(92, 50), [127, 127, 127, 255]);
    assert!(IRect::new(20, 20, 80, 70).contains_rect(&changed));
    // Masks go through as gray.
    let mut mask = Raster::from_region(1, IRect::new(0, 0, 2, 1), &[10, 200]);
    map_pixels(&mut mask, None, &mut invert);
    assert_eq!(mask.read_vec(IRect::new(0, 0, 2, 1)), vec![245, 55]);
}

/// Times filters on a 4000 × 3000 layer.
#[test]
#[ignore = "benchmark: cargo test -p psd_engine --release -- --ignored --nocapture"]
fn bench_filters() {
    let rect = IRect::new(0, 0, 4000, 3000);
    let data: Vec<u8> = (0..rect.h)
        .flat_map(|y| {
            (0..rect.w).flat_map(move |x| [(x ^ y) as u8, (x * 3) as u8, (y * 5) as u8, 255])
        })
        .collect();
    let src = Raster::from_region(4, rect, &data);
    let time = |name: &str, f: &mut dyn FnMut(&mut Raster)| {
        let mut r = src.clone();
        let start = Instant::now();
        f(&mut r);
        println!(
            "filters: 4000×3000 {name}: {:.1} ms",
            start.elapsed().as_secs_f64() * 1e3
        );
    };
    time("gaussian blur 2", &mut |r| {
        gaussian_blur(r, None, 2.0);
    });
    time("gaussian blur 10", &mut |r| {
        gaussian_blur(r, None, 10.0);
    });
    time("gaussian blur 100", &mut |r| {
        gaussian_blur(r, None, 100.0);
    });
    time("unsharp mask 1.5", &mut |r| {
        unsharp_mask(r, None, 1.0, 1.5, 2);
    });
    time("motion blur 10 at 30°", &mut |r| {
        motion_blur(r, None, 30.0, 10.0);
    });
    time("motion blur 200 at 30°", &mut |r| {
        motion_blur(r, None, 30.0, 200.0);
    });
    time("add noise", &mut |r| {
        add_noise(r, None, 0.1, true, false, 1);
    });
    time("mosaic 16", &mut |r| {
        mosaic(r, None, 16);
    });
}
