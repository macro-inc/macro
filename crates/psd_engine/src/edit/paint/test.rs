use super::*;
use crate::edit::select;
use crate::model::{ColorStop, GradientKind, OpacityStop};
use std::time::Instant;

fn brush(size: f32) -> Brush {
    Brush {
        size,
        ..Brush::default()
    }
}

/// Paints one stroke through `points` (full pressure) and returns the
/// changed area.
fn stroke(target: &mut Raster, brush: Brush, points: &[(f32, f32)]) -> Option<IRect> {
    let points: Vec<_> = points.iter().map(|&(x, y)| (x, y, 1.0)).collect();
    Stroke::new(brush).add(target, None, false, &points)
}

/// An opaque raster of one color over `rect`.
fn solid(rect: IRect, px: [u8; 4]) -> Raster {
    let data = px.repeat(rect.area() as usize);
    Raster::from_region(4, rect, &data)
}

/// Total alpha (in pixels' worth) of a column of pixels.
fn column_alpha(r: &Raster, x: i32, ys: std::ops::Range<i32>) -> f32 {
    ys.map(|y| f32::from(r.get(x, y)[3]) / 255.0).sum()
}

#[test]
fn a_straight_stroke_paints_a_band_of_the_brush_width() {
    let mut r = Raster::rgba();
    let changed = stroke(&mut r, brush(10.0), &[(20.0, 50.0), (180.0, 50.0)]).unwrap();
    // A dab sits at x = 100 (every 2.5 pixels from 20).
    for y in 45..55 {
        assert!(r.get(100, y)[3] >= 250, "row {y} is inside the band");
        assert_eq!(&r.get(100, y)[..3], &[0, 0, 0]);
    }
    for y in (0..44).chain(56..100) {
        assert_eq!(r.get(100, y)[3], 0, "row {y} is outside the band");
    }
    // Every column along the stroke covers about the brush's width.
    for x in [40, 77, 100, 133, 160] {
        let total = column_alpha(&r, x, 30..70);
        assert!((total - 10.0).abs() < 0.35, "column {x} covers {total}");
    }
    assert_eq!(changed, IRect::from_ltrb(15, 45, 185, 55));
    assert_eq!(r.content_bounds(), Some(changed));
}

#[test]
fn dabs_fall_every_spacing_times_size() {
    let mut r = Raster::rgba();
    let pencil = Brush {
        size: 1.0,
        spacing: 5.0,
        pencil: true,
        ..Brush::default()
    };
    stroke(&mut r, pencil, &[(0.5, 0.5), (30.5, 0.5)]);
    let painted: Vec<i32> = (0..40).filter(|&x| r.get(x, 0)[3] != 0).collect();
    assert_eq!(painted, vec![0, 5, 10, 15, 20, 25, 30]);
}

#[test]
fn spacing_carries_across_points() {
    let mut r = Raster::rgba();
    let pencil = Brush {
        size: 1.0,
        spacing: 4.0,
        pencil: true,
        ..Brush::default()
    };
    // Segments shorter than the spacing still place dabs every 4 pixels.
    let points: Vec<(f32, f32)> = (0..=20).map(|i| (0.5 + i as f32 * 1.5, 0.5)).collect();
    stroke(&mut r, pencil, &points);
    let painted: Vec<i32> = (0..40).filter(|&x| r.get(x, 0)[3] != 0).collect();
    assert_eq!(painted, vec![0, 4, 8, 12, 16, 20, 24, 28]);
}

#[test]
fn opacity_caps_a_stroke_that_crosses_itself() {
    let half = Brush {
        opacity: 0.5,
        ..brush(12.0)
    };
    let mut r = Raster::rgba();
    // Back and forth, then across.
    stroke(
        &mut r,
        half.clone(),
        &[
            (20.0, 50.0),
            (180.0, 50.0),
            (20.0, 50.0),
            (180.0, 50.0),
            (100.0, 0.0),
            (100.0, 100.0),
        ],
    );
    assert_eq!(r.get(100, 50)[3], 128);
    assert_eq!(r.get(60, 50)[3], 128);
    assert_eq!(r.get(100, 20)[3], 128);
    // Two strokes are not capped together.
    stroke(&mut r, half, &[(20.0, 50.0), (180.0, 50.0)]);
    assert_eq!(r.get(60, 50)[3], 192);
}

