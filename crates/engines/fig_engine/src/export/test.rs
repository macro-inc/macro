use super::*;
use crate::edit::{History, Op};
use crate::model::Guid;
use crate::testing::showcase_file;

fn scene_of(doc: &Document, page: usize) -> Scene {
    Scene::build(doc, doc.pages[page])
}

fn find(doc: &Document, scene: &Scene, id: &str) -> SceneIdx {
    let _ = Guid::parse(id).unwrap();
    scene.find(doc, id).unwrap()
}

fn setting(json: &str) -> ExportSetting {
    serde_json::from_str(json).unwrap()
}

#[test]
fn jpeg_round_trips_through_a_decoder() {
    let (w, h) = (37u32, 21u32);
    let mut pixmap = tiny_skia::Pixmap::new(w, h).unwrap();
    for (k, px) in pixmap.pixels_mut().iter_mut().enumerate() {
        let (x, y) = (k as u32 % w, k as u32 / w);
        *px = tiny_skia::PremultipliedColorU8::from_rgba(
            (x * 255 / w) as u8,
            (y * 255 / h) as u8,
            128,
            255,
        )
        .unwrap();
    }
    let high = jpeg::encode(pixmap.data(), w, h, 95);
    let low = jpeg::encode(pixmap.data(), w, h, 20);
    assert!(high.starts_with(&[0xFF, 0xD8]) && high.ends_with(&[0xFF, 0xD9]));
    assert!(low.len() < high.len(), "lower quality, smaller file");
    let back = crate::images::decode(&high).expect("decodes");
    assert_eq!((back.width(), back.height()), (w, h));
    let error: f64 = pixmap
        .data()
        .iter()
        .zip(back.data())
        .map(|(a, b)| f64::from((i16::from(*a) - i16::from(*b)).abs()))
        .sum::<f64>()
        / pixmap.data().len() as f64;
    assert!(error < 4.0, "mean error {error}");
}

#[test]
fn transparent_pixels_turn_white_in_jpeg() {
    let pixmap = tiny_skia::Pixmap::new(16, 16).unwrap();
    let back = crate::images::decode(&jpeg::encode(pixmap.data(), 16, 16, 90)).unwrap();
    assert!(back.data().iter().all(|&v| v >= 250));
}

