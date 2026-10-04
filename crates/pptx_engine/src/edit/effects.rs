//! Shape effects (`a:effectLst` in `spPr`, and in `a:rPr` for text): the
//! shadow, glow, soft edge, and reflection galleries of PowerPoint's Shape
//! Effects menu, written in schema order, and read back for the outline.
//!
//! An explicit effect list replaces the one a shape inherits (from a layout
//! placeholder or the theme's effect style), so a shape without a list of
//! its own first gets a copy of the inherited one, as PowerPoint does; an
//! emptied list stays (empty) only while it overrides an inherited one.

use super::ops::{EffectSpec, GlowOptions, ReflectionOptions, ShadowOptions, SoftEdgeOptions};
use super::shapes::find;
use super::xmlutil::{R_PR_ORDER, SP_PR_ORDER, color_element, ensure_sp_pr};
use crate::error::{Error, Result};
use crate::inspect::{
    EffectsOutline, GlowOutline, ReflectionOutline, ShadowOutline, SoftEdgeOutline,
};
use crate::model::color::{Rgba, is_color_element};
use crate::model::fill::{Effects, Reflection, Shadow};
use crate::model::presentation::Presentation;
use crate::model::shape::{Inherit, placeholder_chain};
use crate::units::{EMU_PER_PT, pt_to_emu};
use crate::xml::{NodeId, Ns, XmlDoc};
use std::sync::Arc;

/// Child order of `a:effectLst`.
const EFFECT_LST_ORDER: &[&str] = &[
    "blur",
    "fillOverlay",
    "glow",
    "innerShdw",
    "outerShdw",
    "prstShdw",
    "reflection",
    "softEdge",
];
/// The shadow elements; a shape gets at most one of them.
const SHADOWS: &[&str] = &["innerShdw", "outerShdw", "prstShdw"];
/// Color modifiers that set opacity.
const ALPHA_MODIFIERS: &[&str] = &["alpha", "alphaMod", "alphaOff"];

/// A shadow of PowerPoint's Shadow gallery (black, with this opacity).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ShadowPreset {
    /// Name `setShapeEffects` takes.
    pub name: &'static str,
    /// Inner (`innerShdw`) rather than outer (`outerShdw`).
    pub inner: bool,
    /// Blur radius (points).
    pub blur: f64,
    /// Distance (points).
    pub dist: f64,
    /// Direction (degrees clockwise from the right).
    pub dir: f64,
    /// Horizontal scale (percent).
    pub sx: f64,
    /// Vertical scale (percent; negative flips the shadow below the shape).
    pub sy: f64,
    /// Horizontal skew (degrees).
    pub kx: f64,
    /// The point of the shape the shadow scales and skews about.
    pub align: &'static str,
    /// Opacity of the black shadow.
    pub alpha: f64,
}

const fn outer(name: &'static str, dir: f64, align: &'static str) -> ShadowPreset {
    ShadowPreset {
        name,
        inner: false,
        blur: 4.0,
        dist: 3.0,
        dir,
        sx: 100.0,
        sy: 100.0,
        kx: 0.0,
        align,
        alpha: 0.4,
    }
}

const fn inner(name: &'static str, dir: f64) -> ShadowPreset {
    ShadowPreset {
        name,
        inner: true,
        blur: 5.0,
        dist: 4.0,
        dir,
        sx: 100.0,
        sy: 100.0,
        kx: 0.0,
        align: "ctr",
        alpha: 0.5,
    }
}

const fn perspective(
    name: &'static str,
    (blur, dist, dir): (f64, f64, f64),
    (sx, sy, kx): (f64, f64, f64),
    align: &'static str,
    alpha: f64,
) -> ShadowPreset {
    ShadowPreset {
        name,
        inner: false,
        blur,
        dist,
        dir,
        sx,
        sy,
        kx,
        align,
        alpha,
    }
}

