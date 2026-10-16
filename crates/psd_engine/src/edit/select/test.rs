use super::*;
use std::f64::consts::PI;
use std::time::Instant;

/// Total coverage, in pixels.
fn area(r: &Raster) -> f64 {
    r.tile_keys()
        .filter_map(|(tx, ty)| r.tile(tx, ty))
        .flatten()
        .map(|&v| f64::from(v) / 255.0)
        .sum()
}

fn selection(r: Raster) -> Selection {
    Selection { mask: r }
}

fn close(got: f64, want: f64, share: f64) -> bool {
    (got - want).abs() <= want.abs() * share
}

/// Twice a polygon's signed area (negative when it runs counterclockwise
/// on screen, with y down).
fn area2(p: &[(f32, f32)]) -> f64 {
    (0..p.len())
        .map(|i| {
            let (a, b) = (p[i], p[(i + 1) % p.len()]);
            f64::from(a.0) * f64::from(b.1) - f64::from(b.0) * f64::from(a.1)
        })
        .sum()
}

#[test]
fn rectangles_cover_exactly() {
    let r = rect((10.25, 20.5, 30.5, 40.25));
    assert!(close(area(&r), 30.5 * 40.25, 0.001), "{}", area(&r));
    assert_eq!(r.get(20, 30)[0], 255);
    assert_eq!(r.get(10, 30)[0], 191);
    assert_eq!(r.get(40, 30)[0], 191);
    assert_eq!(r.get(10, 20)[0], 96);
    assert_eq!(r.get(9, 30)[0], 0);
    assert_eq!(r.origin(), (0, 0));
    // Negative sizes flip; no area or no numbers, no coverage.
    assert_eq!(rect((40.75, 60.75, -30.5, -40.25)), r);
    assert!(rect((5.0, 5.0, 0.0, 10.0)).is_empty());
    assert!(rect((f32::NAN, 5.0, 3.0, 10.0)).is_empty());
    // Whole tiles share one.
    let big = rect((0.0, 0.0, 1000.0, 600.0));
    assert!(close(area(&big), 600_000.0, 1e-9));
    let (a, b) = (big.tile_arc(0, 0).unwrap(), big.tile_arc(2, 1).unwrap());
    assert!(Arc::ptr_eq(&a, &b));
}

#[test]
fn ellipses_cover_their_area() {
    let want = PI * 50.0 * 30.0;
    for antialias in [true, false] {
        let e = ellipse((20.0, 30.0, 100.0, 60.0), antialias);
        assert!(close(area(&e), want, 0.01), "{antialias}: {}", area(&e));
        assert_eq!(e.get(70, 60)[0], 255);
        assert_eq!(e.get(21, 31)[0], 0);
        let values: Vec<u8> = e.read_vec(IRect::new(0, 0, 150, 100));
        let partial = values.iter().filter(|&&v| v != 0 && v != 255).count();
        assert_eq!(partial > 0, antialias);
    }
    let big = ellipse((-500.0, 100.0, 3000.0, 2000.0), true);
    assert!(close(area(&big), PI * 1500.0 * 1000.0, 0.002));
    assert!(ellipse((0.0, 0.0, 0.0, 5.0), true).is_empty());
}

#[test]
fn polygons_cover_their_area() {
    let triangle = [(0.0, 0.0), (100.0, 0.0), (0.0, 100.0)];
    for antialias in [true, false] {
        let p = polygon(&triangle, antialias);
        assert!(close(area(&p), 5000.0, 0.01), "{}", area(&p));
    }
    // A bow tie: both lobes (left and right), not the gaps between.
    let bow = polygon(
        &[(0.0, 0.0), (100.0, 100.0), (100.0, 0.0), (0.0, 100.0)],
        true,
    );
    assert!(close(area(&bow), 5000.0, 0.01));
    assert_eq!(bow.get(10, 50)[0], 255);
    assert_eq!(bow.get(90, 50)[0], 255);
    assert_eq!(bow.get(50, 10)[0], 0);
    // Points that are not numbers are skipped; fewer than three cover
    // nothing.
    let skipped = polygon(
        &[(0.0, 0.0), (f32::NAN, 3.0), (100.0, 0.0), (0.0, 100.0)],
        true,
    );
    assert!(close(area(&skipped), 5000.0, 0.01));
    assert!(polygon(&[(0.0, 0.0), (10.0, 10.0)], true).is_empty());
    assert!(polygon(&[], true).is_empty());
}

