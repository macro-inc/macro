use super::*;
use crate::document::Document;
use crate::images::ImageStore;
use crate::render::{RenderOptions, Viewport, render};
use crate::scene::Scene;
use crate::testing::{V, color, fig_file, node, size, solid, translate};
use tiny_skia::Pixmap;

/// The standard normal distribution function (Abramowitz and Stegun 7.1.26,
/// within 1.5e-7).
fn phi(x: f64) -> f64 {
    let z = x.abs() / std::f64::consts::SQRT_2;
    let t = 1.0 / (1.0 + 0.327_591_1 * z);
    let poly = ((((1.061_405_429 * t - 1.453_152_027) * t + 1.421_413_741) * t - 0.284_496_736)
        * t
        + 0.254_829_592)
        * t;
    let erf = 1.0 - poly * (-z * z).exp();
    if x >= 0.0 {
        0.5 * (1.0 + erf)
    } else {
        0.5 * (1.0 - erf)
    }
}

/// How much of the box `[x0, x1] × [y0, y1]`, blurred by a Gaussian of
/// `sigma`, covers point `(x, y)`.
fn blurred_box(x: f64, y: f64, [x0, y0, x1, y1]: [f64; 4], sigma: f64) -> f64 {
    (phi((x - x0) / sigma) - phi((x - x1) / sigma))
        * (phi((y - y0) / sigma) - phi((y - y1) / sigma))
}

fn effect(kind: &'static str, radius: f32, offset: (f32, f32), spread: f32) -> V {
    V::Msg(vec![
        ("type", V::Enum(kind)),
        ("color", color(0.0, 0.0, 0.0, 0.5)),
        ("offset", size(offset.0, offset.1)),
        ("radius", V::Float(radius)),
        ("spread", V::Float(spread)),
        ("visible", V::Bool(true)),
    ])
}

/// The box the Gaussian tests draw: (100, 80), 60 × 40.
const BOX: [f64; 4] = [100.0, 80.0, 160.0, 120.0];

fn file(boxes: Vec<(f32, f32, f32, f32, V, Vec<V>)>) -> Vec<u8> {
    let mut nodes = vec![
        node(0, None, "DOCUMENT", "Document", vec![]),
        node(
            1,
            Some((0, "a")),
            "CANVAS",
            "Page",
            vec![("backgroundColor", color(1.0, 1.0, 1.0, 1.0))],
        ),
    ];
    for (k, (x, y, w, h, fill, effects)) in boxes.into_iter().enumerate() {
        nodes.push(node(
            2 + k as u32,
            Some((1, "a")),
            "RECTANGLE",
            "Box",
            vec![
                ("size", size(w, h)),
                ("transform", translate(x, y)),
                ("fillPaints", V::List(vec![fill])),
                ("effects", V::List(effects)),
            ],
        ));
    }
    fig_file(nodes, vec![])
}

fn draw(bytes: &[u8], vp: Viewport) -> Pixmap {
    let doc = Document::open(bytes).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let opts = RenderOptions {
        outline: false,
        background: Some(doc.page_background(doc.pages[0])),
    };
    render(&doc, &scene, &mut ImageStore::default(), &vp, opts).unwrap()
}

/// A `side`-pixel square view at `scale` centered on page point `(cx, cy)`.
fn around(cx: f64, cy: f64, scale: f64, side: u32) -> Viewport {
    let half = f64::from(side) / 2.0 / scale;
    Viewport {
        x: cx - half,
        y: cy - half,
        scale,
        width: side,
        height: side,
    }
}

/// The largest difference between a render and `expected` (page point →
/// RGB), over the pixels `keep` (page point) chooses.
fn worst(
    p: &Pixmap,
    vp: &Viewport,
    expected: impl Fn(f64, f64) -> [f64; 3],
    keep: impl Fn(f64, f64) -> bool,
) -> f64 {
    let mut worst: f64 = 0.0;
    for py in 0..p.height() {
        for px in 0..p.width() {
            let x = vp.x + (f64::from(px) + 0.5) / vp.scale;
            let y = vp.y + (f64::from(py) + 0.5) / vp.scale;
            if !keep(x, y) {
                continue;
            }
            let c = p.pixel(px, py).unwrap().demultiply();
            let got = [c.red(), c.green(), c.blue()].map(f64::from);
            for (g, e) in got.iter().zip(expected(x, y)) {
                worst = worst.max((g - e).abs());
            }
        }
    }
    worst
}

/// The pages' canvas color: white.
const CANVAS: f64 = 255.0;

#[test]
fn picks_coarseness_by_blur_width() {
    assert_eq!(coarseness_for(0.0), 1);
    assert_eq!(coarseness_for(15.9), 1);
    assert_eq!(coarseness_for(16.0), 2);
    assert_eq!(coarseness_for(48.0), 4);
    assert_eq!(coarseness_for(128.0), 16);
    assert_eq!(coarseness_for(1e9), MAX_COARSENESS);
}

