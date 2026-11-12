use super::*;
use crate::model::{
    BlendMode, Composite, Contour, Effects, Fill, Glow, GlowSource, GlowTechnique, Gradient,
    GradientKind, Knot, Layer, LayerMask, PathOp, Pattern, PatternFill, Rgb, Shadow, StrokeEffect,
    StrokePosition, Subpath, VectorMask,
};
use crate::raster::Raster;
use crate::render::testing::{add, add_solid, assert_px, group, painted, px, render, solid};
use std::sync::Arc;

#[test]
fn the_stored_composite_is_drawn_where_it_is_current() {
    let mut doc = Document::new(64, 64);
    let all = doc.bounds();
    add_solid(&mut doc, all, [255, 0, 0, 255]);
    doc.composite = Some(Composite {
        raster: solid(all, [0, 255, 0, 255]),
        stale: Vec::new(),
    });
    let out = render(&doc, all, 0);
    assert_px(px(&out, all, 10, 10), [0, 255, 0, 255], 0);
    // Stale areas composite the layers.
    doc.composite
        .as_mut()
        .unwrap()
        .invalidate(IRect::new(8, 8, 8, 8));
    let out = render(&doc, all, 0);
    assert_px(px(&out, all, 10, 10), [255, 0, 0, 255], 0);
    assert_px(px(&out, all, 20, 20), [0, 255, 0, 255], 0);
    assert_px(px(&out, all, 7, 7), [0, 255, 0, 255], 0);
    // At level 1 a pixel is stale if any of its canvas pixels is.
    let half = IRect::new(0, 0, 32, 32);
    let out = render(&doc, half, 1);
    assert_px(px(&out, half, 4, 4), [255, 0, 0, 255], 0);
    assert_px(px(&out, half, 7, 7), [255, 0, 0, 255], 0);
    assert_px(px(&out, half, 3, 3), [0, 255, 0, 255], 0);
    assert_px(px(&out, half, 8, 8), [0, 255, 0, 255], 0);
}

