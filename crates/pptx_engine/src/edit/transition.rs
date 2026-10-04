//! Slide transitions: reading `p:transition` (also inside the
//! `mc:AlternateContent` PowerPoint writes for newer effects and exact
//! durations) and writing it at its schema position in `p:sld`
//! (`cSld`, `clrMapOvr`, `transition`, `timing`, `extLst`).
//!
//! Effects from ECMA-376 with a duration PowerPoint 2007 can express (fast,
//! medium, slow) are written as a plain `p:transition`. Other durations and
//! the PowerPoint 2010+ effects (`reveal`, `flash`; `morph` from 2016) are
//! written as `mc:AlternateContent`: a `p14` (or `p159`) choice with the
//! exact duration and effect, and a plain fallback (a fade for newer effects).

use crate::error::{Error, Result};
use crate::inspect::TransitionOutline;
use crate::model::presentation::Presentation;
use crate::model::shape::alternate_content_choice;
use crate::xml::{NodeId, Ns, XmlDoc};

/// The PowerPoint 2015 namespace of the morph transition.
const P159: &str = "http://schemas.microsoft.com/office/powerpoint/2015/09/main";
const P14: &str = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const PML: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
const MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
/// Longest transition PowerPoint accepts (59.99 s), rounded up.
const MAX_DURATION_MS: u32 = 60_000;
/// Durations of the `spd` presets (fast, medium, slow).
const PRESET_DURATIONS: [(u32, &str); 3] = [(500, "fast"), (750, "med"), (1000, "slow")];
/// Directions of effects that move along an edge or a corner.
const EIGHT_WAYS: &[&str] = &["l", "r", "u", "d", "lu", "ru", "ld", "rd"];

/// Effects `setTransition` writes, with their options (the first is the default).
const EFFECTS: &[(&str, &[&str])] = &[
    ("none", &[]),
    ("cut", &[]),
    ("fade", &["smooth", "black"]),
    ("push", &["l", "r", "u", "d"]),
    ("wipe", &["l", "r", "u", "d"]),
    ("split", &["horzOut", "horzIn", "vertOut", "vertIn"]),
    ("reveal", &["l", "r"]),
    ("randomBar", &["horz", "vert"]),
    ("shape", &["circle", "diamond", "plus"]),
    ("uncover", EIGHT_WAYS),
    ("cover", EIGHT_WAYS),
    ("zoom", &["in", "out"]),
    ("dissolve", &[]),
    ("flash", &[]),
    ("morph", &["byObject", "byWord", "byChar"]),
];

/// The extension namespace an effect needs.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Extension {
    P14,
    P159,
}

/// The requested changes of a `setTransition` operation.
pub(super) struct TransitionPatch<'a> {
    pub kind: &'a str,
    pub duration_ms: Option<u32>,
    pub direction: Option<&'a str>,
    pub advance_on_click: Option<bool>,
    pub advance_after_ms: Option<Option<u32>>,
}

/// The transition of a slide part, if it has one.
pub(crate) fn read(doc: &XmlDoc) -> Option<TransitionOutline> {
    let root = doc.root();
    doc.children(root).find_map(|c| {
        let t = transition_in(doc, c)?;
        Some(parse(doc, t))
    })
}

/// The `p:transition` a root child is or wraps (the branch the engine understands).
fn transition_in(doc: &XmlDoc, child: NodeId) -> Option<NodeId> {
    if doc.is(child, Ns::P, "transition") {
        return Some(child);
    }
    if doc.is(child, Ns::MC, "AlternateContent") {
        let branch = alternate_content_choice(doc, child)?;
        return doc
            .children(branch)
            .find(|&n| doc.is(n, Ns::P, "transition"));
    }
    None
}

/// Whether a root child is (or wraps) a transition, in any branch.
fn holds_transition(doc: &XmlDoc, child: NodeId) -> bool {
    doc.is(child, Ns::P, "transition")
        || doc.is(child, Ns::MC, "AlternateContent")
            && doc
                .children(child)
                .any(|b| doc.children(b).any(|n| doc.is(n, Ns::P, "transition")))
}

fn parse(doc: &XmlDoc, t: NodeId) -> TransitionOutline {
    let duration_ms = doc
        .attr_ns(t, Ns::P14, "dur")
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or_else(|| match doc.attr(t, "spd") {
            Some("slow") => 1000,
            Some("med") => 750,
            _ => 500,
        });
    let effect = doc
        .children(t)
        .find(|&c| !matches!(doc.local(c), "sndAc" | "extLst"));
    let (kind, direction) = match effect {
        Some(e) => describe(doc, e),
        None => ("none".to_owned(), None),
    };
    TransitionOutline {
        kind,
        duration_ms,
        direction,
        advance_on_click: doc.attr_bool(t, "advClick").unwrap_or(true),
        advance_after_ms: doc.attr_i64(t, "advTm").and_then(|v| u32::try_from(v).ok()),
    }
}

