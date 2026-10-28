//! Shape animations: the main sequence of a slide's `p:timing` (what plays
//! as the presenter clicks through the slide), read into
//! [`AnimationOutline`](crate::inspect::AnimationOutline)s and rewritten by
//! `setAnimations`, `addAnimation`, and `removeAnimations`.
//!
//! PowerPoint stores the main sequence as click groups of time groups of
//! effects. The engine treats it as a flat list in playback order, each
//! effect starting on a click, with the previous effect, or after it, and
//! lays the groups out again on every write, as PowerPoint does. Effects an
//! edit keeps keep their markup (sounds, smoothing, effects the engine does
//! not create); only their timing and build group change. New effects get
//! the markup PowerPoint writes for their preset, and text shapes a
//! `p:bldP` build entry. Trigger sequences, media nodes, and their build
//! entries stay as they are.
//!
//! Animations name shapes by id and paragraphs by index, so after every
//! batch the slides it touched drop the effects whose shape or paragraph is
//! gone ([`scrub`]); PowerPoint repairs files that keep them.

mod markup;
mod presets;
mod read;
mod sequence;

pub(crate) use read::read;
pub(crate) use sequence::add_media_node;

use self::markup::NewEffect;
use self::read::{Entry, ShapeIndex};
use self::sequence::{Build, CTN_ORDER, Placed};
use super::xmlutil::import_fragment;
use crate::edit::{AnimationClass, AnimationRepeat, AnimationSpec, AnimationStart, RepeatUntil};
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::xml::{NodeId, Ns, XmlDoc};

/// Longest duration and delay (PowerPoint's limit is 59.99 s).
const MAX_MS: u32 = 60_000;
/// Shortest duration of an effect that is not instant.
const MIN_DURATION_MS: u32 = 10;
/// Most plays of a repeating animation.
const MAX_REPEAT: f32 = 1000.0;

/// Timing changes for a kept effect (`None` keeps the value).
#[derive(Default)]
struct TimingPatch {
    start: Option<AnimationStart>,
    duration_ms: Option<u32>,
    delay_ms: Option<u32>,
    repeat: Option<AnimationRepeat>,
}

/// One effect of the sequence being written.
enum Slot<'a> {
    /// An effect the slide has.
    Kept(Entry, TimingPatch),
    /// A new effect.
    New(NewEffect<'a>),
}

fn invalid(message: String) -> Error {
    Error::InvalidEdit(message)
}

/// Prefixes an animation's position to the errors about it.
fn numbered(index: usize, e: Error) -> Error {
    match e {
        Error::InvalidEdit(m) => invalid(format!("animation {index}: {m}")),
        other => other,
    }
}

fn check_ms(field: &str, value: Option<u32>, min: u32) -> Result<()> {
    match value {
        Some(v) if v < min || v > MAX_MS => Err(invalid(format!(
            "{field} {v} is out of range ({min}-{MAX_MS} ms)"
        ))),
        _ => Ok(()),
    }
}

fn check_repeat(repeat: Option<AnimationRepeat>) -> Result<()> {
    match repeat {
        Some(AnimationRepeat::Times(n)) if !(n > 0.0 && n <= MAX_REPEAT) => Err(invalid(format!(
            "repeat {n} is out of range (more than 0, at most {MAX_REPEAT})"
        ))),
        _ => Ok(()),
    }
}

/// Checks a motion path: PowerPoint's path commands and numbers only.
fn check_path(path: &str) -> Result<()> {
    let allowed = |c: char| c.is_ascii_digit() || " .,-+MLCZEmlcze".contains(c);
    if !path.trim_start().starts_with(['M', 'm']) || !path.chars().all(allowed) {
        return Err(invalid(format!(
            "motion path {path:?} must start with M and use only M, L, C, Z, E, and numbers"
        )));
    }
    Ok(())
}

fn unknown_effect(class: AnimationClass, name: &str) -> Error {
    let names = presets::names(class);
    let class = presets::class_name(class);
    if names.is_empty() {
        return invalid(format!(
            "{class} animations can only be kept, not created (new animations are entrance, emphasis, exit, or path effects)"
        ));
    }
    invalid(format!(
        "unknown {class} effect `{name}` (use one of {})",
        names.join(", ")
    ))
}

/// The option a spec asks for (the effect's default when it names none).
fn variant_of(
    effect: &'static presets::Effect,
    direction: Option<&str>,
) -> Result<&'static presets::Variant> {
    match direction {
        None => Ok(&effect.variants[0]),
        Some(d) if !effect.has_options() => Err(invalid(format!(
            "the `{}` effect has no direction (got `{d}`)",
            effect.name
        ))),
        Some(d) => effect.variants.iter().find(|v| v.name == d).ok_or_else(|| {
            invalid(format!(
                "unknown `{}` direction `{d}` (use one of {})",
                effect.name,
                effect.option_names().join(", ")
            ))
        }),
    }
}

