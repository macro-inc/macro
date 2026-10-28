use crate::container::Container;
use crate::document::Document;
use crate::edit::{History, Op, flags};
use crate::kiwi::{Decoder, Reader, Schema, Value};
use crate::model::{Axis, ExportConstraint, ExportFormat, GridAlign, GridPattern, Guid, Props};
use crate::save::{blank, save};
use crate::testing::{SCHEMA, V, color, fig_file_with, guid, node, showcase_file, size};

fn ops(json: &str) -> Vec<Op> {
    serde_json::from_str(json).unwrap()
}

fn props<'a>(doc: &'a Document, id: &str) -> &'a Props {
    doc.props(doc.find(Guid::parse(id).unwrap()).unwrap())
}

const EDITS: &str = r#"[
    {"op":"setExports","ids":["1:12"],"settings":[
        {"format":"PNG","value":2,"suffix":"@2x"},
        {"format":"JPG","constraint":"CONTENT_WIDTH","value":300,"quality":70},
        {"format":"SVG","svgOutlineText":false,"svgIncludeId":true},
        {"format":"PDF"}]},
    {"op":"setLayoutGrids","ids":["1:10"],"grids":[
        {"pattern":"STRIPES","axis":"X","align":"STRETCH","count":12,"offset":16,"gutter":8},
        {"pattern":"STRIPES","axis":"Y","align":"MIN","count":0,"sectionSize":24,"gutter":0},
        {"pattern":"GRID","sectionSize":8,"color":"0000FF33"}]},
    {"op":"setGuides","id":"1:1","guides":[{"axis":"X","offset":-40},{"axis":"Y","offset":700}]},
    {"op":"setGuides","id":"1:10","guides":[{"axis":"X","offset":180}]}
]"#;

fn check_edits(doc: &Document) {
    let exports = props(doc, "1:12").export_settings.as_deref().unwrap();
    assert_eq!(exports.len(), 4);
    assert_eq!(exports[0].suffix, "@2x");
    assert_eq!(exports[0].value, 2.0);
    assert_eq!(exports[1].format, ExportFormat::Jpeg);
    assert_eq!(exports[1].constraint, ExportConstraint::ContentWidth);
    assert_eq!(exports[1].quality, 70);
    assert!(!exports[2].svg_outline_text && exports[2].svg_include_id);
    assert_eq!(exports[3].format, ExportFormat::Pdf);
    let grids = props(doc, "1:10").layout_grids.as_deref().unwrap();
    assert_eq!(grids.len(), 3);
    assert_eq!(grids[0].count, 12);
    assert_eq!(grids[0].offset, 16.0);
    assert_eq!(grids[1].axis, Axis::Y);
    assert_eq!(grids[1].align, GridAlign::Min);
    assert_eq!(grids[1].count, i32::MAX, "0 is Auto");
    assert_eq!(grids[2].pattern, GridPattern::Grid);
    assert!((grids[2].color.b - 1.0).abs() < 1e-6 && (grids[2].color.a - 0.2).abs() < 1e-6);
    let page = props(doc, "1:1").guides.as_deref().unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!((page[0].axis, page[0].offset), (Axis::X, -40.0));
    assert_eq!((page[1].axis, page[1].offset), (Axis::Y, 700.0));
    assert!(page.iter().all(|g| g.guid.is_some()));
    let frame = props(doc, "1:10").guides.as_deref().unwrap();
    assert_eq!(frame[0].offset, 180.0);
}