/// The kind and option of an effect element.
fn describe(doc: &XmlDoc, e: NodeId) -> (String, Option<String>) {
    let attr = |name: &str, default: &str| Some(doc.attr(e, name).unwrap_or(default).to_owned());
    let local = doc.local(e);
    let p159 = doc.ns_uri(doc.ns(e)) == Some(P159);
    let (kind, direction) = match (doc.ns(e), local) {
        (Ns::P, "cut") => ("cut", None),
        (Ns::P, "fade") => {
            let black = doc.attr_bool(e, "thruBlk").unwrap_or(false);
            (
                "fade",
                Some(if black { "black" } else { "smooth" }.to_owned()),
            )
        }
        (Ns::P, "push") => ("push", attr("dir", "l")),
        (Ns::P, "wipe") => ("wipe", attr("dir", "l")),
        (Ns::P, "split") => {
            let orient = doc.attr(e, "orient").unwrap_or("horz");
            let dir = match doc.attr(e, "dir").unwrap_or("out") {
                "in" => "In",
                _ => "Out",
            };
            ("split", Some(format!("{orient}{dir}")))
        }
        (Ns::P14, "reveal") => ("reveal", attr("dir", "l")),
        (Ns::P, "randomBar") => ("randomBar", attr("dir", "horz")),
        (Ns::P, "circle" | "diamond" | "plus") => ("shape", Some(local.to_owned())),
        (Ns::P, "pull") => ("uncover", attr("dir", "l")),
        (Ns::P, "cover") => ("cover", attr("dir", "l")),
        (Ns::P, "zoom") => ("zoom", attr("dir", "in")),
        (Ns::P, "dissolve") => ("dissolve", None),
        (Ns::P14, "flash") => ("flash", None),
        (_, "morph") if p159 => ("morph", attr("option", "byObject")),
        _ => (local, doc.attr(e, "dir").map(str::to_owned)),
    };
    (kind.to_owned(), direction)
}

/// The duration PowerPoint gives a new transition of this kind.
fn default_duration(kind: &str) -> u32 {
    match kind {
        "fade" => 700,
        "morph" => 2000,
        _ => 1000,
    }
}

/// The full transition a patch asks for, given the slide's current one.
fn resolve(
    patch: &TransitionPatch<'_>,
    current: Option<&TransitionOutline>,
) -> Result<TransitionOutline> {
    let kind = patch.kind.trim();
    let Some(&(kind, options)) = EFFECTS.iter().find(|(k, _)| *k == kind) else {
        let names: Vec<&str> = EFFECTS.iter().map(|(k, _)| *k).collect();
        return Err(Error::InvalidEdit(format!(
            "unknown transition `{kind}` (use one of {})",
            names.join(", ")
        )));
    };
    let same_kind = current.is_some_and(|c| c.kind == kind);
    let direction = match patch.direction.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) if options.is_empty() => {
            return Err(Error::InvalidEdit(format!(
                "the `{kind}` transition has no option `{d}`"
            )));
        }
        Some(d) => {
            if !options.contains(&d) {
                return Err(Error::InvalidEdit(format!(
                    "unknown `{kind}` option `{d}` (use one of {})",
                    options.join(", ")
                )));
            }
            Some(d.to_owned())
        }
        None if options.is_empty() => None,
        None => current
            .filter(|_| same_kind)
            .and_then(|c| c.direction.clone())
            .filter(|d| options.contains(&d.as_str()))
            .or_else(|| options.first().map(|d| (*d).to_owned())),
    };
    let duration_ms = patch
        .duration_ms
        .or_else(|| current.filter(|c| c.kind != "none").map(|c| c.duration_ms))
        .unwrap_or_else(|| default_duration(kind));
    if duration_ms > MAX_DURATION_MS {
        return Err(Error::InvalidEdit(format!(
            "transition duration {duration_ms} ms is too long (at most {MAX_DURATION_MS})"
        )));
    }
    Ok(TransitionOutline {
        kind: kind.to_owned(),
        duration_ms,
        direction,
        advance_on_click: patch
            .advance_on_click
            .or_else(|| current.map(|c| c.advance_on_click))
            .unwrap_or(true),
        advance_after_ms: match patch.advance_after_ms {
            Some(v) => v,
            None => current.and_then(|c| c.advance_after_ms),
        },
    })
}

/// Sets the transition of a slide (or, with `apply_to_all`, of every slide).
pub(super) fn set_transition(
    pres: &mut Presentation,
    slide: u32,
    patch: &TransitionPatch<'_>,
    apply_to_all: bool,
) -> Result<()> {
    let part = pres.slide_part(slide)?;
    let current = read(&*pres.xml(&part)?);
    let transition = resolve(patch, current.as_ref())?;
    let targets: Vec<String> = if apply_to_all {
        pres.slides.iter().map(|s| s.part.clone()).collect()
    } else {
        vec![part]
    };
    for target in targets {
        write(pres.xml_mut(&target)?, &transition)?;
    }
    Ok(())
}

