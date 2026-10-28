use super::*;
use crate::edit::{History, Op};
use crate::model::PaintKind;
use crate::scene::Scene;
use crate::testing::{V, fig_file, node, simple_file, size, solid, translate};

fn apply(doc: &mut Document, json: &str) -> Vec<String> {
    let ops: Vec<Op> = serde_json::from_str(json).unwrap();
    History::default().apply(doc, &ops, None).unwrap().created
}

fn find<'a>(doc: &'a Document, id: &str) -> &'a crate::model::Props {
    doc.props(doc.find(Guid::parse(id).unwrap()).unwrap())
}

#[test]
fn saves_edits_and_reopens() {
    let original = simple_file();
    let mut doc = Document::open(&original).unwrap();
    let created = apply(
        &mut doc,
        r#"[{"op":"set","ids":["1:3"],"props":{"name":"Moved","x":40,"y":50,"fills":[{"color":"00FF00"}]}},
            {"op":"create","parent":"1:2","node":{"type":"ELLIPSE","name":"Dot","x":150,"y":150,"width":20,"height":20}}]"#,
    );
    let saved = save(&doc, &original).unwrap();
    let reopened = Document::open(&saved).unwrap();
    let rect = find(&reopened, "1:3");
    assert_eq!(rect.name(), "Moved");
    assert_eq!(rect.transform().m02, 40.0);
    assert_eq!(rect.transform().m12, 50.0);
    assert!(matches!(rect.fills()[0].kind, PaintKind::Solid(c) if c.g == 1.0 && c.r == 0.0));
    let dot = find(&reopened, &created[0]);
    assert_eq!(dot.name(), "Dot");
    assert_eq!(dot.node_type(), NodeType::Ellipse);
    let frame = reopened.find(Guid::parse("1:2").unwrap()).unwrap();
    assert_eq!(reopened.node(frame).children.len(), 2);
    // The saved file has a thumbnail and draws the same.
    assert!(
        reopened
            .thumbnail
            .as_deref()
            .is_some_and(|t| t.starts_with(b"\x89PNG"))
    );
    let scene = Scene::build(&reopened, reopened.pages[0]);
    assert_eq!(scene.nodes.len(), 4);
}

#[test]
fn saves_arc_metadata_for_new_ellipses() {
    let original = blank("Arc");
    let mut doc = Document::open(&original).unwrap();
    let created = apply(
        &mut doc,
        r#"[{"op":"create","parent":"0:1","node":{"type":"ELLIPSE","name":"Arc","x":0,"y":0,"width":40,"height":40}}]"#,
    );
    let id = doc.find(Guid::parse(&created[0]).unwrap()).unwrap();
    let arc = [0.25, 4.5, 1.0];
    doc.nodes[id as usize].props.arc_data = Some(arc);
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    let props = find(&reopened, &created[0]);
    assert_eq!(props.arc_data, Some(arc));
    assert!(!props.supports_shadow_spread());
}

#[test]
fn drops_deleted_nodes() {
    let original = simple_file();
    let mut doc = Document::open(&original).unwrap();
    apply(&mut doc, r#"[{"op":"delete","ids":["1:3"]}]"#);
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    assert!(reopened.find(Guid::parse("1:3").unwrap()).is_none());
    assert!(reopened.find(Guid::parse("1:2").unwrap()).is_some());
}

#[test]
fn keeps_fields_it_does_not_model() {
    let original = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Page", vec![]),
            node(
                2,
                Some((1, "!")),
                "RECTANGLE",
                "R",
                vec![
                    ("size", size(10.0, 10.0)),
                    ("transform", translate(0.0, 0.0)),
                    ("fillPaints", V::List(vec![solid(1.0, 0.0, 0.0)])),
                    ("unusedField", V::Str("keep me".into())),
                ],
            ),
        ],
        vec![],
    );
    let mut doc = Document::open(&original).unwrap();
    let copies = apply(
        &mut doc,
        r#"[{"op":"translate","ids":["1:2"],"dx":5,"dy":5},{"op":"duplicate","ids":["1:2"],"dx":20}]"#,
    );
    let saved = save(&doc, &original).unwrap();
    let container = Container::open(&saved).unwrap();
    let schema = Schema::decode(&container.schema).unwrap();
    let message = Decoder::new(&schema)
        .decode(
            &mut Reader::new(&container.message),
            schema.def_index("Message").unwrap(),
        )
        .unwrap();
    let Some(Value::List(changes)) = message.get(&schema, "nodeChanges") else {
        panic!("node changes");
    };
    let kept: Vec<_> = changes
        .iter()
        .filter_map(|v| match v {
            Value::Msg(m) => m.get(&schema, "unusedField"),
            _ => None,
        })
        .collect();
    assert_eq!(kept.len(), 2, "the edited node and its copy keep the field");
    let reopened = Document::open(&saved).unwrap();
    assert_eq!(find(&reopened, &copies[0]).transform().m02, 25.0);
}

