//! What a text layer Photoshop never saw needs: engine data with the
//! document resources Photoshop writes (kinsoku and mojikumi sets, the
//! normal style and paragraph sheets, the font set), run templates, and the
//! text and warp descriptors.
//!
//! The minimal structure follows ag-psd's `encodeEngineData` (MIT,
//! <https://github.com/Agamnentzar/ag-psd>, `src/text.ts`); the values are
//! Photoshop's defaults as its files store them.

use crate::codec::descriptor::{Descriptor, Id, Value};
use crate::codec::engine_data::EngineValue;

fn dict(items: Vec<(&str, EngineValue)>) -> EngineValue {
    EngineValue::Dict(items.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

fn float(v: f64) -> EngineValue {
    EngineValue::Float(v)
}

fn int(v: i64) -> EngineValue {
    EngineValue::Int(v)
}

fn flag(v: bool) -> EngineValue {
    EngineValue::Bool(v)
}

fn text(v: &str) -> EngineValue {
    EngineValue::String(v.to_string())
}

fn floats(v: &[f64]) -> EngineValue {
    EngineValue::Array(v.iter().map(|&x| float(x)).collect())
}

fn black() -> EngineValue {
    dict(vec![
        ("Type", int(1)),
        ("Values", floats(&[1.0, 0.0, 0.0, 0.0])),
    ])
}

/// Photoshop's default paragraph properties.
fn paragraph_properties() -> EngineValue {
    dict(vec![
        ("Justification", int(0)),
        ("FirstLineIndent", float(0.0)),
        ("StartIndent", float(0.0)),
        ("EndIndent", float(0.0)),
        ("SpaceBefore", float(0.0)),
        ("SpaceAfter", float(0.0)),
        ("AutoHyphenate", flag(true)),
        ("HyphenatedWordSize", int(6)),
        ("PreHyphen", int(2)),
        ("PostHyphen", int(2)),
        ("ConsecutiveHyphens", int(8)),
        ("Zone", float(36.0)),
        ("WordSpacing", floats(&[0.8, 1.0, 1.33])),
        ("LetterSpacing", floats(&[0.0, 0.0, 0.0])),
        ("GlyphSpacing", floats(&[1.0, 1.0, 1.0])),
        ("AutoLeading", float(1.2)),
        ("LeadingType", int(0)),
        ("Hanging", flag(false)),
        ("Burasagari", flag(false)),
        ("KinsokuOrder", int(0)),
        ("EveryLineComposer", flag(false)),
    ])
}

/// Photoshop's normal style sheet (font 0 until a run's font is known).
fn style_sheet_data() -> EngineValue {
    dict(vec![
        ("Font", int(0)),
        ("FontSize", float(12.0)),
        ("FauxBold", flag(false)),
        ("FauxItalic", flag(false)),
        ("AutoLeading", flag(true)),
        ("Leading", float(0.0)),
        ("HorizontalScale", float(1.0)),
        ("VerticalScale", float(1.0)),
        ("Tracking", int(0)),
        ("AutoKerning", flag(true)),
        ("Kerning", int(0)),
        ("BaselineShift", float(0.0)),
        ("FontCaps", int(0)),
        ("FontBaseline", int(0)),
        ("Underline", flag(false)),
        ("Strikethrough", flag(false)),
        ("Ligatures", flag(true)),
        ("DLigatures", flag(false)),
        ("BaselineDirection", int(2)),
        ("Tsume", float(0.0)),
        ("StyleRunAlignment", int(2)),
        ("Language", int(0)),
        ("NoBreak", flag(false)),
        ("FillColor", black()),
        ("StrokeColor", black()),
        ("FillFlag", flag(true)),
        ("StrokeFlag", flag(false)),
        ("FillFirst", flag(true)),
        ("YUnderline", int(1)),
        ("OutlineWidth", float(1.0)),
        ("CharacterDirection", int(0)),
        ("HindiNumbers", flag(false)),
        ("Kashida", int(1)),
        ("DiacriticPos", int(2)),
    ])
}

const HARD_NO_START: &str = "、。，．・：；？！ー―’”）〕］｝〉》」』】ヽヾゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ゛゜?!)]},.:;℃℉¢％‰";
const HARD_NO_END: &str = "‘“（〔［｛〈《「『【([{￥＄£＠§〒＃";
const SOFT_NO_START: &str = "、。，．・：；？！’”）〕］｝〉》」』】ヽヾゝゞ々";
const SOFT_NO_END: &str = "‘“（〔［｛〈《「『【";

/// The resources Photoshop stores with each text layer.
fn resources() -> EngineValue {
    let kinsoku = |name: &str, no_start: &str, no_end: &str| {
        dict(vec![
            ("Name", text(name)),
            ("NoStart", text(no_start)),
            ("NoEnd", text(no_end)),
            ("Keep", text("―‥")),
            ("Hanging", text("、。.,")),
        ])
    };
    let mojikumi = (1..=4)
        .map(|i| {
            dict(vec![(
                "InternalName",
                text(&format!("Photoshop6MojiKumiSet{i}")),
            )])
        })
        .collect();
    dict(vec![
        (
            "KinsokuSet",
            EngineValue::Array(vec![
                kinsoku("PhotoshopKinsokuHard", HARD_NO_START, HARD_NO_END),
                kinsoku("PhotoshopKinsokuSoft", SOFT_NO_START, SOFT_NO_END),
            ]),
        ),
        ("MojiKumiSet", EngineValue::Array(mojikumi)),
        ("TheNormalStyleSheet", int(0)),
        ("TheNormalParagraphSheet", int(0)),
        (
            "ParagraphSheetSet",
            EngineValue::Array(vec![dict(vec![
                ("Name", text("Normal RGB")),
                ("DefaultStyleSheet", int(0)),
                ("Properties", paragraph_properties()),
            ])]),
        ),
        (
            "StyleSheetSet",
            EngineValue::Array(vec![dict(vec![
                ("Name", text("Normal RGB")),
                ("StyleSheetData", style_sheet_data()),
            ])]),
        ),
        (
            "FontSet",
            EngineValue::Array(vec![dict(vec![
                ("Name", text("AdobeInvisFont")),
                ("Script", int(0)),
                ("FontType", int(0)),
                ("Synthetic", int(0)),
            ])]),
        ),
        ("SuperscriptSize", float(0.583)),
        ("SuperscriptPosition", float(0.333)),
        ("SubscriptSize", float(0.583)),
        ("SubscriptPosition", float(0.333)),
        ("SmallCapSize", float(0.7)),
    ])
}

fn adjustments() -> EngineValue {
    dict(vec![
        ("Axis", floats(&[1.0, 0.0, 1.0])),
        ("XY", floats(&[0.0, 0.0])),
    ])
}

/// Engine data with no text or runs yet.
pub(super) fn engine() -> EngineValue {
    let shape = dict(vec![
        ("ShapeType", int(0)),
        ("Procession", int(0)),
        (
            "Lines",
            dict(vec![
                ("WritingDirection", int(0)),
                ("Children", EngineValue::Array(Vec::new())),
            ]),
        ),
        (
            "Cookie",
            dict(vec![(
                "Photoshop",
                dict(vec![
                    ("ShapeType", int(0)),
                    ("PointBase", floats(&[0.0, 0.0])),
                    (
                        "Base",
                        dict(vec![
                            ("ShapeType", int(0)),
                            ("TransformPoint0", floats(&[1.0, 0.0])),
                            ("TransformPoint1", floats(&[0.0, 1.0])),
                            ("TransformPoint2", floats(&[0.0, 0.0])),
                        ]),
                    ),
                ]),
            )]),
        ),
    ]);
    let empty = || EngineValue::Array(Vec::new());
    let engine_dict = dict(vec![
        ("Editor", dict(vec![("Text", text(""))])),
        (
            "ParagraphRun",
            dict(vec![
                (
                    "DefaultRunData",
                    dict(vec![
                        (
                            "ParagraphSheet",
                            dict(vec![
                                ("DefaultStyleSheet", int(0)),
                                ("Properties", dict(Vec::new())),
                            ]),
                        ),
                        ("Adjustments", adjustments()),
                    ]),
                ),
                ("RunArray", empty()),
                ("RunLengthArray", empty()),
                ("IsJoinable", int(1)),
            ]),
        ),
        (
            "StyleRun",
            dict(vec![
                (
                    "DefaultRunData",
                    dict(vec![(
                        "StyleSheet",
                        dict(vec![("StyleSheetData", dict(Vec::new()))]),
                    )]),
                ),
                ("RunArray", empty()),
                ("RunLengthArray", empty()),
                ("IsJoinable", int(2)),
            ]),
        ),
        (
            "GridInfo",
            dict(vec![
                ("GridIsOn", flag(false)),
                ("ShowGrid", flag(false)),
                ("GridSize", float(18.0)),
                ("GridLeading", float(22.0)),
                (
                    "GridColor",
                    dict(vec![
                        ("Type", int(1)),
                        ("Values", floats(&[0.0, 0.0, 0.0, 1.0])),
                    ]),
                ),
                (
                    "GridLeadingFillColor",
                    dict(vec![
                        ("Type", int(1)),
                        ("Values", floats(&[0.0, 0.0, 0.0, 1.0])),
                    ]),
                ),
                ("AlignLineHeightToGridFlags", flag(false)),
            ]),
        ),
        ("AntiAlias", int(3)),
        ("UseFractionalGlyphWidths", flag(true)),
        (
            "Rendered",
            dict(vec![
                ("Version", int(1)),
                (
                    "Shapes",
                    dict(vec![
                        ("WritingDirection", int(0)),
                        ("Children", EngineValue::Array(vec![shape])),
                    ]),
                ),
            ]),
        ),
    ]);
    dict(vec![
        ("EngineDict", engine_dict),
        ("ResourceDict", resources()),
        ("DocumentResources", resources()),
    ])
}

/// A new style run: the values Photoshop writes in every run.
pub(super) fn style_run() -> EngineValue {
    dict(vec![(
        "StyleSheet",
        dict(vec![(
            "StyleSheetData",
            dict(vec![
                ("Font", int(0)),
                ("FontSize", float(12.0)),
                ("AutoKerning", flag(true)),
                ("Kerning", int(0)),
                ("FillColor", black()),
            ]),
        )]),
    )])
}

/// A new paragraph run.
pub(super) fn paragraph_run() -> EngineValue {
    dict(vec![
        (
            "ParagraphSheet",
            dict(vec![
                ("DefaultStyleSheet", int(0)),
                ("Properties", paragraph_properties()),
            ]),
        ),
        ("Adjustments", adjustments()),
    ])
}

/// A new text descriptor (its items set by the encoder).
pub(super) fn text_descriptor() -> Descriptor {
    Descriptor::new("TxLr")
        .with("Txt ", Value::Text(String::new()))
        .with(
            "textGridding",
            Value::Enum("textGridding".into(), "None".into()),
        )
        .with("Ornt", Value::Enum("Ornt".into(), "Hrzn".into()))
        .with("AntA", Value::Enum("Annt".into(), "AnSm".into()))
        .with("TextIndex", Value::Integer(0))
        .with("EngineData", Value::RawData(Vec::new()))
}

/// The warp of unwarped text.
pub(super) fn warp_descriptor() -> Descriptor {
    Descriptor::new(Id::string("warp"))
        .with(
            "warpStyle",
            Value::Enum("warpStyle".into(), "warpNone".into()),
        )
        .with("warpValue", Value::Double(0.0))
        .with("warpPerspective", Value::Double(0.0))
        .with("warpPerspectiveOther", Value::Double(0.0))
        .with("warpRotate", Value::Enum("Ornt".into(), "Hrzn".into()))
}