/// PowerPoint's Shadow gallery: Outer, Inner, and Perspective.
pub(crate) const SHADOW_PRESETS: &[ShadowPreset] = &[
    outer("outerBottomRight", 45.0, "tl"),
    outer("outerBottom", 90.0, "t"),
    outer("outerBottomLeft", 135.0, "tr"),
    outer("outerRight", 0.0, "l"),
    ShadowPreset {
        blur: 5.0,
        dist: 0.0,
        sx: 102.0,
        sy: 102.0,
        ..outer("outerCenter", 0.0, "ctr")
    },
    outer("outerLeft", 180.0, "r"),
    outer("outerTopRight", 315.0, "bl"),
    outer("outerTop", 270.0, "b"),
    outer("outerTopLeft", 225.0, "br"),
    // Inner shadows are named for the edges they shade, which face away
    // from the direction they are offset in.
    inner("innerTopLeft", 45.0),
    inner("innerTop", 90.0),
    inner("innerTopRight", 135.0),
    inner("innerLeft", 0.0),
    ShadowPreset {
        blur: 9.0,
        dist: 0.0,
        alpha: 1.0,
        ..inner("innerCenter", 0.0)
    },
    inner("innerRight", 180.0),
    inner("innerBottomLeft", 315.0),
    inner("innerBottom", 270.0),
    inner("innerBottomRight", 225.0),
    perspective(
        "perspectiveUpperLeft",
        (6.0, 0.0, 225.0),
        (100.0, 23.0, 20.0),
        "br",
        0.2,
    ),
    perspective(
        "perspectiveUpperRight",
        (6.0, 0.0, 315.0),
        (100.0, 23.0, -20.0),
        "bl",
        0.2,
    ),
    perspective(
        "perspectiveBelow",
        (12.0, 25.0, 90.0),
        (90.0, -19.0, 0.0),
        "b",
        0.15,
    ),
    perspective(
        "perspectiveLowerLeft",
        (6.0, 1.0, 135.0),
        (100.0, -23.0, 13.34),
        "bl",
        0.2,
    ),
    perspective(
        "perspectiveLowerRight",
        (6.0, 1.0, 45.0),
        (100.0, -23.0, -13.34),
        "br",
        0.2,
    ),
];

/// The shadow options start from when the shape has none.
const DEFAULT_SHADOW: &str = "outerBottomRight";

/// A reflection of PowerPoint's Reflection gallery.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ReflectionPreset {
    /// Name `setShapeEffects` takes.
    pub name: &'static str,
    /// How much of the shape is reflected (percent of its height).
    pub size: f64,
    /// Gap below the shape (points).
    pub dist: f64,
}

/// PowerPoint's Reflection gallery: tight, half, and full reflections,
/// touching or 4 or 8 pt away. All start 50% opaque with a 0.5 pt blur.
pub(crate) const REFLECTION_PRESETS: &[ReflectionPreset] = &[
    reflection("tightTouching", 35.0, 0.0),
    reflection("halfTouching", 55.0, 0.0),
    reflection("fullTouching", 90.0, 0.0),
    reflection("tight4pt", 35.0, 4.0),
    reflection("half4pt", 55.0, 4.0),
    reflection("full4pt", 90.0, 4.0),
    reflection("tight8pt", 35.0, 8.0),
    reflection("half8pt", 55.0, 8.0),
    reflection("full8pt", 90.0, 8.0),
];

const fn reflection(name: &'static str, size: f64, dist: f64) -> ReflectionPreset {
    ReflectionPreset { name, size, dist }
}

/// Blur of the gallery reflections (points).
const REFLECTION_BLUR: f64 = 0.5;
/// Opacity where the gallery reflections start and end.
const REFLECTION_START_ALPHA: f64 = 0.5;
const REFLECTION_END_ALPHA: f64 = 0.003;
/// The reflection options start from when the shape has none.
const DEFAULT_REFLECTION: &str = "tightTouching";
/// A new glow: color, size (points), transparency.
const DEFAULT_GLOW: (&str, f32, f32) = ("accent1", 10.0, 0.6);
/// A new soft edge's size (points).
const DEFAULT_SOFT_EDGE: f32 = 5.0;
/// PowerPoint saturates theme glow colors by this much (`satMod`).
const GLOW_SATURATION: &str = "175000";

