use super::*;
use crate::edit::{History, Op};
use crate::model::Guid;
use crate::testing::simple_file;

fn new_text(doc: &mut Document, h: &mut History, json_props: &str) -> NodeIdx {
    let ops: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"create","parent":"1:2","node":{{"type":"TEXT","x":10,"y":10,"width":1,"height":1,"props":{json_props}}}}}]"#
    ))
    .unwrap();
    let applied = h.apply(doc, &ops, None).unwrap();
    doc.find(Guid::parse(&applied.created[0]).unwrap()).unwrap()
}

#[test]
fn lays_out_new_text_to_fit() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(&mut doc, &mut h, r#"{"characters":"Hello","fontSize":20}"#);
    let p = doc.props(t);
    let layout = p.text_layout.as_ref().unwrap();
    assert_eq!(layout.glyphs.len(), 5);
    assert_eq!(layout.lines, 1);
    assert!(layout.glyphs.iter().all(|g| g.blob.is_some()));
    // Auto width: wide enough for five letters at 20 px, one line high.
    let size = p.size();
    assert!(size.x > 40.0 && size.x < 70.0, "{size:?}");
    assert!((size.y - 24.2).abs() < 1.0, "{size:?}");
    // Glyphs advance left to right on one baseline.
    let xs: Vec<f32> = layout.glyphs.iter().map(|g| g.x).collect();
    assert!(xs.windows(2).all(|w| w[1] > w[0]));
    assert!(layout.glyphs.iter().all(|g| g.y == layout.glyphs[0].y));
}

#[test]
fn wraps_fixed_width_text() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"one two three four","fontSize":10}"#,
    );
    // Fix the width: Figma's "auto height".
    doc.nodes[t as usize].props.text_style = Some(Arc::new(TextStyle {
        auto_resize: Some("HEIGHT".into()),
        ..doc.props(t).text_style.as_deref().cloned().unwrap()
    }));
    doc.nodes[t as usize].props.size = Some(Vec2::new(40.0, 10.0));
    edit(&mut doc, t, None, None).unwrap();
    let p = doc.props(t);
    let layout = p.text_layout.as_ref().unwrap();
    assert!(layout.lines >= 3, "{} lines", layout.lines);
    assert_eq!(p.size().x, 40.0);
    assert!(p.size().y > 30.0);
    // Inked glyphs stay inside the box; trailing spaces may hang past it.
    assert!(
        layout
            .glyphs
            .iter()
            .all(|g| g.blob.is_none() || g.x + g.advance <= 40.5)
    );
}

#[test]
fn reuses_glyph_outlines() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let before = doc.blobs.len();
    new_text(&mut doc, &mut h, r#"{"characters":"aaaa"}"#);
    assert_eq!(doc.blobs.len(), before + 1, "one outline for four a's");
}

#[test]
fn maps_style_names_to_weights() {
    assert_eq!(weight_of("Regular"), 400.0);
    assert_eq!(weight_of("Semi Bold"), 600.0);
    assert_eq!(weight_of("Bold Italic"), 700.0);
    assert_eq!(weight_of("ExtraLight"), 200.0);
}

#[test]
fn kerns_pairs() {
    let mut cache = HashMap::new();
    let font = Font::new("Inter", "Regular", &mut cache).unwrap();
    let k = font.kerning(font.glyph('A'), font.glyph('V'));
    assert!(k < 0.0, "A and V tuck together: {k}");
}