#[test]
fn names_files_as_figma_does() {
    assert_eq!(
        file_name("Icon", &setting(r#"{"format":"PNG"}"#)),
        "Icon.png"
    );
    assert_eq!(
        file_name("Icon", &setting(r#"{"format":"PNG","value":2}"#)),
        "Icon@2x.png"
    );
    assert_eq!(
        file_name("Icon", &setting(r#"{"format":"PNG","value":0.5}"#)),
        "Icon@0.5x.png"
    );
    assert_eq!(
        file_name(
            "Icon",
            &setting(r#"{"format":"JPEG","constraint":"CONTENT_WIDTH","value":300}"#)
        ),
        "Icon@300w.jpg"
    );
    assert_eq!(
        file_name(
            "icons/arrow: left",
            &setting(r#"{"format":"SVG","suffix":"-dark"}"#)
        ),
        "icons/arrow- left-dark.svg"
    );
    assert_eq!(
        file_name("", &setting(r#"{"format":"PDF"}"#)),
        "Untitled.pdf"
    );
}

#[test]
fn exports_one_file_or_a_zip() {
    let doc = Document::open(&showcase_file()).unwrap();
    let scene = scene_of(&doc, 0);
    let mut images = ImageStore::default();
    let avatar = find(&doc, &scene, "1:12");
    let one = export_files(
        &doc,
        &scene,
        &mut images,
        &[(avatar, setting(r#"{"format":"PNG","value":2}"#))],
        "Export",
    )
    .unwrap();
    assert_eq!(one.name, "Avatar@2x.png");
    assert_eq!(one.mime, "image/png");
    let png = crate::images::decode(&one.bytes).unwrap();
    assert_eq!(png.width(), 192, "96 px at 2x");

    let width = export_one(
        &doc,
        &scene,
        &mut images,
        avatar,
        &setting(r#"{"format":"JPEG","constraint":"CONTENT_WIDTH","value":48}"#),
    )
    .unwrap();
    assert_eq!(crate::images::decode(&width.bytes).unwrap().width(), 48);

    let home = find(&doc, &scene, "1:10");
    let many = export_files(
        &doc,
        &scene,
        &mut images,
        &[
            (avatar, setting(r#"{"format":"PNG"}"#)),
            (avatar, setting(r#"{"format":"PNG"}"#)),
            (avatar, setting(r#"{"format":"SVG"}"#)),
            (home, setting(r#"{"format":"PDF"}"#)),
        ],
        "Export",
    )
    .unwrap();
    assert_eq!(many.name, "Export.zip");
    let zip = crate::zip::ZipArchive::new(&many.bytes).unwrap();
    let names: Vec<&str> = zip.entries().iter().map(|e| e.name.as_str()).collect();
    assert_eq!(
        names,
        ["Avatar.png", "Avatar 2.png", "Avatar.svg", "Home.pdf"]
    );
}

/// The object offsets in a PDF's cross-reference table point at objects.
fn check_xref(pdf: &[u8]) -> usize {
    let tail = |at: usize| String::from_utf8_lossy(&pdf[at..(at + 64).min(pdf.len())]).into_owned();
    let marker = b"startxref\n";
    let xref = pdf
        .windows(marker.len())
        .rposition(|w| w == marker)
        .unwrap();
    let at: usize = tail(xref + 10).lines().next().unwrap().parse().unwrap();
    let table = String::from_utf8_lossy(&pdf[at..]).into_owned();
    assert!(table.starts_with("xref\n"));
    let mut lines = table.lines().skip(1);
    let count: usize = lines
        .next()
        .unwrap()
        .split(' ')
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    lines.next();
    for k in 1..count {
        let offset: usize = lines.next().unwrap()[..10].parse().unwrap();
        assert!(
            tail(offset).starts_with(&format!("{k} 0 obj")),
            "object {k}"
        );
    }
    count
}

#[test]
fn frames_become_pdf_pages() {
    let doc = Document::open(&showcase_file()).unwrap();
    let scene = scene_of(&doc, 0);
    let mut images = ImageStore::default();
    let pdf = frames_pdf(&doc, &scene, &mut images).unwrap();
    assert!(pdf.starts_with(b"%PDF-1.4"));
    assert!(pdf.ends_with(b"%%EOF\n"));
    check_xref(&pdf);
    let text = String::from_utf8_lossy(&pdf);
    assert_eq!(text.matches("/Type /Page ").count(), 2, "Home and Settings");
    assert!(text.contains("/Count 2"));
    assert!(text.contains("/MediaBox [0 0 360 640]"));
    // The header's gradient is a shading; the card's shadow an image.
    assert!(text.contains("/ShadingType 2"));
    assert!(text.contains("/Subtype /Image"));
}

#[test]
fn pdf_content_draws_vectors() {
    let doc = Document::open(&showcase_file()).unwrap();
    let scene = scene_of(&doc, 0);
    let mut images = ImageStore::default();
    let row = find(&doc, &scene, "1:21");
    let pdf = pdf::export(&doc, &scene, &mut images, &[row]).unwrap();
    check_xref(&pdf);
    let text = String::from_utf8_lossy(&pdf);
    // A plain rounded rectangle needs no images.
    assert!(!text.contains("/Subtype /Image"));
    // Its content stream inflates to a filled path.
    let at = |from: usize, needle: &[u8]| {
        from + pdf[from..]
            .windows(needle.len())
            .position(|w| w == needle)
            .unwrap()
    };
    let start = at(0, b"stream\n") + 7;
    let end = at(start, b"\nendstream");
    let content = miniz_oxide::inflate::decompress_to_vec_zlib(&pdf[start..end]).unwrap();
    let content = String::from_utf8(content).unwrap();
    assert!(content.contains(" rg "), "{content}");
    assert!(content.contains(" c "), "rounded corners are curves");
    assert!(content.trim_end().ends_with("f Q"));
}

#[test]
fn svg_options_name_layers_and_keep_text() {
    let mut doc = Document::open(&showcase_file()).unwrap();
    let ops: Vec<Op> = serde_json::from_str(
        r#"[{"op":"create","parent":"1:10","node":{"type":"TEXT","x":20,"y":500,"width":1,"height":1,
            "props":{"characters":"Hi & bye","fontSize":20,"fontStyle":"Bold"}}}]"#,
    )
    .unwrap();
    History::default().apply(&mut doc, &ops, None).unwrap();
    let scene = scene_of(&doc, 0);
    let home = find(&doc, &scene, "1:10");
    let mut images = ImageStore::default();
    let file = export_one(
        &doc,
        &scene,
        &mut images,
        home,
        &setting(r#"{"format":"SVG","svgOutlineText":false,"svgIncludeId":true}"#),
    )
    .unwrap();
    let svg = String::from_utf8(file.bytes).unwrap();
    assert!(svg.contains("id=\"Home\""), "{svg}");
    assert!(svg.contains("id=\"Primary_button\""));
    assert!(svg.contains("font-weight=\"700\""));
    assert!(svg.contains(">Hi &amp; bye</tspan>"));
    let outlined = svg::export(&doc, &scene, home).unwrap();
    assert!(!outlined.contains("<text") && !outlined.contains("id=\"Home\""));
}