/// The effects a `setShapeEffects` operation (or a text format) changes.
#[derive(Clone, Copy, Default)]
pub(super) struct EffectsPatch<'a> {
    pub shadow: Option<&'a EffectSpec<ShadowOptions>>,
    pub glow: Option<&'a EffectSpec<GlowOptions>>,
    pub soft_edge: Option<&'a EffectSpec<SoftEdgeOptions>>,
    pub reflection: Option<&'a EffectSpec<ReflectionOptions>>,
}

impl EffectsPatch<'_> {
    /// Whether the patch keeps every effect.
    fn is_empty(&self) -> bool {
        self.shadow.is_none()
            && self.glow.is_none()
            && self.soft_edge.is_none()
            && self.reflection.is_none()
    }
}

/// Sets effects on shapes of a slide.
pub(super) fn set_shape_effects(
    pres: &mut Presentation,
    slide: u32,
    shapes: &[u32],
    patch: &EffectsPatch<'_>,
) -> Result<()> {
    if shapes.is_empty() {
        return Err(Error::InvalidEdit(
            "setShapeEffects needs at least one shape".into(),
        ));
    }
    let part = pres.slide_part(slide)?;
    for &id in shapes {
        let inherited = inherited_list(pres, &part, id)?;
        let doc = pres.xml_mut(&part)?;
        let node = find(doc, id)?;
        if doc.local(node) == "graphicFrame" {
            return Err(Error::InvalidEdit(format!(
                "shape {id} is a table, chart, or other graphic frame, which has no shape effects"
            )));
        }
        if patch.is_empty() {
            continue;
        }
        let sp_pr = ensure_sp_pr(doc, node);
        let existing = doc.child(sp_pr, Ns::A, "effectLst");
        let lst = match existing {
            Some(l) => l,
            None => {
                doc.remove_children_named(sp_pr, Ns::A, "effectDag");
                let lst = match &inherited {
                    Some((src, list)) => import_inherited(doc, node, src, *list),
                    None => doc.create_element(Ns::A, "effectLst"),
                };
                doc.insert_in_order(sp_pr, lst, SP_PR_ORDER);
                lst
            }
        };
        patch_list(doc, lst, patch)?;
        if doc.first_child(lst).is_none() && inherited.is_none() {
            doc.detach(lst);
        }
    }
    Ok(())
}

/// Applies a text shadow or glow to a run's properties (`a:rPr`).
pub(super) fn patch_run_effects(
    doc: &mut XmlDoc,
    rpr: NodeId,
    shadow: Option<&EffectSpec<ShadowOptions>>,
    glow: Option<&EffectSpec<GlowOptions>>,
) -> Result<()> {
    if shadow.is_none() && glow.is_none() {
        return Ok(());
    }
    let existing = doc.child(rpr, Ns::A, "effectLst");
    let lst = match existing {
        Some(l) => l,
        None => {
            doc.remove_children_named(rpr, Ns::A, "effectDag");
            doc.ensure_child(rpr, Ns::A, "effectLst", R_PR_ORDER)
        }
    };
    let patch = EffectsPatch {
        shadow,
        glow,
        ..EffectsPatch::default()
    };
    patch_list(doc, lst, &patch)?;
    if existing.is_none() && doc.first_child(lst).is_none() {
        doc.detach(lst);
    }
    Ok(())
}

/// The effect list a shape inherits (ignoring its own): a layout or master
/// placeholder's, else the theme effect style its `p:style` refers to.
/// Lists without effects count as none.
fn inherited_list(
    pres: &mut Presentation,
    part: &str,
    shape: u32,
) -> Result<Option<(Arc<XmlDoc>, NodeId)>> {
    let slide = pres.part(part)?;
    let node = find(&slide.doc, shape)?;
    let ctx = pres.context_for(slide.clone(), 1)?;
    for (p, n) in placeholder_chain(&ctx, &slide, node, Inherit::Slide)
        .iter()
        .skip(1)
    {
        let list = sp_pr(&p.doc, *n).and_then(|s| p.doc.child(s, Ns::A, "effectLst"));
        if let Some(list) = list {
            let has_effects = p.doc.first_child(list).is_some();
            return Ok(has_effects.then(|| (Arc::clone(&p.doc), list)));
        }
    }
    let doc = &slide.doc;
    let Some(effect_ref) = doc
        .children(node)
        .find(|&c| doc.local(c) == "style")
        .and_then(|s| doc.child(s, Ns::A, "effectRef"))
    else {
        return Ok(None);
    };
    let idx = doc.attr_i64(effect_ref, "idx").unwrap_or(0).max(0) as u32;
    let theme = &ctx.theme;
    let list = theme
        .effect_style(idx)
        .and_then(|s| theme.doc.child(s, Ns::A, "effectLst"))
        .filter(|&l| theme.doc.first_child(l).is_some());
    Ok(list.map(|l| (Arc::clone(&theme.doc), l)))
}

