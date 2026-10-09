//! The model to effect descriptors: each effect is written into its
//! descriptor (an existing one, keeping the items the model does not
//! cover, or a new one with Photoshop's items in its order), changing only
//! the items whose values differ.

use super::read::{BEVEL_STYLES, BEVEL_TECHNIQUES, STROKE_POSITIONS, id_of};
use crate::codec::descriptor::{Descriptor, Value};
use crate::codec::paint::{self, color};
use crate::model::{
    Bevel, Fill, Glow, GlowSource, GlowTechnique, Overlay, Rgb, Satin, Shadow, StrokeEffect,
};

/// The items of a new effect descriptor, in Photoshop's order.
pub(super) fn items(class: &str) -> &'static [&'static str] {
    const LEAD: [&str; 3] = ["enab", "present", "showInDialog"];
    match class {
        "DrSh" => &[
            LEAD[0],
            LEAD[1],
            LEAD[2],
            "Md  ",
            "Clr ",
            "Opct",
            "uglg",
            "lagl",
            "Dstn",
            "Ckmt",
            "blur",
            "Nose",
            "AntA",
            "TrnS",
            "layerConceals",
        ],
        "IrSh" => &[
            LEAD[0], LEAD[1], LEAD[2], "Md  ", "Clr ", "Opct", "uglg", "lagl", "Dstn", "Ckmt",
            "blur", "Nose", "AntA", "TrnS",
        ],
        "OrGl" => &[
            LEAD[0], LEAD[1], LEAD[2], "Md  ", "Clr ", "Opct", "GlwT", "Ckmt", "blur", "Nose",
            "ShdN", "AntA", "TrnS", "Inpr",
        ],
        "IrGl" => &[
            LEAD[0], LEAD[1], LEAD[2], "Md  ", "Clr ", "Opct", "GlwT", "Ckmt", "blur", "Nose",
            "ShdN", "AntA", "TrnS", "Inpr", "glwS",
        ],
        "SoFi" => &[LEAD[0], LEAD[1], LEAD[2], "Md  ", "Clr ", "Opct"],
        "GrFl" => &[
            LEAD[0], LEAD[1], LEAD[2], "Md  ", "Opct", "Grad", "Angl", "Type", "Rvrs", "Dthr",
            "gs99", "Algn", "Scl ", "Ofst",
        ],
        "patternFill" => &[
            LEAD[0], LEAD[1], LEAD[2], "Md  ", "Opct", "Ptrn", "Angl", "Scl ", "Algn", "phase",
        ],
        "FrFX" => &[
            LEAD[0],
            LEAD[1],
            LEAD[2],
            "Styl",
            "PntT",
            "Md  ",
            "Opct",
            "Sz  ",
            "Clr ",
            "overprint",
        ],
        "ebbl" => &[
            LEAD[0],
            LEAD[1],
            LEAD[2],
            "hglM",
            "hglC",
            "hglO",
            "sdwM",
            "sdwC",
            "sdwO",
            "bvlT",
            "bvlS",
            "uglg",
            "lagl",
            "Lald",
            "srgR",
            "blur",
            "bvlD",
            "TrnS",
            "antialiasGloss",
            "Sftn",
            "useShape",
            "useTexture",
        ],
        "ChFX" => &[
            LEAD[0], LEAD[1], LEAD[2], "Md  ", "Clr ", "AntA", "Invr", "Opct", "lagl", "Dstn",
            "blur", "MpgS",
        ],
        _ => &LEAD,
    }
}

/// A new effect descriptor: its items in order, flags off, shown in the
/// layer and the dialog; the effect's values are written over it.
pub(super) fn fresh(class: &str) -> Descriptor {
    let mut d = Descriptor::new(class);
    for key in items(class) {
        d.items.push(((*key).into(), Value::Bool(false)));
    }
    d.set("present", Value::Bool(true));
    d.set("showInDialog", Value::Bool(true));
    if d.has("Clr ") {
        d.set("Clr ", Value::Descriptor(color::to_descriptor(Rgb::BLACK)));
    }
    d
}

/// Spread and choke are percentages Photoshop stores in pixel units.
fn put_choke(d: &mut Descriptor, v: f32) {
    if paint::percent(d, "Ckmt") != Some(v) {
        d.set(
            "Ckmt",
            Value::UnitDouble("#Pxl".into(), f64::from(v) * 100.0),
        );
    }
}

/// Writes a drop shadow (`drop`) or inner shadow.
pub(super) fn shadow(d: &mut Descriptor, s: &Shadow, drop: bool) {
    paint::put_bool(d, "enab", s.enabled);
    paint::put_blend(d, "Md  ", s.blend);
    paint::put_color(d, "Clr ", s.color);
    paint::put_percent(d, "Opct", s.opacity);
    paint::put_bool(d, "uglg", s.use_global_light);
    paint::put_angle(d, "lagl", s.angle);
    paint::put_pixels(d, "Dstn", s.distance);
    put_choke(d, s.spread);
    paint::put_pixels(d, "blur", s.size);
    paint::put_percent(d, "Nose", s.noise);
    paint::put_contour(d, "TrnS", &s.contour);
    if drop {
        paint::put_bool(d, "layerConceals", s.knocks_out);
    }
}

