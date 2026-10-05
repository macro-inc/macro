use super::*;
use crate::testing::{V, fig_file, node, simple_file, size, solid, translate};

fn rgba(p: &Pixmap, x: u32, y: u32) -> [u8; 4] {
    let c = p.pixel(x, y).unwrap().demultiply();
    [c.red(), c.green(), c.blue(), c.alpha()]
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

fn viewport(x: f64, y: f64, scale: f64, width: u32, height: u32) -> Viewport {
    Viewport {
        x,
        y,
        scale,
        width,
        height,
    }
}

#[test]
fn renders_fills_in_place() {
    let p = draw(&simple_file(), viewport(0.0, 0.0, 1.0, 300, 300));
    assert_eq!(rgba(&p, 50, 40), [255, 0, 0, 255], "the rectangle");
    assert_eq!(rgba(&p, 150, 150), [255, 255, 255, 255], "the frame");
    assert_eq!(rgba(&p, 250, 250), [230, 230, 230, 255], "the canvas");
    // Edges land on pixel boundaries.
    assert_eq!(rgba(&p, 10, 20), [255, 0, 0, 255]);
    assert_eq!(rgba(&p, 9, 20), [255, 255, 255, 255]);
    assert_eq!(rgba(&p, 109, 69), [255, 0, 0, 255]);
    assert_eq!(rgba(&p, 110, 69), [255, 255, 255, 255]);
}

#[test]
fn renders_tiles_at_scale() {
    // The tile starting at page (5, 10) at 2× covers the rectangle's corner.
    let p = draw(&simple_file(), viewport(5.0, 10.0, 2.0, 64, 64));
    assert_eq!(rgba(&p, 9, 19), [255, 255, 255, 255]);
    assert_eq!(rgba(&p, 10, 20), [255, 0, 0, 255]);
}

#[test]
fn applies_layer_opacity() {
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(
                1,
                Some((0, "!")),
                "CANVAS",
                "Page",
                vec![("backgroundColor", crate::testing::color(1.0, 1.0, 1.0, 1.0))],
            ),
            node(
                2,
                Some((1, "!")),
                "RECTANGLE",
                "Half",
                vec![
                    ("size", size(10.0, 10.0)),
                    ("transform", translate(0.0, 0.0)),
                    ("opacity", V::Float(0.5)),
                    ("fillPaints", V::List(vec![solid(0.0, 0.0, 0.0)])),
                ],
            ),
        ],
        vec![],
    );
    let p = draw(&bytes, viewport(0.0, 0.0, 1.0, 20, 20));
    let [r, g, b, a] = rgba(&p, 5, 5);
    assert!(
        (126..=129).contains(&r) && r == g && g == b && a == 255,
        "{r} {g} {b}"
    );
}

#[test]
fn frames_clip_their_children() {
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(
                1,
                Some((0, "!")),
                "CANVAS",
                "Page",
                vec![("backgroundColor", crate::testing::color(1.0, 1.0, 1.0, 1.0))],
            ),
            node(
                2,
                Some((1, "!")),
                "FRAME",
                "Clip",
                vec![
                    ("size", size(20.0, 20.0)),
                    ("transform", translate(0.0, 0.0)),
                ],
            ),
            node(
                3,
                Some((2, "!")),
                "RECTANGLE",
                "Overflow",
                vec![
                    ("size", size(40.0, 40.0)),
                    ("transform", translate(10.0, 10.0)),
                    ("fillPaints", V::List(vec![solid(0.0, 0.0, 1.0)])),
                ],
            ),
        ],
        vec![],
    );
    let p = draw(&bytes, viewport(0.0, 0.0, 1.0, 60, 60));
    assert_eq!(rgba(&p, 15, 15), [0, 0, 255, 255]);
    assert_eq!(rgba(&p, 30, 30), [255, 255, 255, 255], "clipped away");
}

#[test]
fn renders_overridden_instances() {
    let bytes = crate::scene::test::instance_file();
    let p = draw(&bytes, viewport(0.0, 0.0, 1.0, 300, 40));
    assert_eq!(rgba(&p, 40, 15), [0, 0, 255, 255], "the component");
    assert_eq!(rgba(&p, 240, 15), [0, 255, 0, 255], "the instance");
}

