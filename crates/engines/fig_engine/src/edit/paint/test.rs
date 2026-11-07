use crate::document::Document;
use crate::edit::{History, Op, parse_hex};
use crate::model::{Color, GradientKind, Guid, Paint, PaintKind, Props};
use crate::save::{blank, save};
use crate::testing::simple_file;

fn apply(doc: &mut Document, json: &str) -> Vec<String> {
    let ops: Vec<Op> = serde_json::from_str(json).unwrap();
    History::default().apply(doc, &ops, None).unwrap().created
}

fn props<'a>(doc: &'a Document, id: &str) -> &'a Props {
    doc.props(doc.find(Guid::parse(id).unwrap()).unwrap())
}

fn fills(doc: &Document, id: &str) -> Vec<Paint> {
    props(doc, id).fills().to_vec()
}

#[test]
fn switches_a_solid_to_a_gradient_fading_out() {
    let mut doc = Document::open(&simple_file()).unwrap();
    apply(
        &mut doc,
        r#"[{"op":"set","ids":["1:3"],"props":{"fills":[{"keep":0,"type":"GRADIENT_LINEAR"}]}}]"#,
    );
    let PaintKind::Gradient { kind, stops, .. } = &fills(&doc, "1:3")[0].kind else {
        panic!("a gradient");
    };
    assert_eq!(*kind, GradientKind::Linear);
    assert_eq!(stops.len(), 2);
    assert_eq!(stops[0].color, parse_hex("FF0000").unwrap());
    assert_eq!(stops[1].color.a, 0.0);
    assert_eq!(stops[1].position, 1.0);
}

#[test]
fn keeps_stops_across_gradient_kinds_and_back_to_solid() {
    let mut doc = Document::open(&simple_file()).unwrap();
    apply(
        &mut doc,
        r#"[{"op":"set","ids":["1:3"],"props":{"fills":[{"keep":0,"type":"GRADIENT_LINEAR",
        "stops":[{"color":"00FF00","position":0.8},{"color":"0000FF80","position":0.1},{"color":"zz","position":0.5}]}]}}]"#,
    );
    apply(
        &mut doc,
        r#"[{"op":"set","ids":["1:3"],"props":{"fills":[{"keep":0,"type":"GRADIENT_RADIAL"}]}}]"#,
    );
    let PaintKind::Gradient { kind, stops, .. } = &fills(&doc, "1:3")[0].kind else {
        panic!("a gradient");
    };
    assert_eq!(*kind, GradientKind::Radial);
    // Sorted by position; the unparseable stop is dropped.
    assert_eq!(stops.len(), 2);
    assert_eq!(stops[0].position, 0.1);
    assert!((stops[0].color.a - 0.502).abs() < 0.01);
    assert_eq!(stops[1].color, parse_hex("00FF00").unwrap());
    apply(
        &mut doc,
        r#"[{"op":"set","ids":["1:3"],"props":{"fills":[{"keep":0,"type":"SOLID"}]}}]"#,
    );
    assert_eq!(
        fills(&doc, "1:3")[0].kind,
        PaintKind::Solid(Color {
            r: 0.0,
            g: 0.0,
            b: 1.0,
            a: 1.0
        })
    );
}

#[test]
fn reorders_and_hides_paints() {
    let mut doc = Document::open(&simple_file()).unwrap();
    apply(
        &mut doc,
        r#"[{"op":"set","ids":["1:3"],"props":{"fills":[{"keep":0},{"color":"0000FF"}]}}]"#,
    );
    apply(
        &mut doc,
        r#"[{"op":"set","ids":["1:3"],"props":{"fills":[{"keep":1,"visible":false},{"keep":0}]}}]"#,
    );
    let f = fills(&doc, "1:3");
    assert_eq!(f[0].kind, PaintKind::Solid(parse_hex("0000FF").unwrap()));
    assert!(!f[0].visible);
    assert_eq!(f[1].kind, PaintKind::Solid(parse_hex("FF0000").unwrap()));
}

#[test]
fn saves_gradients_and_dashes() {
    let bytes = blank("Paints");
    let mut doc = Document::open(&bytes).unwrap();
    let created = apply(
        &mut doc,
        r#"[{"op":"create","parent":"0:1","node":{"type":"RECTANGLE","x":0,"y":0,"width":100,"height":50,
        "props":{"fills":[{"type":"GRADIENT_ANGULAR","stops":[{"color":"FF0000","position":0},{"color":"0000FF","position":1}]}],
        "strokes":[{"color":"000000"}],"strokeWeight":2,"dashPattern":[4,2]}}}]"#,
    );
    let id = &created[0];
    assert_eq!(
        props(&doc, id).dash_pattern.as_deref(),
        Some(&[4.0, 2.0][..])
    );
    let saved = save(&doc, &bytes).unwrap();
    let reopened = Document::open(&saved).unwrap();
    let p = props(&reopened, id);
    assert_eq!(p.dash_pattern.as_deref(), Some(&[4.0, 2.0][..]));
    let PaintKind::Gradient { kind, stops, .. } = &p.fills()[0].kind else {
        panic!("a gradient");
    };
    assert_eq!(*kind, GradientKind::Angular);
    assert_eq!(stops[1].color, parse_hex("0000FF").unwrap());

    // An empty pattern makes the stroke solid again.
    let mut doc = reopened;
    apply(
        &mut doc,
        &format!(r#"[{{"op":"set","ids":["{id}"],"props":{{"dashPattern":[]}}}}]"#),
    );
    assert!(props(&doc, id).dash_pattern.is_none());
    let again = Document::open(&save(&doc, &saved).unwrap()).unwrap();
    assert!(props(&again, id).dash_pattern.is_none());
}