#[test]
fn flow_builds_up_within_a_stroke() {
    let light = Brush {
        flow: 0.2,
        ..brush(20.0)
    };
    let mut once = Raster::rgba();
    stroke(&mut once, light.clone(), &[(50.0, 50.0)]);
    assert_eq!(once.get(50, 50)[3], 51, "one dab adds its flow");

    let mut many = Raster::rgba();
    stroke(&mut many, light.clone(), &[(10.0, 50.0), (90.0, 50.0)]);
    // A pixel on the path is under four dabs: 1 - 0.8^4 of full.
    let a = f32::from(many.get(50, 50)[3]) / 255.0;
    assert!((a - (1.0 - 0.8f32.powi(4))).abs() < 0.01, "{a}");

    // Going over it again builds up further, but opacity still caps it.
    let capped = Brush {
        opacity: 0.6,
        ..light
    };
    let mut r = Raster::rgba();
    let pass: Vec<(f32, f32)> = (0..12)
        .map(|i| {
            if i % 2 == 0 {
                (10.0, 50.0)
            } else {
                (90.0, 50.0)
            }
        })
        .collect();
    stroke(&mut r, capped, &pass);
    let a = r.get(50, 50)[3];
    assert!((150..=153).contains(&a), "{a}");
}

#[test]
fn soft_brushes_fall_off_smoothly() {
    let soft = Brush {
        hardness: 0.0,
        ..brush(40.0)
    };
    let mut r = Raster::rgba();
    stroke(&mut r, soft, &[(100.0, 100.0)]);
    let profile: Vec<u8> = (100..122).map(|x| r.get(x, 100)[3]).collect();
    assert!(profile[0] >= 250, "full at the center: {profile:?}");
    assert!(
        profile.windows(2).all(|w| w[1] <= w[0]),
        "falls: {profile:?}"
    );
    assert!(
        profile[10] > 60 && profile[10] < 160,
        "half way: {profile:?}"
    );
    assert_eq!(profile[20], 0, "nothing at the rim: {profile:?}");
}

#[test]
fn pencil_strokes_are_aliased() {
    let mut r = Raster::rgba();
    let pencil = Brush {
        pencil: true,
        ..brush(7.0)
    };
    stroke(&mut r, pencil, &[(10.0, 10.0), (90.0, 63.0)]);
    let rect = IRect::new(0, 0, 100, 80);
    let alphas: Vec<u8> = r.read_vec(rect).chunks(4).map(|p| p[3]).collect();
    assert!(alphas.iter().all(|&a| a == 0 || a == 255));
    assert!(alphas.iter().filter(|&&a| a == 255).count() > 500);

    // A one-pixel pencil paints exactly one pixel per dab.
    let mut dot = Raster::rgba();
    let one = Brush {
        pencil: true,
        ..brush(1.0)
    };
    stroke(&mut dot, one, &[(5.0, 5.0)]);
    assert_eq!(dot.content_bounds(), Some(IRect::new(5, 5, 1, 1)));

    // A brush (not a pencil) antialiases its edge.
    let mut soft = Raster::rgba();
    stroke(&mut soft, brush(7.0), &[(10.0, 10.0), (90.0, 63.0)]);
    let partial = soft
        .read_vec(rect)
        .chunks(4)
        .filter(|p| p[3] != 0 && p[3] != 255)
        .count();
    assert!(partial > 50);
}