fn sp_pr(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    doc.children(shape)
        .find(|&c| matches!(doc.local(c), "spPr" | "grpSpPr"))
}

/// Copies an inherited effect list into the shape's part, giving style
/// placeholder colors (`phClr`) the color of the shape's `a:effectRef`.
fn import_inherited(doc: &mut XmlDoc, shape: NodeId, src: &XmlDoc, list: NodeId) -> NodeId {
    let copy = doc.import(src, list);
    let style_color = doc
        .children(shape)
        .find(|&c| doc.local(c) == "style")
        .and_then(|s| doc.child(s, Ns::A, "effectRef"))
        .and_then(|r| doc.children(r).find(|&c| is_color_element(doc, c)));
    let placeholders: Vec<NodeId> = doc
        .descendants(copy)
        .into_iter()
        .filter(|&n| doc.is(n, Ns::A, "schemeClr") && doc.attr(n, "val") == Some("phClr"))
        .collect();
    for ph in placeholders {
        let color = match style_color {
            Some(c) => doc.deep_clone(c),
            None => black(doc),
        };
        // The placeholder's own modifiers apply after the style color's.
        for modifier in doc.children(ph).collect::<Vec<_>>() {
            doc.append_child(color, modifier);
        }
        doc.insert_before(ph, color);
        doc.detach(ph);
    }
    copy
}

/// Applies a patch to an `a:effectLst`.
fn patch_list(doc: &mut XmlDoc, list: NodeId, patch: &EffectsPatch<'_>) -> Result<()> {
    if let Some(spec) = patch.shadow {
        apply_shadow(doc, list, spec)?;
    }
    if let Some(spec) = patch.glow {
        apply_glow(doc, list, spec)?;
    }
    if let Some(spec) = patch.soft_edge {
        apply_soft_edge(doc, list, spec)?;
    }
    if let Some(spec) = patch.reflection {
        apply_reflection(doc, list, spec)?;
    }
    Ok(())
}

fn remove_all(doc: &mut XmlDoc, list: NodeId, names: &[&str]) {
    let doomed: Vec<NodeId> = doc
        .children(list)
        .filter(|&c| doc.ns(c) == Ns::A && names.contains(&doc.local(c)))
        .collect();
    for d in doomed {
        doc.detach(d);
    }
}

fn find_effect(doc: &XmlDoc, list: NodeId, names: &[&str]) -> Option<NodeId> {
    doc.children(list)
        .find(|&c| doc.ns(c) == Ns::A && names.contains(&doc.local(c)))
}

fn shadow_preset(name: &str) -> Result<&'static ShadowPreset> {
    SHADOW_PRESETS
        .iter()
        .find(|p| p.name == name)
        .ok_or_else(|| {
            let names: Vec<&str> = SHADOW_PRESETS.iter().map(|p| p.name).collect();
            Error::InvalidEdit(format!(
                "unknown shadow `{name}` (use none, {})",
                names.join(", ")
            ))
        })
}

fn reflection_preset(name: &str) -> Result<&'static ReflectionPreset> {
    REFLECTION_PRESETS
        .iter()
        .find(|p| p.name == name)
        .ok_or_else(|| {
            let names: Vec<&str> = REFLECTION_PRESETS.iter().map(|p| p.name).collect();
            Error::InvalidEdit(format!(
                "unknown reflection `{name}` (use none, {})",
                names.join(", ")
            ))
        })
}