/// Writes an outer glow or inner glow (`inner`).
pub(super) fn glow(d: &mut Descriptor, g: &Glow, inner: bool) {
    paint::put_bool(d, "enab", g.enabled);
    paint::put_blend(d, "Md  ", g.blend);
    paint::put_color(d, "Clr ", g.color);
    match &g.gradient {
        Some(gradient) => {
            let object = paint::gradient_object_descriptor(gradient, d.object("Grad"));
            if d.object("Grad") != Some(&object) {
                d.set("Grad", Value::Descriptor(object));
            }
            paint::put_gradient_method(d, gradient.method);
        }
        None => {
            d.remove("Grad");
        }
    }
    paint::put_percent(d, "Opct", g.opacity);
    let technique = match g.technique {
        GlowTechnique::Softer => "SfBL",
        GlowTechnique::Precise => "PrBL",
    };
    paint::put_enum(d, "GlwT", "BETE", technique);
    put_choke(d, g.spread);
    paint::put_pixels(d, "blur", g.size);
    paint::put_percent(d, "Nose", g.noise);
    paint::put_percent(d, "ShdN", g.jitter);
    paint::put_contour(d, "TrnS", &g.contour);
    paint::put_percent(d, "Inpr", g.range);
    if inner {
        let source = match g.source {
            GlowSource::Edge => "SrcE",
            GlowSource::Center => "SrcC",
        };
        paint::put_enum(d, "glwS", "IGSr", source);
    }
}

/// Writes a bevel and emboss.
pub(super) fn bevel(d: &mut Descriptor, b: &Bevel) {
    paint::put_bool(d, "enab", b.enabled);
    paint::put_blend(d, "hglM", b.highlight_blend);
    paint::put_color(d, "hglC", b.highlight_color);
    paint::put_percent(d, "hglO", b.highlight_opacity);
    paint::put_blend(d, "sdwM", b.shadow_blend);
    paint::put_color(d, "sdwC", b.shadow_color);
    paint::put_percent(d, "sdwO", b.shadow_opacity);
    paint::put_enum(d, "bvlT", "bvlT", id_of(&BEVEL_TECHNIQUES, b.technique));
    paint::put_enum(d, "bvlS", "BESl", id_of(&BEVEL_STYLES, b.style));
    paint::put_bool(d, "uglg", b.use_global_light);
    paint::put_angle(d, "lagl", b.angle);
    paint::put_angle(d, "Lald", b.altitude);
    paint::put_percent(d, "srgR", b.depth);
    paint::put_pixels(d, "blur", b.size);
    paint::put_enum(d, "bvlD", "BESs", if b.up { "In  " } else { "Out " });
    paint::put_contour(d, "TrnS", &b.gloss);
    paint::put_pixels(d, "Sftn", b.soften);
    paint::put_bool(d, "useShape", b.contour.is_some());
    if let Some(contour) = &b.contour {
        paint::put_contour(d, "MpgS", contour);
    }
}

/// Writes a satin.
pub(super) fn satin(d: &mut Descriptor, s: &Satin) {
    paint::put_bool(d, "enab", s.enabled);
    paint::put_blend(d, "Md  ", s.blend);
    paint::put_color(d, "Clr ", s.color);
    paint::put_bool(d, "Invr", s.invert);
    paint::put_percent(d, "Opct", s.opacity);
    paint::put_angle(d, "lagl", s.angle);
    paint::put_pixels(d, "Dstn", s.distance);
    paint::put_pixels(d, "blur", s.size);
    paint::put_contour(d, "MpgS", &s.contour);
}

/// Writes a color, gradient, or pattern overlay.
pub(super) fn overlay(d: &mut Descriptor, o: &Overlay) {
    paint::put_bool(d, "enab", o.enabled);
    paint::put_blend(d, "Md  ", o.blend);
    paint::put_percent(d, "Opct", o.opacity);
    match &o.fill {
        Fill::Solid { color } => paint::put_color(d, "Clr ", *color),
        Fill::Gradient { gradient } => paint::put_gradient(d, gradient),
        Fill::Pattern { pattern } => paint::put_pattern(d, pattern, "Algn"),
    }
}

/// Writes a stroke.
pub(super) fn stroke(d: &mut Descriptor, s: &StrokeEffect) {
    paint::put_bool(d, "enab", s.enabled);
    paint::put_enum(d, "Styl", "FStl", id_of(&STROKE_POSITIONS, s.position));
    let paint_type = match s.fill {
        Fill::Solid { .. } => "SClr",
        Fill::Gradient { .. } => "GrFl",
        Fill::Pattern { .. } => "Ptrn",
    };
    paint::put_enum(d, "PntT", "FrFl", paint_type);
    paint::put_blend(d, "Md  ", s.blend);
    paint::put_percent(d, "Opct", s.opacity);
    paint::put_pixels(d, "Sz  ", s.size);
    match &s.fill {
        Fill::Solid { color } => paint::put_color(d, "Clr ", *color),
        Fill::Gradient { gradient } => paint::put_gradient(d, gradient),
        Fill::Pattern { pattern } => paint::put_pattern(d, pattern, "Lnkd"),
    }
}