#[test]
fn erasing_removes_alpha() {
    let rect = IRect::new(0, 0, 200, 100);
    let mut r = solid(rect, [200, 10, 10, 255]);
    let eraser = Brush {
        mode: BrushMode::Erase,
        ..brush(10.0)
    };
    stroke(&mut r, eraser.clone(), &[(20.0, 30.0), (180.0, 30.0)]);
    assert_eq!(r.get(100, 30), [0, 0, 0, 0]);
    assert_eq!(r.get(100, 60), [200, 10, 10, 255]);

    let half = Brush {
        opacity: 0.5,
        ..eraser
    };
    stroke(&mut r, half, &[(20.0, 70.0), (180.0, 70.0)]);
    assert_eq!(r.get(100, 70), [200, 10, 10, 128]);
    // Erasing nothing changes nothing.
    let mut empty = Raster::rgba();
    let eraser = Brush {
        mode: BrushMode::Erase,
        ..brush(10.0)
    };
    assert_eq!(stroke(&mut empty, eraser, &[(5.0, 5.0), (50.0, 5.0)]), None);
    assert!(empty.is_empty());
}

#[test]
fn locked_alpha_recolors_without_spreading() {
    let mut r = solid(IRect::new(0, 0, 100, 100), [255, 255, 255, 255]);
    let red = Brush {
        color: Rgb::new(1.0, 0.0, 0.0),
        ..brush(10.0)
    };
    let points = [(20.0, 50.0, 1.0), (180.0, 50.0, 1.0)];
    let changed = Stroke::new(red.clone()).add(&mut r, None, true, &points);
    assert_eq!(r.get(60, 50), [255, 0, 0, 255]);
    assert_eq!(
        r.get(150, 50),
        [0, 0, 0, 0],
        "transparent stays transparent"
    );
    assert_eq!(changed.map(|c| c.right()), Some(100));
    assert_eq!(r.content_bounds(), Some(IRect::new(0, 0, 100, 100)));

    // Erasing with alpha locked paints the color, as Photoshop paints the
    // background color.
    let eraser = Brush {
        mode: BrushMode::Erase,
        color: Rgb::new(0.0, 0.0, 1.0),
        ..brush(10.0)
    };
    let points = [(20.0, 20.0, 1.0), (80.0, 20.0, 1.0)];
    Stroke::new(eraser).add(&mut r, None, true, &points);
    assert_eq!(r.get(50, 20), [0, 0, 255, 255]);
}

#[test]
fn a_selection_clips_and_scales_the_stroke() {
    let mut selection = Selection::none();
    select::combine(
        &mut selection,
        select::rect((0.0, 0.0, 100.0, 200.0)),
        select::SelectMode::Replace,
    );
    let mut half = select::rect((100.0, 0.0, 50.0, 200.0));
    let data: Vec<u8> = half
        .read_vec(IRect::new(100, 0, 50, 200))
        .iter()
        .map(|v| v / 2 + 1)
        .collect();
    half.write(IRect::new(100, 0, 50, 200), &data);
    select::combine(&mut selection, half, select::SelectMode::Add);

    let mut r = Raster::rgba();
    let points = [(20.0, 50.0, 1.0), (220.0, 50.0, 1.0)];
    let changed = Stroke::new(brush(10.0)).add(&mut r, Some(&selection), false, &points);
    assert_eq!(r.get(50, 50)[3], 255);
    assert_eq!(r.get(120, 50)[3], 128);
    assert_eq!(r.get(170, 50)[3], 0);
    assert_eq!(changed.map(|c| c.right()), Some(150));

    // An empty selection selects nothing.
    let mut r = Raster::rgba();
    let none = Selection::none();
    assert_eq!(
        Stroke::new(brush(10.0)).add(&mut r, Some(&none), false, &points),
        None
    );
    assert!(r.is_empty());
}