#[test]
fn makes_blank_designs() {
    let bytes = blank("Untitled design");
    let mut doc = Document::open(&bytes).unwrap();
    assert_eq!(doc.file_name.as_deref(), Some("Untitled design"));
    assert_eq!(doc.pages.len(), 1);
    assert_eq!(doc.props(doc.pages[0]).name(), "Page 1");
    let created = apply(
        &mut doc,
        r#"[{"op":"create","parent":"0:1","node":{"type":"FRAME","name":"Desktop","x":0,"y":0,"width":1440,"height":1024}},
            {"op":"create","parent":"0:1","node":{"type":"TEXT","x":100,"y":100,"width":1,"height":1,"props":{"characters":"Hi Macro","fontSize":32}}}]"#,
    );
    let reopened = Document::open(&save(&doc, &bytes).unwrap()).unwrap();
    let frame = find(&reopened, &created[0]);
    assert_eq!(frame.node_type(), NodeType::Frame);
    assert_eq!(frame.size(), Vec2::new(1440.0, 1024.0));
    let text = find(&reopened, &created[1]);
    assert_eq!(
        text.text_content.as_ref().map(|c| c.characters.as_ref()),
        Some("Hi Macro")
    );
    let layout = text.text_layout.as_ref().unwrap();
    assert_eq!(layout.glyphs.len(), 8);
    let glyph_blob = layout.glyphs[0].blob.unwrap();
    assert!(
        reopened.blobs.path(glyph_blob).is_some(),
        "glyph outlines saved"
    );
    assert_eq!(
        text.text_style.as_ref().unwrap().font_family.as_deref(),
        Some("Inter")
    );
}

#[test]
fn saves_unedited_files_unchanged_in_content() {
    let original = crate::testing::showcase_file();
    let doc = Document::open(&original).unwrap();
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    assert_eq!(reopened.nodes.len(), doc.nodes.len());
    for (a, b) in doc.nodes.iter().zip(&reopened.nodes) {
        assert_eq!(a.props.guid, b.props.guid);
        assert_eq!(a.props.name, b.props.name);
        assert_eq!(a.props.transform, b.props.transform);
        assert_eq!(a.props.fills, b.props.fills);
    }
}

#[test]
fn saves_added_images() {
    let original = simple_file();
    let mut doc = Document::open(&original).unwrap();
    let mut pixmap = tiny_skia::Pixmap::new(4, 2).unwrap();
    pixmap.fill(tiny_skia::Color::from_rgba8(255, 0, 0, 255));
    let png = crate::images::encode_png(&pixmap);
    let hash = "00112233445566778899aabbccddeeff00112233";
    assert_eq!(doc.add_image(hash, png), Some((4, 2)));
    apply(
        &mut doc,
        &format!(r#"[{{"op":"set","ids":["1:3"],"props":{{"fills":[{{"image":"{hash}"}}]}}}}]"#),
    );
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    assert!(reopened.images.contains_key(hash));
    let fill = &find(&reopened, "1:3").fills()[0];
    assert!(matches!(&fill.kind, PaintKind::Image(i) if i.hash.as_deref() == Some(hash)));
    let scene = Scene::build(&reopened, reopened.pages[0]);
    let pixels = render::render(
        &reopened,
        &scene,
        &mut ImageStore::default(),
        &Viewport {
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            width: 200,
            height: 200,
        },
        RenderOptions::default(),
    )
    .unwrap();
    let c = pixels.pixel(50, 40).unwrap();
    assert_eq!(
        (c.red(), c.green(), c.blue()),
        (255, 0, 0),
        "the image fills the rectangle"
    );
}

#[test]
fn saves_text_styles() {
    let bytes = blank("Type");
    let mut doc = Document::open(&bytes).unwrap();
    let created = apply(
        &mut doc,
        r#"[{"op":"create","parent":"0:1","node":{"type":"TEXT","x":0,"y":0,"width":1,"height":1,"props":{"characters":"Styled","fontSize":20,"fontStyle":"Semi Bold","lineHeight":{"value":150,"unit":"PERCENT"},"letterSpacing":{"value":2,"unit":"PERCENT"},"textDecoration":"UNDERLINE","textCase":"UPPER","textAlignHorizontal":"CENTER"}}}]"#,
    );
    let before = find(&doc, &created[0]).clone();
    let reopened = Document::open(&save(&doc, &bytes).unwrap()).unwrap();
    let text = find(&reopened, &created[0]);
    let style = text.text_style.as_deref().unwrap();
    assert_eq!(style.font_style.as_deref(), Some("Semi Bold"));
    assert_eq!(style.line_height, Some((1.5, "RAW".into())));
    assert_eq!(style.letter_spacing, Some((2.0, "PERCENT".into())));
    assert_eq!(style.decoration.as_deref(), Some("UNDERLINE"));
    assert_eq!(style.case.as_deref(), Some("UPPER"));
    assert_eq!(style.align_horizontal.as_deref(), Some("CENTER"));
    let layout = text.text_layout.as_deref().unwrap();
    assert_eq!(
        layout.decorations,
        before.text_layout.as_deref().unwrap().decorations
    );
    assert_eq!(layout.glyphs.len(), 6);
}

#[test]
fn draws_and_saves_arrows() {
    let bytes = blank("Lines");
    let mut doc = Document::open(&bytes).unwrap();
    let created = apply(
        &mut doc,
        r#"[{"op":"create","parent":"0:1","node":{"type":"LINE","name":"Arrow","x":0,"y":50,"width":100,"height":0,"props":{"rotation":-90,"strokeCap":"ARROW_LINES","strokeWeight":2}}}]"#,
    );
    let line = find(&doc, &created[0]).clone();
    assert_eq!(line.size().y, 0.0);
    assert_eq!(line.stroke_cap.as_deref(), Some("ARROW_LINES"));
    // A quarter turn clockwise about its middle: it runs down from (50, 0).
    let t = line.transform();
    assert!((t.m02 - 50.0).abs() < 1e-6 && t.m12.abs() < 1e-6, "{t:?}");
    let scene = Scene::build(&doc, doc.pages[0]);
    let b = scene.node(scene.root()).bounds;
    assert!(b.w >= 8.0 && b.h >= 100.0, "the arrowhead is inside: {b:?}");
    let reopened = Document::open(&save(&doc, &bytes).unwrap()).unwrap();
    let r = find(&reopened, &created[0]);
    assert_eq!(r.stroke_cap.as_deref(), Some("ARROW_LINES"));
    assert_eq!(r.node_type(), NodeType::Line);
}
