//! Layer styles: the `lfx2` descriptor (and `lmfx`, which holds several of
//! one effect), or the legacy `lrFX` block in files without one.
//!
//! The descriptor-based blocks are a version (0), the descriptor version
//! (16), and a descriptor with the style's scale (`Scl `), its master
//! switch, and the effects: one per key (`DrSh`, `IrSh`, `OrGl`, `IrGl`,
//! `ebbl`, `SoFi`, `GrFl`, `patternFill`, `ChFX`, `FrFX`), or, for the kinds
//! a layer may have several of, lists (`dropShadowMulti`,
//! `innerShadowMulti`, `solidFillMulti`, `gradientFillMulti`,
//! `frameFXMulti`), which newer files use in `lfx2` too. Effects whose
//! `present` is off are placeholders Photoshop keeps for its dialog: they
//! are not part of the style, and encoding keeps them where they are.

mod legacy;
mod read;
mod write;

use crate::binary::{Reader, Writer};
use crate::codec::descriptor::{self, Descriptor, Id, Value};
use crate::codec::paint;
use crate::error::Result;
use crate::model::{Bevel, Effects, Glow, Overlay, Satin, Shadow, StrokeEffect};

/// Effect kinds, in Photoshop's item order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    DropShadow,
    InnerShadow,
    OuterGlow,
    ColorOverlay,
    GradientOverlay,
    PatternOverlay,
    Stroke,
    InnerGlow,
    Bevel,
    Satin,
}

impl Kind {
    const ALL: [Kind; 10] = [
        Kind::DropShadow,
        Kind::InnerShadow,
        Kind::OuterGlow,
        Kind::ColorOverlay,
        Kind::GradientOverlay,
        Kind::PatternOverlay,
        Kind::Stroke,
        Kind::InnerGlow,
        Kind::Bevel,
        Kind::Satin,
    ];

    /// The key (and class) of one effect.
    fn key(self) -> &'static str {
        match self {
            Kind::DropShadow => "DrSh",
            Kind::InnerShadow => "IrSh",
            Kind::OuterGlow => "OrGl",
            Kind::ColorOverlay => "SoFi",
            Kind::GradientOverlay => "GrFl",
            Kind::PatternOverlay => "patternFill",
            Kind::Stroke => "FrFX",
            Kind::InnerGlow => "IrGl",
            Kind::Bevel => "ebbl",
            Kind::Satin => "ChFX",
        }
    }

    /// The key of the list, for kinds a layer may have several of.
    fn multi_key(self) -> Option<&'static str> {
        match self {
            Kind::DropShadow => Some("dropShadowMulti"),
            Kind::InnerShadow => Some("innerShadowMulti"),
            Kind::ColorOverlay => Some("solidFillMulti"),
            Kind::GradientOverlay => Some("gradientFillMulti"),
            Kind::Stroke => Some("frameFXMulti"),
            _ => None,
        }
    }
}

/// Where a top-level item goes among the others.
fn top_order(key: &str) -> Option<usize> {
    match key {
        "Scl " => Some(0),
        "masterFXSwitch" => Some(1),
        "numModifyingFX" => Some(2 + Kind::ALL.len()),
        _ => Kind::ALL
            .iter()
            .position(|k| k.key() == key || k.multi_key() == Some(key))
            .map(|i| i + 2),
    }
}

/// How a kind's effects are stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Form {
    Absent,
    Single,
    Multi,
}

/// A kind's effect descriptors, placeholders included, and their form.
fn entries(d: &Descriptor, kind: Kind) -> (Vec<Descriptor>, Form) {
    if let Some(list) = kind.multi_key().and_then(|k| d.list(k)) {
        let items = list
            .iter()
            .filter_map(Value::as_descriptor)
            .cloned()
            .collect();
        return (items, Form::Multi);
    }
    match d.object(kind.key()) {
        Some(e) => (vec![e.clone()], Form::Single),
        None => (Vec::new(), Form::Absent),
    }
}

/// Whether an effect is part of the style (not a placeholder).
fn is_present(e: &Descriptor) -> bool {
    e.bool("present") != Some(false)
}

/// The effects a style descriptor holds.
fn from_descriptor(d: &Descriptor) -> Effects {
    let mut fx = Effects {
        enabled: d.bool("masterFXSwitch").unwrap_or(true),
        scale: paint::percent(d, "Scl ").unwrap_or(1.0),
        ..Effects::default()
    };
    for kind in Kind::ALL {
        let (list, _) = entries(d, kind);
        for e in list.iter().filter(|e| is_present(e)) {
            match kind {
                Kind::DropShadow => fx.drop_shadows.push(read::shadow(e, true)),
                Kind::InnerShadow => fx.inner_shadows.push(read::shadow(e, false)),
                Kind::OuterGlow => fx.outer_glows.push(read::glow(e, false)),
                Kind::InnerGlow => fx.inner_glows.push(read::glow(e, true)),
                Kind::Bevel => fx.bevels.push(read::bevel(e)),
                Kind::Satin => fx.satins.push(read::satin(e)),
                Kind::ColorOverlay => fx.color_overlays.push(read::overlay(e, read::solid(e))),
                Kind::GradientOverlay => {
                    fx.gradient_overlays
                        .push(read::overlay(e, read::gradient(e)));
                }
                Kind::PatternOverlay => {
                    if let Some(fill) = read::pattern(e) {
                        fx.pattern_overlays.push(read::overlay(e, fill));
                    }
                }
                Kind::Stroke => fx.strokes.push(read::stroke(e)),
            }
        }
    }
    fx
}