#[test]
fn coarse_layer_blurs_match_a_gaussian() {
    // A black box blurred by 12 (a Gaussian of 6) on the canvas.
    let bytes = file(vec![(
        100.0,
        80.0,
        60.0,
        40.0,
        solid(0.0, 0.0, 0.0),
        vec![effect("FOREGROUND_BLUR", 12.0, (0.0, 0.0), 0.0)],
    )]);
    // Full resolution, then 2, 4, and 16 times coarser.
    for (scale, k) in [(2.0, 1), (4.0, 2), (8.0, 4), (32.0, 16)] {
        assert_eq!(coarseness_for(6.0 * scale), k);
        // Across the box's left edge, and around its corner.
        for (cx, cy) in [(100.0, 100.0), (160.0, 120.0)] {
            let vp = around(cx, cy, scale, 256);
            let p = draw(&bytes, vp);
            let d = worst(
                &p,
                &vp,
                |x, y| [CANVAS * (1.0 - blurred_box(x, y, BOX, 6.0)); 3],
                |_, _| true,
            );
            assert!(
                d <= 4.0,
                "{scale}× ({k} coarser) at ({cx}, {cy}): off by {d}"
            );
        }
    }
}

#[test]
fn coarse_drop_shadows_match_a_gaussian() {
    // A blue box with a shadow of half-opaque black, blurred by 12, moved
    // (3.3, 5.7) and spread 2.3: fractions of a pixel at every scale.
    let (dx, dy, spread) = (3.3, 5.7, 2.3);
    let bytes = file(vec![(
        100.0,
        80.0,
        60.0,
        40.0,
        solid(0.2, 0.5, 1.0),
        vec![effect(
            "DROP_SHADOW",
            12.0,
            (dx as f32, dy as f32),
            spread as f32,
        )],
    )]);
    let shadow = [
        BOX[0] - spread + dx,
        BOX[1] - spread + dy,
        BOX[2] + spread + dx,
        BOX[3] + spread + dy,
    ];
    for (scale, k) in [(4.0, 2), (8.0, 4), (32.0, 16)] {
        assert_eq!(coarseness_for(6.0 * scale), k);
        for (cx, cy) in [(160.0, 100.0), (165.0, 125.0), (130.0, 125.0)] {
            let vp = around(cx, cy, scale, 256);
            let p = draw(&bytes, vp);
            // Outside the box (its anti-aliased edge aside), the canvas
            // under the shadow; inside, the box alone.
            let margin = 1.0 / scale;
            let inside = |x: f64, y: f64| {
                x > BOX[0] + margin
                    && x < BOX[2] - margin
                    && y > BOX[1] + margin
                    && y < BOX[3] - margin
            };
            let outside = |x: f64, y: f64| {
                x < BOX[0] - margin
                    || x > BOX[2] + margin
                    || y < BOX[1] - margin
                    || y > BOX[3] + margin
            };
            let d = worst(
                &p,
                &vp,
                |x, y| [CANVAS * (1.0 - 0.5 * blurred_box(x, y, shadow, 6.0)); 3],
                outside,
            );
            assert!(
                d <= 4.0,
                "shadow at {scale}× ({k} coarser) around ({cx}, {cy}): off by {d}"
            );
            let d = worst(&p, &vp, |_, _| [51.0, 127.5, 255.0], inside);
            assert!(d <= 1.0, "box at {scale}× around ({cx}, {cy}): off by {d}");
        }
    }
}

#[test]
fn inner_shadows_match_a_gaussian() {
    // A white box with an inner shadow of half-opaque black, blurred by 12,
    // moved (3.3, 5.7) and spread 2.3, on a white canvas.
    let (dx, dy, spread) = (3.3, 5.7, 2.3);
    let bytes = file(vec![(
        100.0,
        80.0,
        60.0,
        40.0,
        solid(1.0, 1.0, 1.0),
        vec![effect(
            "INNER_SHADOW",
            12.0,
            (dx as f32, dy as f32),
            spread as f32,
        )],
    )]);
    // The shadow covers what of the box the box, moved and shrunk by the
    // spread, blurred, leaves.
    let hole = [
        BOX[0] + spread + dx,
        BOX[1] + spread + dy,
        BOX[2] - spread + dx,
        BOX[3] - spread + dy,
    ];
    for (scale, k) in [(1.0, 1), (2.0, 1), (4.0, 2), (8.0, 4), (32.0, 16)] {
        assert_eq!(coarseness_for(6.0 * scale), k);
        for (cx, cy) in [(100.0, 100.0), (130.0, 80.0), (160.0, 120.0)] {
            let vp = around(cx, cy, scale, 256);
            let p = draw(&bytes, vp);
            let margin = 1.0 / scale;
            let inside = |x: f64, y: f64| {
                x > BOX[0] + margin
                    && x < BOX[2] - margin
                    && y > BOX[1] + margin
                    && y < BOX[3] - margin
            };
            let d = worst(
                &p,
                &vp,
                |x, y| [CANVAS * (1.0 - 0.5 * (1.0 - blurred_box(x, y, hole, 6.0))); 3],
                inside,
            );
            assert!(
                d <= 4.0,
                "{scale}× ({k} coarser) around ({cx}, {cy}): off by {d}"
            );
        }
    }
}