#[test]
fn batching_points_never_changes_the_stroke() {
    let path: Vec<(f32, f32, f32)> = (0..80)
        .map(|i| {
            let t = i as f32 * 0.37;
            (
                150.0 + 120.0 * t.cos() * (1.0 + 0.1 * t),
                140.0 + 90.0 * (1.3 * t).sin(),
                0.3 + 0.7 * (0.5 + 0.5 * (2.1 * t).sin()),
            )
        })
        .collect();
    for b in [
        Brush {
            hardness: 0.3,
            flow: 0.4,
            opacity: 0.8,
            pressure_size: true,
            pressure_opacity: true,
            color: Rgb::new(0.2, 0.5, 0.9),
            ..brush(24.0)
        },
        Brush {
            pencil: true,
            spacing: 0.7,
            pressure_size: true,
            ..brush(9.0)
        },
    ] {
        let mut whole = solid(IRect::new(40, 40, 120, 120), [250, 240, 10, 200]);
        let mut batched = whole.clone();
        let one = Stroke::new(b.clone()).add(&mut whole, None, false, &path);
        let mut s = Stroke::new(b);
        let mut union: Option<IRect> = None;
        let mut i = 0;
        for n in [1, 3, 7, 2, 11, 5].iter().cycle() {
            if i >= path.len() {
                break;
            }
            let end = (i + n).min(path.len());
            if let Some(r) = s.add(&mut batched, None, false, &path[i..end]) {
                union = Some(union.map_or(r, |u| u.union(&r)));
            }
            i = end;
        }
        assert_eq!(whole, batched);
        assert_eq!(one, union);
    }
}

#[test]
fn pressure_scales_size_and_flow() {
    let b = Brush {
        pressure_size: true,
        pressure_opacity: true,
        ..brush(20.0)
    };
    let mut r = Raster::rgba();
    Stroke::new(b).add(&mut r, None, false, &[(50.0, 50.0, 0.5)]);
    // Half the size, half the flow.
    let bounds = r.content_bounds().unwrap();
    assert!(bounds.w <= 12 && bounds.w >= 10, "{bounds:?}");
    assert_eq!(r.get(50, 50)[3], 128);
}

#[test]
fn masks_take_the_colors_gray() {
    let mut mask = Raster::gray();
    let red = Brush {
        color: Rgb::new(1.0, 0.0, 0.0),
        ..brush(10.0)
    };
    stroke(&mut mask, red, &[(20.0, 20.0), (80.0, 20.0)]);
    assert_eq!(mask.get(50, 20)[0], 76);
    let mut white = Raster::from_region(1, IRect::new(0, 0, 100, 100), &[255; 10_000]);
    let eraser = Brush {
        mode: BrushMode::Erase,
        opacity: 0.5,
        ..brush(10.0)
    };
    stroke(&mut white, eraser, &[(20.0, 20.0), (80.0, 20.0)]);
    assert_eq!(white.get(50, 20)[0], 128);
}

#[test]
fn strokes_touch_only_the_tiles_they_paint() {
    let mut r = Raster::rgba();
    let changed = stroke(&mut r, brush(30.0), &[(20.0, 20.0), (900.0, 20.0)]).unwrap();
    assert_eq!(r.tile_count(), 4);
    // Dabs fall every 7.5 pixels: the last at 897.5.
    assert_eq!(changed, IRect::from_ltrb(5, 5, 913, 35));
    // A stroke on a layer whose grid starts elsewhere.
    let mut moved = Raster::rgba();
    moved.set_origin((-100, 37));
    stroke(&mut moved, brush(30.0), &[(20.0, 20.0), (900.0, 20.0)]);
    assert_eq!(moved.read_vec(changed), r.read_vec(changed));
}

