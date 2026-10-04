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
    edit(&mut doc, t, &Change::default()).unwrap();
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
    let font = Font::new("Inter", "Regular").unwrap();
    let k = font.kerning(font.glyph('A'), font.glyph('V'));
    assert!(k < 0.0, "A and V tuck together: {k}");
}

fn set(doc: &mut Document, h: &mut History, id: NodeIdx, props: &str) {
    let guid = doc.props(id).guid.unwrap();
    let ops: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"set","ids":["{guid}"],"props":{props}}}]"#
    ))
    .unwrap();
    h.apply(doc, &ops, None).unwrap();
}

fn width(doc: &Document, t: NodeIdx) -> f64 {
    doc.props(t).size().x
}

#[test]
fn heavier_weights_set_wider() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"Heading","fontSize":32}"#,
    );
    let regular = width(&doc, t);
    set(&mut doc, &mut h, t, r#"{"fontStyle":"Bold"}"#);
    assert!(width(&doc, t) > regular + 2.0);
    assert_eq!(
        doc.props(t)
            .text_style
            .as_ref()
            .unwrap()
            .font_style
            .as_deref(),
        Some("Bold")
    );
    // Italic is slanted, not wider.
    set(&mut doc, &mut h, t, r#"{"fontStyle":"Italic"}"#);
    assert!((width(&doc, t) - regular).abs() < 1.0);
}

#[test]
fn line_heights_follow_figma_units() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(&mut doc, &mut h, r#"{"characters":"a\nb","fontSize":10}"#);
    let auto = doc.props(t).size().y;
    assert!((auto - 24.2).abs() < 0.5, "Inter's own line height: {auto}");
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"lineHeight":{"value":150,"unit":"PERCENT"}}"#,
    );
    assert!((doc.props(t).size().y - 30.0).abs() < 0.01);
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"lineHeight":{"value":20,"unit":"PIXELS"}}"#,
    );
    assert!((doc.props(t).size().y - 40.0).abs() < 0.01);
    set(&mut doc, &mut h, t, r#"{"lineHeight":{"unit":"AUTO"}}"#);
    assert!((doc.props(t).size().y - auto).abs() < 0.01);
    set(&mut doc, &mut h, t, r#"{"paragraphSpacing":8}"#);
    assert!((doc.props(t).size().y - auto - 8.0).abs() < 0.01);
}

#[test]
fn letter_spacing_and_case() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(&mut doc, &mut h, r#"{"characters":"abc","fontSize":10}"#);
    let w = width(&doc, t);
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"letterSpacing":{"value":10,"unit":"PIXELS"}}"#,
    );
    assert!((width(&doc, t) - w - 20.0).abs() < 1.01);
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"letterSpacing":{"value":0,"unit":"PERCENT"},"textCase":"UPPER"}"#,
    );
    assert!(width(&doc, t) > w + 2.0, "capitals are wider");
    let content = doc.props(t).text_content.clone().unwrap();
    assert_eq!(&*content.characters, "abc", "case is displayed, not stored");
}