/// A document exercising most of the compositor: gradients, groups,
/// clipping, masks, effects, a pattern fill, and a dissolve layer.
fn busy_document() -> Document {
    let mut doc = Document::new(300, 260);
    doc.patterns.push(Pattern {
        id: "p".into(),
        name: "dots".into(),
        width: 4,
        height: 4,
        rgba: Arc::from(
            (0..16)
                .flat_map(|i| {
                    if i % 5 == 0 {
                        [255, 255, 0, 255]
                    } else {
                        [0, 0, 0, 0]
                    }
                })
                .collect::<Vec<u8>>(),
        ),
    });
    let bg = painted(doc.bounds(), |x, y| {
        [(x * 255 / 300) as u8, (y * 255 / 260) as u8, 128, 255]
    });
    let mut b = Layer::new(0, "Background");
    b.pixels = bg;
    b.background = true;
    add(&mut doc, b);
    // A soft-edged blob with a drop shadow, glow, and stroke.
    let blob = painted(IRect::new(40, 30, 120, 100), |x, y| {
        let (dx, dy) = ((x - 100) as f32, (y - 80) as f32);
        let d = (dx * dx + dy * dy).sqrt();
        let a = ((45.0 - d) * 40.0).clamp(0.0, 255.0) as u8;
        [200, 40, 90, a]
    });
    let mut l = Layer::new(0, "blob");
    l.pixels = blob;
    l.effects = Some(Effects {
        drop_shadows: vec![Shadow {
            enabled: true,
            blend: BlendMode::Multiply,
            color: Rgb::BLACK,
            opacity: 0.7,
            angle: 120.0,
            use_global_light: true,
            distance: 9.0,
            spread: 0.1,
            size: 11.0,
            noise: 0.2,
            contour: Contour::default(),
            knocks_out: true,
        }],
        outer_glows: vec![Glow {
            enabled: true,
            blend: BlendMode::Screen,
            color: Rgb::new(1.0, 1.0, 0.6),
            gradient: None,
            opacity: 0.6,
            noise: 0.0,
            technique: GlowTechnique::Precise,
            spread: 0.2,
            size: 7.0,
            contour: Contour::default(),
            range: 0.5,
            jitter: 0.0,
            source: GlowSource::Edge,
        }],
        strokes: vec![StrokeEffect {
            enabled: true,
            blend: BlendMode::Normal,
            opacity: 1.0,
            size: 3.0,
            position: StrokePosition::Center,
            fill: Fill::Gradient {
                gradient: Gradient::default(),
            },
        }],
        ..Effects::default()
    });
    add(&mut doc, l);
    // A clipped, feather-masked layer in an isolated group.
    let base = add_solid(
        &mut doc,
        IRect::new(150, 120, 120, 110),
        [30, 160, 220, 255],
    );
    let clipped = add_solid(
        &mut doc,
        IRect::new(100, 100, 200, 100),
        [250, 250, 250, 200],
    );
    doc.layer_mut(clipped).clipping = true;
    doc.layer_mut(clipped).blend = BlendMode::Overlay;
    doc.layer_mut(clipped).mask = Some(LayerMask {
        generation: 0,
        raster: Raster::from_region(1, IRect::new(160, 130, 60, 60), &[255u8; 3600]),
        rect: IRect::new(160, 130, 60, 60),
        default_color: 0,
        disabled: false,
        linked: true,
        density: 0.9,
        feather: 6.0,
    });
    let g = group(&mut doc, &[base, clipped], BlendMode::Normal);
    doc.layer_mut(g).opacity = 220;
    // A rotated pattern fill shaped by a triangle, and a dissolve layer.
    let mut fill = Layer::new(0, "pattern");
    fill.kind = crate::model::LayerKind::Fill {
        fill: Fill::Pattern {
            pattern: PatternFill {
                pattern: "p".into(),
                name: String::new(),
                scale: 1.5,
                angle: 30.0,
                align_with_layer: false,
                phase: (1.0, 2.0),
            },
        },
        stroke: None,
    };
    fill.vector_mask = Some(VectorMask {
        subpaths: vec![Subpath {
            nonzero: false,
            joined: false,
            shape: 0,
            closed: true,
            op: PathOp::Combine,
            knots: vec![
                Knot::corner(10.0, 250.0),
                Knot::corner(130.5, 140.25),
                Knot::corner(140.0, 255.0),
            ],
        }],
        ..VectorMask::default()
    });
    add(&mut doc, fill);
    let d = add_solid(&mut doc, IRect::new(200, 10, 90, 90), [0, 255, 120, 255]);
    doc.layer_mut(d).blend = BlendMode::Dissolve;
    doc.layer_mut(d).opacity = 150;
    let mut grad = Layer::new(0, "radial");
    grad.kind = crate::model::LayerKind::Fill {
        fill: Fill::Gradient {
            gradient: Gradient {
                kind: GradientKind::Radial,
                ..Gradient::default()
            },
        },
        stroke: None,
    };
    grad.opacity = 90;
    grad.blend = BlendMode::SoftLight;
    add(&mut doc, grad);
    doc
}

#[test]
fn tiles_render_the_same_as_one_area() {
    let doc = busy_document();
    for level in [0u8, 1] {
        let whole = doc.bounds().at_level(level);
        let full = render(&doc, whole, level);
        // Cut into four uneven pieces, each rendered by a fresh renderer.
        let (cx, cy) = (whole.w * 3 / 7, whole.h / 3);
        for part in [
            IRect::from_ltrb(0, 0, cx, cy),
            IRect::from_ltrb(cx, 0, whole.w, cy),
            IRect::from_ltrb(0, cy, cx, whole.h),
            IRect::from_ltrb(cx, cy, whole.w, whole.h),
        ] {
            let piece = render(&doc, part, level);
            for y in part.y..part.bottom() {
                for x in part.x..part.right() {
                    let (a, b) = (px(&piece, part, x, y), px(&full, whole, x, y));
                    assert_eq!(a, b, "level {level} at ({x}, {y})");
                }
            }
        }
    }
}