#[test]
fn bad_input_paints_nothing_and_never_panics() {
    let mut r = Raster::rgba();
    let nan = f32::NAN;
    let weird = Brush {
        size: nan,
        hardness: f32::INFINITY,
        opacity: -3.0,
        flow: nan,
        spacing: 0.0,
        ..Brush::default()
    };
    let points = [(nan, 1.0, 1.0), (f32::INFINITY, 2.0, 0.5), (3.0, 4.0, nan)];
    assert_eq!(Stroke::new(weird).add(&mut r, None, false, &points), None);
    // A huge brush clamps to 5000 pixels; far points clamp too.
    let mut corner = Selection::none();
    select::combine(
        &mut corner,
        select::rect((0.0, 0.0, 4.0, 4.0)),
        select::SelectMode::Replace,
    );
    let mut s = Stroke::new(brush(1e9));
    let points = [(1e30, -1e30, 2.0), (2.0, 2.0, -1.0)];
    assert_eq!(
        s.add(&mut r, Some(&corner), false, &points),
        Some(IRect::new(0, 0, 4, 4))
    );
    let mut s = Stroke::new(brush(3.0));
    assert!(s.add(&mut r, None, false, &[(1e30, 1e30, 1.0)]).is_some());
    let mut s = Stroke::new(brush(0.0));
    assert_eq!(
        s.add(&mut r, None, false, &[(5.0, 5.0, 1.0), (50.0, 5.0, 1.0)]),
        None
    );
    // Tiny brushes paint faintly rather than not at all.
    let mut tiny = Raster::rgba();
    stroke(&mut tiny, brush(0.5), &[(5.5, 5.5)]);
    assert_eq!(tiny.get(5, 5)[3], 64);
}

#[test]
fn fill_covers_bounds_within_the_selection() {
    let mut r = Raster::rgba();
    let all = IRect::new(-10, -10, 700, 600);
    let changed = fill(&mut r, all, None, [1, 2, 3, 255], 1.0, false);
    assert_eq!(changed, Some(all));
    assert_eq!(r.get(300, 300), [1, 2, 3, 255]);
    assert_eq!(r.get(-11, 0), [0; 4]);
    // Whole tiles share one tile.
    let inner = r.tile_arc(0, 0).unwrap();
    assert!(Arc::ptr_eq(&inner, &r.tile_arc(1, 0).unwrap()));
    assert_eq!(fill(&mut r, all, None, [1, 2, 3, 255], 1.0, false), None);

    let mut selection = Selection::none();
    select::combine(
        &mut selection,
        select::rect((10.0, 10.0, 20.0, 20.0)),
        select::SelectMode::Replace,
    );
    let changed = fill(&mut r, all, Some(&selection), [255, 0, 0, 255], 0.5, false);
    assert_eq!(changed, Some(IRect::new(10, 10, 20, 20)));
    assert_eq!(r.get(15, 15), [128, 1, 2, 255]);

    // Locked alpha fills only what is there; masks take the gray.
    let mut sparse = solid(IRect::new(0, 0, 10, 10), [0, 0, 0, 255]);
    fill(&mut sparse, all, None, [0, 255, 0, 255], 1.0, true);
    assert_eq!(sparse.get(5, 5), [0, 255, 0, 255]);
    assert_eq!(sparse.content_bounds(), Some(IRect::new(0, 0, 10, 10)));
    let mut mask = Raster::gray();
    fill(
        &mut mask,
        IRect::new(0, 0, 4, 4),
        None,
        [0, 0, 255, 255],
        1.0,
        false,
    );
    assert_eq!(mask.get(1, 1)[0], 29);
    // Areas past a billion pixels are refused.
    let huge = IRect::new(-1_000_000, -1_000_000, 2_000_000, 2_000_000);
    assert_eq!(
        fill(&mut mask, huge, None, [9, 9, 9, 255], 1.0, false),
        None
    );
    // Bounds at the ends of the number line never overflow.
    let far = IRect::new(i32::MAX - 5, i32::MAX - 5, i32::MAX, 100);
    assert_eq!(fill(&mut mask, far, None, [9, 9, 9, 255], 1.0, false), None);
}

