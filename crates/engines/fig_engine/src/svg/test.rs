use super::*;
use crate::edit::{History, Op};
use crate::testing::{showcase_file, simple_file};

fn svg_of(doc: &Document, page: usize, id: &str) -> String {
    let scene = Scene::build(doc, doc.pages[page]);
    let i = scene.find(doc, id).unwrap();
    export(doc, &scene, i).unwrap()
}

fn apply(doc: &mut Document, json: &str) -> Vec<String> {
    let ops: Vec<Op> = serde_json::from_str(json).unwrap();
    History::default().apply(doc, &ops, None).unwrap().created
}

/// Every element opened is closed.
fn balanced(svg: &str) -> bool {
    let opened = svg.matches('<').count();
    let self_closed = svg.matches("/>").count();
    let closing = svg.matches("</").count();
    opened == self_closed + 2 * closing
}

#[test]
fn exports_a_frame_with_its_content_clipped() {
    let doc = Document::open(&simple_file()).unwrap();
    let svg = svg_of(&doc, 0, "1:2");
    assert!(svg.starts_with("<svg width=\"200\" height=\"200\" viewBox=\"0 0 200 200\""));
    assert!(svg.contains("fill=\"#FFFFFF\""), "{svg}");
    assert!(
        svg.contains("<path d=\"M10 20L110 20L110 70L10 70Z\" fill=\"#FF0000\"/>"),
        "{svg}"
    );
    assert!(svg.contains("<clipPath id=") && svg.contains("clip-path=\"url(#clip"));
    assert!(balanced(&svg), "{svg}");
}

#[test]
fn exports_gradients_strokes_and_shadows() {
    let doc = Document::open(&showcase_file()).unwrap();
    let svg = svg_of(&doc, 0, "1:10");
    assert!(svg.contains("<linearGradient") && svg.contains("gradientTransform="));
    // The avatar's inside stroke is cut to its fill.
    assert!(svg.contains("stroke-width=\"8\""), "{svg}");
    assert!(svg.contains("<filter") && svg.contains("<feGaussianBlur stdDeviation=\"6\"/>"));
    assert!(svg.contains("<feOffset dx=\"0\" dy=\"4\"/>"));
    // The instance's override shows.
    assert!(svg.contains("#F24721"), "{svg}");
    assert!(!svg.contains("NaN"));
    assert!(balanced(&svg), "{svg}");
}

#[test]
fn layers_export_by_their_own_bounds() {
    let doc = Document::open(&simple_file()).unwrap();
    let svg = svg_of(&doc, 0, "1:3");
    assert!(svg.starts_with("<svg width=\"100\" height=\"50\""));
    assert!(
        svg.contains("<path d=\"M0 0L100 0L100 50L0 50Z\" fill=\"#FF0000\"/>"),
        "{svg}"
    );
}

#[test]
fn outlines_text_and_embeds_images() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut pixmap = tiny_skia::Pixmap::new(2, 2).unwrap();
    pixmap.fill(tiny_skia::Color::from_rgba8(0, 128, 255, 255));
    let png = crate::images::encode_png(&pixmap);
    doc.add_image("ab", png).unwrap();
    let created = apply(
        &mut doc,
        r#"[{"op":"create","parent":"1:2","node":{"type":"TEXT","x":10,"y":100,"width":1,"height":1,
              "props":{"characters":"Hi","fontSize":20}}},
            {"op":"set","ids":["1:3"],"props":{"fills":[{"image":"ab"}]}}]"#,
    );
    let svg = svg_of(&doc, 0, "1:2");
    assert!(!svg.contains("<text"), "text is outlined");
    let text = svg_of(&doc, 0, &created[0]);
    assert!(text.contains("<path") && (text.contains('C') || text.contains('Q')));
    assert!(svg.contains("href=\"data:image/png;base64,iVBORw0KGgo"));
}

#[test]
fn encodes_base64() {
    assert_eq!(base64(b"Man"), "TWFu");
    assert_eq!(base64(b"Ma"), "TWE=");
    assert_eq!(base64(b"M"), "TQ==");
}

#[test]
fn formats_numbers_compactly() {
    assert_eq!(num(10.0), "10");
    assert_eq!(num(0.12345), "0.123");
    assert_eq!(num(-0.0001), "0");
    assert_eq!(num(-2.5), "-2.5");
}