#[test]
fn combining_adds_subtracts_and_intersects() {
    let a = || rect((0.0, 0.0, 60.0, 60.0));
    let b = || rect((40.0, 40.0, 60.0, 60.0));
    let at = |s: &Selection| [(10, 10), (50, 50), (90, 90)].map(|(x, y)| s.coverage(x, y));

    let mut s = selection(a());
    combine(&mut s, b(), SelectMode::Replace);
    assert_eq!(at(&s), [0, 255, 255]);

    let mut s = selection(a());
    combine(&mut s, b(), SelectMode::Add);
    assert_eq!(at(&s), [255, 255, 255]);
    assert!(close(area(&s.mask), 3600.0 * 2.0 - 400.0, 1e-9));

    let mut s = selection(a());
    combine(&mut s, b(), SelectMode::Subtract);
    assert_eq!(at(&s), [255, 0, 0]);

    let mut s = selection(a());
    combine(&mut s, b(), SelectMode::Intersect);
    assert_eq!(at(&s), [0, 255, 0]);
    assert_eq!(s.bounds(), Some(IRect::new(40, 40, 20, 20)));

    // Partial coverage subtracts in proportion.
    let mut half = rect((0.0, 0.0, 60.0, 60.0));
    half.write(IRect::new(0, 0, 60, 60), &[128; 3600]);
    let mut s = selection(a());
    combine(&mut s, half, SelectMode::Subtract);
    assert_eq!(s.coverage(10, 10), 127);

    // Nothing left is nothing selected.
    let mut s = selection(a());
    combine(&mut s, a(), SelectMode::Subtract);
    assert!(s.is_empty());
    let mut s = selection(a());
    combine(
        &mut s,
        rect((300.0, 300.0, 5.0, 5.0)),
        SelectMode::Intersect,
    );
    assert!(s.is_empty());

    // An RGBA shape counts its alpha, wherever its grid starts.
    let mut layer = Raster::rgba();
    layer.set_origin((-37, 11));
    layer.write(IRect::new(5, 5, 10, 10), &[9, 9, 9, 200].repeat(100));
    let mut s = Selection::none();
    combine(&mut s, layer, SelectMode::Add);
    assert_eq!(s.mask.origin(), (0, 0));
    assert_eq!(s.coverage(7, 7), 200);
    assert_eq!(s.bounds(), Some(IRect::new(5, 5, 10, 10)));
}

#[test]
fn inverting_and_selecting_all() {
    let bounds = IRect::new(0, 0, 300, 100);
    let s = invert(&selection(rect((10.0, 10.0, 20.0, 20.0))), bounds);
    assert!(close(area(&s.mask), 30_000.0 - 400.0, 1e-9));
    assert_eq!(s.coverage(15, 15), 0);
    assert_eq!(s.coverage(50, 50), 255);
    assert_eq!(s.coverage(350, 50), 0);
    let everything = all(bounds);
    assert_eq!(everything.bounds(), Some(bounds));
    assert!(close(area(&everything.mask), 30_000.0, 1e-9));
    assert!(invert(&everything, bounds).is_empty());
    // Areas past a billion pixels are refused.
    assert!(all(IRect::new(-1_000_000, -1_000_000, 2_000_000, 2_000_000)).is_empty());
    assert!(all(IRect::new(i32::MAX - 5, 0, i32::MAX, 10)).is_empty());
    let sample = |_: i32, _: i32| [0u8; 4];
    let edge = IRect::new(i32::MAX - 5, 0, i32::MAX, 10);
    assert!(magic_wand(&sample, edge, (0, 0), 0, true, false).is_empty());
    assert!(rect((-1e7, -1e7, 2e7, 2e7)).is_empty());
    assert!(ellipse((-1e7, -1e7, 2e7, 2e7), true).is_empty());
    assert!(polygon(&[(-1e7, -1e7), (1e7, -1e7), (0.0, 1e7)], true).is_empty());
}