/// A white canvas with two black squares, joined by a gray bar.
fn shapes() -> Raster {
    let mut r = solid(IRect::new(0, 0, 100, 60), [255, 255, 255, 255]);
    r.write(IRect::new(10, 10, 20, 20), &[0, 0, 0, 255].repeat(400));
    r.write(IRect::new(60, 10, 20, 20), &[0, 0, 0, 255].repeat(400));
    r.write(IRect::new(30, 18, 30, 4), &[20, 20, 20, 255].repeat(120));
    r
}

#[test]
fn the_paint_bucket_fills_like_pixels() {
    let src = shapes();
    let sample = |x: i32, y: i32| src.get(x, y);
    let bounds = IRect::new(0, 0, 100, 60);
    let red = [255, 0, 0, 255];

    // Tolerance too low to cross the bar: one square.
    let mut r = Raster::rgba();
    let changed = flood_fill(
        &mut r,
        &sample,
        bounds,
        None,
        (15, 15),
        10,
        true,
        false,
        red,
        1.0,
    );
    assert_eq!(changed, Some(IRect::new(10, 10, 20, 20)));
    // Enough to take the bar: both squares and the bar.
    let mut r = Raster::rgba();
    flood_fill(
        &mut r,
        &sample,
        bounds,
        None,
        (15, 15),
        30,
        true,
        false,
        red,
        1.0,
    );
    assert_eq!(r.get(70, 15), red);
    assert_eq!(r.get(45, 20), red);
    assert_eq!(r.get(45, 10), [0; 4]);
    // Not contiguous: every black pixel, but not the bar.
    let mut r = Raster::rgba();
    flood_fill(
        &mut r,
        &sample,
        bounds,
        None,
        (15, 15),
        10,
        false,
        false,
        red,
        1.0,
    );
    assert_eq!(r.get(70, 15), red);
    assert_eq!(r.get(45, 20), [0; 4]);
    // The white surround, around the shapes, at half opacity.
    let mut r = Raster::rgba();
    flood_fill(
        &mut r,
        &sample,
        bounds,
        None,
        (0, 0),
        0,
        true,
        false,
        red,
        0.5,
    );
    assert_eq!(r.get(50, 50), [255, 0, 0, 128]);
    assert_eq!(r.get(15, 15), [0; 4]);
    // Antialiasing softens only staircase edges.
    let mut r = Raster::rgba();
    flood_fill(
        &mut r,
        &sample,
        bounds,
        None,
        (15, 15),
        10,
        true,
        true,
        red,
        1.0,
    );
    assert_eq!(r.get(10, 20), red);
    assert_eq!(r.get(9, 20), [0; 4]);
    // A seed outside the bounds fills nothing.
    let mut r = Raster::rgba();
    assert_eq!(
        flood_fill(
            &mut r,
            &sample,
            bounds,
            None,
            (500, 5),
            10,
            true,
            false,
            red,
            1.0
        ),
        None
    );
}

/// A gradient's level (`0..=255`) of a channel at `t`.
fn level(g: &Gradient, t: f32, channel: usize) -> i32 {
    (g.sample(t)[channel] * 255.0).round() as i32
}

fn two_stop(from: Rgb, to: Rgb, kind: GradientKind) -> Gradient {
    Gradient {
        kind,
        colors: vec![
            ColorStop {
                location: 0.0,
                midpoint: 0.5,
                color: from,
            },
            ColorStop {
                location: 1.0,
                midpoint: 0.5,
                color: to,
            },
        ],
        ..Gradient::default()
    }
}

