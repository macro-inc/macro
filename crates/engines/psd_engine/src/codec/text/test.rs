use super::*;
use crate::codec::corpus;
use crate::model::{Rgb, TextAlign, TextCase, TextStyle};

fn style(font: &str, size: f32, color: Rgb) -> TextStyle {
    TextStyle {
        font: font.into(),
        size,
        color,
        ..TextStyle::default()
    }
}

/// A two-paragraph area text layer with two styles.
fn sample() -> TextLayer {
    let mut bold = style("Inter-Bold", 36.0, Rgb::new(1.0, 0.0, 0.0));
    bold.faux_italic = true;
    bold.underline = true;
    bold.tracking = 50.0;
    bold.leading = Some(40.0);
    bold.case = TextCase::AllCaps;
    bold.baseline_shift = -2.0;
    bold.horizontal_scale = 1.25;
    bold.vertical_scale = 0.75;
    TextLayer {
        text: "Hello\rWorld\r".into(),
        runs: vec![
            TextRun {
                length: 6,
                style: bold,
            },
            TextRun {
                length: 6,
                style: style("Inter-Regular", 24.0, Rgb::new(0.0, 0.0, 1.0)),
            },
        ],
        paragraphs: vec![
            ParagraphRun {
                length: 6,
                align: TextAlign::Center,
            },
            ParagraphRun {
                length: 6,
                align: TextAlign::JustifyAll,
            },
        ],
        transform: [1.0, 0.0, 0.0, 1.0, 40.0, 60.0],
        area: Some([0.0, 0.0, 200.0, 100.5]),
        orientation: TextOrientation::Horizontal,
        anti_alias: AntiAlias::Crisp,
        warped: false,
    }
}

fn engine(data: &[u8]) -> EngineValue {
    let t = read_tysh(data).expect("reads");
    engine_of(&t.text).expect("engine data")
}

#[test]
fn new_layers_round_trip() {
    let layer = sample();
    let data = encode(&layer, None);
    assert_eq!(decode(&data).expect("decodes"), layer);

    let t = read_tysh(&data).expect("reads");
    assert_eq!((t.version, t.text_version, t.warp_version), (1, 50, 1));
    assert_eq!(t.text.text("Txt "), Some("Hello\rWorld"));
    assert_eq!(t.text.enumeration("AntA"), Some("AnCr"));
    assert_eq!(t.warp.class, "warp");
    assert!(!t.warp.class.is_code());
    let engine = engine(&data);
    assert_eq!(
        style::fonts(&engine),
        ["AdobeInvisFont", "Inter-Bold", "Inter-Regular"]
    );
    let shape = style::area(&engine);
    assert_eq!(shape, Some([0.0, 0.0, 200.0, 100.5]));
    // The normal style sheet uses the first run's font, not the invisible
    // one.
    let normal_font = engine
        .path(&["ResourceDict", "StyleSheetSet"])
        .and_then(EngineValue::as_array)
        .and_then(|s| s[0].path(&["StyleSheetData", "Font"]))
        .and_then(EngineValue::as_i64);
    assert_eq!(normal_font, Some(1));
    // Photoshop's layout, byte for byte through a parse.
    let raw = match t.text.get("EngineData") {
        Some(Value::RawData(raw)) => raw.clone(),
        _ => Vec::new(),
    };
    assert!(raw.starts_with(b"\n\n<<\n\t/EngineDict\n\t<<\n\t\t/Editor"));
    assert_eq!(
        engine_data::write(&engine_data::parse(&raw).expect("parses")),
        raw
    );
}

