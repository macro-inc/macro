use super::*;
use crate::model::{Knot, LayerMask, PathOp, Rgb, Subpath, VectorMask};
use crate::raster::Raster;
use crate::render::testing::{add, add_solid, solid};

fn cx<'a>(doc: &'a Document, cache: &'a mut Cache, level: u8) -> Cx<'a> {
    Cx::new(doc, level, cache, true)
}

fn mask(rect: IRect, value: u8, default_color: u8) -> LayerMask {
    LayerMask {
        generation: 0,
        raster: Raster::from_region(1, rect, &vec![value; rect.area() as usize]),
        rect,
        default_color,
        disabled: false,
        linked: true,
        density: 1.0,
        feather: 0.0,
    }
}

fn square_mask(x: f64, y: f64, s: f64) -> VectorMask {
    VectorMask {
        subpaths: vec![Subpath {
            nonzero: false,
            joined: false,
            shape: 0,
            closed: true,
            op: PathOp::Combine,
            knots: vec![
                Knot::corner(x, y),
                Knot::corner(x + s, y),
                Knot::corner(x + s, y + s),
                Knot::corner(x, y + s),
            ],
        }],
        ..VectorMask::default()
    }
}

#[test]
fn pixel_masks_density_and_feather() {
    let mut doc = Document::new(40, 40);
    let l = add_solid(&mut doc, IRect::new(0, 0, 40, 40), [255, 0, 0, 255]);
    doc.layer_mut(l).mask = Some(mask(IRect::new(10, 10, 20, 20), 255, 0));
    let mut cache = Cache::default();
    let rect = IRect::new(0, 0, 40, 40);
    let c = content(&mut cx(&doc, &mut cache, 0), l, rect);
    let alpha = |c: &Content, x: i32, y: i32| c.px[(y * 40 + x) as usize][3];
    assert_eq!(alpha(&c, 15, 15), 1.0);
    assert_eq!(alpha(&c, 5, 5), 0.0);
    // Density 40%: hidden areas show 60%.
    doc.layer_mut(l).mask.as_mut().unwrap().density = 0.4;
    let c = content(&mut cx(&doc, &mut cache, 0), l, rect);
    assert!((alpha(&c, 5, 5) - 0.6).abs() < 1e-6);
    // Feather softens the edge symmetrically.
    let m = doc.layer_mut(l).mask.as_mut().unwrap();
    m.density = 1.0;
    m.feather = 3.0;
    let c = content(&mut cx(&doc, &mut cache, 0), l, rect);
    assert!((alpha(&c, 9, 20) + alpha(&c, 10, 20) - 1.0).abs() < 0.02);
    assert!(alpha(&c, 7, 20) > 0.0 && alpha(&c, 7, 20) < 0.3);
    assert!((alpha(&c, 20, 20) - 1.0).abs() < 1e-3);
    // Disabled masks change nothing.
    doc.layer_mut(l).mask.as_mut().unwrap().disabled = true;
    let c = content(&mut cx(&doc, &mut cache, 0), l, rect);
    assert_eq!(alpha(&c, 5, 5), 1.0);
}

#[test]
fn vector_masks_cut_pixels_and_shape_fills() {
    let mut doc = Document::new(40, 40);
    let l = add_solid(&mut doc, IRect::new(0, 0, 40, 40), [0, 0, 255, 255]);
    doc.layer_mut(l).vector_mask = Some(square_mask(10.0, 10.0, 10.0));
    let mut cache = Cache::default();
    let rect = IRect::new(0, 0, 40, 40);
    let c = content(&mut cx(&doc, &mut cache, 0), l, rect);
    assert_eq!(c.px[15 * 40 + 15][3], 1.0);
    assert_eq!(c.px[25 * 40 + 25][3], 0.0);
    assert_eq!(extent(&doc, l, 0, false), Some(IRect::new(9, 9, 12, 12)));
    // A shape layer paints its fill inside its outline.
    let mut shape = Layer::new(0, "shape");
    shape.kind = LayerKind::Fill {
        fill: Fill::Solid {
            color: Rgb::new(0.0, 1.0, 0.0),
        },
        stroke: None,
    };
    shape.vector_mask = Some(square_mask(20.0, 20.0, 10.0));
    let s = add(&mut doc, shape);
    let c = content(&mut cx(&doc, &mut cache, 0), s, rect);
    assert_eq!(c.px[25 * 40 + 25], [0.0, 1.0, 0.0, 1.0]);
    assert_eq!(c.px[5 * 40 + 5][3], 0.0);
    // Without an outline a fill covers the canvas, and only the canvas.
    let mut fill = Layer::new(0, "fill");
    fill.kind = LayerKind::Fill {
        fill: Fill::Solid { color: Rgb::WHITE },
        stroke: None,
    };
    let f = add(&mut doc, fill);
    let wide = IRect::new(-5, 0, 50, 1);
    let c = content(&mut cx(&doc, &mut cache, 0), f, wide);
    assert_eq!(c.px[0][3], 0.0);
    assert_eq!(c.px[5][3], 1.0);
    assert_eq!(extent(&doc, f, 0, false), Some(doc.bounds()));
}

