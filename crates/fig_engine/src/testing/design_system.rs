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
/// A file with a "Theme" collection (Light and Dark modes): `Surface`
/// (white, black) and `Brand` (blue, then `Surface`), a frame and a
/// rectangle in it bound to them, and an instance of a component whose
/// layer is bound to `Surface`.
pub fn variables_file() -> Vec<u8> {
    use crate::kiwi::{Schema, schema_from_text};
    use crate::testing::{V, color, encode, guid, node, size, translate};
    let text = crate::save::MACRO_SCHEMA
        .replace("WASHI_TAPE VARIABLE", "WASHI_TAPE VARIABLE VARIABLE_SET")
        .replace(
            "message Paint type:PaintType",
            "enum VariableDataType BOOLEAN FLOAT STRING ALIAS COLOR\nmessage VariableID guid:GUID assetRef:AssetRef\nmessage VariableSetID guid:GUID assetRef:AssetRef\nmessage VariableAnyValue boolValue:bool textValue:string floatValue:float alias:VariableID colorValue:Color\nmessage VariableData value:VariableAnyValue dataType:VariableDataType resolvedDataType:VariableDataType\nmessage VariableDataValuesEntry modeID:GUID variableData:VariableData\nmessage VariableDataValues entries:VariableDataValuesEntry[]\nmessage VariableSetMode id:GUID name:string sortPosition:string\nmessage VariableModeBySetMapEntry variableSetID:VariableSetID variableModeID:GUID\nmessage VariableModeBySetMap entries:VariableModeBySetMapEntry[]\nmessage Paint colorVar:VariableData type:PaintType",
        )
        .replace(
            "styleIdForText:StyleId",
            "styleIdForText:StyleId variableSetID:VariableSetID variableResolvedType:VariableDataType variableDataValues:VariableDataValues variableSetModes:VariableSetMode[] variableModeBySetMap:VariableModeBySetMap",
        );
    let schema_bytes = schema_from_text(&text);
    let schema = Schema::decode(&schema_bytes).unwrap();
    let c = |r: f32, g: f32, b: f32| color(r, g, b, 1.0);
    let bound = |rgb: V, var: u32| {
        V::List(vec![V::Msg(vec![
            ("type", V::Enum("SOLID")),
            ("color", rgb),
            ("opacity", V::Float(1.0)),
            ("visible", V::Bool(true)),
            (
                "colorVar",
                V::Msg(vec![
                    (
                        "value",
                        V::Msg(vec![("alias", V::Msg(vec![("guid", guid(var))]))]),
                    ),
                    ("dataType", V::Enum("ALIAS")),
                    ("resolvedDataType", V::Enum("COLOR")),
                ]),
            ),
        ])])
    };
    let value = |mode: u32, v: V| V::Msg(vec![("modeID", guid(mode)), ("variableData", v)]);
    let color_value = |rgb: V| {
        V::Msg(vec![
            ("value", V::Msg(vec![("colorValue", rgb)])),
            ("dataType", V::Enum("COLOR")),
            ("resolvedDataType", V::Enum("COLOR")),
        ])
    };
    let alias = |var: u32| {
        V::Msg(vec![
            (
                "value",
                V::Msg(vec![("alias", V::Msg(vec![("guid", guid(var))]))]),
            ),
            ("dataType", V::Enum("ALIAS")),
            ("resolvedDataType", V::Enum("COLOR")),
        ])
    };
    let variable = |local: u32, name: &str, values: Vec<V>| {
        node(
            local,
            Some((2, "a")),
            "VARIABLE",
            name,
            vec![
                ("variableSetID", V::Msg(vec![("guid", guid(50))])),
                ("variableResolvedType", V::Enum("COLOR")),
                (
                    "variableDataValues",
                    V::Msg(vec![("entries", V::List(values))]),
                ),
            ],
        )
    };
    let nodes = vec![
        node(0, None, "DOCUMENT", "Document", vec![]),
        node(
            1,
            Some((0, "!")),
            "CANVAS",
            "Page",
            vec![("backgroundColor", c(1.0, 1.0, 1.0))],
        ),
        node(
            2,
            Some((0, "\"")),
            "CANVAS",
            "Internal",
            vec![("internalOnly", V::Bool(true))],
        ),
        node(
            50,
            Some((2, "!")),
            "VARIABLE_SET",
            "Theme",
            vec![(
                "variableSetModes",
                V::List(vec![
                    V::Msg(vec![("id", guid(60)), ("name", V::Str("Light".into()))]),
                    V::Msg(vec![("id", guid(61)), ("name", V::Str("Dark".into()))]),
                ]),
            )],
        ),
        variable(
            51,
            "Surface",
            vec![
                value(60, color_value(c(1.0, 1.0, 1.0))),
                value(61, color_value(c(0.0, 0.0, 0.0))),
            ],
        ),
        variable(
            52,
            "Brand",
            vec![
                value(60, color_value(c(0.0, 0.0, 1.0))),
                value(61, alias(51)),
            ],
        ),
        node(
            20,
            Some((1, "!")),
            "SYMBOL",
            "Chip",
            vec![
                ("size", size(20.0, 20.0)),
                ("transform", translate(300.0, 0.0)),
            ],
        ),
        node(
            21,
            Some((20, "!")),
            "RECTANGLE",
            "Chip fill",
            vec![
                ("size", size(20.0, 20.0)),
                ("transform", translate(0.0, 0.0)),
                ("fillPaints", bound(c(1.0, 1.0, 1.0), 51)),
            ],
        ),
        node(
            10,
            Some((1, "\"")),
            "FRAME",
            "Screen",
            vec![
                ("size", size(200.0, 100.0)),
                ("transform", translate(0.0, 0.0)),
                ("fillPaints", bound(c(1.0, 1.0, 1.0), 51)),
            ],
        ),
        node(
            11,
            Some((10, "!")),
            "RECTANGLE",
            "Logo",
            vec![
                ("size", size(20.0, 20.0)),
                ("transform", translate(10.0, 10.0)),
                ("fillPaints", bound(c(0.0, 0.0, 1.0), 52)),
            ],
        ),
        node(
            30,
            Some((10, "\"")),
            "INSTANCE",
            "Chip",
            vec![
                ("size", size(20.0, 20.0)),
                ("transform", translate(50.0, 10.0)),
                ("symbolData", V::Msg(vec![("symbolID", guid(20))])),
            ],
        ),
    ];
    let message = encode(
        &schema,
        "Message",
        &[("nodeChanges", V::List(nodes)), ("blobs", V::List(vec![]))],
    );
    let mut out = b"fig-kiwi".to_vec();
    out.extend_from_slice(&48u32.to_le_bytes());
    for chunk in [schema_bytes, message] {
        let compressed = miniz_oxide::deflate::compress_to_vec(&chunk, 6);
        out.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        out.extend_from_slice(&compressed);
    }
    out
}

/// The committed `variables.fig` must match [`variables_file`]; run
/// `cargo test -p fig_engine --lib write_variables_fixture -- --ignored`
/// after changing it.
#[test]
fn variables_fixture_is_current() {
    let committed = include_bytes!("../../tests/fixtures/variables.fig");
    assert!(
        committed.as_slice() == variables_file().as_slice(),
        "tests/fixtures/variables.fig is stale; regenerate it (see the doc comment)"
    );
}

#[test]
#[ignore = "writes tests/fixtures/variables.fig"]
fn write_variables_fixture() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/variables.fig");
    std::fs::write(path, variables_file()).unwrap();
}