#[test]
fn exports_one_node_on_transparency() {
    let doc = Document::open(&simple_file()).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let rect = scene.find(&doc, "1:3").unwrap();
    let p = render_node(
        &doc,
        &scene,
        &mut ImageStore::default(),
        rect,
        2.0,
        RenderOptions::default(),
    )
    .unwrap();
    assert_eq!((p.width(), p.height()), (200, 100));
    assert_eq!(rgba(&p, 100, 50), [255, 0, 0, 255]);
}

#[test]
fn draws_outlines() {
    let doc = Document::open(&simple_file()).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let opts = RenderOptions {
        outline: true,
        background: Some(crate::model::Color::WHITE),
    };
    let p = render(
        &doc,
        &scene,
        &mut ImageStore::default(),
        &viewport(0.0, 0.0, 1.0, 300, 300),
        opts,
    )
    .unwrap();
    // Outline view draws no fills: the rectangle's inside is background.
    assert_eq!(rgba(&p, 50, 40), [255, 255, 255, 255]);
    let edge = rgba(&p, 10, 40);
    assert!(edge[0] < 200, "the outline is drawn: {edge:?}");
}

#[test]
fn strokes_ellipses_along_their_outline() {
    // An ellipse saved without stroke geometry: the inside stroke follows the
    // circle, not its bounding box.
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(
                1,
                Some((0, "!")),
                "CANVAS",
                "Page",
                vec![("backgroundColor", crate::testing::color(0.0, 0.0, 0.0, 1.0))],
            ),
            node(
                2,
                Some((1, "!")),
                "ELLIPSE",
                "Dot",
                vec![
                    ("size", size(40.0, 40.0)),
                    ("transform", translate(0.0, 0.0)),
                    ("fillPaints", V::List(vec![solid(1.0, 1.0, 0.0)])),
                    ("strokePaints", V::List(vec![solid(1.0, 1.0, 1.0)])),
                    ("strokeWeight", V::Float(4.0)),
                    ("strokeAlign", V::Enum("INSIDE")),
                ],
            ),
        ],
        vec![],
    );
    let p = draw(&bytes, viewport(0.0, 0.0, 1.0, 40, 40));
    assert_eq!(rgba(&p, 20, 20), [255, 255, 0, 255], "the fill");
    assert_eq!(
        rgba(&p, 20, 1),
        [255, 255, 255, 255],
        "the stroke at the top"
    );
    assert_eq!(rgba(&p, 1, 1), [0, 0, 0, 255], "outside the circle");
    assert_eq!(
        rgba(&p, 6, 20),
        [255, 255, 0, 255],
        "inside the stroke band"
    );
    // On the diagonal, 18 units from the centre: in the circle's stroke band
    // but well inside its box's edges.
    assert_eq!(
        rgba(&p, 7, 7),
        [255, 255, 255, 255],
        "the stroke follows the curve"
    );
}

#[test]
fn area_masks_match_whole_masks_where_read() {
    let path = crate::geometry::rect_path(10.0, 10.0, 20.0, 15.0).unwrap();
    let ts = Transform::from_translate(3.5, 2.25);
    let mut parent = Mask::new(64, 48).unwrap();
    for (i, a) in parent.data_mut().iter_mut().enumerate() {
        *a = (i * 7 % 256) as u8;
    }

    // Filled, inverted, and multiplied over the whole surface.
    let mut whole = Mask::new(64, 48).unwrap();
    whole.fill_path(&path, FillRule::EvenOdd, true, ts);
    whole.invert();
    for (a, &b) in whole.data_mut().iter_mut().zip(parent.data()) {
        *a = ((u16::from(*a) * u16::from(b) + 127) / 255) as u8;
    }

    let mut area = AreaMask {
        mask: Mask::new(64, 48).unwrap(),
        area: [0; 4],
    };
    area.include(tiny_skia::Rect::from_xywh(0.0, 0.0, 40.0, 30.0).unwrap());
    area.fill_path(&path, FillRule::EvenOdd, ts);
    area.invert();
    area.multiply(&parent);
    for y in 0..30 {
        for x in 0..40 {
            let at = y * 64 + x;
            assert_eq!(area.mask.data()[at], whole.data()[at], "pixel {x},{y}");
        }
    }
    area.clear();
    assert!(
        area.mask.data().iter().all(|&a| a == 0),
        "cleared for reuse"
    );
}