/// Checks that an option is a finite number in `range`.
fn check(name: &str, value: Option<f32>, range: std::ops::RangeInclusive<f32>) -> Result<()> {
    match value {
        Some(v) if !v.is_finite() || !range.contains(&v) => Err(Error::InvalidEdit(format!(
            "{name} {v} is out of range ({} to {})",
            range.start(),
            range.end()
        ))),
        _ => Ok(()),
    }
}

fn set_emu(doc: &mut XmlDoc, el: NodeId, attr: &str, pt: f64) {
    doc.set_attr(el, attr, &pt_to_emu(pt).to_string());
}

/// An angle attribute (60000ths of a degree, `0..21600000`).
fn set_angle(doc: &mut XmlDoc, el: NodeId, attr: &str, degrees: f64) {
    let v = (degrees.rem_euclid(360.0) * 60_000.0).round() as i64 % 21_600_000;
    doc.set_attr(el, attr, &v.to_string());
}

/// A percentage attribute (1000ths of a percent).
fn set_pct(doc: &mut XmlDoc, el: NodeId, attr: &str, pct: f64) {
    doc.set_attr(el, attr, &((pct * 1000.0).round() as i64).to_string());
}

/// Sets the color of an effect element and/or its transparency. A new color
/// keeps the old color's transparency unless one is given.
fn set_effect_color(
    doc: &mut XmlDoc,
    el: NodeId,
    color: Option<&str>,
    transparency: Option<f32>,
    saturate_theme: bool,
) -> Result<()> {
    let old = doc.children(el).find(|&c| is_color_element(doc, c));
    let old_alpha = old
        .and_then(|c| doc.child(c, Ns::A, "alpha"))
        .and_then(|a| doc.attr_f64(a, "val"))
        .map(|v| v / 100_000.0);
    let target = match color {
        Some(c) => {
            let new = color_element(doc, c, None)?;
            if saturate_theme && doc.local(new) == "schemeClr" {
                let sat = doc.create_element(Ns::A, "satMod");
                doc.set_attr(sat, "val", GLOW_SATURATION);
                doc.append_child(new, sat);
            }
            match old {
                Some(o) => {
                    doc.insert_before(o, new);
                    doc.detach(o);
                }
                None => doc.append_child(el, new),
            }
            new
        }
        None => match old {
            Some(o) => o,
            None => {
                let c = black(doc);
                doc.append_child(el, c);
                c
            }
        },
    };
    let alpha = match (transparency, color) {
        (Some(t), _) => Some(1.0 - f64::from(t)),
        (None, Some(_)) => old_alpha,
        (None, None) => return Ok(()),
    };
    for name in ALPHA_MODIFIERS {
        doc.remove_children_named(target, Ns::A, name);
    }
    if let Some(a) = alpha {
        append_alpha(doc, target, a);
    }
    Ok(())
}

/// PowerPoint's shadow color, `black` (detached).
fn black(doc: &mut XmlDoc) -> NodeId {
    let el = doc.create_element(Ns::A, "prstClr");
    doc.set_attr(el, "val", "black");
    el
}

/// Gives a color element an opacity (`a:alpha`) unless it is opaque.
fn append_alpha(doc: &mut XmlDoc, color: NodeId, alpha: f64) {
    if alpha < 1.0 - 1e-6 {
        let node = doc.create_element(Ns::A, "alpha");
        let val = (alpha.max(0.0) * 100_000.0).round() as i64;
        doc.set_attr(node, "val", &val.to_string());
        doc.append_child(color, node);
    }
}

/// A gallery shadow element.
fn shadow_element(doc: &mut XmlDoc, p: &ShadowPreset) -> NodeId {
    let el = doc.create_element(Ns::A, if p.inner { "innerShdw" } else { "outerShdw" });
    set_emu(doc, el, "blurRad", p.blur);
    if p.dist > 0.0 {
        set_emu(doc, el, "dist", p.dist);
        set_angle(doc, el, "dir", p.dir);
    }
    if !p.inner {
        if p.sx != 100.0 {
            set_pct(doc, el, "sx", p.sx);
        }
        if p.sy != 100.0 {
            set_pct(doc, el, "sy", p.sy);
        }
        if p.kx != 0.0 {
            // A skew is a signed angle (ST_FixedAngle, -90° to 90°).
            doc.set_attr(el, "kx", &((p.kx * 60_000.0).round() as i64).to_string());
        }
        doc.set_attr(el, "algn", p.align);
        doc.set_attr(el, "rotWithShape", "0");
    }
    let color = black(doc);
    append_alpha(doc, color, p.alpha);
    doc.append_child(el, color);
    el
}