#[test]
fn point_and_vertical_text() {
    let mut layer = sample();
    layer.area = None;
    layer.orientation = TextOrientation::Vertical;
    layer.anti_alias = AntiAlias::None;
    let data = encode(&layer, None);
    let back = decode(&data).expect("decodes");
    assert_eq!(back, layer);
    let engine = engine(&data);
    assert_eq!(style::orientation(&engine), Some(TextOrientation::Vertical));
    let shapes = engine
        .path(&["EngineDict", "Rendered", "Shapes", "Children"])
        .and_then(EngineValue::as_array)
        .expect("shapes");
    assert_eq!(shapes[0].get("Procession"), Some(&EngineValue::Int(1)));
    assert!(
        shapes[0]
            .path(&["Cookie", "Photoshop", "PointBase"])
            .is_some()
    );

    // Switching to area text replaces the point with a box.
    let mut boxed = back;
    boxed.area = Some([1.0, 2.0, 3.0, 4.0]);
    let data = encode(&boxed, Some(&data));
    assert_eq!(decode(&data).expect("decodes"), boxed);
}

#[test]
fn unchanged_layers_write_back_as_they_were() {
    let data = encode(&sample(), None);
    let mut padded = data.clone();
    padded.extend_from_slice(&[0, 0, 0]);
    let layer = decode(&padded).expect("decodes");
    assert_eq!(encode(&layer, Some(&padded)), data);
}

/// Engine data whose runs leave defaults to the normal style sheet, as
/// Photoshop writes them.
fn sparse_engine() -> EngineValue {
    let mut engine = fresh::engine();
    let set_font = |engine: &mut EngineValue, key: &str| {
        if let Some(EngineValue::Array(fonts)) = engine.path_mut(&[key, "FontSet"]) {
            fonts.push(EngineValue::Dict(vec![(
                "Name".into(),
                EngineValue::String("MyriadPro-Regular".into()),
            )]));
            fonts.push(EngineValue::Dict(vec![(
                "Name".into(),
                EngineValue::String("MyriadPro-Bold".into()),
            )]));
        }
        if let Some(EngineValue::Array(sheets)) = engine.path_mut(&[key, "StyleSheetSet"]) {
            style::dict_at(&mut sheets[0], &["StyleSheetData"]).set("Font", EngineValue::Int(1));
        }
    };
    set_font(&mut engine, "ResourceDict");
    set_font(&mut engine, "DocumentResources");
    let run = |data: Vec<(&str, EngineValue)>| {
        EngineValue::Dict(vec![(
            "StyleSheet".into(),
            EngineValue::Dict(vec![(
                "StyleSheetData".into(),
                EngineValue::Dict(data.into_iter().map(|(k, v)| (k.to_string(), v)).collect()),
            )]),
        )])
    };
    let red = EngineValue::Dict(vec![
        ("Type".into(), EngineValue::Int(1)),
        (
            "Values".into(),
            EngineValue::Array(vec![
                EngineValue::Float(1.0),
                EngineValue::Float(1.0),
                EngineValue::Float(0.0),
                EngineValue::Float(0.0),
            ]),
        ),
    ]);
    let gray = EngineValue::Dict(vec![
        ("Type".into(), EngineValue::Int(0)),
        (
            "Values".into(),
            EngineValue::Array(vec![EngineValue::Float(1.0), EngineValue::Float(0.25)]),
        ),
    ]);
    let runs = vec![
        run(vec![
            ("Font", EngineValue::Int(2)),
            ("FontSize", EngineValue::Float(25.0)),
            ("Kerning", EngineValue::Int(7)),
            ("FillColor", red),
        ]),
        run(vec![
            ("FontSize", EngineValue::Float(25.0)),
            ("FillColor", gray),
        ]),
    ];
    let style_run = style::dict_at(&mut engine, &["EngineDict", "StyleRun"]);
    style_run.set("RunArray", EngineValue::Array(runs));
    style_run.set(
        "RunLengthArray",
        EngineValue::Array(vec![EngineValue::Int(3), EngineValue::Int(4)]),
    );
    let mut paragraph = fresh::paragraph_run();
    style::dict_at(&mut paragraph, &["ParagraphSheet", "Properties"])
        .set("Justification", EngineValue::Int(1));
    let paragraphs = style::dict_at(&mut engine, &["EngineDict", "ParagraphRun"]);
    paragraphs.set("RunArray", EngineValue::Array(vec![paragraph]));
    paragraphs.set(
        "RunLengthArray",
        EngineValue::Array(vec![EngineValue::Int(7)]),
    );
    style::dict_at(&mut engine, &["EngineDict", "Editor"])
        .set("Text", EngineValue::String("Hey you\r".into()));
    engine
}

