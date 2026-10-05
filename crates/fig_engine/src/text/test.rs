use super::*;
use crate::edit::{History, Op};
use crate::model::{Guid, Vec2};
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
    let w = |s: &str| parse_style(s).weight;
    assert_eq!(w("Regular"), 400.0);
    assert_eq!(w("Semi Bold"), 600.0);
    assert_eq!(w("SemiBold"), 600.0);
    assert_eq!(w("Bold Italic"), 700.0);
    assert_eq!(w("ExtraLight"), 200.0);
    assert_eq!(w("Medium"), 500.0);
    assert_eq!(w("Heavy"), 900.0);
    assert_eq!(w("45 Light"), 300.0);
    assert!(parse_style("Bold Italic").italic);
    assert!(!parse_style("Medium").italic);
    assert_eq!(parse_style("Condensed Bold").width, 75.0);
    assert_eq!(parse_style("SemiCondensed").width, 87.5);
    assert_eq!(parse_style("9pt Regular").optical_size, Some(9.0));
    assert_eq!(parse_style("Regular").optical_size, None);
}

#[test]
fn kerns_pairs() {
    let font = font::Font::new("Inter", "Regular");
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

const INTER: &[u8] = include_bytes!("../../fonts/InterVariable.ttf");

#[test]
fn registers_fonts_under_a_family() {
    let faces = register_font(INTER.to_vec(), Some("Test Sans"));
    assert_eq!(faces.len(), 1);
    assert_eq!(faces[0].family, "Test Sans");
    assert!(faces[0].variable);
    assert_eq!((faces[0].weight, faces[0].max_weight), (100.0, 900.0));
    let count = registered().len();
    // Registering the same file again changes nothing.
    assert_eq!(register_font(INTER.to_vec(), Some("Test Sans")), faces);
    assert_eq!(registered().len(), count);
    assert!(register_font(b"not a font".to_vec(), None).is_empty());
    assert_eq!(font_status("Test Sans", "Semi Bold"), FontStatus::Available);
    assert_eq!(font_status("test sans", "Regular"), FontStatus::Available);
    assert_eq!(font_status("Test Sans", "Italic"), FontStatus::StyleMissing);
    assert_eq!(
        font_status("Nowhere Grotesk", "Regular"),
        FontStatus::Missing
    );
    assert!(has_font("Test Sans") && !has_font("Nowhere Grotesk"));
}

#[test]
fn lays_out_in_the_registered_font() {
    register_font(INTER.to_vec(), Some("Laid Sans"));
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let inter = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"Hamburgefonts","fontSize":20}"#,
    );
    let other = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"Hamburgefonts","fontSize":20,"fontFamily":"Laid Sans"}"#,
    );
    assert_eq!(width(&doc, inter), width(&doc, other));
    // A missing family keeps its name and lays out in Inter.
    set(
        &mut doc,
        &mut h,
        other,
        r#"{"fontFamily":"Nowhere Grotesk"}"#,
    );
    let style = doc.props(other).text_style.clone().unwrap();
    assert_eq!(style.font_family.as_deref(), Some("Nowhere Grotesk"));
    assert_eq!(width(&doc, inter), width(&doc, other));
    let fonts = document_fonts(&doc);
    let missing = fonts
        .iter()
        .find(|f| f.family == "Nowhere Grotesk")
        .unwrap();
    assert_eq!(missing.status, FontStatus::Missing);
    assert_eq!(missing.layers, 1);
    assert!(
        fonts
            .iter()
            .any(|f| f.family == "Inter" && f.status == FontStatus::Available)
    );
}

fn content(doc: &Document, t: NodeIdx) -> Arc<TextContent> {
    doc.props(t).text_content.clone().unwrap()
}

#[test]
fn styles_a_range_of_characters() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"one two three","fontSize":10}"#,
    );
    let plain = width(&doc, t);
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"fontStyle":"Bold","textRange":[4,7]}"#,
    );
    let c = content(&doc, t);
    assert_eq!(&c.style_ids[..], &[0, 0, 0, 0, 1, 1, 1]);
    assert_eq!(c.styles.len(), 1);
    assert_eq!(c.styles[0].font_style.as_deref(), Some("Bold"));
    assert_eq!(c.styles[0].font_family.as_deref(), Some("Inter"));
    assert!(width(&doc, t) > plain, "bold is wider");
    // The layer's own style is unchanged.
    let style = doc.props(t).text_style.clone().unwrap();
    assert_eq!(style.font_style.as_deref(), Some("Regular"));
    // A bigger size on part of the range splits it.
    set(&mut doc, &mut h, t, r#"{"fontSize":20,"textRange":[6,9]}"#);
    let c = content(&doc, t);
    assert_eq!(&c.style_ids[..], &[0, 0, 0, 0, 1, 1, 2, 3, 3]);
    let run = |id: u32| c.styles.iter().find(|r| r.id == id).unwrap().clone();
    assert_eq!(run(2).font_size, Some(20.0));
    assert_eq!(run(2).font_style.as_deref(), Some("Bold"));
    assert_eq!(run(3).font_size, Some(20.0));
    assert_eq!(run(3).font_style, None);
    let layout = doc.props(t).text_layout.clone().unwrap();
    assert_eq!(layout.glyphs[6].font_size, 20.0);
    assert_eq!(layout.glyphs[5].font_size, 10.0);
    // Setting a range back to the layer's style drops its runs.
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"fontStyle":"Regular","fontSize":10,"textRange":[0,13]}"#,
    );
    let c = content(&doc, t);
    assert!(c.style_ids.is_empty() && c.styles.is_empty(), "{c:?}");
    assert_eq!(width(&doc, t), plain);
    // Undo restores the runs.
    h.undo(&mut doc).unwrap();
    assert_eq!(content(&doc, t).styles.len(), 3);
}