/// Whether a spec describes an existing animation (so it is kept).
fn describes(
    spec: &AnimationSpec,
    name: &str,
    direction: Option<&str>,
    path: Option<&str>,
    e: &Entry,
) -> bool {
    let o = &e.outline;
    o.shape_id == spec.shape_id
        && o.class == spec.class
        && o.effect == name
        && o.paragraph == spec.paragraph
        && direction.is_none_or(|d| o.direction.as_deref() == Some(d))
        && path.is_none_or(|p| o.path.as_deref() == Some(p))
}

/// What a spec turns into: an existing animation it describes (taken from
/// `existing`), or a new effect.
fn resolve<'a>(
    spec: &'a AnimationSpec,
    shapes: &ShapeIndex,
    existing: &mut [Option<Entry>],
) -> Result<Slot<'a>> {
    let facts = shapes
        .get(spec.shape_id)
        .ok_or_else(|| invalid(format!("shape {} is not on the slide", spec.shape_id)))?;
    let class = spec.class;
    let name = spec.effect.trim();
    let created = presets::effect(class, name);
    if created.is_none() && !presets::keep_only(class, name) {
        return Err(unknown_effect(class, name));
    }
    let direction = spec
        .direction
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty());
    let variant = created.map(|e| variant_of(e, direction)).transpose()?;
    if let Some(p) = spec.paragraph {
        match facts.paragraphs {
            Some(n) if (p as usize) < n => {}
            Some(n) => {
                return Err(invalid(format!(
                    "shape {} has {n} paragraphs, so there is no paragraph {p} (0-based)",
                    spec.shape_id
                )));
            }
            None => {
                return Err(invalid(format!(
                    "shape {} has no text, so it has no paragraph {p}",
                    spec.shape_id
                )));
            }
        }
    }
    let path = spec
        .path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty());
    if let Some(p) = path {
        if class != AnimationClass::Path {
            return Err(invalid("only `path` animations take a path".into()));
        }
        check_path(p)?;
    }
    check_ms("durationMs", spec.duration_ms, MIN_DURATION_MS)?;
    check_ms("delayMs", spec.delay_ms, 0)?;
    check_repeat(spec.repeat)?;
    let matched = existing
        .iter_mut()
        .find(|slot| {
            slot.as_ref()
                .is_some_and(|e| describes(spec, name, direction, path, e))
        })
        .and_then(Option::take);
    if let Some(entry) = matched {
        let patch = TimingPatch {
            start: spec.start,
            duration_ms: spec.duration_ms,
            delay_ms: spec.delay_ms,
            repeat: spec.repeat,
        };
        return Ok(Slot::Kept(entry, patch));
    }
    let (Some(effect), Some(variant)) = (created, variant) else {
        let names = presets::names(class);
        return Err(invalid(format!(
            "`{name}` {} animations can only be kept, and shape {} has none to keep{}",
            presets::class_name(class),
            spec.shape_id,
            if names.is_empty() {
                String::new()
            } else {
                format!("; new ones can be {}", names.join(", "))
            }
        )));
    };
    let instant = effect.default_ms == 0;
    Ok(Slot::New(NewEffect {
        class,
        effect,
        variant,
        shape: spec.shape_id,
        paragraph: spec.paragraph,
        start: spec.start.unwrap_or(AnimationStart::OnClick),
        duration_ms: if instant {
            0
        } else {
            spec.duration_ms.unwrap_or(effect.default_ms)
        },
        delay_ms: spec.delay_ms.unwrap_or(0),
        repeat: spec.repeat,
        path,
    }))
}

/// From an effect's start to its end: its delay, then every play.
fn span(delay_ms: u32, duration_ms: u32, repeat: Option<AnimationRepeat>) -> u64 {
    let plays = match repeat {
        Some(AnimationRepeat::Times(n)) if n > 0.0 => f64::from(n),
        _ => 1.0,
    };
    u64::from(delay_ms) + (f64::from(duration_ms) * plays).round() as u64
}

