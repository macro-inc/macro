use super::*;
use crate::model::{Color, Paint};
use crate::testing::{PdfBuilder, dict, helvetica, name, nums};

/// A page with two layers: a red background, and art with a clip group, a
/// stroked line, text, and a half-transparent group.
fn layered() -> Vec<u8> {
    let mut b = PdfBuilder::new();
    let bg = b.ocg("Background");
    let art = b.ocg("Art");
    b.layers(&[art, bg], &[]);
    let form = b.stream(
        dict(vec![
            ("Type", name("XObject")),
            ("Subtype", name("Form")),
            ("BBox", nums(&[0.0, 0.0, 200.0, 100.0])),
            (
                "Group",
                Object::Dict(dict(vec![("S", name("Transparency"))])),
            ),
        ]),
        "1 1 0 rg 150 10 30 30 re f",
    );
    let resources = dict(vec![
        ("Font", Object::Dict(dict(vec![("F1", helvetica())]))),
        (
            "Properties",
            Object::Dict(dict(vec![("MC0", Object::Ref(bg)), ("MC1", Object::Ref(art))])),
        ),
        ("XObject", Object::Dict(dict(vec![("Fm0", Object::Ref(form))]))),
        (
            "ExtGState",
            Object::Dict(dict(vec![(
                "GS0",
                Object::Dict(dict(vec![("ca", Object::number(0.5)), ("CA", Object::number(0.5))])),
            )])),
        ),
    ]);
    let content = "/OC /MC0 BDC\n1 0 0 rg 0 0 200 100 re f\nEMC\n\
        /OC /MC1 BDC\n\
        q 10 10 50 50 re W n\n0 0 1 rg 0 0 100 100 re f\n0 1 0 RG 2 w 20 20 m 40 40 l S\nQ\n\
        BT /F1 12 Tf 1 0 0 1 120 50 Tm (Hello) Tj ET\n\
        q /GS0 gs /Fm0 Do Q\n\
        EMC\n";
    b.page(200.0, 100.0, content, resources);
    b.finish()
}

fn kinds(doc: &Document, i: NodeIdx) -> Vec<&'static str> {
    doc.node(i)
        .children
        .iter()
        .filter(|&&c| !doc.node(c).removed)
        .map(|&c| crate::inspect::kind_word(&doc.node(c).kind))
        .collect()
}

#[test]
fn reads_layers_clips_text_and_groups() {
    let doc = open(&layered()).expect("opens").document;
    assert_eq!(doc.artboards.len(), 1);
    assert_eq!(doc.artboards[0].rect, Rect::new(0.0, 0.0, 200.0, 100.0));
    let names: Vec<&str> = doc.layers.iter().map(|&l| doc.node(l).name.as_str()).collect();
    assert_eq!(names, ["Background", "Art"], "bottom to top");

    let bg = doc.layers[0];
    assert_eq!(kinds(&doc, bg), ["path"]);
    let rect = doc.node(doc.node(bg).children[0]);
    let NodeKind::Path(p) = &rect.kind else {
        panic!("a path")
    };
    assert_eq!(
        p.fill,
        Some(Paint::Solid {
            color: Color::Rgb {
                r: 1.0,
                g: 0.0,
                b: 0.0
            }
        })
    );
    // Page space (y up) to canvas (y down).
    let corner = rect.transform.apply(crate::geom::Point::new(0.0, 0.0));
    assert_eq!((corner.x, corner.y), (0.0, 100.0));

    let art = doc.layers[1];
    assert_eq!(kinds(&doc, art), ["clipGroup", "text", "group"]);
    let clip_group = doc.node(art).children[0];
    assert_eq!(kinds(&doc, clip_group), ["path", "path"]);
    let NodeKind::Group { clip: Some(clip), .. } = &doc.node(clip_group).kind else {
        panic!("a clip group")
    };
    assert_eq!(clip.path.bounds(), Some(Rect::new(10.0, 40.0, 60.0, 90.0)));
    let line = doc.node(doc.node(clip_group).children[1]);
    let NodeKind::Path(line) = &line.kind else {
        panic!("a path")
    };
    assert!(line.fill.is_none());
    assert_eq!(line.stroke.as_ref().map(|s| s.width), Some(2.0));

    let text = doc.node(doc.node(art).children[1]);
    let NodeKind::Text(t) = &text.kind else {
        panic!("text")
    };
    assert_eq!(t.text, "Hello");
    assert_eq!(t.size, 12.0);
    assert_eq!(t.family, "Helvetica");
    assert_eq!(t.runs.as_ref().map(|r| r[0].glyphs.len()), Some(5));

    let group = doc.node(doc.node(art).children[2]);
    assert_eq!(group.opacity, 0.5);
    let NodeKind::Group { clip, .. } = &group.kind else {
        panic!("a group")
    };
    assert!(clip.is_none(), "a form box that clips nothing is dropped");
}

#[test]
fn page_box_clips_are_dropped() {
    let mut b = PdfBuilder::new();
    b.page(
        200.0,
        100.0,
        "q 0 0 200 100 re W n 1 0 0 rg 10 10 20 20 re f Q",
        Dict::new(),
    );
    let doc = open(&b.finish()).expect("opens").document;
    assert_eq!(doc.layers.len(), 1);
    assert_eq!(kinds(&doc, doc.layers[0]), ["path"]);
}

