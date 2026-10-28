//! The animation effects the engine knows: PowerPoint's preset ids and
//! subtypes, the names and options they read as, and what a new effect of
//! each kind gets by default.
//!
//! Entrance and exit effects share preset ids (fade is 10 in both groups);
//! options are mostly subtypes (fly in from the left is preset 2, subtype
//! 8), but some options are presets of their own (float in up is 42, down
//! is 47; the shape effect's circle, box, diamond, and plus are 6, 4, 8, 13).

use crate::edit::AnimationClass;

/// One option of an effect and the preset it is written as.
pub(super) struct Variant {
    /// Option name (the outline's `direction`); empty for effects without options.
    pub name: &'static str,
    /// `presetID`.
    pub preset: u32,
    /// `presetSubtype`.
    pub subtype: u32,
}

/// An effect `setAnimations` can create.
pub(super) struct Effect {
    pub class: AnimationClass,
    pub name: &'static str,
    /// Duration of a new effect in milliseconds (0: it happens at once).
    pub default_ms: u32,
    /// Options, the default first (one unnamed variant when it has none).
    pub variants: &'static [Variant],
}

impl Effect {
    /// Whether the effect has options to choose from.
    pub fn has_options(&self) -> bool {
        !self.variants[0].name.is_empty()
    }

    /// The option names, for error messages.
    pub fn option_names(&self) -> Vec<&'static str> {
        self.variants.iter().map(|v| v.name).collect()
    }
}

const fn v(name: &'static str, preset: u32, subtype: u32) -> Variant {
    Variant {
        name,
        preset,
        subtype,
    }
}

const fn e(
    class: AnimationClass,
    name: &'static str,
    default_ms: u32,
    variants: &'static [Variant],
) -> Effect {
    Effect {
        class,
        name,
        default_ms,
        variants,
    }
}

// Subtype bits: 1 top, 2 right, 4 bottom, 8 left; 5 vertical, 10
// horizontal; 16 in, 32 out.
const FLY: &[Variant] = &[
    v("bottom", 2, 4),
    v("left", 2, 8),
    v("right", 2, 2),
    v("top", 2, 1),
    v("bottomLeft", 2, 12),
    v("bottomRight", 2, 6),
    v("topLeft", 2, 9),
    v("topRight", 2, 3),
];
const WIPE: &[Variant] = &[
    v("bottom", 22, 4),
    v("left", 22, 8),
    v("right", 22, 2),
    v("top", 22, 1),
];
const SPLIT_IN: &[Variant] = &[
    v("verticalOut", 16, 37),
    v("horizontalOut", 16, 42),
    v("verticalIn", 16, 21),
    v("horizontalIn", 16, 26),
];
const SPLIT_OUT: &[Variant] = &[
    v("verticalIn", 16, 21),
    v("horizontalIn", 16, 26),
    v("verticalOut", 16, 37),
    v("horizontalOut", 16, 42),
];
const SHAPE_IN: &[Variant] = &[
    v("circleOut", 6, 32),
    v("circleIn", 6, 16),
    v("boxOut", 4, 32),
    v("boxIn", 4, 16),
    v("diamondOut", 8, 32),
    v("diamondIn", 8, 16),
    v("plusOut", 13, 32),
    v("plusIn", 13, 16),
];
const SHAPE_OUT: &[Variant] = &[
    v("circleIn", 6, 16),
    v("circleOut", 6, 32),
    v("boxIn", 4, 16),
    v("boxOut", 4, 32),
    v("diamondIn", 8, 16),
    v("diamondOut", 8, 32),
    v("plusIn", 13, 16),
    v("plusOut", 13, 32),
];
const WHEEL: &[Variant] = &[
    v("spokes1", 21, 1),
    v("spokes2", 21, 2),
    v("spokes3", 21, 3),
    v("spokes4", 21, 4),
    v("spokes8", 21, 8),
];
const BARS: &[Variant] = &[v("horizontal", 14, 10), v("vertical", 14, 5)];
const ZOOM: &[Variant] = &[v("objectCenter", 53, 16), v("slideCenter", 53, 528)];
const FLOAT_IN: &[Variant] = &[v("up", 42, 0), v("down", 47, 0)];
const FLOAT_OUT: &[Variant] = &[v("down", 42, 0), v("up", 47, 0)];
/// Spin's direction is the sign of its rotation, not a subtype.
const SPIN: &[Variant] = &[v("clockwise", 8, 0), v("counterclockwise", 8, 0)];
const PATH: &[Variant] = &[
    v("down", 42, 0),
    v("left", 35, 0),
    v("right", 63, 0),
    v("up", 64, 0),
];