fn sparse_block() -> Vec<u8> {
    let mut text = fresh::text_descriptor();
    text.set("Txt ", Value::Text("Hey you".into()));
    text.set(
        "AntA",
        Value::Enum("Annt".into(), "antiAliasPlatformLCD".into()),
    );
    text.set(
        "EngineData",
        Value::RawData(engine_data::write(&sparse_engine())),
    );
    let mut warp = fresh::warp_descriptor();
    warp.set(
        "warpStyle",
        Value::Enum("warpStyle".into(), "warpArc".into()),
    );
    write_tysh(&TySh {
        version: 1,
        transform: [2.0, 0.0, 0.0, 2.0, 10.0, 20.0],
        text_version: 50,
        text,
        warp_version: 1,
        warp,
        bounds: [7; 16],
        len: 0,
    })
}

#[test]
fn runs_inherit_the_normal_style_sheet() {
    let layer = decode(&sparse_block()).expect("decodes");
    assert_eq!(layer.text, "Hey you\r");
    assert_eq!(layer.runs.len(), 2);
    assert_eq!(layer.runs[0].style.font, "MyriadPro-Bold");
    assert_eq!(layer.runs[1].style.font, "MyriadPro-Regular");
    assert_eq!(layer.runs[0].style.color, Rgb::new(1.0, 0.0, 0.0));
    assert_eq!(layer.runs[1].style.color, Rgb::new(0.25, 0.25, 0.25));
    assert_eq!(layer.runs[1].style.size, 25.0);
    assert_eq!(layer.runs[1].length, 5);
    assert_eq!(
        layer.paragraphs,
        [ParagraphRun {
            length: 8,
            align: TextAlign::Right
        }]
    );
    assert!(layer.warped);
    assert_eq!(layer.anti_alias, AntiAlias::Smooth);
    // Sizes stay in text space.
    assert_eq!(layer.transform[0], 2.0);
}

#[test]
fn edits_keep_what_the_model_does_not_cover() {
    let data = sparse_block();
    let mut layer = decode(&data).expect("decodes");
    layer.text = "Hey you there\r".into();
    layer.runs[1].length = 11;
    layer.runs[0].style.color = Rgb::new(0.0, 1.0, 0.0);
    layer.runs[1].style.font = "Inter-Regular".into();
    layer.paragraphs[0].length = 14;
    let out = encode(&layer, Some(&data));
    assert_eq!(decode(&out).expect("decodes"), layer);

    let before = read_tysh(&data).expect("reads");
    let after = read_tysh(&out).expect("reads");
    assert_eq!(after.warp, before.warp);
    assert_eq!(after.bounds, before.bounds);
    assert_eq!(after.text.text("Txt "), Some("Hey you there"));
    assert_eq!(after.text.enumeration("AntA"), Some("antiAliasPlatformLCD"));
    let engine = engine(&out);
    let runs = engine
        .path(&["EngineDict", "StyleRun", "RunArray"])
        .and_then(EngineValue::as_array)
        .expect("runs");
    // The first run keeps its kerning; the second gains only a font.
    let first = runs[0]
        .path(&["StyleSheet", "StyleSheetData"])
        .expect("data");
    assert_eq!(first.get("Kerning"), Some(&EngineValue::Int(7)));
    let second = runs[1]
        .path(&["StyleSheet", "StyleSheetData"])
        .expect("data");
    assert_eq!(second.get("Font"), Some(&EngineValue::Int(3)));
    assert_eq!(second.get("FontSize"), Some(&EngineValue::Float(25.0)));
    for key in ["ResourceDict", "DocumentResources"] {
        let fonts = engine
            .path(&[key, "FontSet"])
            .and_then(EngineValue::as_array);
        assert_eq!(fonts.map(<[EngineValue]>::len), Some(4), "{key}");
    }
    assert_eq!(
        engine.path(&["DocumentResources", "KinsokuSet"]),
        sparse_engine().path(&["DocumentResources", "KinsokuSet"])
    );
}