#[test]
fn underlines_and_strikes() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"one two","fontSize":10}"#,
    );
    set(&mut doc, &mut h, t, r#"{"textDecoration":"UNDERLINE"}"#);
    let layout = doc.props(t).text_layout.clone().unwrap();
    assert_eq!(layout.decorations.len(), 1);
    let r = layout.decorations[0].rects[0];
    let baseline = layout.glyphs[0].y;
    assert!(
        r[1] > baseline && r[1] < baseline + 3.0,
        "{r:?} below {baseline}"
    );
    assert!((f64::from(r[2]) - width(&doc, t)).abs() < 1.0);
    set(&mut doc, &mut h, t, r#"{"textDecoration":"STRIKETHROUGH"}"#);
    let r = doc.props(t).text_layout.clone().unwrap().decorations[0].rects[0];
    assert!(r[1] < baseline - 2.0);
    set(&mut doc, &mut h, t, r#"{"textDecoration":"NONE"}"#);
    assert!(
        doc.props(t)
            .text_layout
            .clone()
            .unwrap()
            .decorations
            .is_empty()
    );
}

#[test]
fn aligns_and_justifies_wrapped_lines() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"aaa bbb ccc ddd eee","fontSize":10}"#,
    );
    set(&mut doc, &mut h, t, r#"{"width":60}"#);
    let style = doc.props(t).text_style.clone().unwrap();
    assert_eq!(
        style.auto_resize.as_deref(),
        Some("HEIGHT"),
        "a dragged width is fixed"
    );
    let layout = doc.props(t).text_layout.clone().unwrap();
    assert!(layout.lines >= 2);
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"textAlignHorizontal":"JUSTIFIED"}"#,
    );
    let layout = doc.props(t).text_layout.clone().unwrap();
    let first_line_y = layout.glyphs[0].y;
    let last = layout
        .glyphs
        .iter()
        .rfind(|g| g.y == first_line_y && g.blob.is_some())
        .unwrap();
    assert!(
        (last.x + last.advance - 60.0).abs() < 0.5,
        "justified to the edge"
    );
    set(&mut doc, &mut h, t, r#"{"textAlignHorizontal":"RIGHT"}"#);
    let layout = doc.props(t).text_layout.clone().unwrap();
    let last_glyph = layout.glyphs.last().unwrap();
    assert!((last_glyph.x + last_glyph.advance - 60.0).abs() < 0.5);
    // A dragged height fixes the box.
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"height":100,"textAlignVertical":"BOTTOM"}"#,
    );
    let p = doc.props(t);
    assert_eq!(
        p.text_style.as_ref().unwrap().auto_resize.as_deref(),
        Some("NONE")
    );
    assert_eq!(p.size().y, 100.0);
    assert!(p.text_layout.as_ref().unwrap().glyphs.last().unwrap().y > 90.0);
}

#[test]
fn styles_follow_their_characters() {
    // Typing in the middle takes the style before; the ends keep theirs.
    assert_eq!(
        remap_styles("abcd", &[0, 1, 1, 2], "abXXcd"),
        vec![0, 1, 1, 1, 1, 2]
    );
    assert_eq!(remap_styles("abcd", &[1, 1, 0, 0], "ab"), vec![1, 1]);
    assert_eq!(
        remap_styles("abcd", &[0, 0, 0, 2], "Xabcd"),
        vec![0, 0, 0, 0, 2]
    );
    assert_eq!(remap_styles("ab", &[], "abc"), Vec::<u32>::new());
    assert_eq!(remap_styles("aa", &[3, 3], "aaa"), vec![3, 3, 3]);
}

#[test]
fn lays_out_character_styles() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"small BIG","fontSize":10}"#,
    );
    let mut content = doc.props(t).text_content.as_deref().cloned().unwrap();
    content.style_ids = Arc::from([0, 0, 0, 0, 0, 0, 7, 7, 7]);
    content.styles = Arc::from([StyleRun {
        id: 7,
        font_size: Some(30.0),
        font_style: Some("Bold".into()),
        ..Default::default()
    }]);
    doc.nodes[t as usize].props.text_content = Some(Arc::new(content));
    edit(&mut doc, t, &Change::default()).unwrap();
    let layout = doc.props(t).text_layout.clone().unwrap();
    assert_eq!(layout.glyphs[0].font_size, 10.0);
    assert_eq!(layout.glyphs[8].font_size, 30.0);
    assert_eq!(layout.glyphs[8].style_id, 7);
    assert!(
        doc.props(t).size().y > 30.0,
        "the big run sets the line height"
    );
    // Typing after the big run continues it.
    set(&mut doc, &mut h, t, r#"{"characters":"small BIGGER"}"#);
    let content = doc.props(t).text_content.clone().unwrap();
    assert_eq!(content.style_ids.len(), 12);
    assert_eq!(content.style_ids[11], 7);
    // A size for the whole layer replaces the run's.
    set(&mut doc, &mut h, t, r#"{"fontSize":12}"#);
    let layout = doc.props(t).text_layout.clone().unwrap();
    assert!(layout.glyphs.iter().all(|g| g.font_size == 12.0));
}

#[test]
fn undoes_typing() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(&mut doc, &mut h, r#"{"characters":"Hi","fontSize":10}"#);
    let w = width(&doc, t);
    set(&mut doc, &mut h, t, r#"{"characters":"Hi there"}"#);
    assert!(width(&doc, t) > w);
    h.undo(&mut doc).unwrap();
    assert_eq!(width(&doc, t), w);
    let content = doc.props(t).text_content.clone().unwrap();
    assert_eq!(&*content.characters, "Hi");
}