fn apply_shadow(doc: &mut XmlDoc, list: NodeId, spec: &EffectSpec<ShadowOptions>) -> Result<()> {
    let o = match spec {
        EffectSpec::Preset(name) => {
            let name = name.trim();
            remove_all(doc, list, SHADOWS);
            if name != "none" {
                let el = shadow_element(doc, shadow_preset(name)?);
                doc.insert_in_order(list, el, EFFECT_LST_ORDER);
            }
            return Ok(());
        }
        EffectSpec::Options(o) => o,
    };
    check("shadow transparency", o.transparency, 0.0..=1.0)?;
    check("shadow size", o.size_pct, 1.0..=200.0)?;
    check("shadow blur", o.blur_pt, 0.0..=100.0)?;
    check("shadow distance", o.distance_pt, 0.0..=200.0)?;
    check("shadow angle", o.angle_deg, -3600.0..=3600.0)?;
    let current = find_effect(doc, list, SHADOWS).filter(|&c| doc.local(c) != "prstShdw");
    let el = match (o.preset.as_deref().map(str::trim), current) {
        (Some("none"), _) => {
            return Err(Error::InvalidEdit(
                "to remove a shadow, pass \"none\" instead of options".into(),
            ));
        }
        (None, Some(c)) => c,
        (name, _) => {
            let preset = shadow_preset(name.unwrap_or(DEFAULT_SHADOW))?;
            remove_all(doc, list, SHADOWS);
            let el = shadow_element(doc, preset);
            doc.insert_in_order(list, el, EFFECT_LST_ORDER);
            el
        }
    };
    if let Some(b) = o.blur_pt {
        set_emu(doc, el, "blurRad", f64::from(b));
    }
    if let Some(d) = o.distance_pt {
        set_emu(doc, el, "dist", f64::from(d));
    }
    if let Some(a) = o.angle_deg {
        set_angle(doc, el, "dir", f64::from(a));
    }
    if let Some(size) = o.size_pct {
        if doc.local(el) == "innerShdw" {
            return Err(Error::InvalidEdit("inner shadows have no size".into()));
        }
        let sx = doc.attr_f64(el, "sx").unwrap_or(100_000.0);
        let sy = doc.attr_f64(el, "sy").unwrap_or(100_000.0);
        // A perspective shadow keeps its squash and flip.
        let ratio = if sx == 0.0 { 1.0 } else { sy / sx };
        set_pct(doc, el, "sx", f64::from(size));
        set_pct(doc, el, "sy", f64::from(size) * ratio);
    }
    set_effect_color(doc, el, o.color.as_deref(), o.transparency, false)
}

fn apply_glow(doc: &mut XmlDoc, list: NodeId, spec: &EffectSpec<GlowOptions>) -> Result<()> {
    let o = match spec {
        EffectSpec::Preset(name) if name.trim() == "none" => {
            remove_all(doc, list, &["glow"]);
            return Ok(());
        }
        EffectSpec::Preset(name) => {
            return Err(Error::InvalidEdit(format!(
                "unknown glow `{name}` (use none, or options with color, sizePt, and transparency)"
            )));
        }
        EffectSpec::Options(o) => o,
    };
    check("glow transparency", o.transparency, 0.0..=1.0)?;
    check("glow size", o.size_pt, 0.0..=150.0)?;
    if o.size_pt == Some(0.0) {
        remove_all(doc, list, &["glow"]);
        return Ok(());
    }
    let el = match find_effect(doc, list, &["glow"]) {
        Some(g) => g,
        None => {
            let (color, size, transparency) = DEFAULT_GLOW;
            let g = doc.create_element(Ns::A, "glow");
            set_emu(doc, g, "rad", f64::from(size));
            set_effect_color(doc, g, Some(color), Some(transparency), true)?;
            doc.insert_in_order(list, g, EFFECT_LST_ORDER);
            g
        }
    };
    if let Some(s) = o.size_pt {
        set_emu(doc, el, "rad", f64::from(s));
    }
    set_effect_color(doc, el, o.color.as_deref(), o.transparency, true)
}