#[test]
fn feathering_softens_the_edge() {
    let s = selection(rect((100.0, 100.0, 50.0, 50.0)));
    let f = feather(&s, 10.0);
    assert!(close(area(&f.mask), 2500.0, 0.01), "{}", area(&f.mask));
    assert_eq!(f.coverage(125, 125), 255);
    let edge = i32::from(f.coverage(100, 125));
    assert!((edge - 140).abs() < 25, "{edge}");
    assert_eq!(f.coverage(60, 125), 0);
    let ramp: Vec<u8> = (88..112).map(|x| f.coverage(x, 125)).collect();
    assert!(ramp.windows(2).all(|w| w[0] <= w[1]), "{ramp:?}");
    assert_eq!(feather(&s, 0.0), s);
    assert_eq!(feather(&s, f32::NAN), s);
}

#[test]
fn expanding_grows_and_shrinks() {
    let s = selection(rect((100.0, 100.0, 40.0, 40.0)));
    let grown = expand(&s, 5);
    assert_eq!(grown.coverage(95, 120), 255);
    assert_eq!(grown.coverage(94, 120), 0);
    assert_eq!(grown.coverage(144, 120), 255);
    assert_eq!(grown.coverage(145, 120), 0);
    assert_eq!(grown.coverage(95, 95), 0, "corners round off");
    let want = 50.0 * 50.0 - (4.0 - PI) * 25.0;
    assert!(
        close(area(&grown.mask), want, 0.01),
        "{}",
        area(&grown.mask)
    );

    let shrunk = expand(&s, -5);
    assert_eq!(shrunk.bounds(), Some(IRect::new(105, 105, 30, 30)));
    assert!(close(area(&shrunk.mask), 900.0, 1e-9));
    assert!(expand(&s, -20).is_empty());
    assert_eq!(expand(&s, 0), s);
    // Far past the limit, it grows by the limit.
    let huge = expand(&selection(rect((0.0, 0.0, 2.0, 2.0))), 1_000_000);
    assert_eq!(huge.bounds().map(|b| b.w), Some(1002));
    // Holes fill in when growing.
    let mut ring = selection(rect((0.0, 0.0, 30.0, 30.0)));
    combine(
        &mut ring,
        rect((10.0, 10.0, 10.0, 10.0)),
        SelectMode::Subtract,
    );
    assert_eq!(expand(&ring, 5).coverage(15, 15), 255);
}

#[test]
fn expanding_is_seamless_across_tiles() {
    // A large rectangle keeps exact straight edges everywhere.
    let s = selection(rect((100.0, 100.0, 1200.0, 900.0)));
    let grown = expand(&s, 10);
    for y in (100..1000).step_by(37) {
        assert_eq!(grown.coverage(90, y), 255, "row {y}");
        assert_eq!(grown.coverage(89, y), 0, "row {y}");
        assert_eq!(grown.coverage(700, y), 255, "row {y}");
    }
    let shrunk = expand(&s, -10);
    assert_eq!(shrunk.bounds(), Some(IRect::new(110, 110, 1180, 880)));
    assert!(close(area(&shrunk.mask), 1180.0 * 880.0, 1e-9));

    // Small blobs on either side of tile seams, against a brute-force
    // distance to the nearest selected pixel.
    let blobs = [
        (3, 3),
        (520, 40),
        (530, 50),
        (1030, 1031),
        (40, 600),
        (1100, 15),
    ];
    let mut s = Selection::none();
    for &(x, y) in &blobs {
        let disk = ellipse((x as f32 - 3.0, y as f32 - 3.0, 6.0, 6.0), false);
        combine(&mut s, disk, SelectMode::Add);
    }
    let selected: Vec<(i32, i32)> = s
        .mask
        .tile_keys()
        .flat_map(|(tx, ty)| {
            let r = s.mask.tile_rect(tx, ty);
            (r.y..r.bottom()).flat_map(move |y| (r.x..r.right()).map(move |x| (x, y)))
        })
        .filter(|&(x, y)| s.coverage(x, y) >= 128)
        .collect();
    let grown = expand(&s, 9);
    for &(bx, by) in &blobs {
        for y in (by - 14..by + 14).step_by(3) {
            for x in (bx - 14..bx + 14).step_by(2) {
                let d2 = selected
                    .iter()
                    .map(|&(sx, sy)| f64::from((sx - x).pow(2) + (sy - y).pow(2)))
                    .fold(f64::INFINITY, f64::min);
                let edge = (10.0 - d2.min(121.0).sqrt()).clamp(0.0, 1.0);
                let want = ((edge * 255.0 + 0.5) as u8).max(s.coverage(x, y));
                assert_eq!(grown.coverage(x, y), want, "({x}, {y})");
            }
        }
    }
}