#[test]
fn gradients_run_between_the_drag_points() {
    let bounds = IRect::new(0, 0, 100, 20);
    let g = two_stop(
        Rgb::from_u8(10, 20, 30),
        Rgb::from_u8(200, 150, 100),
        GradientKind::Linear,
    );
    let mut r = Raster::rgba();
    let changed = gradient(
        &mut r,
        &g,
        (20.0, 0.0),
        (80.0, 0.0),
        bounds,
        None,
        1.0,
        false,
    );
    assert_eq!(changed, Some(bounds));
    assert_eq!(r.get(0, 5), [10, 20, 30, 255]);
    assert_eq!(r.get(19, 5), [10, 20, 30, 255]);
    assert_eq!(r.get(80, 5), [200, 150, 100, 255]);
    assert_eq!(r.get(99, 19), [200, 150, 100, 255]);
    let mid = r.get(50, 5);
    assert!(
        (i32::from(mid[0]) - level(&g, 30.5 / 60.0, 0)).abs() <= 1,
        "{mid:?}"
    );
    let reds: Vec<u8> = (20..80).map(|x| r.get(x, 0)[0]).collect();
    assert!(reds.windows(2).all(|w| w[0] <= w[1]));

    // Reversed, the ends swap.
    let reversed = Gradient {
        reverse: true,
        ..g.clone()
    };
    let mut r = Raster::rgba();
    gradient(
        &mut r,
        &reversed,
        (20.0, 0.0),
        (80.0, 0.0),
        bounds,
        None,
        1.0,
        false,
    );
    assert_eq!(r.get(0, 5), [200, 150, 100, 255]);
    assert_eq!(r.get(99, 5), [10, 20, 30, 255]);

    // Half opacity over transparency; opacity stops.
    let mut faded = g.clone();
    faded.opacities = vec![
        OpacityStop {
            location: 0.0,
            midpoint: 0.5,
            opacity: 1.0,
        },
        OpacityStop {
            location: 1.0,
            midpoint: 0.5,
            opacity: 0.0,
        },
    ];
    let mut r = Raster::rgba();
    gradient(
        &mut r,
        &faded,
        (20.0, 0.0),
        (80.0, 0.0),
        bounds,
        None,
        0.5,
        false,
    );
    assert_eq!(r.get(0, 5), [10, 20, 30, 128]);
    assert_eq!(r.get(90, 5), [0; 4]);

    // A drag with no length draws nothing.
    let mut r = Raster::rgba();
    assert_eq!(
        gradient(&mut r, &g, (5.0, 5.0), (5.0, 5.0), bounds, None, 1.0, false),
        None
    );
}

#[test]
fn gradient_shapes() {
    let bounds = IRect::new(0, 0, 101, 101);
    let black = Rgb::BLACK;
    let white = Rgb::WHITE;
    let at = |kind: GradientKind, to: (f32, f32), points: &[(i32, i32)]| -> Vec<u8> {
        let mut r = Raster::rgba();
        let g = two_stop(black, white, kind);
        gradient(&mut r, &g, (50.5, 50.5), to, bounds, None, 1.0, false);
        points.iter().map(|&(x, y)| r.get(x, y)[0]).collect()
    };
    // Radial: black at the center, white from the radius out.
    let v = at(
        GradientKind::Radial,
        (90.5, 50.5),
        &[(50, 50), (50, 10), (95, 95)],
    );
    assert_eq!(v, vec![0, 255, 255]);
    // Reflected: mirrored about the start.
    let v = at(
        GradientKind::Reflected,
        (90.5, 50.5),
        &[(30, 0), (70, 0), (50, 3)],
    );
    assert_eq!(v[0], v[1]);
    assert_eq!(v[2], 0);
    // Diamond: a corner at the end point, the same value on the diamond.
    let v = at(
        GradientKind::Diamond,
        (90.5, 50.5),
        &[(70, 50), (60, 40), (50, 30), (90, 50)],
    );
    assert!(v[0] == v[1] && v[1] == v[2], "{v:?}");
    assert_eq!(v[3], 255);
    // Angle: starts along the drag, sweeping counterclockwise.
    let v = at(
        GradientKind::Angle,
        (90.5, 50.5),
        &[(80, 50), (50, 20), (20, 50), (50, 80)],
    );
    let g = two_stop(black, white, GradientKind::Angle);
    let want = [0.0, 0.25, 0.5, 0.75].map(|t| level(&g, t, 0));
    for (got, want) in v.iter().zip(want) {
        assert!((i32::from(*got) - want).abs() <= 1, "{v:?} vs {want:?}");
    }
}

