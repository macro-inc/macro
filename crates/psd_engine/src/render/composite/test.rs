use crate::model::{
    Adjustment, Artboard, ArtboardBackground, BlendMode, BlendRanges, Contour, Document, Effects,
    Fill, Knot, Layer, LayerKind, LayerMask, Overlay, PathOp, Rgb, Shadow, Subpath, VectorMask,
};
use crate::raster::{IRect, Raster};
use crate::render::testing::{add, add_solid, assert_px, group, px, render};

const ALL: IRect = IRect::new(0, 0, 40, 40);

/// A 40×40 document with a white background.
fn white_doc() -> Document {
    let mut doc = Document::new(40, 40);
    add_solid(&mut doc, ALL, [255, 255, 255, 255]);
    doc
}

fn at(doc: &Document, x: i32, y: i32) -> [u8; 4] {
    px(&render(doc, ALL, 0), ALL, x, y)
}

#[test]
fn opacity_fades_layers_over_the_backdrop() {
    let mut doc = white_doc();
    let l = add_solid(&mut doc, IRect::new(10, 10, 20, 20), [0, 0, 255, 255]);
    doc.layer_mut(l).opacity = 128;
    assert_px(at(&doc, 15, 15), [127, 127, 255, 255], 1);
    assert_px(at(&doc, 5, 5), [255, 255, 255, 255], 0);
    // Hidden and removed layers are skipped.
    doc.layer_mut(l).visible = false;
    assert_px(at(&doc, 15, 15), [255, 255, 255, 255], 0);
    // Over nothing, coverage stays as alpha.
    let mut bare = Document::new(40, 40);
    let b = add_solid(&mut bare, ALL, [255, 0, 0, 255]);
    bare.layer_mut(b).opacity = 64;
    assert_px(at(&bare, 0, 0), [255, 0, 0, 64], 0);
}

#[test]
fn fill_fades_paint_but_not_effects() {
    let mut doc = white_doc();
    let l = add_solid(&mut doc, IRect::new(10, 10, 10, 10), [0, 0, 255, 255]);
    let layer = doc.layer_mut(l);
    layer.fill_opacity = 0;
    layer.effects = Some(Effects {
        color_overlays: vec![Overlay {
            enabled: true,
            blend: BlendMode::Normal,
            opacity: 1.0,
            fill: Fill::Solid {
                color: Rgb::new(1.0, 0.0, 0.0),
            },
        }],
        ..Effects::default()
    });
    // The overlay shows at full strength where the paint is gone.
    assert_px(at(&doc, 15, 15), [255, 0, 0, 255], 0);
    // Opacity fades both.
    doc.layer_mut(l).opacity = 0;
    assert_px(at(&doc, 15, 15), [255, 255, 255, 255], 0);
}

#[test]
fn special_modes_take_fill_inside_the_blend() {
    let mut doc = Document::new(40, 40);
    add_solid(&mut doc, ALL, [100, 100, 100, 255]);
    let l = add_solid(&mut doc, ALL, [200, 200, 200, 255]);
    doc.layer_mut(l).blend = BlendMode::LinearDodge;
    doc.layer_mut(l).opacity = 128;
    let by_opacity = at(&doc, 0, 0);
    doc.layer_mut(l).opacity = 255;
    doc.layer_mut(l).fill_opacity = 128;
    let by_fill = at(&doc, 0, 0);
    // Opacity: 100 + (255 - 100) / 2; fill: 100 + 200 / 2.
    assert_px(by_opacity, [178, 178, 178, 255], 1);
    assert_px(by_fill, [200, 200, 200, 255], 1);
}

#[test]
fn pass_through_groups_blend_children_into_the_backdrop() {
    let mut doc = Document::new(40, 40);
    add_solid(&mut doc, ALL, [255, 0, 0, 255]);
    let child = add_solid(&mut doc, IRect::new(10, 10, 20, 20), [128, 128, 128, 255]);
    doc.layer_mut(child).blend = BlendMode::Multiply;
    let g = group(&mut doc, &[child], BlendMode::PassThrough);
    // The child multiplies the red backdrop.
    assert_px(at(&doc, 15, 15), [128, 0, 0, 255], 1);
    // Isolated (Normal), it multiplies only transparency: plain gray.
    doc.layer_mut(g).blend = BlendMode::Normal;
    assert_px(at(&doc, 15, 15), [128, 128, 128, 255], 1);
    // Group opacity fades the result against the backdrop either way.
    doc.layer_mut(g).blend = BlendMode::PassThrough;
    doc.layer_mut(g).opacity = 128;
    assert_px(at(&doc, 15, 15), [191, 0, 0, 255], 1);
    // A hidden group hides its layers.
    doc.layer_mut(g).visible = false;
    assert_px(at(&doc, 15, 15), [255, 0, 0, 255], 0);
}