#[test]
fn transparency_becomes_a_selection() {
    let mut layer = Raster::rgba();
    layer.set_origin((3, -7));
    layer.write(
        IRect::new(10, 10, 4, 1),
        &[1, 2, 3, 0, 1, 2, 3, 64, 0, 0, 0, 255, 9, 9, 9, 128],
    );
    let s = from_alpha(&layer);
    assert_eq!(s.mask.origin(), (0, 0));
    let row: Vec<u8> = (10..14).map(|x| s.coverage(x, 10)).collect();
    assert_eq!(row, vec![0, 64, 255, 128]);
    let mut mask = Raster::gray();
    mask.put(5, 6, &[77]);
    assert_eq!(from_alpha(&mask).coverage(5, 6), 77);
}

#[test]
fn a_rectangles_outline_is_its_corners() {
    let s = selection(rect((10.0, 20.0, 30.0, 40.0)));
    let outline = outline(&s, 1000);
    assert_eq!(outline.len(), 1);
    let mut corners = outline[0].clone();
    assert_eq!(corners.len(), 4, "{corners:?}");
    assert!(area2(&corners) < 0.0, "counterclockwise on screen");
    corners.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert_eq!(
        corners,
        vec![(10.0, 20.0), (10.0, 60.0), (40.0, 20.0), (40.0, 60.0)]
    );
}

#[test]
fn outlines_trace_holes_and_islands() {
    let mut donut = selection(ellipse((0.0, 0.0, 200.0, 200.0), true));
    combine(
        &mut donut,
        ellipse((50.0, 50.0, 100.0, 100.0), true),
        SelectMode::Subtract,
    );
    let rings = outline(&donut, 10_000);
    assert_eq!(rings.len(), 2);
    let (outer, hole) = if rings[0].len() > rings[1].len() {
        (&rings[0], &rings[1])
    } else {
        (&rings[1], &rings[0])
    };
    assert!(area2(outer) < 0.0 && area2(hole) > 0.0);
    // The antialiased edges trace the circles closely.
    for &(x, y) in outer {
        let r = f64::from(x - 100.0).hypot(f64::from(y - 100.0));
        assert!((r - 100.0).abs() < 0.6, "{r}");
    }
    for &(x, y) in hole {
        let r = f64::from(x - 100.0).hypot(f64::from(y - 100.0));
        assert!((r - 50.0).abs() < 0.6, "{r}");
    }
    assert!(close(-area2(outer) / 2.0, PI * 100.0 * 100.0, 0.01));

    // Islands, each counterclockwise.
    let mut two = selection(rect((0.0, 0.0, 10.0, 10.0)));
    combine(&mut two, rect((300.0, 300.0, 10.0, 10.0)), SelectMode::Add);
    let islands = outline(&two, 100);
    assert_eq!(islands.len(), 2);
    assert!(islands.iter().all(|p| p.len() == 4 && area2(p) < 0.0));
    // A one-pixel selection is that pixel.
    let mut dot = Raster::gray();
    dot.put(7, 9, &[255]);
    assert_eq!(outline(&selection(dot), 100)[0].len(), 4);
    assert!(outline(&Selection::none(), 100).is_empty());
}

#[test]
fn outlines_fit_their_budget() {
    let circle = selection(ellipse((0.0, 0.0, 400.0, 400.0), true));
    let full = outline(&circle, usize::MAX);
    assert!(full[0].len() > 500);
    for budget in [200, 50, 8] {
        let fitted = outline(&circle, budget);
        let points: usize = fitted.iter().map(Vec::len).sum();
        assert!(points <= budget && points >= 3, "{budget}: {points}");
        // Still about the circle.
        let a = -area2(&fitted[0]) / 2.0;
        assert!(close(
            a,
            PI * 200.0 * 200.0,
            if budget > 20 { 0.02 } else { 0.4 }
        ));
    }
    // When even three points each are too many, the smallest go.
    let mut two = selection(rect((0.0, 0.0, 10.0, 10.0)));
    combine(&mut two, rect((300.0, 300.0, 40.0, 40.0)), SelectMode::Add);
    let one = outline(&two, 5);
    assert_eq!(one.len(), 1);
    assert!(one[0].iter().all(|&(x, _)| x >= 300.0));
    assert!(outline(&two, 2).is_empty());
}

