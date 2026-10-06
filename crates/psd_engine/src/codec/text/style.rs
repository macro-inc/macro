//! Text engine data to the model and back: character style runs, paragraph
//! runs, fonts, and the text's shape (point or box, horizontal or
//! vertical).
//!
//! Runs leave out values equal to the document's defaults, so a run's
//! style is its own `StyleSheetData` over the run defaults over the normal
//! style sheet (`ResourceDict.StyleSheetSet[TheNormalStyleSheet]`);
//! paragraphs work the same way with `ParagraphSheetSet`. Fonts are indices
//! into `ResourceDict.FontSet`. Writing changes only the values that
//! differ, starting each run from the original run at the same place.

use crate::codec::engine_data::EngineValue;
use crate::model::{ParagraphRun, Rgb, TextAlign, TextCase, TextOrientation, TextRun, TextStyle};

/// Paragraph alignments by `Justification` code.
const ALIGNS: [TextAlign; 7] = [
    TextAlign::Left,
    TextAlign::Right,
    TextAlign::Center,
    TextAlign::JustifyLeft,
    TextAlign::JustifyRight,
    TextAlign::JustifyCenter,
    TextAlign::JustifyAll,
];

/// Style dictionaries, looked up in order (a run's own values first).
struct Cascade<'a>(Vec<&'a EngineValue>);

impl Cascade<'_> {
    fn get(&self, key: &str) -> Option<&EngineValue> {
        self.0.iter().find_map(|d| d.get(key))
    }

    fn f32(&self, key: &str) -> Option<f32> {
        self.get(key)?.as_f64().map(|v| v as f32)
    }

    fn bool(&self, key: &str) -> Option<bool> {
        self.get(key)?.as_bool()
    }
}

fn dict() -> EngineValue {
    EngineValue::Dict(Vec::new())
}

/// The resources (fonts, style sheets) text layers keep with them.
fn resources(root: &EngineValue) -> Option<&EngineValue> {
    root.get("ResourceDict")
        .or_else(|| root.get("DocumentResources"))
}

/// An item of a resource set, by the index another value names.
fn sheet<'a>(
    root: &'a EngineValue,
    set: &str,
    index: &str,
    inner: &str,
) -> Option<&'a EngineValue> {
    let res = resources(root)?;
    let i = res.get(index).and_then(EngineValue::as_i64).unwrap_or(0);
    let list = res.get(set)?.as_array()?;
    list.get(usize::try_from(i).ok()?)
        .or(list.first())?
        .get(inner)
}

/// The fonts' PostScript names, by index.
pub(super) fn fonts(root: &EngineValue) -> Vec<String> {
    resources(root)
        .and_then(|r| r.get("FontSet"))
        .and_then(EngineValue::as_array)
        .unwrap_or_default()
        .iter()
        .map(|f| {
            f.get("Name")
                .and_then(EngineValue::as_str)
                .unwrap_or_default()
                .to_string()
        })
        .collect()
}

/// A `FillColor`: `Type` 1 is ARGB, 0 is alpha and gray, 2 alpha and CMYK
/// ink, each `0..=1`.
fn color_of(v: &EngineValue) -> Option<Rgb> {
    let values: Vec<f64> = v
        .get("Values")?
        .as_array()?
        .iter()
        .filter_map(EngineValue::as_f64)
        .collect();
    let c = |i: usize| values.get(i).copied().unwrap_or(0.0);
    let unit = |x: f64| x.clamp(0.0, 1.0) as f32;
    Some(match v.get("Type").and_then(EngineValue::as_i64)? {
        0 => Rgb::new(unit(c(1)), unit(c(1)), unit(c(1))),
        1 => Rgb::new(unit(c(1)), unit(c(2)), unit(c(3))),
        2 => crate::codec::paint::color::cmyk_to_rgb(c(1), c(2), c(3), c(4)),
        _ => return None,
    })
}

fn color_value(c: Rgb, alpha: f64) -> EngineValue {
    EngineValue::Dict(vec![
        ("Type".into(), EngineValue::Int(1)),
        (
            "Values".into(),
            EngineValue::Array(vec![
                EngineValue::Float(alpha),
                EngineValue::Float(f64::from(c.r)),
                EngineValue::Float(f64::from(c.g)),
                EngineValue::Float(f64::from(c.b)),
            ]),
        ),
    ])
}

