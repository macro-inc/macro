//! Effect descriptors to the model: shadows (`DrSh`, `IrSh`), glows
//! (`OrGl`, `IrGl`), bevels (`ebbl`), satins (`ChFX`), overlays (`SoFi`,
//! `GrFl`, `patternFill`), and strokes (`FrFX`). Missing items take
//! Photoshop's defaults.

use crate::codec::descriptor::Descriptor;
use crate::codec::paint;
use crate::model::{
    Bevel, BevelStyle, BevelTechnique, BlendMode, Fill, Glow, GlowSource, GlowTechnique, Overlay,
    Rgb, Satin, Shadow, StrokeEffect, StrokePosition,
};

/// Bevel styles and their `BESl` ids.
pub(super) const BEVEL_STYLES: [(BevelStyle, &str); 5] = [
    (BevelStyle::InnerBevel, "InrB"),
    (BevelStyle::OuterBevel, "OtrB"),
    (BevelStyle::Emboss, "Embs"),
    (BevelStyle::PillowEmboss, "PlEb"),
    (BevelStyle::StrokeEmboss, "strokeEmboss"),
];

/// Bevel techniques and their `bvlT` ids.
pub(super) const BEVEL_TECHNIQUES: [(BevelTechnique, &str); 3] = [
    (BevelTechnique::Smooth, "SfBL"),
    (BevelTechnique::ChiselHard, "PrBL"),
    (BevelTechnique::ChiselSoft, "Slmt"),
];

/// Stroke positions and their `FStl` ids.
pub(super) const STROKE_POSITIONS: [(StrokePosition, &str); 3] = [
    (StrokePosition::Outside, "OutF"),
    (StrokePosition::Inside, "InsF"),
    (StrokePosition::Center, "CtrF"),
];