/// A white canvas with two black squares, joined by a dark gray bar, and
/// a transparent corner.
fn shapes() -> Raster {
    let mut r = Raster::from_region(4, IRect::new(0, 0, 100, 60), &[255; 24_000]);
    r.write(IRect::new(10, 10, 20, 20), &[0, 0, 0, 255].repeat(400));
    r.write(IRect::new(60, 10, 20, 20), &[0, 0, 0, 255].repeat(400));
    r.write(IRect::new(30, 18, 30, 4), &[20, 20, 20, 255].repeat(120));
    r.write(IRect::new(90, 50, 10, 10), &[0; 400]);
    r.write(IRect::new(95, 55, 1, 1), &[200, 10, 10, 0]);
    r
}

#[test]
fn the_magic_wand_selects_like_pixels() {
    let src = shapes();
    let sample = |x: i32, y: i32| src.get(x, y);
    let bounds = IRect::new(0, 0, 100, 60);
    let square = magic_wand(&sample, bounds, (15, 15), 10, true, false);
    assert_eq!(
        selection(square.clone()).bounds(),
        Some(IRect::new(10, 10, 20, 20))
    );
    assert!(close(area(&square), 400.0, 1e-9));
    let joined = magic_wand(&sample, bounds, (15, 15), 30, true, false);
    assert!(close(area(&joined), 920.0, 1e-9));
    let scattered = magic_wand(&sample, bounds, (15, 15), 10, false, false);
    assert!(close(area(&scattered), 800.0, 1e-9));
    // Transparent pixels match whatever color they hide.
    let clear = magic_wand(&sample, bounds, (91, 51), 0, true, false);
    assert!(close(area(&clear), 100.0, 1e-9));
    // Bounds limit the search; a seed outside finds nothing.
    let limited = magic_wand(&sample, IRect::new(0, 0, 20, 60), (15, 15), 10, true, false);
    assert!(close(area(&limited), 200.0, 1e-9));
    assert!(magic_wand(&sample, bounds, (-5, 5), 10, true, false).is_empty());
}

#[test]
fn the_magic_wand_antialiases_staircases_only() {
    // A hard-edged triangle: its staircase softens, its straight sides do
    // not.
    let tri = polygon(&[(0.0, 0.0), (64.0, 0.0), (0.0, 64.0)], false);
    let sample = |x: i32, y: i32| {
        let v = tri.get(x, y)[0];
        [v, v, v, 255]
    };
    let bounds = IRect::new(0, 0, 80, 80);
    let hard = magic_wand(&sample, bounds, (2, 2), 0, true, false);
    let soft = magic_wand(&sample, bounds, (2, 2), 0, true, true);
    assert!(close(area(&soft), area(&hard), 0.02));
    assert_eq!(soft.get(0, 30)[0], 255);
    assert_eq!(soft.get(30, 0)[0], 255);
    let values: Vec<u8> = soft.read_vec(IRect::new(0, 0, 80, 80));
    assert!(values.iter().any(|&v| v != 0 && v != 255));
}

/// Times outlines and selection morphology on a large selection.
#[test]
#[ignore = "benchmark: cargo test -p psd_engine --release -- --ignored --nocapture"]
fn bench_selections() {
    let start = Instant::now();
    let mut s = selection(ellipse((0.0, 0.0, 4000.0, 3000.0), true));
    combine(
        &mut s,
        polygon(&[(500.0, 500.0), (3500.0, 800.0), (2000.0, 2600.0)], true),
        SelectMode::Subtract,
    );
    println!(
        "selections: shapes {:.1} ms",
        start.elapsed().as_secs_f64() * 1e3
    );
    let start = Instant::now();
    let rings = outline(&s, 2000);
    println!(
        "selections: outline of 4000×3000 ({} polygons) {:.1} ms",
        rings.len(),
        start.elapsed().as_secs_f64() * 1e3
    );
    let start = Instant::now();
    let _ = feather(&s, 20.0);
    println!(
        "selections: feather 20 {:.1} ms",
        start.elapsed().as_secs_f64() * 1e3
    );
    let start = Instant::now();
    let _ = expand(&s, 40);
    println!(
        "selections: expand 40 {:.1} ms",
        start.elapsed().as_secs_f64() * 1e3
    );
}