#[test]
fn shared_clips_make_one_group_and_new_clips_another() {
    let mut b = PdfBuilder::new();
    b.page(
        200.0,
        100.0,
        "q 10 10 50 50 re W n 0 0 10 10 re f 5 5 10 10 re f Q \
         q 10 10 50 50 re W n 0 0 10 10 re f Q",
        Dict::new(),
    );
    let doc = open(&b.finish()).expect("opens").document;
    // Same path, set again: a second clip.
    assert_eq!(kinds(&doc, doc.layers[0]), ["clipGroup", "clipGroup"]);
    assert_eq!(kinds(&doc, doc.node(doc.layers[0]).children[0]), ["path", "path"]);
}

#[test]
fn soft_masked_content_is_raw() {
    let mut b = PdfBuilder::new();
    let mask_form = b.stream(
        dict(vec![
            ("Type", name("XObject")),
            ("Subtype", name("Form")),
            ("BBox", nums(&[0.0, 0.0, 100.0, 100.0])),
            (
                "Group",
                Object::Dict(dict(vec![("S", name("Transparency")), ("CS", name("DeviceGray"))])),
            ),
        ]),
        "0.5 g 0 0 100 100 re f",
    );
    let resources = dict(vec![(
        "ExtGState",
        Object::Dict(dict(vec![(
            "GS0",
            Object::Dict(dict(vec![(
                "SMask",
                Object::Dict(dict(vec![
                    ("S", name("Luminosity")),
                    ("G", Object::Ref(mask_form)),
                ])),
            )])),
        )])),
    )]);
    b.page(100.0, 100.0, "q /GS0 gs 1 0 0 rg 0 0 100 100 re f Q", resources);
    let doc = open(&b.finish()).expect("opens").document;
    assert_eq!(kinds(&doc, doc.layers[0]), ["artwork"]);
    // Drawn: half of red over white.
    let img = crate::testing::draw(&doc);
    let px = crate::testing::pixel(&img, 50, 50);
    assert!((i32::from(px[1]) - 128).abs() < 8, "{px:?}");
    assert_eq!(px[0], 255);
}

#[test]
fn pages_are_artboards_side_by_side() {
    let mut b = PdfBuilder::new();
    b.page(100.0, 50.0, "0 g 0 0 10 10 re f", Dict::new());
    b.page(80.0, 60.0, "0 g 0 0 10 10 re f", Dict::new());
    let doc = open(&b.finish()).expect("opens").document;
    let rects: Vec<Rect> = doc.artboards.iter().map(|a| a.rect).collect();
    assert_eq!(rects[0], Rect::new(0.0, 0.0, 100.0, 50.0));
    assert_eq!(rects[1], Rect::new(100.0 + ARTBOARD_GAP, 0.0, 180.0 + ARTBOARD_GAP, 60.0));
    let second = doc.node(doc.layers[0]).children[1];
    let b = node_bounds(&doc, second).expect("bounds");
    assert_eq!(b, Rect::new(140.0, 50.0, 150.0, 60.0));
    assert_eq!(doc.node(second).artboard, doc.artboards[1].id);
}

#[test]
fn rotated_pages_show_turned() {
    let mut b = PdfBuilder::new();
    let page = b.page(100.0, 50.0, "0 g 0 0 10 10 re f", Dict::new());
    let mut doc_bytes = b.finish();
    // Add Rotate 90 by rewriting the page dictionary text.
    let text = String::from_utf8_lossy(&doc_bytes).into_owned();
    let marker = format!("{} 0 obj", page.num);
    assert!(text.contains(&marker));
    let patched = text.replacen("/Type /Page", "/Type /Page /Rotate 90", 1);
    doc_bytes = patched.into_bytes();
    let doc = open(&doc_bytes).expect("opens (repaired)").document;
    assert_eq!(doc.artboards[0].rect, Rect::new(0.0, 0.0, 50.0, 100.0));
    let square = doc.node(doc.layers[0]).children[0];
    // The bottom-left corner of the page shows at the top-left.
    assert_eq!(node_bounds(&doc, square), Some(Rect::new(0.0, 0.0, 10.0, 10.0)));
}

#[test]
fn old_and_foreign_files() {
    assert!(matches!(
        open(b"%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator(R) 8.0"),
        Err(AiError::Unsupported(_))
    ));
    assert!(matches!(open(b"GIF89a"), Err(AiError::NotAi)));
}

#[test]
fn text_with_word_gaps_and_lines() {
    let mut b = PdfBuilder::new();
    let resources = dict(vec![("Font", Object::Dict(dict(vec![("F1", helvetica())])))]);
    b.page(
        300.0,
        200.0,
        "BT /F1 10 Tf 1 0 0 1 10 100 Tm [(Two)-600(words)] TJ 0 -14 Td (Next) Tj ET",
        resources,
    );
    let doc = open(&b.finish()).expect("opens").document;
    let t = doc.node(doc.node(doc.layers[0]).children[0]);
    let NodeKind::Text(t) = &t.kind else {
        panic!("text")
    };
    assert_eq!(t.text, "Two words\nNext");
    assert!((t.line_height - 1.4).abs() < 1e-6);
}