macro_rules! single {
    ($preset:expr) => {
        &[v("", $preset, 0)]
    };
}

use AnimationClass::{Emphasis, Entrance, Exit, Path};

/// The effects `setAnimations` creates: PowerPoint's Animations gallery.
pub(super) const EFFECTS: &[Effect] = &[
    e(Entrance, "appear", 0, single!(1)),
    e(Entrance, "fade", 500, single!(10)),
    e(Entrance, "flyIn", 500, FLY),
    e(Entrance, "floatIn", 1000, FLOAT_IN),
    e(Entrance, "split", 500, SPLIT_IN),
    e(Entrance, "wipe", 500, WIPE),
    e(Entrance, "shape", 2000, SHAPE_IN),
    e(Entrance, "wheel", 2000, WHEEL),
    e(Entrance, "randomBars", 500, BARS),
    e(Entrance, "growTurn", 500, single!(31)),
    e(Entrance, "zoom", 500, ZOOM),
    e(Entrance, "swivel", 2000, single!(45)),
    e(Entrance, "bounce", 2000, single!(26)),
    e(Emphasis, "pulse", 500, single!(26)),
    e(Emphasis, "colorPulse", 500, single!(27)),
    e(Emphasis, "teeter", 1000, single!(32)),
    e(Emphasis, "spin", 2000, SPIN),
    e(Emphasis, "growShrink", 2000, single!(6)),
    e(Emphasis, "desaturate", 2000, single!(25)),
    e(Emphasis, "darken", 2000, single!(24)),
    e(Emphasis, "lighten", 2000, single!(30)),
    e(Emphasis, "transparency", 2000, single!(9)),
    e(Emphasis, "boldFlash", 1000, single!(10)),
    e(Emphasis, "wave", 1000, single!(34)),
    e(Exit, "disappear", 0, single!(1)),
    e(Exit, "fadeOut", 500, single!(10)),
    e(Exit, "flyOut", 500, FLY),
    e(Exit, "floatOut", 1000, FLOAT_OUT),
    e(Exit, "split", 500, SPLIT_OUT),
    e(Exit, "wipe", 500, WIPE),
    e(Exit, "shape", 2000, SHAPE_OUT),
    e(Exit, "wheel", 2000, WHEEL),
    e(Exit, "randomBars", 500, BARS),
    e(Exit, "shrinkTurn", 500, single!(31)),
    e(Exit, "zoom", 500, ZOOM),
    e(Exit, "swivel", 2000, single!(45)),
    e(Exit, "bounce", 2000, single!(26)),
    e(Path, "path", 2000, PATH),
];