#[test]
fn adjustments_reach_below_pass_through_groups_only() {
    let mut doc = Document::new(40, 40);
    add_solid(&mut doc, ALL, [255, 255, 255, 255]);
    let inside = add_solid(&mut doc, IRect::new(0, 0, 20, 40), [0, 0, 0, 255]);
    let mut inv = Layer::new(0, "invert");
    inv.kind = LayerKind::Adjustment {
        adjustment: Box::new(Adjustment::Invert),
    };
    let inv = add(&mut doc, inv);
    let g = group(&mut doc, &[inside, inv], BlendMode::PassThrough);
    // Everything below is inverted: the black half and the white page.
    assert_px(at(&doc, 5, 5), [255, 255, 255, 255], 0);
    assert_px(at(&doc, 30, 5), [0, 0, 0, 255], 0);
    // Isolated, only the group's own pixels are.
    doc.layer_mut(g).blend = BlendMode::Normal;
    assert_px(at(&doc, 5, 5), [255, 255, 255, 255], 0);
    assert_px(at(&doc, 30, 5), [255, 255, 255, 255], 0);
}

#[test]
fn adjustment_layers_follow_masks_opacity_and_modes() {
    let mut doc = white_doc();
    let mut adj = Layer::new(0, "levels");
    adj.kind = LayerKind::Adjustment {
        adjustment: Box::new(Adjustment::Invert),
    };
    adj.opacity = 128;
    adj.mask = Some(LayerMask {
        generation: 0,
        raster: Raster::from_region(1, IRect::new(0, 0, 20, 40), &[255u8; 800]),
        rect: IRect::new(0, 0, 20, 40),
        default_color: 0,
        disabled: false,
        linked: true,
        density: 1.0,
        feather: 0.0,
    });
    add(&mut doc, adj);
    assert_px(at(&doc, 5, 5), [127, 127, 127, 255], 1);
    assert_px(at(&doc, 30, 5), [255, 255, 255, 255], 0);
}

#[test]
fn clipped_layers_show_only_over_their_base() {
    let mut doc = white_doc();
    let base = add_solid(&mut doc, IRect::new(10, 10, 20, 20), [255, 0, 0, 255]);
    let clipped = add_solid(&mut doc, ALL, [0, 0, 255, 255]);
    doc.layer_mut(clipped).clipping = true;
    assert_px(at(&doc, 15, 15), [0, 0, 255, 255], 0);
    assert_px(at(&doc, 5, 5), [255, 255, 255, 255], 0);
    // Clipped layers blend with the base's colors.
    doc.layer_mut(clipped).blend = BlendMode::Multiply;
    doc.layer_mut(clipped).pixels = crate::render::testing::solid(ALL, [128, 128, 128, 255]);
    assert_px(at(&doc, 15, 15), [128, 0, 0, 255], 1);
    // The base's opacity fades the whole clipping group.
    doc.layer_mut(base).opacity = 128;
    assert_px(at(&doc, 15, 15), [191, 127, 127, 255], 1);
    // A base at fill 0 still clips: only the clipped layer shows.
    doc.layer_mut(base).opacity = 255;
    doc.layer_mut(base).fill_opacity = 0;
    doc.layer_mut(clipped).blend = BlendMode::Normal;
    assert_px(at(&doc, 15, 15), [128, 128, 128, 255], 1);
    assert_px(at(&doc, 5, 5), [255, 255, 255, 255], 0);
    // A hidden base hides its clipping group.
    doc.layer_mut(base).visible = false;
    assert_px(at(&doc, 15, 15), [255, 255, 255, 255], 0);
}