#[test]
fn level_one_matches_the_box_filtered_full_size_render() {
    // Layers whose edges fall on even pixels downscale exactly; gradients
    // within a pixel's footprint stay within rounding.
    let mut doc = Document::new(256, 128);
    let bounds = doc.bounds();
    add_solid(&mut doc, bounds, [255, 255, 255, 255]);
    let a = painted(IRect::new(10, 20, 100, 60), |x, y| {
        [(x * 2) as u8, (y * 3) as u8, 90, 255]
    });
    let mut l = Layer::new(0, "gradient");
    l.pixels = a;
    l.opacity = 200;
    add(&mut doc, l);
    let b = add_solid(&mut doc, IRect::new(60, 40, 120, 70), [20, 120, 240, 160]);
    doc.layer_mut(b).blend = BlendMode::Multiply;
    let g = group(&mut doc, &[b], BlendMode::PassThrough);
    doc.layer_mut(g).opacity = 200;
    let full = render(&doc, doc.bounds(), 0);
    let half_rect = doc.bounds().at_level(1);
    let half = render(&doc, half_rect, 1);
    for y in 0..half_rect.h {
        for x in 0..half_rect.w {
            let mut sum = [0u32; 4];
            let mut premul = [0u32; 3];
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let p = px(&full, doc.bounds(), 2 * x + dx, 2 * y + dy);
                sum[3] += p[3] as u32;
                for c in 0..3 {
                    premul[c] += p[c] as u32 * p[3] as u32;
                }
            }
            let expected = if sum[3] == 0 {
                [0; 4]
            } else {
                [
                    ((premul[0] + sum[3] / 2) / sum[3]) as u8,
                    ((premul[1] + sum[3] / 2) / sum[3]) as u8,
                    ((premul[2] + sum[3] / 2) / sum[3]) as u8,
                    ((sum[3] + 2) / 4) as u8,
                ]
            };
            assert_px(px(&half, half_rect, x, y), expected, 1);
        }
    }
}

#[test]
fn caches_follow_edits_without_invalidation() {
    let mut doc = Document::new(512, 512);
    let bounds = doc.bounds();
    let l = add_solid(&mut doc, bounds, [10, 20, 30, 255]);
    let mut renderer = Renderer::new();
    let rect = IRect::new(0, 0, 128, 128);
    let before = renderer.render(&doc, rect, 2);
    assert_px(px(&before, rect, 5, 5), [10, 20, 30, 255], 0);
    // Repaint a 4×4 block (one level-2 pixel) in place.
    let block = IRect::new(20, 20, 4, 4);
    doc.layer_mut(l)
        .pixels
        .write(block, &[200u8, 0, 0, 255].repeat(16));
    let after = renderer.render(&doc, rect, 2);
    assert_px(px(&after, rect, 5, 5), [200, 0, 0, 255], 0);
    assert_px(px(&after, rect, 6, 5), [10, 20, 30, 255], 0);
    renderer.clear();
    assert_eq!(renderer.render(&doc, rect, 2), after);
}

#[test]
fn renders_clip_to_the_canvas_and_survive_odd_input() {
    let mut doc = Document::new(10, 10);
    add_solid(&mut doc, IRect::new(-5, -5, 30, 30), [1, 2, 3, 255]);
    let rect = IRect::new(-2, -2, 14, 14);
    let out = render(&doc, rect, 0);
    assert_px(px(&out, rect, -1, -1), [0; 4], 0);
    assert_px(px(&out, rect, 0, 0), [1, 2, 3, 255], 0);
    assert_px(px(&out, rect, 10, 9), [0; 4], 0);
    // Empty rectangles, empty documents, absurd levels and blurs.
    assert!(render(&doc, IRect::new(0, 0, 0, 5), 0).is_empty());
    assert_eq!(
        render(&Document::new(0, 0), IRect::new(0, 0, 2, 2), 0),
        vec![0; 16]
    );
    assert_eq!(render(&doc, IRect::new(0, 0, 1, 1), 99).len(), 4);
    let l = add_solid(&mut doc, IRect::new(2, 2, 3, 3), [9, 9, 9, 255]);
    doc.layer_mut(l).effects = Some(Effects {
        drop_shadows: vec![Shadow {
            enabled: true,
            blend: BlendMode::Normal,
            color: Rgb::BLACK,
            opacity: 1.0,
            angle: 0.0,
            use_global_light: false,
            distance: 1e6,
            spread: 2.0,
            size: 1e6,
            noise: 9.0,
            contour: Contour {
                name: String::new(),
                points: Vec::new(),
            },
            knocks_out: false,
        }],
        ..Effects::default()
    });
    doc.layer_mut(l).mask = Some(LayerMask {
        generation: 0,
        raster: Raster::gray(),
        rect: IRect::default(),
        default_color: 255,
        disabled: false,
        linked: true,
        density: f32::NAN,
        feather: 1e9,
    });
    let out = render(&doc, IRect::new(0, 0, 10, 10), 0);
    assert_eq!(out.len(), 400);
}