/// Stretches an effect's behaviors from `old` to `new` milliseconds. A
/// last-moment `p:set` (exits hide the shape 1 ms before they end) stays
/// at the end.
fn rescale(doc: &mut XmlDoc, ctn: NodeId, old: u32, new: u32) {
    let scale = |v: u32| (f64::from(v) * f64::from(new) / f64::from(old)).round() as u32;
    for n in read::behavior_ctns(doc, ctn) {
        let dur = doc.attr_i64(n, "dur").and_then(|v| u32::try_from(v).ok());
        if let Some(d) = dur.filter(|&d| d > 1) {
            doc.set_attr(n, "dur", &scale(d).max(1).to_string());
        }
        let Some(list) = doc.child(n, Ns::P, "stCondLst") else {
            continue;
        };
        let conds: Vec<NodeId> = doc.children_named(list, Ns::P, "cond").collect();
        for c in conds {
            let Some(delay) = doc.attr_i64(c, "delay").and_then(|v| u32::try_from(v).ok()) else {
                continue;
            };
            let moved = if dur == Some(1) && delay + 1 == old {
                new.saturating_sub(1)
            } else {
                scale(delay)
            };
            doc.set_attr(c, "delay", &moved.to_string());
        }
    }
}

/// Sets an effect's delay (its first start condition).
fn set_delay(doc: &mut XmlDoc, ctn: NodeId, delay: u32) {
    let list = doc.ensure_child(ctn, Ns::P, "stCondLst", CTN_ORDER);
    let cond = doc
        .children_named(list, Ns::P, "cond")
        .find(|&c| doc.attr(c, "evt").is_none());
    let cond = match cond {
        Some(c) => c,
        None => {
            let c = doc.create_element(Ns::P, "cond");
            doc.insert_child(list, 0, c);
            c
        }
    };
    doc.set_attr(cond, "delay", &delay.to_string());
}

/// Sets how often an effect plays.
fn set_repeat(doc: &mut XmlDoc, ctn: NodeId, repeat: AnimationRepeat) -> Result<()> {
    doc.remove_children_named(ctn, Ns::P, "endCondLst");
    match repeat {
        AnimationRepeat::Times(1.0) => doc.remove_attr(ctn, "repeatCount"),
        AnimationRepeat::Times(n) => {
            let thousandths = (f64::from(n) * 1000.0).round();
            doc.set_attr(ctn, "repeatCount", &thousandths.to_string());
        }
        AnimationRepeat::Until(until) => {
            doc.set_attr(ctn, "repeatCount", "indefinite");
            if until == RepeatUntil::UntilNextClick {
                let end = import_fragment(
                    doc,
                    r#"<p:endCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>"#,
                )?;
                doc.insert_in_order(ctn, end, CTN_ORDER);
            }
        }
    }
    Ok(())
}

/// Puts a slot's effect in the document, with its timing.
fn place(doc: &mut XmlDoc, slot: Slot<'_>) -> Result<Placed> {
    match slot {
        Slot::Kept(entry, patch) => {
            let o = &entry.outline;
            let mut duration = o.duration_ms;
            if let Some(d) = patch.duration_ms.filter(|&d| d != duration && duration > 0) {
                rescale(doc, entry.ctn, duration, d);
                duration = d;
            }
            let delay = patch.delay_ms.unwrap_or(o.delay_ms);
            if patch.delay_ms.is_some() {
                set_delay(doc, entry.ctn, delay);
            }
            if let Some(r) = patch.repeat {
                set_repeat(doc, entry.ctn, r)?;
            }
            Ok(Placed {
                par: entry.par,
                start: patch.start.unwrap_or(o.start),
                span_ms: span(delay, duration, patch.repeat.or(o.repeat)),
                shape: o.shape_id,
                build: Build::Kept(entry.grp),
            })
        }
        Slot::New(e) => {
            let par = import_fragment(doc, &markup::effect_xml(&e))?;
            let build = match e.paragraph {
                Some(_) => Build::Paragraph(format!(
                    "{}/{}/{}",
                    presets::class_attr(e.class),
                    e.effect.name,
                    e.variant.name
                )),
                None => Build::Shape,
            };
            Ok(Placed {
                par,
                start: e.start,
                span_ms: span(e.delay_ms, e.duration_ms, e.repeat),
                shape: e.shape,
                build,
            })
        }
    }
}

/// Writes the slots as the slide's main sequence.
fn rewrite(doc: &mut XmlDoc, slots: Vec<Slot<'_>>, shapes: &ShapeIndex) -> Result<()> {
    let placed = slots
        .into_iter()
        .map(|s| place(doc, s))
        .collect::<Result<Vec<_>>>()?;
    sequence::write(doc, placed, shapes)
}

fn kept<'a>(entry: Entry) -> Slot<'a> {
    Slot::Kept(entry, TimingPatch::default())
}