#[test]
fn clipped_layers_not_blended_as_a_group_blend_onto_the_backdrop() {
    let mut doc = Document::new(40, 40);
    add_solid(&mut doc, ALL, [0, 255, 0, 255]);
    let base = add_solid(&mut doc, IRect::new(10, 10, 20, 20), [255, 0, 0, 255]);
    doc.layer_mut(base).blend = BlendMode::Multiply;
    let clipped = add_solid(&mut doc, ALL, [255, 255, 255, 255]);
    doc.layer_mut(clipped).clipping = true;
    // As a group: white over red is white, multiplied onto green: green.
    assert_px(at(&doc, 15, 15), [0, 255, 0, 255], 0);
    // Separately: red multiplies green to black, then white covers it.
    doc.layer_mut(base).blend_clipped_as_group = false;
    assert_px(at(&doc, 15, 15), [255, 255, 255, 255], 0);
    assert_px(at(&doc, 5, 5), [0, 255, 0, 255], 0);
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
fn masks_limit_layers_and_groups() {
    let mut doc = white_doc();
    let l = add_solid(&mut doc, ALL, [0, 0, 0, 255]);
    doc.layer_mut(l).vector_mask = Some(square_mask(10.0, 10.0, 10.0));
    assert_px(at(&doc, 15, 15), [0, 0, 0, 255], 0);
    assert_px(at(&doc, 25, 25), [255, 255, 255, 255], 0);
    let mut inverted = square_mask(10.0, 10.0, 10.0);
    inverted.invert = true;
    doc.layer_mut(l).vector_mask = Some(inverted);
    assert_px(at(&doc, 15, 15), [255, 255, 255, 255], 0);
    assert_px(at(&doc, 25, 25), [0, 0, 0, 255], 0);
    // A group's mask limits its pass-through result.
    doc.layer_mut(l).vector_mask = None;
    let g = group(&mut doc, &[l], BlendMode::PassThrough);
    doc.layer_mut(g).vector_mask = Some(square_mask(0.0, 0.0, 20.0));
    assert_px(at(&doc, 5, 5), [0, 0, 0, 255], 0);
    assert_px(at(&doc, 30, 30), [255, 255, 255, 255], 0);
}

#[test]
fn fill_layers_paint_inside_their_shapes() {
    let mut doc = white_doc();
    let mut shape = Layer::new(0, "shape");
    shape.kind = LayerKind::Fill {
        fill: Fill::Solid {
            color: Rgb::new(0.0, 1.0, 0.0),
        },
        stroke: None,
    };
    shape.vector_mask = Some(square_mask(5.0, 5.0, 10.0));
    shape.opacity = 128;
    add(&mut doc, shape);
    assert_px(at(&doc, 10, 10), [127, 255, 127, 255], 1);
    assert_px(at(&doc, 20, 20), [255, 255, 255, 255], 0);
    // A gradient fill without a shape covers the canvas, black to white
    // upward by default.
    let mut gradient = Layer::new(0, "gradient");
    gradient.kind = LayerKind::Fill {
        fill: Fill::Gradient {
            gradient: crate::model::Gradient {
                smoothness: 0.0,
                ..Default::default()
            },
        },
        stroke: None,
    };
    add(&mut doc, gradient);
    let out = render(&doc, ALL, 0);
    assert!(px(&out, ALL, 20, 1)[0] > 240 && px(&out, ALL, 20, 38)[0] < 15);
}

#[test]
fn blend_if_hides_by_value() {
    let mut doc = Document::new(40, 40);
    add_solid(&mut doc, IRect::new(0, 0, 20, 40), [0, 0, 0, 255]);
    add_solid(&mut doc, IRect::new(20, 0, 20, 40), [255, 255, 255, 255]);
    let l = add_solid(&mut doc, ALL, [255, 0, 0, 255]);
    // Show only over light underlying pixels.
    doc.layer_mut(l).blend_ranges = Some(BlendRanges {
        channels: vec![([0, 0, 255, 255], [128, 128, 255, 255])],
    });
    assert_px(at(&doc, 5, 5), [0, 0, 0, 255], 0);
    assert_px(at(&doc, 30, 5), [255, 0, 0, 255], 0);
}

fn drop_shadow(knocks_out: bool) -> Shadow {
    Shadow {
        enabled: true,
        blend: BlendMode::Normal,
        color: Rgb::BLACK,
        opacity: 1.0,
        angle: 90.0,
        use_global_light: false,
        distance: 0.0,
        spread: 1.0,
        size: 2.0,
        noise: 0.0,
        contour: Contour::default(),
        knocks_out,
    }
}

#[test]
fn knocked_out_shadows_hide_under_the_layer() {
    let mut doc = white_doc();
    let l = add_solid(&mut doc, IRect::new(10, 10, 20, 20), [255, 0, 0, 255]);
    doc.layer_mut(l).fill_opacity = 0;
    doc.layer_mut(l).effects = Some(Effects {
        drop_shadows: vec![drop_shadow(true)],
        ..Effects::default()
    });
    // Around the layer: the shadow; under it: nothing at fill 0.
    assert_px(at(&doc, 9, 20), [0, 0, 0, 255], 0);
    assert_px(at(&doc, 20, 20), [255, 255, 255, 255], 0);
    doc.layer_mut(l).effects = Some(Effects {
        drop_shadows: vec![drop_shadow(false)],
        ..Effects::default()
    });
    assert_px(at(&doc, 20, 20), [0, 0, 0, 255], 0);
}

/// Photoshop 2026's `2026-blend-modes` file: 50% gray, then a layer per
/// mode with a color overlay of the same mode; `merged` is Photoshop's.
/// A mode, the layer's color, the overlay's, and Photoshop's result.
type Case = (BlendMode, [u8; 3], [u8; 3], [u8; 3]);

const PHOTOSHOP: [Case; 6] = [
    (
        BlendMode::Multiply,
        [242, 190, 85],
        [65, 116, 217],
        [31, 43, 37],
    ),
    (
        BlendMode::SoftLight,
        [85, 242, 225],
        [217, 65, 82],
        [147, 148, 148],
    ),
    (
        BlendMode::VividLight,
        [85, 190, 242],
        [217, 116, 65],
        [211, 248, 255],
    ),
    (
        BlendMode::LinearLight,
        [85, 155, 242],
        [217, 149, 65],
        [220, 224, 129],
    ),
    (
        BlendMode::Difference,
        [120, 85, 242],
        [183, 217, 65],
        [175, 174, 49],
    ),
    (
        BlendMode::Color,
        [242, 85, 155],
        [65, 217, 149],
        [29, 181, 113],
    ),
];

#[test]
fn interior_effects_blend_onto_the_composite_like_photoshop() {
    let mut doc = Document::new(60, 10);
    add_solid(&mut doc, IRect::new(0, 0, 60, 10), [0, 0, 0, 255]);
    add_solid(&mut doc, IRect::new(0, 0, 60, 10), [128, 128, 128, 255]);
    for (i, (mode, src, ov, _)) in PHOTOSHOP.iter().enumerate() {
        let l = add_solid(
            &mut doc,
            IRect::new(i as i32 * 10, 0, 10, 10),
            [src[0], src[1], src[2], 255],
        );
        let layer = doc.layer_mut(l);
        layer.blend = *mode;
        layer.effects = Some(Effects {
            color_overlays: vec![Overlay {
                enabled: true,
                blend: *mode,
                opacity: 1.0,
                fill: Fill::Solid {
                    color: Rgb::from_u8(ov[0], ov[1], ov[2]),
                },
            }],
            ..Effects::default()
        });
    }
    let rect = IRect::new(0, 0, 60, 10);
    let out = render(&doc, rect, 0);
    for (i, (mode, _, _, merged)) in PHOTOSHOP.iter().enumerate() {
        let got = px(&out, rect, i as i32 * 10 + 5, 5);
        let ok = got.iter().zip(merged).all(|(g, m)| g.abs_diff(*m) <= 1);
        assert!(ok, "{mode:?}: {got:?}, Photoshop {merged:?}");
    }
    // Blending interior effects as a group puts the overlay on the paint
    // first: |128 - |src - overlay|| for Difference.
    let difference = doc.roots[2 + 4];
    doc.layer_mut(difference).blend_interior_as_group = true;
    let out = render(&doc, rect, 0);
    assert_px(px(&out, rect, 45, 5), [65, 4, 49, 255], 1);
}

#[test]
fn artboards_draw_on_their_backgrounds_and_cut_their_content() {
    let mut doc = Document::new(40, 40);
    // A red layer reaching past the artboard on both sides.
    let red = add_solid(&mut doc, IRect::new(0, 10, 40, 10), [255, 0, 0, 255]);
    let board = group(&mut doc, &[red], BlendMode::Normal);
    let set = |doc: &mut Document, background: ArtboardBackground| {
        doc.layer_mut(board).kind = LayerKind::Group {
            open: true,
            artboard: Some(Artboard {
                rect: IRect::new(10, 0, 20, 40),
                background,
            }),
        };
    };
    set(&mut doc, ArtboardBackground::White);
    assert_px(at(&doc, 15, 15), [255, 0, 0, 255], 0);
    assert_px(at(&doc, 15, 30), [255, 255, 255, 255], 0);
    assert_px(at(&doc, 5, 15), [0, 0, 0, 0], 0);
    assert_px(at(&doc, 35, 15), [0, 0, 0, 0], 0);
    set(
        &mut doc,
        ArtboardBackground::Color {
            color: Rgb::from_u8(0, 0, 255),
        },
    );
    assert_px(at(&doc, 15, 30), [0, 0, 255, 255], 0);
    set(&mut doc, ArtboardBackground::Transparent);
    assert_px(at(&doc, 15, 30), [0, 0, 0, 0], 0);
    assert_px(at(&doc, 15, 15), [255, 0, 0, 255], 0);
    assert_px(at(&doc, 5, 15), [0, 0, 0, 0], 0);
    // Zoomed out, the same.
    let half = IRect::new(0, 0, 20, 20);
    let out = render(&doc, half, 1);
    assert_px(px(&out, half, 2, 7), [0, 0, 0, 0], 0);
    assert_px(px(&out, half, 8, 7), [255, 0, 0, 255], 0);
}