#[test]
fn exports_grids_and_guides_edit_undo_and_save() {
    let original = showcase_file();
    let mut doc = Document::open(&original).unwrap();
    let mut history = History::default();
    history.apply(&mut doc, &ops(EDITS), None).unwrap();
    check_edits(&doc);
    let node = doc.node(doc.find(Guid::parse("1:12").unwrap()).unwrap());
    assert!(node.edits & flags::EXPORTS != 0);

    history.undo(&mut doc);
    assert!(props(&doc, "1:12").export_settings.is_none());
    assert!(props(&doc, "1:10").layout_grids.is_none());
    assert!(props(&doc, "1:1").guides.is_none());
    history.redo(&mut doc);
    check_edits(&doc);

    // The test schema has none of these fields: saving adds them.
    let saved = save(&doc, &original).unwrap();
    let reopened = Document::open(&saved).unwrap();
    check_edits(&reopened);

    // Moving a guide keeps its id; removing grids and presets empties them.
    let first = props(&reopened, "1:1").guides.as_deref().unwrap()[0].guid;
    let mut doc = reopened;
    History::default()
        .apply(
            &mut doc,
            &ops(
                r#"[{"op":"setGuides","id":"1:1","guides":[{"keep":0,"axis":"X","offset":-20}]},
                    {"op":"setLayoutGrids","ids":["1:10"],"grids":[]},
                    {"op":"setExports","ids":["1:12"],"settings":[]}]"#,
            ),
            None,
        )
        .unwrap();
    let again = Document::open(&save(&doc, &saved).unwrap()).unwrap();
    let guides = props(&again, "1:1").guides.as_deref().unwrap();
    assert_eq!(guides.len(), 1);
    assert_eq!(guides[0].offset, -20.0);
    assert_eq!(guides[0].guid, first);
    assert!(
        props(&again, "1:10")
            .layout_grids
            .as_deref()
            .unwrap_or(&[])
            .is_empty()
    );
    assert!(
        props(&again, "1:12")
            .export_settings
            .as_deref()
            .unwrap_or(&[])
            .is_empty()
    );
}

#[test]
fn blank_designs_have_the_fields() {
    let original = blank("New");
    let mut doc = Document::open(&original).unwrap();
    let page = doc.props(doc.pages[0]).guid.unwrap().to_string();
    let frame = History::default()
        .apply(
            &mut doc,
            &ops(&format!(
                r#"[{{"op":"create","parent":"{page}","node":{{"type":"FRAME","x":0,"y":0,"width":200,"height":100}}}}]"#
            )),
            None,
        )
        .unwrap()
        .created[0]
        .clone();
    History::default()
        .apply(
            &mut doc,
            &ops(&format!(
                r#"[{{"op":"setLayoutGrids","ids":["{frame}"],"grids":[{{"pattern":"STRIPES","count":4}}]}},
                    {{"op":"setGuides","id":"{page}","guides":[{{"axis":"Y","offset":12}}]}},
                    {{"op":"setExports","ids":["{frame}"],"settings":[{{"format":"JPEG","quality":55}}]}}]"#
            )),
            None,
        )
        .unwrap();
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    assert_eq!(
        props(&reopened, &frame).layout_grids.as_deref().unwrap()[0].count,
        4
    );
    assert_eq!(
        props(&reopened, &page).guides.as_deref().unwrap()[0].offset,
        12.0
    );
    let export = &props(&reopened, &frame).export_settings.as_deref().unwrap()[0];
    assert_eq!((export.format, export.quality), (ExportFormat::Jpeg, 55));
}

/// The test schema with Figma's export, grid, and guide types (and fields
/// the engine does not model).
fn figma_schema() -> String {
    SCHEMA
        .replace(
            "message NodeChange ",
            "enum ImageType PNG JPEG SVG PDF
enum ExportConstraintType CONTENT_SCALE CONTENT_WIDTH CONTENT_HEIGHT
enum ExportSVGIDMode IF_NEEDED ALWAYS
enum ExportColorProfile DOCUMENT SRGB DISPLAY_P3_V4
enum Axis X Y
enum LayoutGridType MIN CENTER STRETCH MAX
enum LayoutGridPattern STRIPES GRID
struct ExportConstraint type:ExportConstraintType value:float
message ExportSettings suffix:string imageType:ImageType constraint:ExportConstraint svgDataName:bool svgIDMode:ExportSVGIDMode svgOutlineText:bool contentsOnly:bool useAbsoluteBounds:bool colorProfile:ExportColorProfile quality:float
message LayoutGrid type:LayoutGridType axis:Axis visible:bool numSections:int offset:float sectionSize:float gutterSize:float color:Color pattern:LayoutGridPattern
message Guide axis:Axis offset:float guid:GUID
message NodeChange ",
        )
        .replace(
            " unusedField:string",
            " unusedField:string exportSettings:ExportSettings[] layoutGrids:LayoutGrid[] guides:Guide[]",
        )
}

