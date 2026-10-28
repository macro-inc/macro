//! The markup of new effects: an effect's `p:par` with the behaviors
//! PowerPoint writes for its preset (visibility `p:set`s, `p:animEffect`
//! filters, `p:anim` keyframes on `ppt_x`/`ppt_y`/`ppt_w`/`ppt_h`,
//! `p:animRot`, `p:animScale`, `p:animClr`, `p:animMotion`).
//!
//! Time node ids are written as 0 and numbered when the sequence is laid
//! out; `grpId` and `nodeType` are set there too.

use super::presets::{Effect, Variant};
use super::read::NODE_TYPES;
use crate::edit::xmlutil::esc;
use crate::edit::{AnimationClass, AnimationRepeat, AnimationStart, RepeatUntil};
use std::fmt::Write as _;

/// End of a keyframe list (`p:tav/@tm` is in thousandths of a percent).
const END: u32 = 100_000;
/// How far the motion path presets move a shape (a fraction of the slide).
const PATH_LENGTH: f64 = 0.25;
/// Angles in `p:animRot/@by` are in 60000ths of a degree.
const DEGREE: i64 = 60_000;

/// A new effect.
pub(super) struct NewEffect<'a> {
    pub class: AnimationClass,
    pub effect: &'static Effect,
    pub variant: &'static Variant,
    pub shape: u32,
    pub paragraph: Option<u32>,
    pub start: AnimationStart,
    pub duration_ms: u32,
    pub delay_ms: u32,
    pub repeat: Option<AnimationRepeat>,
    /// A motion path of its own (`path` class), in PowerPoint's syntax.
    pub path: Option<&'a str>,
}