/// Replaces a slide's main sequence (see [`EditOp::SetAnimations`](super::EditOp::SetAnimations)).
pub(super) fn set_animations(
    pres: &mut Presentation,
    slide: u32,
    specs: &[AnimationSpec],
) -> Result<()> {
    let part = pres.slide_part(slide)?;
    let doc = pres.xml_mut(&part)?;
    let shapes = ShapeIndex::of(doc);
    let mut existing: Vec<Option<Entry>> =
        read::entries(doc, &shapes).into_iter().map(Some).collect();
    let mut slots = Vec::with_capacity(specs.len());
    for (i, spec) in specs.iter().enumerate() {
        slots.push(resolve(spec, &shapes, &mut existing).map_err(|e| numbered(i, e))?);
    }
    rewrite(doc, slots, &shapes)
}

/// Adds an animation (see [`EditOp::AddAnimation`](super::EditOp::AddAnimation)).
pub(super) fn add_animation(
    pres: &mut Presentation,
    slide: u32,
    spec: &AnimationSpec,
    index: Option<usize>,
) -> Result<()> {
    let part = pres.slide_part(slide)?;
    let doc = pres.xml_mut(&part)?;
    let shapes = ShapeIndex::of(doc);
    let entries = read::entries(doc, &shapes);
    let count = entries.len();
    let at = index.unwrap_or(count);
    if at > count {
        return Err(invalid(format!(
            "index {at} is past the end of the slide's {count} animations"
        )));
    }
    let new = resolve(spec, &shapes, &mut [])?;
    let mut slots: Vec<Slot<'_>> = entries.into_iter().map(kept).collect();
    slots.insert(at, new);
    rewrite(doc, slots, &shapes)
}

/// Removes animations (see [`EditOp::RemoveAnimations`](super::EditOp::RemoveAnimations)).
pub(super) fn remove_animations(
    pres: &mut Presentation,
    slide: u32,
    shape_ids: Option<&[u32]>,
    indexes: Option<&[usize]>,
) -> Result<()> {
    if shape_ids.is_none() && indexes.is_none() {
        return Err(invalid(
            "removeAnimations needs shapeIds or indexes (setAnimations with [] removes every animation)"
                .into(),
        ));
    }
    let part = pres.slide_part(slide)?;
    let doc = pres.xml_mut(&part)?;
    let shapes = ShapeIndex::of(doc);
    let entries = read::entries(doc, &shapes);
    let shape_ids = shape_ids.unwrap_or_default();
    let indexes = indexes.unwrap_or_default();
    if let Some(id) = shape_ids.iter().find(|&&id| shapes.get(id).is_none()) {
        return Err(invalid(format!("shape {id} is not on the slide")));
    }
    if let Some(i) = indexes.iter().find(|&&i| i >= entries.len()) {
        return Err(invalid(format!(
            "there is no animation {i} (the slide has {})",
            entries.len()
        )));
    }
    let slots = entries
        .into_iter()
        .enumerate()
        .filter(|(i, e)| !indexes.contains(i) && !shape_ids.contains(&e.outline.shape_id))
        .map(|(_, e)| kept(e))
        .collect();
    rewrite(doc, slots, &shapes)
}

/// What a slide's timing names that is not on the slide: missing shapes,
/// and paragraphs past the end of a shape's text.
pub(crate) fn dangling_targets(doc: &XmlDoc) -> Vec<String> {
    let Some(timing) = read::timing(doc) else {
        return Vec::new();
    };
    let shapes = ShapeIndex::of(doc);
    let mut out = Vec::new();
    for n in doc.descendants(timing) {
        if read::is_shape_target(doc, n) {
            match read::target_of(doc, n) {
                Some(t) if shapes.holds(&t) => {}
                Some(t) => out.push(match (shapes.get(t.shape), t.paragraphs) {
                    (Some(_), Some((st, end))) => format!(
                        "animation names paragraphs {st}-{end} of shape {}, which it does not have",
                        t.shape
                    ),
                    _ => format!("animation names missing shape {}", t.shape),
                }),
                None => out.push("animation target has no shape id".to_owned()),
            }
        } else if doc.parent(n).is_some_and(|p| doc.is(p, Ns::P, "bldLst"))
            && let Some(spid) = doc.attr(n, "spid")
            && spid
                .trim()
                .parse::<u32>()
                .ok()
                .and_then(|id| shapes.get(id))
                .is_none()
        {
            out.push(format!("build list names missing shape {spid}"));
        }
    }
    out
}

/// Drops a slide's animations of shapes and paragraphs that are gone,
/// leaving the slide untouched when there are none.
pub(crate) fn scrub(pres: &mut Presentation, part: &str) -> Result<()> {
    if dangling_targets(&*pres.xml(part)?).is_empty() {
        return Ok(());
    }
    let doc = pres.xml_mut(part)?;
    let shapes = ShapeIndex::of(doc);
    let slots = read::entries(doc, &shapes).into_iter().map(kept).collect();
    rewrite(doc, slots, &shapes)
}

#[cfg(test)]
mod test;