fn style_of(c: &Cascade<'_>, fonts: &[String]) -> TextStyle {
    let d = TextStyle::default();
    let font = c
        .get("Font")
        .and_then(EngineValue::as_i64)
        .and_then(|i| fonts.get(usize::try_from(i).ok()?))
        .or(fonts.first())
        .cloned()
        .unwrap_or(d.font);
    TextStyle {
        font,
        size: c.f32("FontSize").unwrap_or(12.0),
        color: c.get("FillColor").and_then(color_of).unwrap_or(Rgb::BLACK),
        tracking: c.f32("Tracking").unwrap_or(0.0),
        leading: if c.bool("AutoLeading").unwrap_or(true) {
            None
        } else {
            Some(c.f32("Leading").unwrap_or(0.0))
        },
        faux_bold: c.bool("FauxBold").unwrap_or(false),
        faux_italic: c.bool("FauxItalic").unwrap_or(false),
        underline: c.bool("Underline").unwrap_or(false),
        strikethrough: c.bool("Strikethrough").unwrap_or(false),
        case: match c.get("FontCaps").and_then(EngineValue::as_i64) {
            Some(1) => TextCase::SmallCaps,
            Some(2) => TextCase::AllCaps,
            _ => TextCase::Normal,
        },
        baseline_shift: c.f32("BaselineShift").unwrap_or(0.0),
        horizontal_scale: c.f32("HorizontalScale").unwrap_or(1.0),
        vertical_scale: c.f32("VerticalScale").unwrap_or(1.0),
    }
}

/// Run lengths fitted to the text: the last run grows or shrinks so they
/// cover it exactly (empty runs at the end are dropped).
pub(super) fn fit(lengths: &mut Vec<u32>, total: u32) {
    let mut sum: u32 = 0;
    for (i, n) in lengths.iter_mut().enumerate() {
        if sum.saturating_add(*n) >= total {
            *n = total - sum;
            sum = total;
            lengths.truncate(i + 1);
            break;
        }
        sum += *n;
    }
    if sum < total {
        match lengths.last_mut() {
            Some(n) => *n += total - sum,
            None => lengths.push(total),
        }
    }
    while lengths.len() > 1 && lengths.last() == Some(&0) {
        lengths.pop();
    }
}

/// A run list's items and lengths.
fn runs_of<'a>(root: &'a EngineValue, key: &str) -> (Vec<&'a EngineValue>, Vec<u32>) {
    let run = root.path(&["EngineDict", key]);
    let items: Vec<&EngineValue> = run
        .and_then(|r| r.get("RunArray"))
        .and_then(EngineValue::as_array)
        .unwrap_or_default()
        .iter()
        .collect();
    let lengths = run
        .and_then(|r| r.get("RunLengthArray"))
        .and_then(EngineValue::as_array)
        .unwrap_or_default()
        .iter()
        .map(|v| {
            v.as_i64()
                .map_or(0, |n| n.clamp(0, i64::from(u32::MAX)) as u32)
        })
        .collect();
    (items, lengths)
}

/// The base character style: the normal style sheet under the run
/// defaults.
fn base_style(root: &EngineValue) -> Vec<&EngineValue> {
    let mut out = Vec::new();
    out.extend(root.path(&[
        "EngineDict",
        "StyleRun",
        "DefaultRunData",
        "StyleSheet",
        "StyleSheetData",
    ]));
    out.extend(sheet(
        root,
        "StyleSheetSet",
        "TheNormalStyleSheet",
        "StyleSheetData",
    ));
    out
}

/// The base paragraph style.
fn base_paragraph(root: &EngineValue) -> Vec<&EngineValue> {
    let mut out = Vec::new();
    out.extend(root.path(&[
        "EngineDict",
        "ParagraphRun",
        "DefaultRunData",
        "ParagraphSheet",
        "Properties",
    ]));
    out.extend(sheet(
        root,
        "ParagraphSheetSet",
        "TheNormalParagraphSheet",
        "Properties",
    ));
    out
}

/// The character style runs covering `total` UTF-16 units.
pub(super) fn decode_runs(root: &EngineValue, total: u32) -> Vec<TextRun> {
    let fonts = fonts(root);
    let (items, mut lengths) = runs_of(root, "StyleRun");
    fit(&mut lengths, total);
    let base = base_style(root);
    lengths
        .iter()
        .enumerate()
        .map(|(i, &length)| {
            let own = items
                .get(i)
                .or(items.last())
                .and_then(|r| r.path(&["StyleSheet", "StyleSheetData"]));
            let mut layers: Vec<&EngineValue> = own.into_iter().collect();
            layers.extend(base.iter().copied());
            TextRun {
                length,
                style: style_of(&Cascade(layers), &fonts),
            }
        })
        .collect()
}