fn apply_soft_edge(
    doc: &mut XmlDoc,
    list: NodeId,
    spec: &EffectSpec<SoftEdgeOptions>,
) -> Result<()> {
    let size = match spec {
        EffectSpec::Preset(name) if name.trim() == "none" => None,
        EffectSpec::Preset(name) => {
            return Err(Error::InvalidEdit(format!(
                "unknown soft edge `{name}` (use none, or options with sizePt)"
            )));
        }
        EffectSpec::Options(o) => {
            check("soft edge size", o.size_pt, 0.0..=100.0)?;
            let current = find_effect(doc, list, &["softEdge"])
                .and_then(|e| doc.attr_f64(e, "rad"))
                .map(|emu| (emu / EMU_PER_PT) as f32);
            match o.size_pt.or(current).unwrap_or(DEFAULT_SOFT_EDGE) {
                s if s > 0.0 => Some(s),
                _ => None,
            }
        }
    };
    let Some(size) = size else {
        remove_all(doc, list, &["softEdge"]);
        return Ok(());
    };
    let el = match find_effect(doc, list, &["softEdge"]) {
        Some(e) => e,
        None => {
            let e = doc.create_element(Ns::A, "softEdge");
            doc.insert_in_order(list, e, EFFECT_LST_ORDER);
            e
        }
    };
    set_emu(doc, el, "rad", f64::from(size));
    Ok(())
}

/// A gallery reflection element.
fn reflection_element(doc: &mut XmlDoc, p: &ReflectionPreset) -> NodeId {
    let el = doc.create_element(Ns::A, "reflection");
    set_emu(doc, el, "blurRad", REFLECTION_BLUR);
    set_pct(doc, el, "stA", REFLECTION_START_ALPHA * 100.0);
    set_pct(doc, el, "endA", REFLECTION_END_ALPHA * 100.0);
    set_pct(doc, el, "endPos", p.size);
    set_emu(doc, el, "dist", p.dist);
    set_angle(doc, el, "dir", 90.0);
    set_pct(doc, el, "sy", -100.0);
    doc.set_attr(el, "algn", "bl");
    doc.set_attr(el, "rotWithShape", "0");
    el
}

fn apply_reflection(
    doc: &mut XmlDoc,
    list: NodeId,
    spec: &EffectSpec<ReflectionOptions>,
) -> Result<()> {
    let o = match spec {
        EffectSpec::Preset(name) => {
            let name = name.trim();
            remove_all(doc, list, &["reflection"]);
            if name != "none" {
                let el = reflection_element(doc, reflection_preset(name)?);
                doc.insert_in_order(list, el, EFFECT_LST_ORDER);
            }
            return Ok(());
        }
        EffectSpec::Options(o) => o,
    };
    check("reflection transparency", o.transparency, 0.0..=1.0)?;
    check("reflection size", o.size_pct, 1.0..=100.0)?;
    check("reflection distance", o.distance_pt, 0.0..=100.0)?;
    check("reflection blur", o.blur_pt, 0.0..=100.0)?;
    let current = find_effect(doc, list, &["reflection"]);
    let el = match (o.preset.as_deref().map(str::trim), current) {
        (Some("none"), _) => {
            return Err(Error::InvalidEdit(
                "to remove a reflection, pass \"none\" instead of options".into(),
            ));
        }
        (None, Some(c)) => c,
        (name, _) => {
            let preset = reflection_preset(name.unwrap_or(DEFAULT_REFLECTION))?;
            remove_all(doc, list, &["reflection"]);
            let el = reflection_element(doc, preset);
            doc.insert_in_order(list, el, EFFECT_LST_ORDER);
            el
        }
    };
    if let Some(t) = o.transparency {
        set_pct(doc, el, "stA", (1.0 - f64::from(t)) * 100.0);
    }
    if let Some(s) = o.size_pct {
        set_pct(doc, el, "endPos", f64::from(s));
    }
    if let Some(d) = o.distance_pt {
        set_emu(doc, el, "dist", f64::from(d));
    }
    if let Some(b) = o.blur_pt {
        set_emu(doc, el, "blurRad", f64::from(b));
    }
    Ok(())
}