/// The value an id names in a table, or the first value.
pub(super) fn by_id<T: Copy>(table: &[(T, &'static str)], id: Option<&str>) -> T {
    id.and_then(|id| table.iter().find(|(_, s)| *s == id))
        .unwrap_or(&table[0])
        .0
}

/// The id of a value in a table.
pub(super) fn id_of<T: Copy + PartialEq>(table: &[(T, &'static str)], value: T) -> &'static str {
    table
        .iter()
        .find(|(v, _)| *v == value)
        .unwrap_or(&table[0])
        .1
}

fn enabled(d: &Descriptor) -> bool {
    d.bool("enab").unwrap_or(true)
}

/// A drop shadow (`drop`) or inner shadow.
pub(super) fn shadow(d: &Descriptor, drop: bool) -> Shadow {
    Shadow {
        enabled: enabled(d),
        blend: paint::blend(d, "Md  ").unwrap_or(BlendMode::Multiply),
        color: paint::color(d, "Clr ").unwrap_or(Rgb::BLACK),
        opacity: paint::percent(d, "Opct").unwrap_or(0.75),
        angle: paint::angle(d, "lagl").unwrap_or(120.0),
        use_global_light: d.bool("uglg").unwrap_or(true),
        distance: paint::pixels(d, "Dstn").unwrap_or(5.0),
        spread: paint::percent(d, "Ckmt").unwrap_or(0.0),
        size: paint::pixels(d, "blur").unwrap_or(5.0),
        noise: paint::percent(d, "Nose").unwrap_or(0.0),
        contour: paint::contour_item(d, "TrnS"),
        knocks_out: drop && d.bool("layerConceals").unwrap_or(true),
    }
}

/// An outer glow or inner glow (`inner`).
pub(super) fn glow(d: &Descriptor, inner: bool) -> Glow {
    Glow {
        enabled: enabled(d),
        blend: paint::blend(d, "Md  ").unwrap_or(BlendMode::Screen),
        color: paint::color(d, "Clr ").unwrap_or(Rgb::new(1.0, 1.0, 190.0 / 255.0)),
        gradient: d.object("Grad").map(paint::gradient_object),
        opacity: paint::percent(d, "Opct").unwrap_or(0.75),
        noise: paint::percent(d, "Nose").unwrap_or(0.0),
        technique: if d.enumeration("GlwT") == Some("PrBL") {
            GlowTechnique::Precise
        } else {
            GlowTechnique::Softer
        },
        spread: paint::percent(d, "Ckmt").unwrap_or(0.0),
        size: paint::pixels(d, "blur").unwrap_or(5.0),
        contour: paint::contour_item(d, "TrnS"),
        range: paint::percent(d, "Inpr").unwrap_or(0.5),
        jitter: paint::percent(d, "ShdN").unwrap_or(0.0),
        source: if inner && d.enumeration("glwS") == Some("SrcC") {
            GlowSource::Center
        } else {
            GlowSource::Edge
        },
    }
}

/// A bevel and emboss; its edge contour counts when `useShape` is on.
pub(super) fn bevel(d: &Descriptor) -> Bevel {
    Bevel {
        enabled: enabled(d),
        style: by_id(&BEVEL_STYLES, d.enumeration("bvlS")),
        technique: by_id(&BEVEL_TECHNIQUES, d.enumeration("bvlT")),
        depth: paint::percent(d, "srgR").unwrap_or(1.0),
        up: d.enumeration("bvlD") != Some("Out "),
        size: paint::pixels(d, "blur").unwrap_or(5.0),
        soften: paint::pixels(d, "Sftn").unwrap_or(0.0),
        angle: paint::angle(d, "lagl").unwrap_or(120.0),
        altitude: paint::angle(d, "Lald").unwrap_or(30.0),
        use_global_light: d.bool("uglg").unwrap_or(true),
        highlight_blend: paint::blend(d, "hglM").unwrap_or(BlendMode::Screen),
        highlight_color: paint::color(d, "hglC").unwrap_or(Rgb::WHITE),
        highlight_opacity: paint::percent(d, "hglO").unwrap_or(0.75),
        shadow_blend: paint::blend(d, "sdwM").unwrap_or(BlendMode::Multiply),
        shadow_color: paint::color(d, "sdwC").unwrap_or(Rgb::BLACK),
        shadow_opacity: paint::percent(d, "sdwO").unwrap_or(0.75),
        gloss: paint::contour_item(d, "TrnS"),
        contour: if d.bool("useShape") == Some(true) {
            Some(paint::contour_item(d, "MpgS"))
        } else {
            None
        },
    }
}

/// A satin.
pub(super) fn satin(d: &Descriptor) -> Satin {
    Satin {
        enabled: enabled(d),
        blend: paint::blend(d, "Md  ").unwrap_or(BlendMode::Multiply),
        color: paint::color(d, "Clr ").unwrap_or(Rgb::BLACK),
        opacity: paint::percent(d, "Opct").unwrap_or(0.5),
        angle: paint::angle(d, "lagl").unwrap_or(19.0),
        distance: paint::pixels(d, "Dstn").unwrap_or(11.0),
        size: paint::pixels(d, "blur").unwrap_or(14.0),
        invert: d.bool("Invr").unwrap_or(true),
        contour: paint::contour_item(d, "MpgS"),
    }
}

/// A color, gradient, or pattern overlay, by the fill its items hold.
pub(super) fn overlay(d: &Descriptor, fill: Fill) -> Overlay {
    Overlay {
        enabled: enabled(d),
        blend: paint::blend(d, "Md  ").unwrap_or(BlendMode::Normal),
        opacity: paint::percent(d, "Opct").unwrap_or(1.0),
        fill,
    }
}

/// A color overlay's fill.
pub(super) fn solid(d: &Descriptor) -> Fill {
    Fill::Solid {
        color: paint::color(d, "Clr ").unwrap_or(Rgb::BLACK),
    }
}

/// A gradient overlay's fill.
pub(super) fn gradient(d: &Descriptor) -> Fill {
    Fill::Gradient {
        gradient: paint::gradient(d).unwrap_or_default(),
    }
}

/// A pattern overlay's fill, when it names a pattern.
pub(super) fn pattern(d: &Descriptor) -> Option<Fill> {
    Some(Fill::Pattern {
        pattern: paint::pattern(d)?,
    })
}

/// A stroke, painting by its `PntT`.
pub(super) fn stroke(d: &Descriptor) -> StrokeEffect {
    let fill = match d.enumeration("PntT") {
        Some("GrFl") if d.has("Grad") => gradient(d),
        Some("Ptrn") => pattern(d).unwrap_or_else(|| solid(d)),
        _ => solid(d),
    };
    StrokeEffect {
        enabled: enabled(d),
        blend: paint::blend(d, "Md  ").unwrap_or(BlendMode::Normal),
        opacity: paint::percent(d, "Opct").unwrap_or(1.0),
        size: paint::pixels(d, "Sz  ").unwrap_or(3.0),
        position: by_id(&STROKE_POSITIONS, d.enumeration("Styl")),
        fill,
    }
}