#[test]
fn corrupt_layer_trees_render_what_they_can() {
    let mut doc = Document::new(20, 20);
    let a = add_solid(&mut doc, IRect::new(0, 0, 10, 10), [255, 0, 0, 255]);
    let g = group(&mut doc, &[a], BlendMode::Normal);
    // The group holds itself twice and a missing layer; the top level
    // lists a missing layer too.
    doc.layer_mut(g).children.extend([g, g, 999]);
    doc.roots.push(1000);
    let rect = IRect::new(0, 0, 20, 20);
    let out = render(&doc, rect, 0);
    assert_px(px(&out, rect, 5, 5), [255, 0, 0, 255], 0);
    assert_px(px(&out, rect, 15, 15), [0; 4], 0);
    assert_eq!(visual_bounds(&doc, g), Some(IRect::new(0, 0, 10, 10)));
    let alone = Renderer::new().render_layer(&doc, g, rect, 0, true);
    assert_px(px(&alone, rect, 5, 5), [255, 0, 0, 255], 0);
}

#[test]
fn groups_nest_down_to_the_depth_limit() {
    let mut doc = Document::new(20, 20);
    let mut top = add_solid(&mut doc, IRect::new(0, 0, 10, 10), [0, 0, 255, 255]);
    let rect = IRect::new(0, 0, 20, 20);
    for depth in 1..=layer::MAX_DEPTH + 1 {
        let blend = if depth % 2 == 0 {
            BlendMode::PassThrough
        } else {
            BlendMode::Normal
        };
        top = group(&mut doc, &[top], blend);
        let shown = depth <= layer::MAX_DEPTH;
        if depth % 16 == 0 || !shown {
            let expected = if shown { [0, 0, 255, 255] } else { [0; 4] };
            assert_px(px(&render(&doc, rect, 0), rect, 5, 5), expected, 0);
            assert_eq!(visual_bounds(&doc, top).is_some(), shown, "{depth}");
        }
    }
}

#[test]
fn layers_render_alone() {
    let mut doc = Document::new(40, 40);
    let bounds = doc.bounds();
    add_solid(&mut doc, bounds, [255, 255, 255, 255]);
    let l = add_solid(&mut doc, IRect::new(10, 10, 10, 10), [0, 0, 255, 255]);
    doc.layer_mut(l).visible = false;
    doc.layer_mut(l).effects = Some(Effects {
        strokes: vec![StrokeEffect {
            enabled: true,
            blend: BlendMode::Normal,
            opacity: 1.0,
            size: 2.0,
            position: StrokePosition::Outside,
            fill: Fill::Solid { color: Rgb::BLACK },
        }],
        ..Effects::default()
    });
    let rect = IRect::new(0, 0, 40, 40);
    let mut r = Renderer::new();
    let with = r.render_layer(&doc, l, rect, 0, true);
    assert_px(px(&with, rect, 15, 15), [0, 0, 255, 255], 0);
    assert_px(px(&with, rect, 9, 15), [0, 0, 0, 255], 0);
    assert_px(px(&with, rect, 5, 5), [0; 4], 0);
    let without = r.render_layer(&doc, l, rect, 0, false);
    assert_px(px(&without, rect, 9, 15), [0; 4], 0);
    // A group renders its layers; a bad index renders nothing.
    let g = group(&mut doc, &[l], BlendMode::PassThrough);
    doc.layer_mut(l).visible = true;
    let grouped = r.render_layer(&doc, g, rect, 0, false);
    assert_px(px(&grouped, rect, 15, 15), [0, 0, 255, 255], 0);
    assert_eq!(r.render_layer(&doc, 999, rect, 0, true), vec![0; 6400]);
}

