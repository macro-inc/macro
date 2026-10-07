//! Text layers (`TySh`): the transform, the text descriptor with its engine
//! data (characters, style runs, paragraph runs, fonts), and the warp.
//!
//! The block is a version (1), the transform (six doubles), the text
//! version (50) and a descriptor (16) holding the characters (`Txt `), the
//! orientation, anti-aliasing, and the engine data (`EngineData`), then
//! the warp version (1) and descriptor (16), then the warp's bounds (four
//! floats). Sizes stay in text space: the transform's scale is not applied.

mod fresh;
mod style;

use crate::binary::{Reader, Writer};
use crate::codec::descriptor::{self, Descriptor, Value};
use crate::codec::engine_data::{self, EngineValue};
use crate::error::{PsdError, Result};
use crate::model::{AntiAlias, ParagraphRun, TextLayer, TextOrientation, TextRun};

/// Anti-aliasing methods by `Annt` id and the engine data's code.
const ANTI_ALIAS: [(AntiAlias, &str, i64); 5] = [
    (AntiAlias::None, "Anno", 0),
    (AntiAlias::Crisp, "AnCr", 1),
    (AntiAlias::Strong, "AnSt", 2),
    (AntiAlias::Smooth, "AnSm", 3),
    (AntiAlias::Sharp, "antiAliasSharp", 4),
];

/// The parts of a `TySh` block.
struct TySh {
    version: u16,
    transform: [f64; 6],
    text_version: u16,
    text: Descriptor,
    warp_version: u16,
    warp: Descriptor,
    /// The warp's bounds, as stored.
    bounds: [u8; 16],
    /// Bytes the parts took (padding may follow).
    len: usize,
}

fn read_tysh(data: &[u8]) -> Result<TySh> {
    let mut r = Reader::new(data);
    let version = r.u16()?;
    if version != 1 {
        return Err(PsdError::Unsupported(format!(
            "text layer version {version}"
        )));
    }
    let mut transform = [0.0; 6];
    for v in &mut transform {
        *v = r.f64()?;
    }
    let text_version = r.u16()?;
    let (text, used) = descriptor::read_versioned(&data[r.pos()..])?;
    r.skip(used)?;
    let warp_version = r.u16()?;
    let (warp, used) = descriptor::read_versioned(&data[r.pos()..])?;
    r.skip(used)?;
    let mut bounds = [0; 16];
    let n = r.remaining().min(16);
    bounds[..n].copy_from_slice(r.bytes(n)?);
    Ok(TySh {
        version,
        transform,
        text_version,
        text,
        warp_version,
        warp,
        bounds,
        len: r.pos(),
    })
}

fn write_tysh(t: &TySh) -> Vec<u8> {
    let mut w = Writer::new();
    w.u16(t.version);
    for v in t.transform {
        w.f64(v);
    }
    w.u16(t.text_version);
    w.bytes(&descriptor::write_versioned(&t.text));
    w.u16(t.warp_version);
    w.bytes(&descriptor::write_versioned(&t.warp));
    w.bytes(&t.bounds);
    w.into_bytes()
}

/// The engine data a text descriptor holds (an empty dictionary when it has
/// none).
fn engine_of(text: &Descriptor) -> Result<EngineValue> {
    match text.get("EngineData") {
        Some(Value::RawData(raw)) => engine_data::parse(raw),
        _ => Ok(EngineValue::Dict(Vec::new())),
    }
}

/// UTF-16 units in a string.
fn units(s: &str) -> u32 {
    s.encode_utf16().count().min(u32::MAX as usize) as u32
}

fn layer_of(t: &TySh, engine: &EngineValue) -> TextLayer {
    let text = engine
        .path(&["EngineDict", "Editor", "Text"])
        .and_then(EngineValue::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}\r", t.text.text("Txt ").unwrap_or_default()));
    let total = units(&text);
    let orientation = match t.text.enumeration("Ornt") {
        Some("Vrtc") => TextOrientation::Vertical,
        Some(_) => TextOrientation::Horizontal,
        None => style::orientation(engine).unwrap_or_default(),
    };
    let anti_alias = anti_alias_of(&t.text)
        .or_else(|| anti_alias_code(engine))
        .unwrap_or_default();
    TextLayer {
        runs: style::decode_runs(engine, total),
        paragraphs: style::decode_paragraphs(engine, total),
        text,
        transform: t.transform,
        area: style::area(engine),
        orientation,
        anti_alias,
        warped: t
            .warp
            .enumeration("warpStyle")
            .is_some_and(|s| s != "warpNone"),
    }
}

/// Reads a `TySh` block.
pub fn decode(data: &[u8]) -> Result<TextLayer> {
    let t = read_tysh(data)?;
    let engine = engine_of(&t.text)?;
    Ok(layer_of(&t, &engine))
}

/// Runs without empty ones, fitted to `total` UTF-16 units (one `fallback`
/// run when there are none).
fn fitted<T: Clone>(
    runs: &[T],
    length: fn(&T) -> u32,
    set: fn(&mut T, u32),
    total: u32,
    fallback: T,
) -> Vec<T> {
    let mut runs: Vec<T> = runs.iter().filter(|r| length(r) > 0).cloned().collect();
    if runs.is_empty() {
        runs.push(fallback);
    }
    let mut lengths: Vec<u32> = runs.iter().map(length).collect();
    style::fit(&mut lengths, total);
    runs.truncate(lengths.len());
    for (run, n) in runs.iter_mut().zip(lengths) {
        set(run, n);
    }
    runs
}

