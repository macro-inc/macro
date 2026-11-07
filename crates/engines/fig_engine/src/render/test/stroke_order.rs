use super::{draw, rgba, viewport};
use crate::testing::{V, fig_file, node, size, solid, translate};
use crate::{Document, Scene};

#[test]
fn child_tabs_cover_the_container_border() {
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Page", vec![]),
            node(
                2,
                Some((1, "!")),
                "FRAME",
                "Tab bar",
                vec![
                    ("size", size(80.0, 30.0)),
                    ("transform", translate(10.0, 10.0)),
                    ("fillPaints", V::List(vec![solid(0.0, 0.0, 0.0)])),
                    ("strokePaints", V::List(vec![solid(0.5, 0.5, 0.5)])),
                    ("strokeWeight", V::Float(1.0)),
                    ("strokeAlign", V::Enum("INSIDE")),
                ],
            ),
            node(
                3,
                Some((2, "!")),
                "RECTANGLE",
                "Active underline",
                vec![
                    ("size", size(20.0, 1.0)),
                    ("transform", translate(10.0, 29.0)),
                    ("fillPaints", V::List(vec![solid(0.0, 1.0, 0.0)])),
                ],
            ),
            node(
                4,
                Some((2, "#")),
                "RECTANGLE",
                "Open tab edge",
                vec![
                    ("size", size(20.0, 1.0)),
                    ("transform", translate(40.0, 29.0)),
                    ("fillPaints", V::List(vec![solid(0.0, 0.0, 0.0)])),
                ],
            ),
        ],
        vec![],
    );
    for scale in [1.0, 2.0] {
        let mut doc = Document::open(&bytes).unwrap();
        let frame = doc.find(crate::model::Guid::parse("1:2").unwrap()).unwrap();
        doc.nodes[frame as usize].props.clip_disabled = Some(true);
        let scene = Scene::build(&doc, doc.pages[0]);
        let p = crate::render::render(
            &doc,
            &scene,
            &mut crate::images::ImageStore::default(),
            &viewport(0.0, 0.0, scale, 200, 100),
            crate::render::RenderOptions::default(),
        )
        .unwrap();
        let sample = |x, y| rgba(&p, (x * scale) as u32, (y * scale) as u32);
        assert_eq!(sample(25.0, 39.0), [0, 255, 0, 255]);
        assert_eq!(sample(55.0, 39.0), [0, 0, 0, 255]);
        assert_eq!(sample(80.0, 39.0), [128, 128, 128, 255]);
    }
    let clipped = draw(&bytes, viewport(0.0, 0.0, 1.0, 100, 50));
    assert_eq!(rgba(&clipped, 25, 39), [128, 128, 128, 255]);
    assert_eq!(rgba(&clipped, 55, 39), [128, 128, 128, 255]);
    let mut doc = Document::open(&bytes).unwrap();
    let frame = doc.find(crate::model::Guid::parse("1:2").unwrap()).unwrap();
    doc.nodes[frame as usize].props.clip_disabled = Some(true);
    let scene = Scene::build(&doc, doc.pages[0]);
    let svg = crate::svg::export(&doc, &scene, 0).unwrap();
    assert!(svg.find("#808080").unwrap() < svg.find("#00FF00").unwrap());
}