/// Presets the engine names but does not create (PowerPoint's "More
/// effects" lists and media actions); animations of these are kept as they are.
const READ_ONLY: &[(AnimationClass, u32, &str)] = &[
    (Entrance, 3, "blinds"),
    (Entrance, 5, "checkerboard"),
    (Entrance, 7, "crawlIn"),
    (Entrance, 9, "dissolveIn"),
    (Entrance, 11, "flashOnce"),
    (Entrance, 12, "peekIn"),
    (Entrance, 15, "spiralIn"),
    (Entrance, 17, "stretch"),
    (Entrance, 18, "strips"),
    (Entrance, 19, "basicSwivel"),
    (Entrance, 20, "wedge"),
    (Entrance, 23, "basicZoom"),
    (Entrance, 25, "boomerang"),
    (Entrance, 28, "credits"),
    (Entrance, 30, "float"),
    (Entrance, 35, "pinwheel"),
    (Entrance, 37, "riseUp"),
    (Entrance, 43, "centerRevolve"),
    (Entrance, 49, "spinner"),
    (Entrance, 50, "compress"),
    (Entrance, 55, "expand"),
    (Exit, 3, "blinds"),
    (Exit, 5, "checkerboard"),
    (Exit, 7, "crawlOut"),
    (Exit, 9, "dissolveOut"),
    (Exit, 12, "peekOut"),
    (Exit, 15, "spiralOut"),
    (Exit, 17, "collapse"),
    (Exit, 18, "strips"),
    (Exit, 19, "basicSwivel"),
    (Exit, 20, "wedge"),
    (Exit, 23, "basicZoom"),
    (Exit, 25, "boomerang"),
    (Exit, 28, "credits"),
    (Exit, 30, "float"),
    (Exit, 35, "pinwheel"),
    (Exit, 37, "sinkDown"),
    (Exit, 43, "centerRevolve"),
    (Exit, 49, "spinner"),
    (Emphasis, 1, "fillColor"),
    (Emphasis, 3, "fontColor"),
    (Emphasis, 7, "lineColor"),
    (Emphasis, 15, "boldReveal"),
    (Emphasis, 16, "brushColor"),
    (Emphasis, 18, "underline"),
    (Emphasis, 19, "objectColor"),
    (Emphasis, 21, "complementaryColor"),
    (AnimationClass::Media, 1, "play"),
    (AnimationClass::Media, 2, "pause"),
    (AnimationClass::Media, 3, "stop"),
];

/// The name of an effect PowerPoint saved but no preset names.
pub(super) const CUSTOM: &str = "custom";

/// The effect `setAnimations` creates for a class and name.
pub(super) fn effect(class: AnimationClass, name: &str) -> Option<&'static Effect> {
    EFFECTS.iter().find(|e| e.class == class && e.name == name)
}

/// Whether a class and name is one the outline reports but the engine does
/// not create (it can only keep such animations).
pub(super) fn keep_only(class: AnimationClass, name: &str) -> bool {
    name == CUSTOM
        || matches!(class, AnimationClass::Media | AnimationClass::Other)
        || READ_ONLY.iter().any(|&(c, _, n)| c == class && n == name)
}

/// The names `setAnimations` creates in a class, for error messages.
pub(super) fn names(class: AnimationClass) -> Vec<&'static str> {
    EFFECTS
        .iter()
        .filter(|e| e.class == class)
        .map(|e| e.name)
        .collect()
}

/// The effect name and option a saved preset reads as.
pub(super) fn identify(
    class: AnimationClass,
    preset: u32,
    subtype: u32,
) -> Option<(&'static str, Option<&'static str>)> {
    let of_class = || EFFECTS.iter().filter(|e| e.class == class);
    let exact = of_class().find_map(|e| {
        e.variants
            .iter()
            .find(|v| v.preset == preset && v.subtype == subtype)
            .map(|v| (e.name, Some(v.name).filter(|n| !n.is_empty())))
    });
    exact
        .or_else(|| {
            of_class()
                .find(|e| class == Path || e.variants.iter().any(|v| v.preset == preset))
                .map(|e| (e.name, None))
        })
        .or_else(|| {
            READ_ONLY
                .iter()
                .find(|&&(c, p, _)| c == class && p == preset)
                .map(|&(_, _, n)| (n, None))
        })
}

/// The `presetClass` value of a class.
pub(super) fn class_attr(class: AnimationClass) -> &'static str {
    match class {
        Entrance => "entr",
        Emphasis => "emph",
        Exit => "exit",
        Path => "path",
        AnimationClass::Media => "mediacall",
        AnimationClass::Other => "verb",
    }
}

/// The class a `presetClass` value names.
pub(super) fn class_of(attr: &str) -> Option<AnimationClass> {
    Some(match attr {
        "entr" => Entrance,
        "emph" => Emphasis,
        "exit" => Exit,
        "path" => Path,
        "mediacall" => AnimationClass::Media,
        "verb" => AnimationClass::Other,
        _ => return None,
    })
}

/// The name of a class in messages (as written in specs).
pub(super) fn class_name(class: AnimationClass) -> &'static str {
    match class {
        Entrance => "entrance",
        Emphasis => "emphasis",
        Exit => "exit",
        Path => "path",
        AnimationClass::Media => "media",
        AnimationClass::Other => "other",
    }
}