#[test]
fn colors_decorates_and_spaces_a_range() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"red and blue","fontSize":10}"#,
    );
    let plain = width(&doc, t);
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"fills":[{"color":"FF0000"}],"textDecoration":"UNDERLINE","letterSpacing":{"value":10,"unit":"PIXELS"},"textRange":[0,3]}"#,
    );
    let p = doc.props(t);
    let c = p.text_content.clone().unwrap();
    let run = &c.styles[0];
    let red = &run.fills.as_deref().unwrap()[0];
    assert!(matches!(red.kind, crate::model::PaintKind::Solid(c) if c.r == 1.0 && c.b == 0.0));
    assert_eq!(run.decoration.as_deref(), Some("UNDERLINE"));
    assert_eq!(run.letter_spacing, Some((10.0, Arc::from("PIXELS"))));
    // The layer keeps its paint; the underline covers only the range.
    assert!(matches!(p.fills()[0].kind, crate::model::PaintKind::Solid(c) if c.r == 0.0));
    let layout = p.text_layout.clone().unwrap();
    assert_eq!(layout.decorations.len(), 1);
    assert_eq!(layout.decorations[0].style_id, run.id);
    assert!(layout.decorations[0].rects[0][2] < 50.0);
    assert!(width(&doc, t) > plain + 25.0, "three letters spaced 10 px");
    assert_eq!(fills_at(p, 1)[0], *red);
    // A whole-layer change replaces the range's value.
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"letterSpacing":{"value":0,"unit":"PIXELS"}}"#,
    );
    let c = content(&doc, t);
    assert_eq!(c.styles[0].letter_spacing, None);
    assert!(c.styles[0].fills.is_some(), "other overrides stay");
}

#[test]
fn saves_and_reopens_character_styles() {
    let original = crate::save::blank("Text");
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let page = doc
        .nodes
        .iter()
        .find(|n| n.props.node_type() == crate::model::NodeType::Canvas)
        .and_then(|n| n.props.guid)
        .unwrap();
    let ops: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"create","parent":"{page}","node":{{"type":"TEXT","x":0,"y":0,"width":1,"height":1,"props":{{"characters":"plain bold\nnext","fontSize":12}}}}}}]"#
    ))
    .unwrap();
    let id = h.apply(&mut doc, &ops, None).unwrap().created[0].clone();
    let t = doc.find(Guid::parse(&id).unwrap()).unwrap();
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"fontStyle":"Bold","fontSize":18,"textCase":"UPPER","lineHeight":{"value":30,"unit":"PIXELS"},"fills":[{"color":"0000FF"}],"textRange":[6,10]}"#,
    );
    let before = doc.props(t).clone();
    let saved = crate::save::save(&doc, &original).unwrap();
    let reopened = Document::open(&saved).unwrap();
    let after = reopened.props(reopened.find(Guid::parse(&id).unwrap()).unwrap());
    assert_eq!(after.text_content, before.text_content);
    let (a, b) = (
        after.text_layout.as_ref().unwrap(),
        before.text_layout.as_ref().unwrap(),
    );
    assert_eq!(a.glyphs, b.glyphs);
    assert_eq!(a.baselines, b.baselines);
    assert_eq!(a.baselines.len(), 2);
}

#[test]
fn gives_the_editor_caret_stops() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"ab\ncd ef","fontSize":10}"#,
    );
    let g = geometry(doc.props(t)).unwrap();
    assert_eq!(g.length, 8);
    assert_eq!(g.lines.len(), 2);
    let (a, b) = (&g.lines[0], &g.lines[1]);
    assert_eq!((a.start, a.end, b.start, b.end), (0, 3, 3, 8));
    assert_eq!(a.xs.len(), 4);
    assert_eq!(a.xs[0], 0.0);
    assert!(a.xs[1] > 0.0 && a.xs[2] > a.xs[1]);
    // The line break takes no room.
    assert_eq!(a.xs[3], a.xs[2]);
    assert!(b.xs.windows(2).all(|w| w[1] >= w[0]));
    assert!(b.top >= a.top + a.height - 0.01);
    assert!(a.baseline > a.top && a.baseline < a.top + a.height);
    // Without line records the lines come from the glyphs.
    let mut props = doc.props(t).clone();
    let mut layout = props.text_layout.as_deref().cloned().unwrap();
    layout.baselines = Arc::from([]);
    props.text_layout = Some(Arc::new(layout));
    let guessed = geometry(&props).unwrap();
    assert_eq!(guessed.lines.len(), 2);
    assert_eq!((guessed.lines[1].start, guessed.lines[1].end), (3, 8));
    assert_eq!(guessed.lines[1].xs, b.xs);
}

#[test]
fn restyling_a_whole_run_keeps_its_id() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let t = new_text(
        &mut doc,
        &mut h,
        r#"{"characters":"plain bold","fontSize":10}"#,
    );
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"fontStyle":"Bold","textRange":[6,10]}"#,
    );
    set(
        &mut doc,
        &mut h,
        t,
        r#"{"textDecoration":"UNDERLINE","textRange":[6,10]}"#,
    );
    let c = content(&doc, t);
    assert_eq!(&c.style_ids[..], &[0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
    assert_eq!(c.styles.len(), 1);
    assert_eq!(c.styles[0].decoration.as_deref(), Some("UNDERLINE"));
}
