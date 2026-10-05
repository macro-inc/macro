//! A small design system made with the editor's own operations and saved:
//! components with boolean, text, and instance swap properties, a
//! component set with two variant properties, instances of them on a
//! screen, and fill, text, and effect styles in use. The browser fixture
//! opens it as `design-system.fig`.

use crate::document::Document;
use crate::edit::{History, Op};
use crate::save::{blank, save};

/// A design built step by step from a blank file.
pub struct Builder {
    pub doc: Document,
    pub history: History,
    pub original: Vec<u8>,
}

impl Builder {
    pub fn new(name: &str) -> Builder {
        let original = blank(name);
        Builder {
            doc: Document::open(&original).expect("a blank file opens"),
            history: History::default(),
            original,
        }
    }

    /// Applies operations (JSON) as one step; returns the created ids.
    pub fn op(&mut self, json: &str) -> Vec<String> {
        let ops: Vec<Op> = serde_json::from_str(json).expect("operations parse");
        self.history
            .apply(&mut self.doc, &ops, None)
            .expect("operations apply")
            .created
    }

    pub fn save(&self) -> Vec<u8> {
        save(&self.doc, &self.original).expect("the design saves")
    }

    fn frame(&mut self, parent: &str, name: &str, rect: [f64; 4], color: &str) -> String {
        self.shape(parent, "FRAME", name, rect, color)
    }

    fn shape(
        &mut self,
        parent: &str,
        kind: &str,
        name: &str,
        rect: [f64; 4],
        color: &str,
    ) -> String {
        let [x, y, w, h] = rect;
        self.op(&format!(
            r#"[{{"op":"create","parent":"{parent}","node":{{"type":"{kind}","name":"{name}","x":{x},"y":{y},"width":{w},"height":{h},"props":{{"fills":[{{"color":"{color}"}}]}}}}}}]"#
        ))[0]
            .clone()
    }

    fn text(
        &mut self,
        parent: &str,
        name: &str,
        x: f64,
        y: f64,
        characters: &str,
        size: f32,
    ) -> String {
        self.op(&format!(
            r#"[{{"op":"create","parent":"{parent}","node":{{"type":"TEXT","name":"{name}","x":{x},"y":{y},"width":1,"height":1,"props":{{"characters":"{characters}","fontSize":{size}}}}}}}]"#
        ))[0]
            .clone()
    }