/// A version (0) and a style descriptor, and how many bytes they took.
fn read_block(data: &[u8]) -> Result<(u32, Descriptor, usize)> {
    let version = Reader::new(data).u32()?;
    let (d, used) = descriptor::read_versioned(&data[4..])?;
    Ok((version, d, 4 + used))
}

/// Reads a layer's effects from its blocks: `lmfx` or `lfx2` first, then
/// `lrFX`. `None` when the layer has no style. (`lfxs`, which newer files
/// give some groups instead, has the same form and may be passed as
/// either.)
pub fn decode(
    lfx2: Option<&[u8]>,
    lmfx: Option<&[u8]>,
    lrfx: Option<&[u8]>,
) -> Result<Option<Effects>> {
    let mut first_error = None;
    for data in [lmfx, lfx2].into_iter().flatten() {
        match read_block(data) {
            Ok((_, d, _)) => return Ok(Some(from_descriptor(&d))),
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    if let Some(data) = lrfx {
        match legacy::decode(data) {
            Ok(fx) => return Ok(Some(fx)),
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    first_error.map_or(Ok(None), Err)
}

/// One model effect, to write into a descriptor.
enum Entry<'a> {
    Shadow(&'a Shadow, bool),
    Glow(&'a Glow, bool),
    Bevel(&'a Bevel),
    Satin(&'a Satin),
    Overlay(&'a Overlay, Kind),
    Stroke(&'a StrokeEffect),
}

impl Entry<'_> {
    /// Whether a descriptor already reads as the effect.
    fn matches(&self, d: &Descriptor) -> bool {
        match self {
            Entry::Shadow(s, drop) => read::shadow(d, *drop) == **s,
            Entry::Glow(g, inner) => read::glow(d, *inner) == **g,
            Entry::Bevel(b) => read::bevel(d) == **b,
            Entry::Satin(s) => read::satin(d) == **s,
            Entry::Overlay(o, kind) => {
                let fill = match kind {
                    Kind::ColorOverlay => Some(read::solid(d)),
                    Kind::GradientOverlay => Some(read::gradient(d)),
                    _ => read::pattern(d),
                };
                fill.is_some_and(|fill| read::overlay(d, fill) == **o)
            }
            Entry::Stroke(s) => read::stroke(d) == **s,
        }
    }

    fn put(&self, d: &mut Descriptor) {
        match self {
            Entry::Shadow(s, drop) => write::shadow(d, s, *drop),
            Entry::Glow(g, inner) => write::glow(d, g, *inner),
            Entry::Bevel(b) => write::bevel(d, b),
            Entry::Satin(s) => write::satin(d, s),
            Entry::Overlay(o, _) => write::overlay(d, o),
            Entry::Stroke(s) => write::stroke(d, s),
        }
    }

    fn enabled(&self) -> bool {
        match self {
            Entry::Shadow(s, _) => s.enabled,
            Entry::Glow(g, _) => g.enabled,
            Entry::Bevel(b) => b.enabled,
            Entry::Satin(s) => s.enabled,
            Entry::Overlay(o, _) => o.enabled,
            Entry::Stroke(s) => s.enabled,
        }
    }
}

/// The model's effects of a kind (one at most for kinds a layer has one
/// of).
fn model_entries(fx: &Effects, kind: Kind) -> Vec<Entry<'_>> {
    let mut out: Vec<Entry<'_>> = match kind {
        Kind::DropShadow => fx
            .drop_shadows
            .iter()
            .map(|s| Entry::Shadow(s, true))
            .collect(),
        Kind::InnerShadow => fx
            .inner_shadows
            .iter()
            .map(|s| Entry::Shadow(s, false))
            .collect(),
        Kind::OuterGlow => fx
            .outer_glows
            .iter()
            .map(|g| Entry::Glow(g, false))
            .collect(),
        Kind::InnerGlow => fx
            .inner_glows
            .iter()
            .map(|g| Entry::Glow(g, true))
            .collect(),
        Kind::Bevel => fx.bevels.iter().map(Entry::Bevel).collect(),
        Kind::Satin => fx.satins.iter().map(Entry::Satin).collect(),
        Kind::ColorOverlay | Kind::GradientOverlay | Kind::PatternOverlay => {
            let list = match kind {
                Kind::ColorOverlay => &fx.color_overlays,
                Kind::GradientOverlay => &fx.gradient_overlays,
                _ => &fx.pattern_overlays,
            };
            list.iter().map(|o| Entry::Overlay(o, kind)).collect()
        }
        Kind::Stroke => fx.strokes.iter().map(Entry::Stroke).collect(),
    };
    if kind.multi_key().is_none() {
        out.truncate(1);
    }
    out
}

/// Puts a top-level item: in place of `key` or `other` (the kind's other
/// form) when there is one, else where Photoshop orders it.
fn place(d: &mut Descriptor, key: &str, other: Option<&str>, value: Value) {
    if d.has(key) {
        d.set(key, value);
        return;
    }
    if let Some(other) = other
        && let Some(item) = d.items.iter_mut().find(|(k, _)| k == other)
    {
        *item = (Id::new(key), value);
        return;
    }
    let order = top_order(key).unwrap_or(usize::MAX);
    let at = d
        .items
        .iter()
        .rposition(|(k, _)| top_order(k).is_some_and(|o| o < order))
        .map_or(0, |i| i + 1);
    d.items.insert(at, (Id::new(key), value));
}

/// Writes a kind's effects into a style descriptor: present effects are
/// updated in order, placeholders stay, more effects are added, fewer are
/// dropped; several, or any in a newer style, are listed. Returns how many
/// enabled effects it wrote.
fn write_kind(d: &mut Descriptor, kind: Kind, fx: &Effects, listed_style: bool) -> usize {
    let models = model_entries(fx, kind);
    let (mut existing, form) = entries(d, kind);
    // A lone placeholder takes the first effect.
    if form == Form::Single && !models.is_empty() && !is_present(&existing[0]) {
        existing[0].set("present", Value::Bool(true));
    }
    let mut next = models.iter();
    let mut out = Vec::new();
    for mut e in existing {
        if !is_present(&e) {
            out.push(e);
        } else if let Some(m) = next.next() {
            if !m.matches(&e) {
                m.put(&mut e);
            }
            out.push(e);
        }
    }
    for m in next {
        let mut e = write::fresh(kind.key());
        m.put(&mut e);
        out.push(e);
    }
    let multi = kind
        .multi_key()
        .filter(|_| form == Form::Multi || out.len() > 1 || (form == Form::Absent && listed_style));
    match (multi, out.len()) {
        (Some(list_key), _) if !out.is_empty() || form == Form::Multi => {
            let list = out.into_iter().map(Value::Descriptor).collect();
            place(d, list_key, Some(kind.key()), Value::List(list));
        }
        (None, 1) => {
            let one = out.into_iter().next().map(Value::Descriptor);
            if let Some(one) = one {
                place(d, kind.key(), kind.multi_key(), one);
            }
        }
        _ => {
            if form == Form::Single {
                d.remove(kind.key());
            }
        }
    }
    models.iter().filter(|m| m.enabled()).count()
}

/// Writes effects as an `lfx2` block (single instances) or an `lmfx` block
/// (several of one effect): returns the key and data. Starts from the
/// `original` block's data when there is one, keeping the items and
/// placeholder effects the model does not cover (and returning it as it
/// was when the effects are unchanged).
pub fn encode(effects: &Effects, original: Option<&[u8]>) -> ([u8; 4], Vec<u8>) {
    let several = Kind::ALL
        .iter()
        .filter(|k| k.multi_key().is_some())
        .any(|&k| model_entries(effects, k).len() > 1);
    let key = if several { *b"lmfx" } else { *b"lfx2" };
    let parsed = original.and_then(|data| Some((data, read_block(data).ok()?)));
    let (version, mut d, fresh) = match parsed {
        Some((data, (_, d, used))) if from_descriptor(&d) == *effects => {
            return (key, data[..used].to_vec());
        }
        Some((_, (version, d, _))) => (version, d, false),
        None => (
            0,
            Descriptor::new("null")
                .with("Scl ", paint::percent_value(1.0))
                .with("masterFXSwitch", Value::Bool(true)),
            true,
        ),
    };
    let listed_style = several
        || Kind::ALL
            .iter()
            .any(|k| k.multi_key().is_some_and(|m| d.has(m)));
    paint::put_percent(&mut d, "Scl ", effects.scale);
    paint::put_bool(&mut d, "masterFXSwitch", effects.enabled);
    let mut enabled = 0;
    for kind in Kind::ALL {
        enabled += write_kind(&mut d, kind, effects, listed_style);
    }
    if d.has("numModifyingFX") || (fresh && several) {
        place(
            &mut d,
            "numModifyingFX",
            None,
            Value::Integer(enabled.min(i32::MAX as usize) as i32),
        );
    }
    let mut w = Writer::new();
    w.u32(version);
    w.bytes(&descriptor::write_versioned(&d));
    (key, w.into_bytes())
}

#[cfg(test)]
mod test;