#[test]
fn gradients_respect_locks_selections_and_masks() {
    let g = two_stop(Rgb::BLACK, Rgb::WHITE, GradientKind::Linear);
    let mut r = solid(IRect::new(0, 0, 10, 10), [255, 0, 0, 255]);
    let bounds = IRect::new(0, 0, 100, 100);
    gradient(
        &mut r,
        &g,
        (0.0, 0.0),
        (100.0, 0.0),
        bounds,
        None,
        1.0,
        true,
    );
    assert_eq!(r.content_bounds(), Some(IRect::new(0, 0, 10, 10)));
    assert_eq!(r.get(0, 0), [1, 1, 1, 255]);

    let mut selection = Selection::none();
    select::combine(
        &mut selection,
        select::rect((50.0, 0.0, 10.0, 10.0)),
        select::SelectMode::Replace,
    );
    let mut r = Raster::rgba();
    let changed = gradient(
        &mut r,
        &g,
        (0.0, 0.0),
        (100.0, 0.0),
        bounds,
        Some(&selection),
        1.0,
        false,
    );
    assert_eq!(changed, Some(IRect::new(50, 0, 10, 10)));

    let mut mask = Raster::gray();
    gradient(
        &mut mask,
        &g,
        (10.0, 0.0),
        (90.0, 0.0),
        bounds,
        None,
        1.0,
        false,
    );
    assert_eq!(mask.get(99, 3)[0], 255);
    assert_eq!(mask.get(0, 3)[0], 0);
}

/// Times a long stroke and pointer-sized batches.
#[test]
#[ignore = "benchmark: cargo test -p psd_engine --release -- --ignored --nocapture"]
fn bench_stroke() {
    let path: Vec<(f32, f32, f32)> = (0..2000)
        .map(|i| {
            let t = i as f32 * 0.01;
            (
                200.0 + i as f32 * 1.8,
                1500.0 + 900.0 * (3.0 * t).sin(),
                1.0,
            )
        })
        .collect();
    for (size, hardness) in [(100.0, 1.0), (100.0, 0.0)] {
        let b = Brush {
            hardness,
            flow: 0.7,
            opacity: 0.9,
            ..brush(size)
        };
        let mut r = Raster::rgba();
        let mut s = Stroke::new(b);
        let start = Instant::now();
        let mut worst = 0.0f64;
        for batch in path.chunks(10) {
            let t = Instant::now();
            s.add(&mut r, None, false, batch);
            worst = worst.max(t.elapsed().as_secs_f64());
        }
        let total = start.elapsed().as_secs_f64();
        println!(
            "stroke: 2000 points, {size}px, hardness {hardness}: {:.1} ms ({:.2} ms per 10-point batch, worst {:.2} ms)",
            total * 1e3,
            total * 1e3 / 200.0,
            worst * 1e3,
        );
    }
    // Pointer batches: 10 points a few pixels apart, 50px brush.
    let b = Brush {
        hardness: 0.5,
        ..brush(50.0)
    };
    let mut r = solid(IRect::new(0, 0, 2000, 2000), [255, 255, 255, 255]);
    let mut s = Stroke::new(b);
    let start = Instant::now();
    let batches = 200;
    for k in 0..batches {
        let batch: Vec<(f32, f32, f32)> = (0..10)
            .map(|i| {
                let t = (k * 10 + i) as f32;
                (300.0 + t * 0.6, 300.0 + 200.0 * (t * 0.01).sin(), 1.0)
            })
            .collect();
        s.add(&mut r, None, false, &batch);
    }
    println!(
        "stroke: 10-point batches, 50px brush: {:.3} ms per batch",
        start.elapsed().as_secs_f64() * 1e3 / f64::from(batches)
    );
}