fn figma_file() -> Vec<u8> {
    fig_file_with(
        &figma_schema(),
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(
                1,
                Some((0, "!")),
                "CANVAS",
                "Page",
                vec![(
                    "guides",
                    V::List(vec![V::Msg(vec![
                        ("axis", V::Enum("Y")),
                        ("offset", V::Float(64.0)),
                        ("guid", guid(90)),
                    ])]),
                )],
            ),
            node(
                2,
                Some((1, "!")),
                "FRAME",
                "Desktop",
                vec![
                    ("size", size(1440.0, 900.0)),
                    (
                        "layoutGrids",
                        V::List(vec![V::Msg(vec![
                            ("type", V::Enum("CENTER")),
                            ("axis", V::Enum("X")),
                            ("visible", V::Bool(true)),
                            ("numSections", V::Uint(12)),
                            ("offset", V::Float(0.0)),
                            ("sectionSize", V::Float(72.0)),
                            ("gutterSize", V::Float(24.0)),
                            ("color", color(1.0, 0.0, 0.0, 0.1)),
                            ("pattern", V::Enum("STRIPES")),
                        ])]),
                    ),
                    (
                        "exportSettings",
                        V::List(vec![V::Msg(vec![
                            ("suffix", V::Str("".into())),
                            ("imageType", V::Enum("PDF")),
                            (
                                "constraint",
                                V::Msg(vec![
                                    ("type", V::Enum("CONTENT_SCALE")),
                                    ("value", V::Float(1.0)),
                                ]),
                            ),
                            ("svgIDMode", V::Enum("ALWAYS")),
                            ("colorProfile", V::Enum("SRGB")),
                            ("quality", V::Float(0.76)),
                        ])]),
                    ),
                ],
            ),
        ],
        vec![],
    )
}

#[test]
fn reads_figmas_fields() {
    let doc = Document::open(&figma_file()).unwrap();
    let guides = props(&doc, "1:1").guides.as_deref().unwrap();
    assert_eq!(guides[0].axis, Axis::Y);
    assert_eq!(guides[0].offset, 64.0);
    assert_eq!(
        guides[0].guid,
        Some(Guid {
            session: 1,
            local: 90
        })
    );
    let grid = props(&doc, "1:2").layout_grids.as_deref().unwrap()[0];
    assert_eq!(grid.align, GridAlign::Center);
    assert_eq!(grid.count, 12);
    assert_eq!(grid.section_size, 72.0);
    let export = &props(&doc, "1:2").export_settings.as_deref().unwrap()[0];
    assert_eq!(export.format, ExportFormat::Pdf);
    assert_eq!(export.quality, 76);
    assert!(export.svg_include_id);
}

#[test]
fn saving_presets_keeps_fields_it_does_not_model() {
    let original = figma_file();
    let mut doc = Document::open(&original).unwrap();
    History::default()
        .apply(
            &mut doc,
            &ops(r#"[{"op":"setExports","ids":["1:2"],"settings":[{"format":"PDF","suffix":"-print"},{"format":"PNG","value":3}]}]"#),
            None,
        )
        .unwrap();
    let saved = save(&doc, &original).unwrap();
    // Read the saved record with its full schema.
    let c = Container::open_without_images(&saved).unwrap();
    let schema = Schema::decode(&c.schema).unwrap();
    let message = Decoder::new(&schema)
        .decode(
            &mut Reader::new(&c.message),
            schema.def_index("Message").unwrap(),
        )
        .unwrap();
    let Some(Value::List(nodes)) = message.get(&schema, "nodeChanges") else {
        panic!("no nodes");
    };
    let frame = nodes
        .iter()
        .find_map(|n| match n {
            Value::Msg(m) if matches!(m.get(&schema, "name"), Some(Value::Str(s)) if &**s == "Desktop") => Some(m),
            _ => None,
        })
        .unwrap();
    let Some(Value::List(exports)) = frame.get(&schema, "exportSettings") else {
        panic!("no export settings");
    };
    assert_eq!(exports.len(), 2);
    let Value::Msg(first) = &exports[0] else {
        panic!()
    };
    assert!(
        matches!(first.get(&schema, "colorProfile"), Some(Value::Enum(..))),
        "the color profile survives"
    );
    assert!(matches!(first.get(&schema, "suffix"), Some(Value::Str(s)) if &**s == "-print"));
    let reopened = Document::open(&saved).unwrap();
    assert_eq!(
        props(&reopened, "1:2").export_settings.as_deref().unwrap()[1].value,
        3.0
    );
}