// ---- reading -------------------------------------------------------------

/// The outline of resolved effects; `inherited` when the shape has no effect
/// list of its own.
pub(crate) fn outline(fx: &Effects, inherited: bool) -> Option<EffectsOutline> {
    if fx.is_empty() {
        return None;
    }
    let shadow = fx
        .outer_shadow
        .as_ref()
        .map(|s| shadow_outline(s, false))
        .or_else(|| fx.inner_shadow.as_ref().map(|s| shadow_outline(s, true)));
    Some(EffectsOutline {
        shadow,
        glow: fx.glow.as_ref().map(|g| GlowOutline {
            color: hex(g.color),
            transparency: round(1.0 - g.color.a),
            size_pt: round(g.radius),
        }),
        soft_edge: fx.soft_edge.map(|r| SoftEdgeOutline { size_pt: round(r) }),
        reflection: fx.reflection.as_ref().map(reflection_outline),
        inherited,
    })
}

/// Whether a shape element carries an effect list (or DAG) of its own.
pub(crate) fn has_own_effects(doc: &XmlDoc, shape: NodeId) -> bool {
    sp_pr(doc, shape).is_some_and(|s| {
        doc.child(s, Ns::A, "effectLst").is_some() || doc.child(s, Ns::A, "effectDag").is_some()
    })
}

fn hex(c: Rgba) -> String {
    format!("#{}", c.to_hex())
}

/// Rounds a reported value to 1/1000 (what the XML stores and less).
fn round(v: f32) -> f32 {
    (v * 1000.0).round() / 1000.0
}

fn shadow_outline(s: &Shadow, inner: bool) -> ShadowOutline {
    let near = |a: f64, b: f32, tol: f64| (a - f64::from(b)).abs() <= tol;
    let black = s.color.r < 0.01 && s.color.g < 0.01 && s.color.b < 0.01;
    let angle_matches = |p: &ShadowPreset| {
        p.dist == 0.0 || {
            let d = (p.dir - f64::from(s.dir)).rem_euclid(360.0);
            d.min(360.0 - d) <= 0.5
        }
    };
    let preset = SHADOW_PRESETS
        .iter()
        .find(|p| {
            p.inner == inner
                && black
                && near(p.blur, s.blur, 0.05)
                && near(p.dist, s.dist, 0.05)
                && angle_matches(p)
                && (inner || near(p.sx / 100.0, s.sx, 0.005) && near(p.sy / 100.0, s.sy, 0.005))
                && (inner || {
                    let d = (p.kx - f64::from(s.kx)).rem_euclid(360.0);
                    d.min(360.0 - d) <= 0.5
                })
                && near(p.alpha, s.color.a, 0.01)
        })
        .map(|p| p.name);
    ShadowOutline {
        kind: if inner { "inner" } else { "outer" },
        preset,
        color: hex(s.color),
        transparency: round(1.0 - s.color.a),
        size_pct: if inner { 100.0 } else { round(s.sx * 100.0) },
        blur_pt: round(s.blur),
        distance_pt: round(s.dist),
        angle_deg: round(s.dir.rem_euclid(360.0)),
    }
}

fn reflection_outline(r: &Reflection) -> ReflectionOutline {
    let near = |a: f64, b: f32, tol: f64| (a - f64::from(b)).abs() <= tol;
    let preset = REFLECTION_PRESETS
        .iter()
        .find(|p| {
            near(REFLECTION_BLUR, r.blur, 0.05)
                && near(REFLECTION_START_ALPHA, r.start_alpha, 0.01)
                && near(p.size / 100.0, r.end_pos, 0.005)
                && near(p.dist, r.dist, 0.05)
        })
        .map(|p| p.name);
    ReflectionOutline {
        preset,
        transparency: round(1.0 - r.start_alpha),
        size_pct: round(r.end_pos * 100.0),
        distance_pt: round(r.dist),
        blur_pt: round(r.blur),
    }
}

#[cfg(test)]
mod test;