#[test]
fn visual_bounds_include_effects_masks_and_children() {
    let mut doc = Document::new(100, 100);
    let a = add_solid(&mut doc, IRect::new(10, 10, 10, 10), [1, 1, 1, 255]);
    assert_eq!(visual_bounds(&doc, a), Some(IRect::new(10, 10, 10, 10)));
    doc.layer_mut(a).effects = Some(Effects {
        strokes: vec![StrokeEffect {
            enabled: true,
            blend: BlendMode::Normal,
            opacity: 1.0,
            size: 5.0,
            position: StrokePosition::Outside,
            fill: Fill::Solid { color: Rgb::BLACK },
        }],
        ..Effects::default()
    });
    let b = visual_bounds(&doc, a).unwrap();
    assert!(b.contains_rect(&IRect::new(5, 5, 20, 20)), "{b:?}");
    let c = add_solid(&mut doc, IRect::new(60, 60, 5, 5), [1, 1, 1, 255]);
    let g = group(&mut doc, &[a, c], BlendMode::PassThrough);
    let gb = visual_bounds(&doc, g).unwrap();
    assert!(gb.contains_rect(&b) && gb.contains_rect(&IRect::new(60, 60, 5, 5)));
    let mut adj = Layer::new(0, "adjust");
    adj.kind = crate::model::LayerKind::Adjustment {
        adjustment: Box::new(crate::model::Adjustment::Invert),
    };
    let adj = add(&mut doc, adj);
    assert_eq!(visual_bounds(&doc, adj), Some(doc.bounds()));
    let empty = add(&mut doc, Layer::new(0, "empty"));
    assert_eq!(visual_bounds(&doc, empty), None);
}

/// Compositing time for a 256×256 tile of ten layers.
#[test]
#[ignore = "benchmark: cargo test -p psd_engine --release -- --ignored --nocapture"]
fn benchmark_tile_composite() {
    let mut doc = Document::new(2048, 2048);
    for i in 0..10 {
        let r = IRect::new(i * 37, i * 29, 1800, 1800);
        let raster = painted(r, |x, y| {
            [
                (x + i) as u8,
                (y * 3) as u8,
                (i * 20) as u8,
                (128 + (x ^ y) % 128) as u8,
            ]
        });
        let mut l = Layer::new(0, "layer");
        l.pixels = raster;
        add(&mut doc, l);
    }
    let mut renderer = Renderer::new();
    let tiles: Vec<IRect> = (0..16)
        .map(|i| IRect::new(256 + (i % 4) * 256, 256 + (i / 4) * 256, 256, 256))
        .collect();
    for (label, level) in [("level 0", 0u8), ("level 1", 1), ("level 2", 2)] {
        // Warm the mip cache, then time.
        for t in &tiles {
            renderer.render(&doc, *t, level);
        }
        let start = std::time::Instant::now();
        let mut n = 0;
        for _ in 0..3 {
            for t in &tiles {
                std::hint::black_box(renderer.render(&doc, *t, level));
                n += 1;
            }
        }
        let per = start.elapsed().as_secs_f64() * 1000.0 / n as f64;
        println!("{label}: {per:.2} ms per 256×256 tile of 10 normal layers");
    }
    // Effects-heavy: one layer with a drop shadow and a stroke.
    let l = doc.roots[9];
    doc.layer_mut(l).effects = Some(Effects {
        drop_shadows: vec![Shadow {
            enabled: true,
            blend: BlendMode::Multiply,
            color: Rgb::BLACK,
            opacity: 0.75,
            angle: 120.0,
            use_global_light: true,
            distance: 10.0,
            spread: 0.0,
            size: 20.0,
            noise: 0.0,
            contour: Contour::default(),
            knocks_out: true,
        }],
        strokes: vec![StrokeEffect {
            enabled: true,
            blend: BlendMode::Normal,
            opacity: 1.0,
            size: 4.0,
            position: StrokePosition::Outside,
            fill: Fill::Solid { color: Rgb::WHITE },
        }],
        ..Effects::default()
    });
    let start = std::time::Instant::now();
    for t in &tiles {
        std::hint::black_box(renderer.render(&doc, *t, 0));
    }
    let per = start.elapsed().as_secs_f64() * 1000.0 / tiles.len() as f64;
    println!("level 0 with shadow and stroke: {per:.2} ms per tile");
}