#[test]
fn shape_strokes_paint_over_the_fill() {
    let mut doc = Document::new(40, 40);
    let mut shape = Layer::new(0, "shape");
    shape.kind = LayerKind::Fill {
        fill: Fill::Solid {
            color: Rgb::new(0.0, 1.0, 0.0),
        },
        stroke: Some(Box::new(VectorStroke {
            enabled: true,
            fill_enabled: false,
            width: 2.0,
            align: crate::model::StrokeAlign::Inside,
            cap: crate::model::LineCap::Butt,
            join: crate::model::LineJoin::Miter,
            miter_limit: 4.0,
            dashes: Vec::new(),
            dash_offset: 0.0,
            opacity: 1.0,
            blend: crate::model::BlendMode::Normal,
            fill: Fill::Solid {
                color: Rgb::new(1.0, 0.0, 0.0),
            },
        })),
    };
    shape.vector_mask = Some(square_mask(10.0, 10.0, 20.0));
    let s = add(&mut doc, shape);
    let mut cache = Cache::default();
    let c = content(&mut cx(&doc, &mut cache, 0), s, IRect::new(0, 0, 40, 40));
    // The stroke's two pixels inside the edge, and no fill.
    assert_eq!(c.px[20 * 40 + 10], [1.0, 0.0, 0.0, 1.0]);
    assert_eq!(c.px[20 * 40 + 11], [1.0, 0.0, 0.0, 1.0]);
    assert_eq!(c.px[20 * 40 + 12][3], 0.0);
    assert_eq!(c.px[20 * 40 + 9][3], 0.0);
}

#[test]
fn backgrounds_are_opaque_across_the_canvas() {
    let mut doc = Document::new(8, 8);
    let mut bg = Layer::new(0, "Background");
    bg.background = true;
    bg.pixels = solid(IRect::new(0, 0, 4, 8), [10, 20, 30, 255]);
    let b = add(&mut doc, bg);
    let mut cache = Cache::default();
    let c = content(&mut cx(&doc, &mut cache, 0), b, IRect::new(0, 0, 10, 1));
    assert_eq!(c.px[1], [10.0 / 255.0, 20.0 / 255.0, 30.0 / 255.0, 1.0]);
    assert_eq!(c.px[6][3], 1.0);
    assert_eq!(c.px[9][3], 0.0);
    assert_eq!(extent(&doc, b, 0, true), Some(doc.bounds()));
}

#[test]
fn extents_follow_masks_levels_and_groups() {
    let mut doc = Document::new(100, 100);
    let l = add_solid(&mut doc, IRect::new(10, 10, 30, 30), [1, 1, 1, 255]);
    assert_eq!(extent(&doc, l, 0, true), Some(IRect::new(10, 10, 30, 30)));
    assert_eq!(extent(&doc, l, 1, true), Some(IRect::new(5, 5, 15, 15)));
    // Tile-granular unless tight.
    assert_eq!(
        extent(&doc, l, 0, false),
        Some(IRect::new(10, 10, 256, 256))
    );
    doc.layer_mut(l).mask = Some(mask(IRect::new(0, 0, 20, 20), 255, 0));
    assert_eq!(extent(&doc, l, 0, true), Some(IRect::new(10, 10, 10, 10)));
    let empty = add(&mut doc, Layer::new(0, "empty"));
    assert_eq!(extent(&doc, empty, 0, true), None);
}

#[test]
fn blend_if_ramps_across_split_sliders() {
    let mut r = BlendRanges {
        channels: vec![([0, 0, 255, 255], [0, 0, 255, 255])],
    };
    assert_eq!(blend_if(&r, [0.5; 3], [0.5; 3]), 1.0);
    // Underlying gray below 81 hides, 81..255 fades in.
    r.channels = vec![([0, 0, 255, 255], [81, 255, 255, 255])];
    assert_eq!(blend_if(&r, [0.5; 3], [80.0 / 255.0; 3]), 0.0);
    let w = blend_if(&r, [0.5; 3], [168.0 / 255.0; 3]);
    assert!((w - 0.5).abs() < 0.01, "{w}");
    // This layer's white end: hidden above 200, fading from 150.
    r.channels = vec![([0, 0, 150, 200], [0, 0, 255, 255])];
    assert_eq!(blend_if(&r, [1.0; 3], [0.0; 3]), 0.0);
    assert!((blend_if(&r, [175.0 / 255.0; 3], [0.0; 3]) - 0.5).abs() < 0.01);
    // Per channel: red of this layer above 100 hides.
    r.channels = vec![
        ([0, 0, 255, 255], [0, 0, 255, 255]),
        ([0, 0, 100, 100], [0, 0, 255, 255]),
    ];
    assert_eq!(blend_if(&r, [0.9, 0.0, 0.0], [0.0; 3]), 0.0);
    assert_eq!(blend_if(&r, [0.1, 1.0, 1.0], [0.0; 3]), 1.0);
}