#[test]
fn fits_runs_to_the_text() {
    let mut layer = sample();
    layer.text = "Hello".into();
    layer.runs[0].length = 2;
    layer.runs[1].length = 50;
    layer.paragraphs.clear();
    let back = decode(&encode(&layer, None)).expect("decodes");
    assert_eq!(back.text, "Hello\r");
    assert_eq!(
        back.runs.iter().map(|r| r.length).collect::<Vec<_>>(),
        [2, 4]
    );
    assert_eq!(
        back.paragraphs,
        [ParagraphRun {
            length: 6,
            align: TextAlign::Left
        }]
    );
}

#[test]
fn rejects_damaged_blocks() {
    let data = encode(&sample(), None);
    let mut wrong = data.clone();
    wrong[1] = 7;
    assert!(decode(&wrong).is_err());
    for n in [0, 10, 60, data.len() / 2] {
        assert!(decode(&data[..n]).is_err(), "{n}");
    }
    // A damaged original is replaced by a new block.
    assert_eq!(
        decode(&encode(&sample(), Some(&wrong))).expect("decodes"),
        sample()
    );
}

fn json_str<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

/// Differences between our text and ag-psd's, for what both read.
fn compare(ours: &TextLayer, engine: &EngineValue, theirs: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    let text = ours.text.replace('\r', "\n");
    if json_str(theirs, "text") != Some(text.trim_end_matches('\n')) {
        out.push(format!("text {:?} vs {:?}", ours.text, theirs.get("text")));
    }
    let base = theirs.get("style").cloned().unwrap_or_default();
    let explicit_fonts: Vec<bool> = engine
        .path(&["EngineDict", "StyleRun", "RunArray"])
        .and_then(EngineValue::as_array)
        .unwrap_or_default()
        .iter()
        .map(|r| r.path(&["StyleSheet", "StyleSheetData", "Font"]).is_some())
        .collect();
    let runs = theirs
        .get("styleRuns")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_else(|| vec![serde_json::json!({ "length": units(&ours.text), "style": {} })]);
    let mut offset = 0u32;
    for (i, run) in runs.iter().enumerate() {
        let get = |key: &str| {
            run.get("style")
                .and_then(|s| s.get(key))
                .or_else(|| base.get(key))
        };
        let Some(style) = ours.style_at(offset) else {
            break;
        };
        if let Some(size) = get("fontSize").and_then(|v| v.as_f64())
            && (size - f64::from(style.size)).abs() > 1e-3
        {
            out.push(format!("run {i} size {size} vs {}", style.size));
        }
        if let Some(c) = get("fillColor") {
            let channel = |k: &str| c.get(k).and_then(|v| v.as_f64()).map(|v| v.round() as u8);
            if let (Some(r), Some(g), Some(b)) = (channel("r"), channel("g"), channel("b"))
                && [r, g, b] != style.color.to_u8()
            {
                out.push(format!("run {i} color {c} vs {:?}", style.color));
            }
        }
        let run_index = ours
            .runs
            .iter()
            .scan(0u32, |start, r| {
                let s = *start;
                *start += r.length;
                Some(s)
            })
            .take_while(|s| *s <= offset)
            .count()
            .saturating_sub(1);
        if explicit_fonts.get(run_index).copied().unwrap_or(false)
            && let Some(font) = get("font").and_then(|f| json_str(f, "name"))
            && font != style.font
        {
            out.push(format!("run {i} font {font} vs {}", style.font));
        }
        offset += run.get("length").and_then(|l| l.as_u64()).unwrap_or(0) as u32;
    }
    let aligns = [
        "left",
        "right",
        "center",
        "justify-left",
        "justify-right",
        "justify-center",
        "justify-all",
    ];
    let paragraph_base = theirs.get("paragraphStyle").cloned().unwrap_or_default();
    let mut offset = 0u32;
    for run in theirs
        .get("paragraphStyleRuns")
        .and_then(|r| r.as_array())
        .into_iter()
        .flatten()
    {
        let align = run
            .get("style")
            .and_then(|s| json_str(s, "justification"))
            .or_else(|| json_str(&paragraph_base, "justification"))
            .unwrap_or("left");
        let mut start = 0u32;
        let ours_align = ours
            .paragraphs
            .iter()
            .find(|p| {
                start += p.length;
                offset < start
            })
            .map(|p| p.align);
        let expected = aligns.iter().position(|a| *a == align);
        let got = ours_align.and_then(|a| {
            [
                TextAlign::Left,
                TextAlign::Right,
                TextAlign::Center,
                TextAlign::JustifyLeft,
                TextAlign::JustifyRight,
                TextAlign::JustifyCenter,
                TextAlign::JustifyAll,
            ]
            .iter()
            .position(|x| *x == a)
        });
        if expected != got {
            out.push(format!("paragraph at {offset}: {align} vs {ours_align:?}"));
        }
        offset += run.get("length").and_then(|l| l.as_u64()).unwrap_or(0) as u32;
    }
    let anti_alias = match json_str(theirs, "antiAlias") {
        Some("none") => Some(AntiAlias::None),
        Some("sharp") => Some(AntiAlias::Sharp),
        Some("crisp") => Some(AntiAlias::Crisp),
        Some("strong") => Some(AntiAlias::Strong),
        Some(_) => Some(AntiAlias::Smooth),
        None => None,
    };
    if anti_alias.is_some_and(|a| a != ours.anti_alias) {
        out.push(format!(
            "anti-alias {anti_alias:?} vs {:?}",
            ours.anti_alias
        ));
    }
    let vertical = json_str(theirs, "orientation") == Some("vertical");
    if vertical != (ours.orientation == TextOrientation::Vertical) {
        out.push("orientation".into());
    }
    let boxed = json_str(theirs, "shapeType") == Some("box");
    if boxed != ours.area.is_some() {
        out.push("shape".into());
    }
    let warped = theirs
        .get("warp")
        .and_then(|w| json_str(w, "style"))
        .is_some_and(|s| s != "none");
    if warped != ours.warped {
        out.push("warp".into());
    }
    out
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn corpus_text_layers() {
    let (mut count, mut compared, mut failures) = (0, 0, Vec::new());
    for file in corpus::files() {
        let ag = file.ag_psd_layers();
        for (layer, ag) in file.layers.iter().zip(ag) {
            let Some(data) = layer.block(b"TySh") else {
                continue;
            };
            count += 1;
            let label = format!("{} {}", file.label(), layer.display_name());
            let text = match decode(data) {
                Ok(t) => t,
                Err(e) => {
                    failures.push(format!("{label}: {e}"));
                    continue;
                }
            };
            let out = encode(&text, Some(data));
            if !data.starts_with(&out) || data.len() - out.len() >= 4 {
                failures.push(format!("{label}: re-encodes differently"));
            }
            // An edit (more text, another color) reads back as made.
            let mut edited = text.clone();
            edited.text.insert_str(0, "Edited ");
            if let Some(first) = edited.runs.first_mut() {
                first.length += 7;
                first.style.color = Rgb::new(0.5, 0.25, 0.0);
            }
            if let Some(first) = edited.paragraphs.first_mut() {
                first.length += 7;
            }
            let out = encode(&edited, Some(data));
            match decode(&out) {
                Ok(back) if back == edited => {}
                Ok(back) => failures.push(format!("{label}: an edit reads back as {back:?}")),
                Err(e) => failures.push(format!("{label}: an edit does not read back: {e}")),
            }
            if let Some(theirs) = ag.as_ref().and_then(|j| j.get("text")) {
                compared += 1;
                let engine = engine(data);
                failures.extend(
                    compare(&text, &engine, theirs)
                        .into_iter()
                        .map(|d| format!("{label}: {d}")),
                );
            }
        }
    }
    eprintln!(
        "{count} text layers, {compared} compared with ag-psd, {} failures",
        failures.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}