    fn component(&mut self, id: &str) {
        self.op(&format!(r#"[{{"op":"createComponent","ids":["{id}"]}}]"#));
    }
}

/// The design system file (see the module comment).
pub fn design_system_file() -> Vec<u8> {
    let mut b = Builder::new("Design system");
    b.op(r#"[{"op":"set","ids":["0:1"],"props":{"name":"Screens"}}]"#);
    let components = b.op(
        r#"[{"op":"create","parent":"0:0","node":{"type":"CANVAS","name":"Components","x":0,"y":0,"width":0,"height":0}}]"#,
    )[0]
        .clone();

    // Icons, for the card's instance swap property.
    let star = b.frame(&components, "Icon/Star", [0.0, 0.0, 24.0, 24.0], "FFFFFF");
    b.shape(&star, "ELLIPSE", "Shape", [2.0, 2.0, 20.0, 20.0], "F5A623");
    b.component(&star);
    let heart = b.frame(&components, "Icon/Heart", [40.0, 0.0, 24.0, 24.0], "FFFFFF");
    b.shape(
        &heart,
        "RECTANGLE",
        "Shape",
        [42.0, 2.0, 20.0, 20.0],
        "E0245E",
    );
    b.component(&heart);

    // A card with a title, and an icon that can be hidden and swapped.
    let card = b.frame(&components, "Card", [0.0, 60.0, 240.0, 120.0], "FFFFFF");
    b.shape(
        &card,
        "RECTANGLE",
        "Background",
        [0.0, 60.0, 240.0, 120.0],
        "F1F4F9",
    );
    let title = b.text(&card, "Title", 16.0, 76.0, "Card title", 16.0);
    let icon = b.op(&format!(
        r#"[{{"op":"instantiate","component":"{star}","parent":"{card}","x":200,"y":76}}]"#
    ))[0]
        .clone();
    b.op(&format!(
        r#"[{{"op":"set","ids":["{icon}"],"props":{{"name":"Icon"}}}}]"#
    ));
    b.component(&card);
    b.op(&format!(
        r#"[{{"op":"addComponentProperty","component":"{card}","name":"Show icon","kind":"BOOL","layer":"{icon}"}},
            {{"op":"addComponentProperty","component":"{card}","name":"Icon","kind":"INSTANCE_SWAP","layer":"{icon}"}},
            {{"op":"addComponentProperty","component":"{card}","name":"Title","kind":"TEXT","layer":"{title}"}}]"#
    ));

    // Buttons: two components combined as variants of a set.
    let primary = b.frame(
        &components,
        "Button/Primary",
        [0.0, 220.0, 120.0, 40.0],
        "0D99FF",
    );
    let primary_label = b.text(&primary, "Label", 16.0, 230.0, "Button", 14.0);
    b.component(&primary);
    let secondary = b.frame(
        &components,
        "Button/Secondary",
        [140.0, 220.0, 120.0, 40.0],
        "E6E6E6",
    );
    let secondary_label = b.text(&secondary, "Label", 156.0, 230.0, "Button", 14.0);
    b.component(&secondary);
    let set = b.op(&format!(
        r#"[{{"op":"combineAsVariants","ids":["{primary}","{secondary}"]}}]"#
    ))[0]
        .clone();
    b.op(&format!(
        r#"[{{"op":"renameVariantProperty","set":"{set}","from":"Property 1","to":"Type"}},
            {{"op":"addVariantProperty","set":"{set}","name":"Size","value":"Medium"}},
            {{"op":"addComponentProperty","component":"{set}","name":"Label","kind":"TEXT","layer":"{primary_label}"}}]"#
    ));
    let label_def = b
        .doc
        .props(
            b.doc
                .find(crate::model::Guid::parse(&set).unwrap())
                .unwrap(),
        )
        .prop_defs
        .as_deref()
        .unwrap_or_default()
        .iter()
        .find(|d| d.kind == "TEXT")
        .map(|d| d.id.to_string())
        .expect("the label property");
    b.op(&format!(
        r#"[{{"op":"bindProperty","ids":["{secondary_label}"],"field":"TEXT","property":"{label_def}"}}]"#
    ));

    // A screen using them, and styles in use.
    let screen = b.frame("0:1", "Screen", [0.0, 0.0, 400.0, 300.0], "FFFFFF");
    b.op(&format!(
        r#"[{{"op":"instantiate","component":"{card}","parent":"{screen}","x":20,"y":20}},
            {{"op":"instantiate","component":"{primary}","parent":"{screen}","x":20,"y":200}}]"#
    ));
    let swatch = b.shape(
        &screen,
        "RECTANGLE",
        "Swatch",
        [300.0, 200.0, 60.0, 60.0],
        "7B61FF",
    );
    b.op(&format!(
        r#"[{{"op":"createStyle","kind":"FILL","name":"Brand/Primary","from":"{swatch}"}}]"#
    ));
    let heading = b.text(&screen, "Heading", 280.0, 20.0, "Welcome", 24.0);
    b.op(&format!(
        r#"[{{"op":"createStyle","kind":"TEXT","name":"Heading","from":"{heading}"}}]"#
    ));
    let raised = b.shape(
        &screen,
        "RECTANGLE",
        "Raised",
        [280.0, 80.0, 100.0, 60.0],
        "FFFFFF",
    );
    b.op(&format!(
        r#"[{{"op":"set","ids":["{raised}"],"props":{{"effects":[{{"type":"DROP_SHADOW","y":4,"radius":8,"color":"00000040"}}]}}}},
            {{"op":"createStyle","kind":"EFFECT","name":"Elevation/1","from":"{raised}"}}]"#
    ));
    b.save()
}

/// The committed fixture must match [`design_system_file`]; run
/// `cargo test -p fig_engine --lib write_design_system_fixture -- --ignored`
/// after changing it (or the operations that build it).
#[test]
fn design_system_fixture_is_current() {
    let committed = include_bytes!("../../tests/fixtures/design-system.fig");
    assert!(
        committed.as_slice() == design_system_file().as_slice(),
        "tests/fixtures/design-system.fig is stale; regenerate it (see the doc comment)"
    );
}

#[test]
#[ignore = "writes tests/fixtures/design-system.fig"]
fn write_design_system_fixture() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/design-system.fig");
    std::fs::write(path, design_system_file()).unwrap();
}