fn align_of(c: &Cascade<'_>) -> TextAlign {
    c.get("Justification")
        .and_then(EngineValue::as_i64)
        .and_then(|j| ALIGNS.get(usize::try_from(j).ok()?).copied())
        .unwrap_or_default()
}

/// The paragraph runs covering `total` UTF-16 units.
pub(super) fn decode_paragraphs(root: &EngineValue, total: u32) -> Vec<ParagraphRun> {
    let (items, mut lengths) = runs_of(root, "ParagraphRun");
    fit(&mut lengths, total);
    let base = base_paragraph(root);
    lengths
        .iter()
        .enumerate()
        .map(|(i, &length)| {
            let own = items
                .get(i)
                .or(items.last())
                .and_then(|r| r.path(&["ParagraphSheet", "Properties"]));
            let mut layers: Vec<&EngineValue> = own.into_iter().collect();
            layers.extend(base.iter().copied());
            ParagraphRun {
                length,
                align: align_of(&Cascade(layers)),
            }
        })
        .collect()
}

/// The first shape's Photoshop settings.
fn photoshop_shape(root: &EngineValue) -> Option<&EngineValue> {
    root.path(&["EngineDict", "Rendered", "Shapes", "Children"])?
        .as_array()?
        .first()?
        .path(&["Cookie", "Photoshop"])
}

/// Area text's box (`ShapeType` 1, `BoxBounds`), in text space.
pub(super) fn area(root: &EngineValue) -> Option<[f64; 4]> {
    let shape = photoshop_shape(root)?;
    if shape.get("ShapeType").and_then(EngineValue::as_i64) != Some(1) {
        return None;
    }
    let bounds = shape.get("BoxBounds")?.as_array()?;
    let v = |i: usize| bounds.get(i).and_then(EngineValue::as_f64).unwrap_or(0.0);
    Some([v(0), v(1), v(2), v(3)])
}

/// The writing direction (2 is vertical).
pub(super) fn orientation(root: &EngineValue) -> Option<TextOrientation> {
    let direction = root
        .path(&["EngineDict", "Rendered", "Shapes", "WritingDirection"])?
        .as_i64()?;
    Some(if direction == 2 {
        TextOrientation::Vertical
    } else {
        TextOrientation::Horizontal
    })
}

/// Sets a dictionary's value unless it already reads as it.
fn put<T: PartialEq>(
    d: &mut EngineValue,
    base: &Cascade<'_>,
    key: &str,
    model: T,
    read: impl Fn(&EngineValue) -> Option<T>,
    write: impl Fn(&T) -> EngineValue,
) {
    let current = d.get(key).or_else(|| base.get(key)).and_then(&read);
    if current.as_ref() != Some(&model) {
        d.set(key, write(&model));
    }
}

fn float(v: &f32) -> EngineValue {
    EngineValue::Float(f64::from(*v))
}

fn read_f32(v: &EngineValue) -> Option<f32> {
    v.as_f64().map(|x| x as f32)
}

/// Writes a style into a run's `StyleSheetData`, changing what differs
/// from what it (over the base) reads as. New fonts join `fonts`.
fn put_style(d: &mut EngineValue, base: &Cascade<'_>, s: &TextStyle, fonts: &mut Vec<String>) {
    let current_font = d
        .get("Font")
        .or_else(|| base.get("Font"))
        .and_then(EngineValue::as_i64)
        .and_then(|i| fonts.get(usize::try_from(i).ok()?))
        .cloned();
    if current_font.as_deref() != Some(s.font.as_str()) {
        let index = match fonts.iter().position(|f| *f == s.font) {
            Some(i) => i,
            None => {
                fonts.push(s.font.clone());
                fonts.len() - 1
            }
        };
        d.set("Font", EngineValue::Int(index as i64));
    }
    put(d, base, "FontSize", s.size, read_f32, float);
    let alpha = d
        .get("FillColor")
        .and_then(|c| c.get("Values"))
        .and_then(EngineValue::as_array)
        .and_then(|v| v.first())
        .and_then(EngineValue::as_f64)
        .unwrap_or(1.0);
    put(d, base, "FillColor", s.color, color_of, |c| {
        color_value(*c, alpha)
    });
    put(d, base, "Tracking", s.tracking, read_f32, |v| {
        EngineValue::Int(v.round() as i64)
    });
    let auto = d
        .get("AutoLeading")
        .or_else(|| base.get("AutoLeading"))
        .and_then(EngineValue::as_bool)
        .unwrap_or(true);
    match s.leading {
        None if !auto => d.set("AutoLeading", EngineValue::Bool(true)),
        None => {}
        Some(leading) => {
            if auto {
                d.set("AutoLeading", EngineValue::Bool(false));
            }
            put(d, base, "Leading", leading, read_f32, float);
        }
    }
    let flag = |v: &bool| EngineValue::Bool(*v);
    put(d, base, "FauxBold", s.faux_bold, EngineValue::as_bool, flag);
    put(
        d,
        base,
        "FauxItalic",
        s.faux_italic,
        EngineValue::as_bool,
        flag,
    );
    put(
        d,
        base,
        "Underline",
        s.underline,
        EngineValue::as_bool,
        flag,
    );
    put(
        d,
        base,
        "Strikethrough",
        s.strikethrough,
        EngineValue::as_bool,
        flag,
    );
    let caps = match s.case {
        TextCase::Normal => 0,
        TextCase::SmallCaps => 1,
        TextCase::AllCaps => 2,
    };
    put(d, base, "FontCaps", caps, EngineValue::as_i64, |v| {
        EngineValue::Int(*v)
    });
    put(d, base, "BaselineShift", s.baseline_shift, read_f32, float);
    put(
        d,
        base,
        "HorizontalScale",
        s.horizontal_scale,
        read_f32,
        float,
    );
    put(d, base, "VerticalScale", s.vertical_scale, read_f32, float);
}

