use super::*;
use crate::model::PaintKind;
use crate::testing::{showcase_file, simple_file};

fn idx(doc: &Document, id: &str) -> NodeIdx {
    doc.find(Guid::parse(id).unwrap()).unwrap()
}

fn frame(doc: &Document, i: NodeIdx) -> Rect {
    let s = doc.props(i).size();
    doc.world(i).map_rect(&Rect::new(0.0, 0.0, s.x, s.y))
}

fn spec(json: &str) -> PasteSpec {
    serde_json::from_str(json).unwrap()
}

#[test]
fn pastes_layers_from_another_file() {
    let source_bytes = simple_file();
    let source = Document::open(&source_bytes).unwrap();
    let copied = crate::save::copy(&source, &source_bytes, &[idx(&source, "1:3")]).unwrap();
    // Into a blank design, at the same place (it is in view).
    let target_bytes = crate::save::blank("Target");
    let mut target = Document::open(&target_bytes).unwrap();
    let mut h = History::default();
    let applied = h
        .paste(
            &mut target,
            &target_bytes,
            &copied.document,
            None,
            &spec(r#"{"parent":"0:1","view":{"x":0,"y":0,"w":500,"h":500}}"#),
        )
        .unwrap();
    assert_eq!(applied.created.len(), 1);
    let pasted = idx(&target, &applied.created[0]);
    let p = target.props(pasted);
    assert_eq!(p.name(), "Red");
    assert_eq!(p.node_type(), NodeType::Rectangle);
    assert!(matches!(p.fills()[0].kind, PaintKind::Solid(c) if c.r == 1.0));
    assert_ne!(p.guid, Guid::parse("1:3"));
    let r = frame(&target, pasted);
    assert_eq!((r.x, r.y, r.w, r.h), (10.0, 20.0, 100.0, 50.0));
    // Saved and reopened, the record carried over.
    let saved = crate::save::save(&target, &target_bytes).unwrap();
    let reopened = Document::open(&saved).unwrap();
    let again = reopened.props(idx(&reopened, &applied.created[0]));
    assert_eq!(again.name(), "Red");
    assert_eq!(again.size(), Vec2::new(100.0, 50.0));
    // Undo removes it.
    h.undo(&mut target).unwrap();
    assert!(target.node(pasted).removed);
}

#[test]
fn places_pasted_layers_like_figma() {
    let source_bytes = simple_file();
    let source = Document::open(&source_bytes).unwrap();
    let copied = crate::save::copy(&source, &source_bytes, &[idx(&source, "1:3")]).unwrap();
    let mut target = Document::open(&source_bytes).unwrap();
    let mut h = History::default();
    // Out of view: centered in it.
    let created = h
        .paste(
            &mut target,
            &source_bytes,
            &copied.document,
            None,
            &spec(r#"{"parent":"1:1","view":{"x":1000,"y":1000,"w":400,"h":200}}"#),
        )
        .unwrap()
        .created;
    let r = frame(&target, idx(&target, &created[0]));
    assert_eq!((r.x, r.y), (1150.0, 1075.0));
    // Into a frame it fits in: the same place, inside it.
    let created = h
        .paste(
            &mut target,
            &source_bytes,
            &copied.document,
            None,
            &spec(r#"{"parent":"1:2"}"#),
        )
        .unwrap()
        .created;
    let i = idx(&target, &created[0]);
    assert_eq!(target.node(i).parent, Some(idx(&target, "1:2")));
    let r = frame(&target, i);
    assert_eq!((r.x, r.y), (10.0, 20.0));
}

#[test]
fn pastes_here_and_to_replace() {
    let bytes = simple_file();
    let source = Document::open(&bytes).unwrap();
    let copied = crate::save::copy(&source, &bytes, &[idx(&source, "1:3")]).unwrap();
    let mut target = Document::open(&bytes).unwrap();
    let mut h = History::default();
    // "Paste here": its top left at the point.
    let created = h
        .paste(
            &mut target,
            &bytes,
            &copied.document,
            None,
            &spec(r#"{"parent":"1:1","at":{"x":300,"y":400}}"#),
        )
        .unwrap()
        .created;
    let r = frame(&target, idx(&target, &created[0]));
    assert_eq!((r.x, r.y), (300.0, 400.0));
    // "Paste to replace": in the replaced layer's place, centered on it,
    // and the replaced layer gone, all in one step.
    let replaced = idx(&target, "1:3");
    let parent = target.node(replaced).parent.unwrap();
    let place = target
        .node(parent)
        .children
        .iter()
        .position(|&c| c == replaced);
    let created = h
        .paste(
            &mut target,
            &bytes,
            &copied.document,
            None,
            &spec(r#"{"parent":"1:1","replace":["1:3"]}"#),
        )
        .unwrap()
        .created;
    let i = idx(&target, &created[0]);
    assert_eq!(target.node(i).parent, Some(parent));
    assert_eq!(
        target.node(parent).children.iter().position(|&c| c == i),
        place
    );
    assert_eq!(frame(&target, i), Rect::new(10.0, 20.0, 100.0, 50.0));
    assert!(target.node(replaced).removed);
    h.undo(&mut target).unwrap();
    assert!(!target.node(replaced).removed && target.node(i).removed);
}

#[test]
fn keeps_instances_of_components_the_file_has() {
    let bytes = showcase_file();
    let source = Document::open(&bytes).unwrap();
    let instance = idx(&source, "1:14");
    let copied = crate::save::copy(&source, &bytes, &[instance]).unwrap();
    // Into the same file: still an instance of the same component.
    let mut same = Document::open(&bytes).unwrap();
    let created = History::default()
        .paste(
            &mut same,
            &bytes,
            &copied.document,
            None,
            &spec(r#"{"parent":"1:1"}"#),
        )
        .unwrap()
        .created;
    let p = same.props(idx(&same, &created[0]));
    assert_eq!(p.node_type(), NodeType::Instance);
    assert_eq!(
        p.symbol.as_ref().and_then(|s| s.symbol_id),
        Guid::parse("1:30")
    );
    // The main component itself pastes as an instance of it, as in Figma;
    // in another file it stays a component.
    let main = crate::save::copy(&source, &bytes, &[idx(&source, "1:30")]).unwrap();
    let created = History::default()
        .paste(
            &mut same,
            &bytes,
            &main.document,
            None,
            &spec(r#"{"parent":"1:1"}"#),
        )
        .unwrap()
        .created;
    let p = same.props(idx(&same, &created[0]));
    assert_eq!(p.node_type(), NodeType::Instance);
    assert_eq!(
        p.symbol.as_ref().and_then(|s| s.symbol_id),
        Guid::parse("1:30")
    );
    let blank = crate::save::blank("Other");
    let mut elsewhere = Document::open(&blank).unwrap();
    let created = History::default()
        .paste(
            &mut elsewhere,
            &blank,
            &main.document,
            None,
            &spec(r#"{"parent":"0:1"}"#),
        )
        .unwrap()
        .created;
    let p = elsewhere.props(idx(&elsewhere, &created[0]));
    assert_eq!(p.node_type(), NodeType::Symbol);
    // Into another file: detached, with the component's layers (and the
    // instance's override) as ordinary layers.
    let target_bytes = crate::save::blank("Other");
    let mut other = Document::open(&target_bytes).unwrap();
    let created = History::default()
        .paste(
            &mut other,
            &target_bytes,
            &copied.document,
            None,
            &spec(r#"{"parent":"0:1"}"#),
        )
        .unwrap()
        .created;
    let i = idx(&other, &created[0]);
    assert_eq!(other.props(i).node_type(), NodeType::Frame);
    let children = &other.node(i).children;
    assert!(!children.is_empty());
    let overridden = children.iter().any(|&c| {
        matches!(other.props(c).fills().first().map(|f| &f.kind),
            Some(PaintKind::Solid(col)) if (col.r - 0.95).abs() < 0.01)
    });
    assert!(overridden, "the override survives detaching");
    // It saves and reopens.
    let saved = crate::save::save(&other, &target_bytes).unwrap();
    assert!(Document::open(&saved).is_ok());
}

#[test]
fn carries_geometry_and_images_over() {
    let bytes = showcase_file();
    let mut source = Document::open(&bytes).unwrap();
    let mut pixmap = tiny_skia::Pixmap::new(1, 1).unwrap();
    pixmap.fill(tiny_skia::Color::from_rgba8(10, 20, 30, 255));
    let hash = "0123456789abcdef0123456789abcdef01234567";
    source
        .add_image(hash, crate::images::encode_png(&pixmap))
        .unwrap();
    History::default()
        .apply(
            &mut source,
            &serde_json::from_str::<Vec<Op>>(&format!(
                r#"[{{"op":"set","ids":["1:13"],"props":{{"fills":[{{"image":"{hash}"}}]}}}}]"#
            ))
            .unwrap(),
            None,
        )
        .unwrap();
    // The avatar ellipse has a stored outline.
    let copied = crate::save::copy(
        &source,
        &bytes,
        &[idx(&source, "1:12"), idx(&source, "1:13")],
    )
    .unwrap();
    assert!(!copied.images.is_empty());
    let target_bytes = crate::save::blank("Other");
    let mut target = Document::open(&target_bytes).unwrap();
    let created = History::default()
        .paste(
            &mut target,
            &target_bytes,
            &copied.document,
            Some(&copied.images),
            &spec(r#"{"parent":"0:1"}"#),
        )
        .unwrap()
        .created;
    assert_eq!(created.len(), 2);
    let avatar = target.props(idx(&target, &created[0]));
    assert_eq!(avatar.name(), "Avatar");
    let geometry = avatar.fill_geometry()[0];
    let path = target.blobs.path(geometry.blob).unwrap();
    assert!((path.bounds().w - 96.0).abs() < 0.01);
    assert!(target.images.contains_key(hash));
    let saved = crate::save::save(&target, &target_bytes).unwrap();
    let reopened = Document::open(&saved).unwrap();
    let card = reopened.props(idx(&reopened, &created[1]));
    assert!(
        matches!(&card.fills()[0].kind, PaintKind::Image(i) if i.hash.as_deref() == Some(hash))
    );
    assert!(reopened.images.contains_key(hash));
}

#[test]
fn translates_records_between_schemas() {
    let src = Schema::decode(&crate::kiwi::schema_from_text(crate::testing::SCHEMA)).unwrap();
    let dst = Schema::decode(&crate::kiwi::schema_from_text(crate::save::MACRO_SCHEMA)).unwrap();
    let node = src.def_index("NodeChange").unwrap();
    let mut m = Msg::new(node);
    m.set(&src, "name", Value::Str("Box".into()));
    m.set(&src, "unusedField", Value::Str("gone".into()));
    m.set(&src, "type", src.enum_value("NodeType", "ELLIPSE").unwrap());
    let out = translate(&src, &dst, &m, dst.def_index("NodeChange").unwrap());
    assert!(matches!(out.get(&dst, "name"), Some(Value::Str(s)) if &**s == "Box"));
    let Some(Value::Enum(d, v)) = out.get(&dst, "type") else {
        panic!("type carried over");
    };
    assert_eq!(dst.enum_name(*d, *v), Some("ELLIPSE"));
    assert_eq!(out.fields.len(), 2, "fields the schema lacks are dropped");
}