/// The effect element (and the extension it needs) of a resolved transition.
fn effect_xml(t: &TransitionOutline) -> (String, Option<Extension>) {
    let dir = t.direction.as_deref().unwrap_or("");
    let directed = |name: &str| format!("<p:{name} dir=\"{dir}\"/>");
    match t.kind.as_str() {
        "cut" => ("<p:cut/>".into(), None),
        "fade" if dir == "black" => ("<p:fade thruBlk=\"1\"/>".into(), None),
        "fade" => ("<p:fade/>".into(), None),
        "push" | "wipe" | "cover" | "randomBar" | "zoom" => (directed(&t.kind), None),
        "uncover" => (directed("pull"), None),
        "split" => {
            let (orient, way) = dir.split_at(4);
            (
                format!(
                    "<p:split orient=\"{orient}\" dir=\"{}\"/>",
                    way.to_ascii_lowercase()
                ),
                None,
            )
        }
        "reveal" => (format!("<p14:reveal dir=\"{dir}\"/>"), Some(Extension::P14)),
        "shape" => (format!("<p:{dir}/>"), None),
        "dissolve" => ("<p:dissolve/>".into(), None),
        "flash" => ("<p14:flash/>".into(), Some(Extension::P14)),
        "morph" => (
            format!("<p159:morph option=\"{dir}\"/>"),
            Some(Extension::P159),
        ),
        _ => (String::new(), None),
    }
}

/// The markup of a resolved transition (`None` when the slide needs none).
fn transition_xml(t: &TransitionOutline) -> Option<String> {
    let mut advance = String::new();
    if !t.advance_on_click {
        advance.push_str(" advClick=\"0\"");
    }
    if let Some(ms) = t.advance_after_ms {
        advance.push_str(&format!(" advTm=\"{ms}\""));
    }
    if t.kind == "none" {
        return (!advance.is_empty())
            .then(|| format!("<p:transition xmlns:p=\"{PML}\"{advance}/>"));
    }
    let (effect, extension) = effect_xml(t);
    let preset = PRESET_DURATIONS
        .iter()
        .find(|(ms, _)| *ms == t.duration_ms)
        .map(|(_, spd)| *spd);
    let spd = preset.unwrap_or(match t.duration_ms {
        0..=625 => "fast",
        626..=875 => "med",
        _ => "slow",
    });
    if extension.is_none() && preset.is_some() {
        return Some(format!(
            "<p:transition xmlns:p=\"{PML}\" spd=\"{spd}\"{advance}>{effect}</p:transition>"
        ));
    }
    let (requires, declarations) = match extension {
        Some(Extension::P159) => (
            "p159",
            format!(" xmlns:p14=\"{P14}\" xmlns:p159=\"{P159}\""),
        ),
        _ => ("p14", format!(" xmlns:p14=\"{P14}\"")),
    };
    let fallback = if extension.is_some() {
        "<p:fade/>"
    } else {
        effect.as_str()
    };
    Some(format!(
        "<mc:AlternateContent xmlns:mc=\"{MC}\" xmlns:p=\"{PML}\"><mc:Choice{declarations} Requires=\"{requires}\"><p:transition spd=\"{spd}\" p14:dur=\"{}\"{advance}>{effect}</p:transition></mc:Choice><mc:Fallback><p:transition spd=\"{spd}\"{advance}>{fallback}</p:transition></mc:Fallback></mc:AlternateContent>",
        t.duration_ms
    ))
}

/// The local name of a root child, looking inside `mc:AlternateContent`.
fn wrapped_local(doc: &XmlDoc, child: NodeId) -> &str {
    if doc.is(child, Ns::MC, "AlternateContent") {
        return doc
            .first_child(child)
            .and_then(|b| doc.first_child(b))
            .map_or("", |n| doc.local(n));
    }
    doc.local(child)
}

/// Replaces a slide's transition with `t` (removing it for `none`).
fn write(doc: &mut XmlDoc, t: &TransitionOutline) -> Result<()> {
    let root = doc.root();
    let old: Vec<NodeId> = doc
        .children(root)
        .filter(|&c| holds_transition(doc, c))
        .collect();
    for o in old {
        doc.detach(o);
    }
    let Some(xml) = transition_xml(t) else {
        return Ok(());
    };
    let fragment = XmlDoc::parse(xml.as_bytes(), "transition")?;
    let node = doc.import_verbatim(&fragment, fragment.root());
    let before = doc
        .children(root)
        .find(|&c| matches!(wrapped_local(doc, c), "timing" | "extLst"));
    match before {
        Some(b) => doc.insert_before(b, node),
        None => doc.append_child(root, node),
    }
    let mut scoped = vec![node];
    scoped.extend(doc.children(node));
    for n in scoped {
        doc.drop_redundant_ns_decls(n);
    }
    Ok(())
}

#[cfg(test)]
mod test;