/// The original run covering a UTF-16 offset (the last one past the end).
fn run_at(items: &[EngineValue], lengths: &[u32], offset: u32) -> Option<EngineValue> {
    let mut start = 0u32;
    for (item, &n) in items.iter().zip(lengths) {
        if offset < start.saturating_add(n) {
            return Some(item.clone());
        }
        start = start.saturating_add(n);
    }
    items.last().cloned()
}

/// A dictionary at a path, created (over whatever was there) when missing.
pub(super) fn dict_at<'a>(v: &'a mut EngineValue, path: &[&str]) -> &'a mut EngineValue {
    if !matches!(v, EngineValue::Dict(_)) {
        *v = dict();
    }
    let Some((key, rest)) = path.split_first() else {
        return v;
    };
    match v {
        EngineValue::Dict(items) => {
            let at = match items.iter().position(|(k, _)| k == key) {
                Some(at) => at,
                None => {
                    items.push(((*key).to_string(), dict()));
                    items.len() - 1
                }
            };
            dict_at(&mut items[at].1, rest)
        }
        other => other,
    }
}

/// Replaces a run list's items and lengths.
fn set_runs(root: &mut EngineValue, key: &str, items: Vec<EngineValue>, lengths: &[u32]) {
    let run = dict_at(root, &["EngineDict", key]);
    run.set("RunArray", EngineValue::Array(items));
    run.set(
        "RunLengthArray",
        EngineValue::Array(
            lengths
                .iter()
                .map(|&n| EngineValue::Int(i64::from(n)))
                .collect(),
        ),
    );
}

/// Writes the character style runs, adding new fonts to the font sets.
pub(super) fn encode_runs(root: &mut EngineValue, runs: &[TextRun], template: &EngineValue) {
    let mut fonts = fonts(root);
    let known = fonts.len();
    let base_owned: Vec<EngineValue> = base_style(root).into_iter().cloned().collect();
    let base = Cascade(base_owned.iter().collect());
    let (items, lengths) = runs_of(root, "StyleRun");
    let items: Vec<EngineValue> = items.into_iter().cloned().collect();
    let mut out = Vec::with_capacity(runs.len());
    let mut start = 0u32;
    for run in runs {
        let mut item = run_at(&items, &lengths, start).unwrap_or_else(|| template.clone());
        put_style(
            dict_at(&mut item, &["StyleSheet", "StyleSheetData"]),
            &base,
            &run.style,
            &mut fonts,
        );
        out.push(item);
        start = start.saturating_add(run.length);
    }
    let lengths: Vec<u32> = runs.iter().map(|r| r.length).collect();
    set_runs(root, "StyleRun", out, &lengths);
    if fonts.len() > known {
        add_fonts(root, &fonts[known..]);
    }
}