#[test]
fn background_blurs_match_a_gaussian() {
    // A black box under a clear one with a background blur of 12, which
    // shows the black box blurred inside it.
    let glass = [90.0, 70.0, 150.0, 110.0];
    let bytes = file(vec![
        (100.0, 80.0, 60.0, 40.0, solid(0.0, 0.0, 0.0), vec![]),
        (
            90.0,
            70.0,
            60.0,
            40.0,
            V::Msg(vec![
                ("type", V::Enum("SOLID")),
                ("color", color(1.0, 1.0, 1.0, 1.0)),
                ("opacity", V::Float(0.0)),
                ("visible", V::Bool(true)),
            ]),
            vec![effect("BACKGROUND_BLUR", 12.0, (0.0, 0.0), 0.0)],
        ),
    ]);
    for (scale, k) in [(2.0, 1), (4.0, 2), (8.0, 4), (32.0, 16)] {
        assert_eq!(coarseness_for(6.0 * scale), k);
        for (cx, cy) in [(100.0, 80.0), (130.0, 95.0), (150.0, 110.0)] {
            let vp = around(cx, cy, scale, 256);
            let p = draw(&bytes, vp);
            let margin = 1.0 / scale;
            let inside = |x: f64, y: f64| {
                x > glass[0] + margin
                    && x < glass[2] - margin
                    && y > glass[1] + margin
                    && y < glass[3] - margin
            };
            let d = worst(
                &p,
                &vp,
                |x, y| [CANVAS * (1.0 - blurred_box(x, y, BOX, 6.0)); 3],
                inside,
            );
            assert!(
                d <= 4.0,
                "{scale}× ({k} coarser) around ({cx}, {cy}): off by {d}"
            );
        }
    }
}

#[test]
fn coarse_tiles_match_the_whole_render() {
    // Shadows and blurs 2 to 16 times coarser than the device, crossing
    // tile edges; one box has both.
    let bytes = file(vec![
        (
            10.0,
            12.0,
            30.0,
            20.0,
            solid(0.2, 0.5, 1.0),
            vec![effect("DROP_SHADOW", 16.0, (6.0, 9.0), 2.0)],
        ),
        (
            52.0,
            44.0,
            24.0,
            18.0,
            solid(0.9, 0.3, 0.1),
            vec![effect("FOREGROUND_BLUR", 20.0, (0.0, 0.0), 0.0)],
        ),
        (
            30.0,
            60.0,
            20.0,
            14.0,
            solid(0.1, 0.7, 0.3),
            vec![effect("FOREGROUND_BLUR", 64.0, (0.0, 0.0), 0.0)],
        ),
        (
            62.0,
            8.0,
            16.0,
            16.0,
            solid(0.5, 0.2, 0.8),
            vec![
                effect("FOREGROUND_BLUR", 10.0, (0.0, 0.0), 0.0),
                effect("DROP_SHADOW", 24.0, (-3.5, 4.25), 1.5),
            ],
        ),
        (
            8.0,
            40.0,
            36.0,
            30.0,
            solid(0.95, 0.95, 0.9),
            vec![
                effect("INNER_SHADOW", 16.0, (2.5, -3.0), 1.5),
                effect("INNER_SHADOW", 4.0, (0.0, 1.0), 0.0),
            ],
        ),
        (
            40.0,
            30.0,
            40.0,
            36.0,
            solid(1.0, 1.0, 1.0),
            vec![effect("BACKGROUND_BLUR", 18.0, (0.0, 0.0), 0.0)],
        ),
    ]);
    let doc = Document::open(&bytes).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let opts = RenderOptions {
        outline: false,
        background: Some(doc.page_background(doc.pages[0])),
    };
    let mut images = ImageStore::default();
    let (scale, side, tiles) = (4.0, 48u32, 8);
    let whole = render(
        &doc,
        &scene,
        &mut images,
        &Viewport {
            x: 0.0,
            y: 0.0,
            scale,
            width: side * tiles,
            height: side * tiles,
        },
        opts,
    )
    .unwrap();
    for ty in 0..tiles {
        for tx in 0..tiles {
            let (x, y) = (tx * side, ty * side);
            let vp = Viewport {
                x: f64::from(x) / scale,
                y: f64::from(y) / scale,
                scale,
                width: side,
                height: side,
            };
            let tile = render(&doc, &scene, &mut images, &vp, opts).unwrap();
            for py in 0..side {
                for px in 0..side {
                    assert_eq!(
                        tile.pixel(px, py),
                        whole.pixel(x + px, y + py),
                        "tile {tx},{ty} pixel {px},{py}"
                    );
                }
            }
        }
    }
}