/// The layer with its text ending in a paragraph end (`\r`), as Photoshop
/// stores it, and its runs covering the text.
fn normalized(layer: &TextLayer) -> TextLayer {
    let mut layer = layer.clone();
    if !layer.text.ends_with('\r') {
        layer.text.push('\r');
    }
    let total = units(&layer.text);
    let style = layer
        .runs
        .first()
        .map(|r| r.style.clone())
        .unwrap_or_default();
    layer.runs = fitted(
        &layer.runs,
        |r| r.length,
        |r, n| r.length = n,
        total,
        TextRun {
            length: total,
            style,
        },
    );
    layer.paragraphs = fitted(
        &layer.paragraphs,
        |r| r.length,
        |r, n| r.length = n,
        total,
        ParagraphRun {
            length: total,
            align: Default::default(),
        },
    );
    layer
}

/// The anti-aliasing a text descriptor names (platform methods read as
/// Smooth).
fn anti_alias_of(text: &Descriptor) -> Option<AntiAlias> {
    let id = text.enumeration("AntA")?;
    Some(
        ANTI_ALIAS
            .iter()
            .find(|(_, s, _)| *s == id)
            .map_or(AntiAlias::Smooth, |(a, _, _)| *a),
    )
}

/// The anti-aliasing the engine data's code names (platform methods read
/// as Smooth).
fn anti_alias_code(engine: &EngineValue) -> Option<AntiAlias> {
    let code = engine.path(&["EngineDict", "AntiAlias"])?.as_i64()?;
    Some(
        ANTI_ALIAS
            .iter()
            .find(|(_, _, c)| *c == code)
            .map_or(AntiAlias::Smooth, |(a, _, _)| *a),
    )
}

/// Writes a `TySh` block for `text`, starting from the `original` block
/// when there is one (warp, fonts, and settings the model does not cover
/// are kept). Without one it writes a complete block for a new point or
/// area text layer.
pub fn encode(text: &TextLayer, original: Option<&[u8]>) -> Vec<u8> {
    let parsed = original.and_then(|data| {
        let t = read_tysh(data).ok()?;
        let engine = engine_of(&t.text).ok()?;
        Some((data, t, engine))
    });
    let (mut t, mut engine, fresh) = match parsed {
        Some((data, t, engine)) if layer_of(&t, &engine) == *text => return data[..t.len].to_vec(),
        Some((_, t, engine)) => (t, engine, false),
        None => (
            TySh {
                version: 1,
                transform: text.transform,
                text_version: 50,
                text: fresh::text_descriptor(),
                warp_version: 1,
                warp: fresh::warp_descriptor(),
                bounds: [0; 16],
                len: 0,
            },
            fresh::engine(),
            true,
        ),
    };
    let layer = normalized(text);
    style::dict_at(&mut engine, &["EngineDict", "Editor"])
        .set("Text", EngineValue::String(layer.text.clone()));
    style::encode_runs(&mut engine, &layer.runs, &fresh::style_run());
    style::encode_paragraphs(&mut engine, &layer.paragraphs, &fresh::paragraph_run());
    style::set_shape(&mut engine, layer.area, layer.orientation);
    if fresh {
        // The normal style sheet takes the first run's font.
        if let Some(font) = engine
            .path(&["EngineDict", "StyleRun", "RunArray"])
            .and_then(EngineValue::as_array)
            .and_then(|runs| runs.first())
            .and_then(|r| r.path(&["StyleSheet", "StyleSheetData", "Font"]))
            .cloned()
        {
            for key in ["ResourceDict", "DocumentResources"] {
                if let Some(EngineValue::Array(sheets)) = engine.path_mut(&[key, "StyleSheetSet"])
                    && let Some(first) = sheets.first_mut()
                {
                    style::dict_at(first, &["StyleSheetData"]).set("Font", font.clone());
                }
            }
        }
    }
    let (_, id, code) = ANTI_ALIAS
        .iter()
        .find(|(a, _, _)| *a == layer.anti_alias)
        .copied()
        .unwrap_or(ANTI_ALIAS[3]);
    if anti_alias_of(&t.text) != Some(layer.anti_alias) {
        t.text.set("AntA", Value::Enum("Annt".into(), id.into()));
    }
    if anti_alias_code(&engine) != Some(layer.anti_alias) {
        style::dict_at(&mut engine, &["EngineDict"]).set("AntiAlias", EngineValue::Int(code));
    }
    let orientation = match layer.orientation {
        TextOrientation::Horizontal => "Hrzn",
        TextOrientation::Vertical => "Vrtc",
    };
    if t.text.enumeration("Ornt") != Some(orientation) {
        t.text
            .set("Ornt", Value::Enum("Ornt".into(), orientation.into()));
    }
    let characters = layer.text.strip_suffix('\r').unwrap_or(&layer.text);
    if t.text.text("Txt ") != Some(characters) {
        t.text.set("Txt ", Value::Text(characters.to_string()));
    }
    t.text
        .set("EngineData", Value::RawData(engine_data::write(&engine)));
    t.transform = layer.transform;
    write_tysh(&t)
}

#[cfg(test)]
mod test;