/// Adds fonts to the resources' font sets (the document's copy too, when
/// it matches).
fn add_fonts(root: &mut EngineValue, names: &[String]) {
    let set_len = |root: &EngineValue, key: &str| {
        root.path(&[key, "FontSet"])
            .and_then(EngineValue::as_array)
            .map(<[EngineValue]>::len)
    };
    let same = set_len(root, "ResourceDict") == set_len(root, "DocumentResources");
    for key in ["ResourceDict", "DocumentResources"] {
        if key == "DocumentResources" && (!same || root.get(key).is_none()) {
            continue;
        }
        let res = dict_at(root, &[key]);
        if !matches!(res.get("FontSet"), Some(EngineValue::Array(_))) {
            res.set("FontSet", EngineValue::Array(Vec::new()));
        }
        if let Some(set) = res.get_mut("FontSet").and_then(EngineValue::as_array_mut) {
            for name in names {
                set.push(EngineValue::Dict(vec![
                    ("Name".into(), EngineValue::String(name.clone())),
                    ("Script".into(), EngineValue::Int(0)),
                    ("FontType".into(), EngineValue::Int(0)),
                    ("Synthetic".into(), EngineValue::Int(0)),
                ]));
            }
        }
    }
}

/// Writes the paragraph runs.
pub(super) fn encode_paragraphs(
    root: &mut EngineValue,
    runs: &[ParagraphRun],
    template: &EngineValue,
) {
    let base_owned: Vec<EngineValue> = base_paragraph(root).into_iter().cloned().collect();
    let base = Cascade(base_owned.iter().collect());
    let (items, lengths) = runs_of(root, "ParagraphRun");
    let items: Vec<EngineValue> = items.into_iter().cloned().collect();
    let mut out = Vec::with_capacity(runs.len());
    let mut start = 0u32;
    for run in runs {
        let mut item = run_at(&items, &lengths, start).unwrap_or_else(|| template.clone());
        let props = dict_at(&mut item, &["ParagraphSheet", "Properties"]);
        let code = ALIGNS.iter().position(|a| *a == run.align).unwrap_or(0) as i64;
        put(
            props,
            &base,
            "Justification",
            code,
            EngineValue::as_i64,
            |v| EngineValue::Int(*v),
        );
        out.push(item);
        start = start.saturating_add(run.length);
    }
    let lengths: Vec<u32> = runs.iter().map(|r| r.length).collect();
    set_runs(root, "ParagraphRun", out, &lengths);
}

/// Sets a value unless it already holds it.
fn set_if(d: &mut EngineValue, key: &str, value: EngineValue) {
    if d.get(key) != Some(&value) {
        d.set(key, value);
    }
}

/// Writes the text's shape: point or area text (its box) and its writing
/// direction.
pub(super) fn set_shape(
    root: &mut EngineValue,
    area: Option<[f64; 4]>,
    orientation: TextOrientation,
) {
    let (shape_type, direction, procession) = (
        i64::from(area.is_some()),
        if orientation == TextOrientation::Vertical {
            2
        } else {
            0
        },
        i64::from(orientation == TextOrientation::Vertical),
    );
    let Some(shapes) = root.path_mut(&["EngineDict", "Rendered", "Shapes"]) else {
        return;
    };
    set_if(shapes, "WritingDirection", EngineValue::Int(direction));
    let Some(first) = shapes
        .get_mut("Children")
        .and_then(EngineValue::as_array_mut)
        .and_then(|c| c.first_mut())
    else {
        return;
    };
    set_if(first, "ShapeType", EngineValue::Int(shape_type));
    set_if(first, "Procession", EngineValue::Int(procession));
    if let Some(lines) = first.get_mut("Lines") {
        set_if(lines, "WritingDirection", EngineValue::Int(direction));
    }
    let Some(photoshop) = first.path_mut(&["Cookie", "Photoshop"]) else {
        return;
    };
    set_if(photoshop, "ShapeType", EngineValue::Int(shape_type));
    if let Some(base) = photoshop.get_mut("Base") {
        set_if(base, "ShapeType", EngineValue::Int(shape_type));
    }
    let floats = |v: &[f64]| EngineValue::Array(v.iter().map(|&x| EngineValue::Float(x)).collect());
    if let EngineValue::Dict(items) = photoshop {
        match area {
            Some(bounds) => {
                let value = floats(&bounds);
                match items
                    .iter_mut()
                    .find(|(k, _)| k == "BoxBounds" || k == "PointBase")
                {
                    Some(item) => *item = ("BoxBounds".into(), value),
                    None => items.push(("BoxBounds".into(), value)),
                }
            }
            None => {
                if let Some(item) = items.iter_mut().find(|(k, _)| k == "BoxBounds") {
                    *item = ("PointBase".into(), floats(&[0.0, 0.0]));
                }
            }
        }
    }
}