/// A keyframe value.
enum Val {
    /// A formula over the shape's properties (`#ppt_x`, `1+#ppt_h/2`).
    Str(&'static str),
    /// A number.
    Num(f64),
}

/// Behaviors being written against one target.
struct Behaviors {
    tgt: String,
    out: String,
}

impl Behaviors {
    fn new(shape: u32, paragraph: Option<u32>) -> Self {
        let tgt = match paragraph {
            Some(p) => format!(
                r#"<p:tgtEl><p:spTgt spid="{shape}"><p:txEl><p:pRg st="{p}" end="{p}"/></p:txEl></p:spTgt></p:tgtEl>"#
            ),
            None => format!(r#"<p:tgtEl><p:spTgt spid="{shape}"/></p:tgtEl>"#),
        };
        Self {
            tgt,
            out: String::new(),
        }
    }

    /// Shows or hides the target at `delay` (instant).
    fn visibility(&mut self, visible: bool, delay: u32) {
        let value = if visible { "visible" } else { "hidden" };
        let _ = write!(
            self.out,
            r#"<p:set><p:cBhvr><p:cTn id="0" dur="1" fill="hold"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst></p:cTn>{}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="{value}"/></p:to></p:set>"#,
            self.tgt
        );
    }

    /// Shows (`in`) or hides (`out`) the target through a transition filter.
    fn filter(&mut self, transition: &str, filter: &str, dur: u32) {
        let _ = write!(
            self.out,
            r#"<p:animEffect transition="{transition}" filter="{filter}"><p:cBhvr><p:cTn id="0" dur="{dur}"/>{}</p:cBhvr></p:animEffect>"#,
            self.tgt
        );
    }

    /// Animates a property through keyframes `(time, value, formula)`.
    fn anim(&mut self, attr: &str, dur: u32, base: bool, keys: &[(u32, Val, Option<&str>)]) {
        let additive = if base { r#" additive="base""# } else { "" };
        let _ = write!(
            self.out,
            r#"<p:anim calcmode="lin" valueType="num"><p:cBhvr{additive}><p:cTn id="0" dur="{dur}" fill="hold"/>{}<p:attrNameLst><p:attrName>{attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst>"#,
            self.tgt
        );
        for (tm, val, fmla) in keys {
            let fmla = fmla.map(|f| format!(r#" fmla="{f}""#)).unwrap_or_default();
            let val = match val {
                Val::Str(s) => format!(r#"<p:strVal val="{s}"/>"#),
                Val::Num(n) => format!(r#"<p:fltVal val="{n}"/>"#),
            };
            let _ = write!(
                self.out,
                r#"<p:tav tm="{tm}"{fmla}><p:val>{val}</p:val></p:tav>"#
            );
        }
        self.out.push_str("</p:tavLst></p:anim>");
    }

    /// Moves a property from one formula to another.
    fn tween(&mut self, attr: &str, dur: u32, base: bool, from: Val, to: Val) {
        self.anim(attr, dur, base, &[(0, from, None), (END, to, None)]);
    }

    /// Turns the target by `degrees` (clockwise when positive).
    fn rotate(&mut self, degrees: f64, delay: u32, dur: u32) {
        let by = (degrees * DEGREE as f64).round() as i64;
        let _ = write!(
            self.out,
            r#"<p:animRot by="{by}"><p:cBhvr><p:cTn id="0" dur="{dur}" fill="hold"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst></p:cTn>{}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>"#,
            self.tgt
        );
    }

    /// Scales the target by `percent`, and back when `reverse`.
    fn scale(&mut self, percent: u32, dur: u32, reverse: bool) {
        let rev = if reverse { r#" autoRev="1""# } else { "" };
        let by = percent * 1000;
        let _ = write!(
            self.out,
            r#"<p:animScale><p:cBhvr><p:cTn id="0" dur="{dur}"{rev} fill="hold"/>{}</p:cBhvr><p:by x="{by}" y="{by}"/></p:animScale>"#,
            self.tgt
        );
    }

    /// Animates a color property (`fillcolor`, `style.color`) to `to`
    /// (color markup) or by an HSL change.
    fn color(&mut self, attr: &str, dur: u32, reverse: bool, change: &str) {
        let rev = if reverse { r#" autoRev="1""# } else { "" };
        let space = if change.starts_with("<p:by>") {
            "hsl"
        } else {
            "rgb"
        };
        let _ = write!(
            self.out,
            r#"<p:animClr clrSpc="{space}" dir="cw"><p:cBhvr override="childStyle"><p:cTn id="0" dur="{dur}"{rev} fill="hold"/>{}<p:attrNameLst><p:attrName>{attr}</p:attrName></p:attrNameLst></p:cBhvr>{change}</p:animClr>"#,
            self.tgt
        );
    }

    /// Sets a style property for `dur` (`hold`: and keeps it).
    fn style(&mut self, attr: &str, value: &str, dur: u32, hold: bool) {
        let fill = if hold { r#" fill="hold""# } else { "" };
        let _ = write!(
            self.out,
            r#"<p:set><p:cBhvr override="childStyle"><p:cTn id="0" dur="{dur}"{fill}/>{}<p:attrNameLst><p:attrName>{attr}</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="{value}"/></p:to></p:set>"#,
            self.tgt
        );
    }

    /// Moves the target along a path relative to where it is.
    fn motion(&mut self, path: &str, dur: u32, points: Option<(&str, (f64, f64))>) {
        let (types, center) = match points {
            Some((types, (x, y))) => (
                format!(r#" ptsTypes="{types}""#),
                format!(
                    r#"<p:rCtr x="{}" y="{}"/>"#,
                    (x * 100_000.0).round(),
                    (y * 100_000.0).round()
                ),
            ),
            None => (String::new(), String::new()),
        };
        let _ = write!(
            self.out,
            r#"<p:animMotion origin="layout" path="{}" pathEditMode="relative" rAng="0"{types}><p:cBhvr><p:cTn id="0" dur="{dur}" fill="hold"/>{}<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr>{center}</p:animMotion>"#,
            esc(path),
            self.tgt
        );
    }
}

/// Where a fly effect starts (entrance) or ends (exit): off the slide's
/// edge (or corner) `direction` names.
fn fly_edges(direction: &str, exit: bool) -> (Val, Val) {
    let lower = direction.to_ascii_lowercase();
    let pick = |entrance: &'static str, exiting: &'static str| {
        if exit { exiting } else { entrance }
    };
    let x = if lower.ends_with("left") {
        pick("0-#ppt_w/2", "0-ppt_w/2")
    } else if lower.ends_with("right") {
        pick("1+#ppt_w/2", "1+ppt_w/2")
    } else {
        pick("#ppt_x", "ppt_x")
    };
    let y = if lower.starts_with("top") {
        pick("0-#ppt_h/2", "0-ppt_h/2")
    } else if lower.starts_with("bottom") {
        pick("1+#ppt_h/2", "1+ppt_h/2")
    } else {
        pick("#ppt_y", "ppt_y")
    };
    (Val::Str(x), Val::Str(y))
}

/// The `wipe` filter for an effect starting at `edge`.
fn wipe_filter(edge: &str, exit: bool) -> &'static str {
    match (edge, exit) {
        ("bottom", false) | ("top", true) => "wipe(up)",
        ("top", false) | ("bottom", true) => "wipe(down)",
        ("left", false) | ("right", true) => "wipe(right)",
        _ => "wipe(left)",
    }
}

/// Splits an option like `circleOut` or `verticalIn` into its stem and way (`in`, `out`).
fn stem_and_way(option: &str) -> (&str, &'static str) {
    match option.strip_suffix("Out") {
        Some(stem) => (stem, "out"),
        None => (option.strip_suffix("In").unwrap_or(option), "in"),
    }
}

/// The filter of the transition-filter effects (`split`, `wipe`, `shape`,
/// `wheel`, `randomBars`), or `None` for other effects.
fn transition_filter(name: &str, option: &str, exit: bool) -> Option<String> {
    Some(match name {
        "split" => {
            let (axis, way) = stem_and_way(option);
            let axis = if axis == "vertical" {
                "Vertical"
            } else {
                "Horizontal"
            };
            format!("barn({way}{axis})")
        }
        "wipe" => wipe_filter(option, exit).to_owned(),
        "shape" => {
            let (shape, way) = stem_and_way(option);
            format!("{shape}({way})")
        }
        "wheel" => format!("wheel({})", option.trim_start_matches("spokes")),
        "randomBars" => format!("randombar({option})"),
        _ => return None,
    })
}

/// The behaviors of an entrance (`exit` = false) or exit effect.
fn appear_or_vanish(b: &mut Behaviors, name: &str, option: &str, d: u32, exit: bool) {
    let (way, last) = if exit {
        ("out", d.saturating_sub(1))
    } else {
        ("in", 0)
    };
    if !exit {
        b.visibility(true, 0);
    }
    if let Some(filter) = transition_filter(name, option, exit) {
        b.filter(way, &filter, d);
    } else {
        match name {
            "fade" | "fadeOut" => b.filter(way, "fade", d),
            "flyIn" | "flyOut" => {
                let (x, y) = fly_edges(option, exit);
                let (x0, y0) = if exit {
                    ("ppt_x", "ppt_y")
                } else {
                    ("#ppt_x", "#ppt_y")
                };
                if exit {
                    b.tween("ppt_x", d, true, Val::Str(x0), x);
                    b.tween("ppt_y", d, true, Val::Str(y0), y);
                } else {
                    b.tween("ppt_x", d, true, x, Val::Str(x0));
                    b.tween("ppt_y", d, true, y, Val::Str(y0));
                }
            }
            "floatIn" => {
                b.filter(way, "fade", d);
                b.tween("ppt_x", d, false, Val::Str("#ppt_x"), Val::Str("#ppt_x"));
                let from = if option == "down" {
                    "#ppt_y-.1"
                } else {
                    "#ppt_y+.1"
                };
                b.tween("ppt_y", d, false, Val::Str(from), Val::Str("#ppt_y"));
            }
            "floatOut" => {
                b.filter(way, "fade", d);
                b.tween("ppt_x", d, false, Val::Str("ppt_x"), Val::Str("ppt_x"));
                let to = if option == "up" {
                    "ppt_y-.1"
                } else {
                    "ppt_y+.1"
                };
                b.tween("ppt_y", d, false, Val::Str("ppt_y"), Val::Str(to));
            }
            "growTurn" | "shrinkTurn" | "zoom" => {
                let turn = name != "zoom";
                let slide_center = option == "slideCenter";
                let keys = |full: &'static str| {
                    if exit {
                        (Val::Str(full.trim_start_matches('#')), Val::Num(0.0))
                    } else {
                        (Val::Num(0.0), Val::Str(full))
                    }
                };
                let (w0, w1) = keys("#ppt_w");
                b.tween("ppt_w", d, false, w0, w1);
                let (h0, h1) = keys("#ppt_h");
                b.tween("ppt_h", d, false, h0, h1);
                if slide_center {
                    for (attr, own) in [("ppt_x", "#ppt_x"), ("ppt_y", "#ppt_y")] {
                        let (from, to) = if exit {
                            (Val::Str(own.trim_start_matches('#')), Val::Num(0.5))
                        } else {
                            (Val::Num(0.5), Val::Str(own))
                        };
                        b.tween(attr, d, false, from, to);
                    }
                }
                if turn {
                    let (from, to) = if exit { (0.0, 90.0) } else { (90.0, 0.0) };
                    b.tween("style.rotation", d, false, Val::Num(from), Val::Num(to));
                }
                b.filter(way, "fade", d);
            }
            "swivel" => {
                let (from, to) = if exit { (1.0, 0.0) } else { (0.0, 1.0) };
                b.anim(
                    "ppt_w",
                    d,
                    false,
                    &[
                        (0, Val::Num(from), Some("#ppt_w*sin(2.5*pi*$)")),
                        (END, Val::Num(to), None),
                    ],
                );
                b.tween("ppt_h", d, false, Val::Str("#ppt_h"), Val::Str("#ppt_h"));
                b.filter(way, "fade", d);
            }
            "bounce" if exit => {
                b.tween("ppt_x", d, false, Val::Str("ppt_x"), Val::Str("ppt_x+0.25"));
                b.anim(
                    "ppt_y",
                    d,
                    false,
                    &[
                        (0, Val::Str("ppt_y"), None),
                        (20_000, Val::Str("ppt_y-0.06"), None),
                        (40_000, Val::Str("ppt_y"), None),
                        (60_000, Val::Str("ppt_y-0.15"), None),
                        (END, Val::Str("1+ppt_h/2"), None),
                    ],
                );
            }
            "bounce" => {
                b.tween(
                    "ppt_x",
                    d,
                    false,
                    Val::Str("#ppt_x-0.25"),
                    Val::Str("#ppt_x"),
                );
                b.anim(
                    "ppt_y",
                    d,
                    false,
                    &[
                        (0, Val::Str("0-#ppt_h/2"), None),
                        (40_000, Val::Str("#ppt_y"), None),
                        (60_000, Val::Str("#ppt_y-0.06"), None),
                        (80_000, Val::Str("#ppt_y"), None),
                        (90_000, Val::Str("#ppt_y-0.015"), None),
                        (END, Val::Str("#ppt_y"), None),
                    ],
                );
            }
            // `appear` and `disappear` only change visibility.
            _ => {}
        }
    }
    if exit {
        b.visibility(false, last);
    }
}

/// Teeter's swings: (start, end) as fractions of the duration, and the turn.
const TEETER: [(f64, f64, f64); 6] = [
    (0.0, 0.1, -5.0),
    (0.1, 0.3, 10.0),
    (0.3, 0.5, -10.0),
    (0.5, 0.7, 10.0),
    (0.7, 0.9, -10.0),
    (0.9, 1.0, 5.0),
];

/// The behaviors of an emphasis effect; returns the iteration markup the
/// effect's own time node needs (text effects that play letter by letter).
fn emphasis(b: &mut Behaviors, name: &str, option: &str, d: u32) -> &'static str {
    let ms = |f: f64| (f * f64::from(d)).round() as u32;
    match name {
        "pulse" => b.scale(105, d / 2, true),
        "colorPulse" => {
            for attr in ["fillcolor", "style.color"] {
                b.color(
                    attr,
                    d / 2,
                    true,
                    r#"<p:to><a:schemeClr val="accent2"/></p:to>"#,
                );
            }
        }
        "teeter" => {
            for (from, to, degrees) in TEETER {
                b.rotate(degrees, ms(from), ms(to) - ms(from));
            }
        }
        "spin" => {
            let degrees = if option == "counterclockwise" {
                -360.0
            } else {
                360.0
            };
            b.rotate(degrees, 0, d);
        }
        "growShrink" => b.scale(150, d, false),
        "desaturate" | "darken" | "lighten" => {
            let (s, l) = match name {
                "desaturate" => (-100_000, 0),
                "darken" => (0, -25_000),
                _ => (0, 25_000),
            };
            let change = format!(r#"<p:by><p:hsl h="0" s="{s}" l="{l}"/></p:by>"#);
            for attr in ["fillcolor", "style.color"] {
                b.color(attr, d, false, &change);
            }
        }
        "transparency" => {
            b.style("style.opacity", "0.5", d, true);
            let _ = write!(
                b.out,
                r#"<p:animEffect filter="image" prLst="opacity: 0.5"><p:cBhvr rctx="IE"><p:cTn id="0" dur="{d}" fill="hold"/>{}</p:cBhvr></p:animEffect>"#,
                b.tgt
            );
        }
        "boldFlash" => b.style("style.fontWeight", "bold", d, false),
        "wave" => {
            b.anim(
                "ppt_y",
                d,
                false,
                &[
                    (0, Val::Str("#ppt_y"), None),
                    (50_000, Val::Str("#ppt_y-0.03"), None),
                    (END, Val::Str("#ppt_y"), None),
                ],
            );
            return r#"<p:iterate type="lt"><p:tmPct val="10000"/></p:iterate>"#;
        }
        _ => {}
    }
    ""
}

/// The motion path of a `path` effect: its own, or the preset line.
fn motion(b: &mut Behaviors, option: &str, path: Option<&str>, d: u32) {
    if let Some(path) = path {
        b.motion(path, d, None);
        return;
    }
    let (x, y) = match option {
        "left" => (-PATH_LENGTH, 0.0),
        "right" => (PATH_LENGTH, 0.0),
        "up" => (0.0, -PATH_LENGTH),
        _ => (0.0, PATH_LENGTH),
    };
    b.motion(
        &format!("M 0 0 L {x} {y} E"),
        d,
        Some(("AA", (x / 2.0, y / 2.0))),
    );
}

/// The `repeatCount` attribute and end condition of a repetition.
fn repeat_markup(repeat: Option<AnimationRepeat>) -> (String, &'static str) {
    const ON_NEXT: &str = r#"<p:endCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>"#;
    match repeat {
        Some(AnimationRepeat::Times(n)) if n > 0.0 && n != 1.0 => (
            format!(r#" repeatCount="{}""#, (f64::from(n) * 1000.0).round()),
            "",
        ),
        Some(AnimationRepeat::Until(until)) => (
            r#" repeatCount="indefinite""#.to_owned(),
            if until == RepeatUntil::UntilNextClick {
                ON_NEXT
            } else {
                ""
            },
        ),
        _ => (String::new(), ""),
    }
}

/// The `p:par` of a new effect.
pub(super) fn effect_xml(e: &NewEffect<'_>) -> String {
    let d = e.duration_ms;
    let option = e.variant.name;
    let mut b = Behaviors::new(e.shape, e.paragraph);
    let mut iterate = "";
    let (preset, subtype) = match e.path {
        Some(_) => (0, 0),
        None => (e.variant.preset, e.variant.subtype),
    };
    match e.class {
        AnimationClass::Entrance => appear_or_vanish(&mut b, e.effect.name, option, d, false),
        AnimationClass::Exit => appear_or_vanish(&mut b, e.effect.name, option, d, true),
        AnimationClass::Emphasis => iterate = emphasis(&mut b, e.effect.name, option, d),
        AnimationClass::Path => motion(&mut b, option, e.path, d),
        AnimationClass::Media | AnimationClass::Other => {}
    }
    let class = super::presets::class_attr(e.class);
    let node = NODE_TYPES
        .iter()
        .find(|(s, _)| *s == e.start)
        .map_or("clickEffect", |(_, n)| n);
    let (repeat, end) = repeat_markup(e.repeat);
    format!(
        r#"<p:par><p:cTn id="0" presetID="{preset}" presetClass="{class}" presetSubtype="{subtype}"{repeat} fill="hold" grpId="0" nodeType="{node}"><p:stCondLst><p:cond delay="{}"/></p:stCondLst>{end}{iterate}<p:childTnLst>{}</p:childTnLst></p:cTn></p:par>"#,
        e.delay_ms, b.out
    )
}
