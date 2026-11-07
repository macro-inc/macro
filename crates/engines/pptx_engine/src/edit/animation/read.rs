//! Reading animations: where a slide's timing and main sequence are, the
//! shapes animations may name, and what each effect of the main sequence
//! reads as.

use super::presets;
use crate::edit::{AnimationClass, AnimationRepeat, AnimationStart, RepeatUntil};
use crate::inspect::AnimationOutline;
use crate::model::shape::{alternate_content_choice, c_nv_pr, sp_tree};
use crate::xml::{NodeId, Ns, XmlDoc};
use std::collections::HashMap;

/// `nodeType` values of effects, by when they start.
pub(super) const NODE_TYPES: [(AnimationStart, &str); 3] = [
    (AnimationStart::OnClick, "clickEffect"),
    (AnimationStart::WithPrevious, "withEffect"),
    (AnimationStart::AfterPrevious, "afterEffect"),
];

/// What an animation may name: a shape and how many paragraphs it has.
#[derive(Clone, Debug)]
pub(super) struct ShapeFacts {
    /// Element name (`sp`, `pic`, `grpSp`, `graphicFrame`, `cxnSp`...).
    pub element: String,
    /// A placeholder or a text box (PowerPoint builds their text without
    /// animating a background).
    pub text_frame: bool,
    /// Paragraphs of its text body (`None`: it has none).
    pub paragraphs: Option<usize>,
}

/// The shapes of a slide by id, group members included.
pub(super) struct ShapeIndex(HashMap<u32, ShapeFacts>);

impl ShapeIndex {
    pub fn of(doc: &XmlDoc) -> Self {
        let mut map = HashMap::new();
        if let Some(tree) = sp_tree(doc) {
            index_tree(doc, tree, &mut map);
        }
        Self(map)
    }

    pub fn get(&self, id: u32) -> Option<&ShapeFacts> {
        self.0.get(&id)
    }

    /// Whether a target (a shape, maybe a paragraph range) still exists.
    pub fn holds(&self, target: &Target) -> bool {
        let Some(facts) = self.get(target.shape) else {
            return false;
        };
        match target.paragraphs {
            None => true,
            Some((st, end)) => st <= end && facts.paragraphs.is_some_and(|n| (end as usize) < n),
        }
    }
}

fn index_tree(doc: &XmlDoc, parent: NodeId, map: &mut HashMap<u32, ShapeFacts>) {
    for c in doc.children(parent) {
        if doc.is(c, Ns::MC, "AlternateContent") {
            if let Some(branch) = alternate_content_choice(doc, c) {
                index_tree(doc, branch, map);
            }
            continue;
        }
        let Some(id) = c_nv_pr(doc, c)
            .and_then(|p| doc.attr_i64(p, "id"))
            .and_then(|id| u32::try_from(id).ok())
        else {
            continue;
        };
        let nv = doc.children(c).find(|&n| doc.local(n).starts_with("nv"));
        let placeholder = nv
            .and_then(|nv| doc.child(nv, Ns::P, "nvPr"))
            .is_some_and(|pr| doc.child(pr, Ns::P, "ph").is_some());
        let text_box = nv
            .and_then(|nv| doc.child(nv, Ns::P, "cNvSpPr"))
            .and_then(|pr| doc.attr_bool(pr, "txBox"))
            .unwrap_or(false);
        let paragraphs = doc
            .child(c, Ns::P, "txBody")
            .map(|b| doc.children_named(b, Ns::A, "p").count());
        map.insert(
            id,
            ShapeFacts {
                element: doc.local(c).to_owned(),
                text_frame: placeholder || text_box,
                paragraphs,
            },
        );
        if doc.local(c) == "grpSp" {
            index_tree(doc, c, map);
        }
    }
}

/// What an effect animates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Target {
    pub shape: u32,
    /// `p:pRg` (first and last paragraph), for text effects.
    pub paragraphs: Option<(u32, u32)>,
}

/// The target a shape-target element (`p:spTgt`, `p:inkTgt`) names.
pub(super) fn target_of(doc: &XmlDoc, tgt: NodeId) -> Option<Target> {
    let shape = doc.attr(tgt, "spid")?.trim().parse::<u32>().ok()?;
    let paragraphs = doc
        .child(tgt, Ns::P, "txEl")
        .and_then(|t| doc.child(t, Ns::P, "pRg"))
        .map(|r| {
            let at = |name| {
                doc.attr_i64(r, name)
                    .and_then(|v| u32::try_from(v).ok())
                    .unwrap_or(u32::MAX)
            };
            (at("st"), at("end"))
        });
    Some(Target { shape, paragraphs })
}

/// Whether an element names a shape (`p:spTgt`, `p:inkTgt`).
pub(super) fn is_shape_target(doc: &XmlDoc, n: NodeId) -> bool {
    doc.is(n, Ns::P, "spTgt") || doc.is(n, Ns::P, "inkTgt")
}

/// The first target among an element's descendants.
fn first_target(doc: &XmlDoc, node: NodeId) -> Option<Target> {
    doc.descendants(node)
        .into_iter()
        .filter(|&n| is_shape_target(doc, n))
        .find_map(|n| target_of(doc, n))
}

/// The slide's `p:timing` (in the branch of `mc:AlternateContent` the
/// engine reads, when wrapped).
pub(super) fn timing(doc: &XmlDoc) -> Option<NodeId> {
    let root = doc.root();
    doc.children(root).find_map(|c| {
        if doc.is(c, Ns::P, "timing") {
            return Some(c);
        }
        if doc.is(c, Ns::MC, "AlternateContent") {
            let branch = alternate_content_choice(doc, c)?;
            return doc.child(branch, Ns::P, "timing");
        }
        None
    })
}

/// The root time node's `p:cTn` (`nodeType="tmRoot"`).
pub(super) fn root_ctn(doc: &XmlDoc, timing: NodeId) -> Option<NodeId> {
    doc.path(timing, Ns::P, &["tnLst", "par", "cTn"])
}

/// The main sequence's `p:seq` and its `p:cTn`.
pub(super) fn main_seq(doc: &XmlDoc, timing: NodeId) -> Option<(NodeId, NodeId)> {
    let list = doc.child(root_ctn(doc, timing)?, Ns::P, "childTnLst")?;
    doc.children_named(list, Ns::P, "seq").find_map(|seq| {
        let ctn = doc.child(seq, Ns::P, "cTn")?;
        (doc.attr(ctn, "nodeType") == Some("mainSeq")).then_some((seq, ctn))
    })
}

/// The `p:cTn` of a time container (`p:par`, `p:seq`, `p:excl`).
pub(super) fn ctn_of(doc: &XmlDoc, par: NodeId) -> Option<NodeId> {
    doc.child(par, Ns::P, "cTn")
}

/// Whether a `p:par` is an effect (rather than a click or time group).
pub(super) fn is_effect(doc: &XmlDoc, par: NodeId) -> bool {
    doc.is(par, Ns::P, "par")
        && ctn_of(doc, par).is_some_and(|ctn| {
            doc.attr(ctn, "presetClass").is_some()
                || matches!(
                    doc.attr(ctn, "nodeType"),
                    Some("clickEffect" | "withEffect" | "afterEffect")
                )
        })
}

/// The `p:par` children of a time container's child list (the branch the
/// engine reads of those PowerPoint wraps in `mc:AlternateContent`).
fn child_pars(doc: &XmlDoc, par: NodeId) -> Vec<NodeId> {
    let Some(list) = ctn_of(doc, par).and_then(|ctn| doc.child(ctn, Ns::P, "childTnLst")) else {
        return Vec::new();
    };
    doc.children(list)
        .filter_map(|c| {
            if doc.is(c, Ns::MC, "AlternateContent") {
                let branch = alternate_content_choice(doc, c)?;
                return doc.child(branch, Ns::P, "par");
            }
            doc.is(c, Ns::P, "par").then_some(c)
        })
        .collect()
}

/// Whether a `p:par` holds behaviors (an effect without PowerPoint's markers).
fn holds_behaviors(doc: &XmlDoc, par: NodeId) -> bool {
    ctn_of(doc, par)
        .and_then(|ctn| doc.child(ctn, Ns::P, "childTnLst"))
        .is_some_and(|list| {
            doc.children(list)
                .any(|c| !matches!(doc.local(c), "par" | "seq" | "excl" | "AlternateContent"))
        })
}

/// The effects under a container, outermost first, not looking inside effects.
fn effects_under(doc: &XmlDoc, par: NodeId, out: &mut Vec<NodeId>) {
    for c in child_pars(doc, par) {
        if is_effect(doc, c) || holds_behaviors(doc, c) {
            out.push(c);
        } else {
            effects_under(doc, c, out);
        }
    }
}

/// The effect `p:par`s of the main sequence in playback order, each with
/// the start its place implies (used when it has no `nodeType`).
fn effect_pars(doc: &XmlDoc, seq: NodeId) -> Vec<(NodeId, AnimationStart)> {
    let mut out = Vec::new();
    for click in child_pars(doc, seq) {
        if is_effect(doc, click) || holds_behaviors(doc, click) {
            out.push((click, AnimationStart::OnClick));
            continue;
        }
        let mut first_in_click = true;
        for time in child_pars(doc, click) {
            let mut effects = Vec::new();
            if is_effect(doc, time) || holds_behaviors(doc, time) {
                effects.push(time);
            } else {
                effects_under(doc, time, &mut effects);
            }
            for (i, effect) in effects.into_iter().enumerate() {
                let start = match (first_in_click, i) {
                    (true, _) => AnimationStart::OnClick,
                    (false, 0) => AnimationStart::AfterPrevious,
                    _ => AnimationStart::WithPrevious,
                };
                first_in_click = false;
                out.push((effect, start));
            }
        }
    }
    out
}

/// An effect of the main sequence.
pub(super) struct Entry {
    /// The effect's `p:par`.
    pub par: NodeId,
    /// Its `p:cTn`.
    pub ctn: NodeId,
    pub outline: AnimationOutline,
    /// `grpId`, which pairs the effect with its entry in the build list.
    pub grp: Option<u32>,
}

/// The effects of the main sequence whose target exists, in playback order.
pub(super) fn entries(doc: &XmlDoc, shapes: &ShapeIndex) -> Vec<Entry> {
    let Some((seq, _)) = timing(doc).and_then(|t| main_seq(doc, t)) else {
        return Vec::new();
    };
    effect_pars(doc, seq)
        .into_iter()
        .filter_map(|(par, implied)| {
            let ctn = ctn_of(doc, par)?;
            let target = first_target(doc, ctn)?;
            if !shapes.holds(&target) {
                return None;
            }
            Some(Entry {
                par,
                ctn,
                outline: outline(doc, ctn, target, implied),
                grp: doc
                    .attr_i64(ctn, "grpId")
                    .and_then(|g| u32::try_from(g).ok()),
            })
        })
        .collect()
}

/// The animations of a slide part's main sequence, in playback order.
pub(crate) fn read(doc: &XmlDoc) -> Vec<AnimationOutline> {
    entries(doc, &ShapeIndex::of(doc))
        .into_iter()
        .map(|e| e.outline)
        .collect()
}

fn attr_u32(doc: &XmlDoc, n: NodeId, name: &str) -> Option<u32> {
    doc.attr_i64(n, name).and_then(|v| u32::try_from(v).ok())
}

/// The first numeric start delay of a time node (`stCondLst/cond/@delay`).
pub(super) fn start_delay(doc: &XmlDoc, ctn: NodeId) -> Option<u32> {
    let list = doc.child(ctn, Ns::P, "stCondLst")?;
    doc.children_named(list, Ns::P, "cond")
        .find_map(|c| attr_u32(doc, c, "delay"))
}

/// The behaviors' time nodes of an effect (every `p:cTn` below its own).
pub(super) fn behavior_ctns(doc: &XmlDoc, ctn: NodeId) -> Vec<NodeId> {
    doc.descendants(ctn)
        .into_iter()
        .filter(|&n| doc.is(n, Ns::P, "cTn"))
        .collect()
}

/// How long one play of an effect lasts: the latest end of its behaviors
/// (0 when they all happen at once).
pub(super) fn span(doc: &XmlDoc, ctn: NodeId) -> u32 {
    let end = behavior_ctns(doc, ctn)
        .into_iter()
        .filter_map(|n| {
            let dur = u64::from(attr_u32(doc, n, "dur")?);
            let turns = if doc.attr_bool(n, "autoRev") == Some(true) {
                2
            } else {
                1
            };
            Some(u64::from(start_delay(doc, n).unwrap_or(0)) + dur * turns)
        })
        .max()
        .unwrap_or(0);
    if end <= 1 {
        0
    } else {
        u32::try_from(end).unwrap_or(u32::MAX)
    }
}

/// An effect's repetition (`repeatCount`, in thousandths, or `indefinite`).
pub(super) fn repeat_of(doc: &XmlDoc, ctn: NodeId) -> Option<AnimationRepeat> {
    let count = doc.attr(ctn, "repeatCount")?.trim();
    if count == "indefinite" {
        let on_next = doc.child(ctn, Ns::P, "endCondLst").is_some_and(|l| {
            doc.children_named(l, Ns::P, "cond")
                .any(|c| doc.attr(c, "evt") == Some("onNext"))
        });
        return Some(AnimationRepeat::Until(if on_next {
            RepeatUntil::UntilNextClick
        } else {
            RepeatUntil::UntilEndOfSlide
        }));
    }
    let thousandths = count.parse::<f64>().ok()?;
    (thousandths > 0.0 && thousandths != 1000.0)
        .then(|| AnimationRepeat::Times((thousandths / 1000.0) as f32))
}

/// The class of an effect without `presetClass`, from what it does.
fn infer_class(doc: &XmlDoc, ctn: NodeId) -> AnimationClass {
    let nodes = doc.descendants(ctn);
    let visibility = nodes.iter().find_map(|&n| {
        if !doc.is(n, Ns::P, "set") {
            return None;
        }
        let names = doc.descendants(n);
        let sets_visibility = names
            .iter()
            .any(|&a| doc.is(a, Ns::P, "attrName") && doc.text(a).trim() == "style.visibility");
        if !sets_visibility {
            return None;
        }
        names
            .iter()
            .find(|&&s| doc.is(s, Ns::P, "strVal"))
            .and_then(|&s| doc.attr(s, "val"))
            .map(str::to_owned)
    });
    match visibility.as_deref() {
        Some("visible") => AnimationClass::Entrance,
        Some("hidden") => AnimationClass::Exit,
        _ if nodes.iter().any(|&n| doc.is(n, Ns::P, "animMotion")) => AnimationClass::Path,
        _ if nodes.iter().any(|&n| doc.is(n, Ns::P, "cmd")) => AnimationClass::Media,
        _ => AnimationClass::Emphasis,
    }
}

/// Spin's direction: the sign of its rotation.
fn spin_direction(doc: &XmlDoc, ctn: NodeId) -> Option<&'static str> {
    let by = doc
        .descendants(ctn)
        .into_iter()
        .find(|&n| doc.is(n, Ns::P, "animRot"))
        .and_then(|n| doc.attr_f64(n, "by"))?;
    Some(if by < 0.0 {
        "counterclockwise"
    } else {
        "clockwise"
    })
}

fn outline(doc: &XmlDoc, ctn: NodeId, target: Target, implied: AnimationStart) -> AnimationOutline {
    let class = doc
        .attr(ctn, "presetClass")
        .and_then(presets::class_of)
        .unwrap_or_else(|| infer_class(doc, ctn));
    let preset_id = attr_u32(doc, ctn, "presetID").unwrap_or(0);
    let preset_subtype = attr_u32(doc, ctn, "presetSubtype").unwrap_or(0);
    let known = doc
        .attr(ctn, "presetClass")
        .and_then(|_| presets::identify(class, preset_id, preset_subtype));
    let (effect, mut direction) = known.unwrap_or((presets::CUSTOM, None));
    if class == AnimationClass::Emphasis && effect == "spin" {
        direction = spin_direction(doc, ctn);
    }
    let start = doc
        .attr(ctn, "nodeType")
        .and_then(|t| NODE_TYPES.iter().find(|(_, name)| *name == t))
        .map_or(implied, |(start, _)| *start);
    let path = (class == AnimationClass::Path)
        .then(|| {
            doc.descendants(ctn)
                .into_iter()
                .find(|&n| doc.is(n, Ns::P, "animMotion"))
                .and_then(|n| doc.attr(n, "path"))
                .map(str::to_owned)
        })
        .flatten();
    AnimationOutline {
        shape_id: target.shape,
        class,
        effect: effect.to_owned(),
        preset_id,
        preset_subtype,
        start,
        duration_ms: span(doc, ctn),
        delay_ms: start_delay(doc, ctn).unwrap_or(0),
        direction: direction.map(str::to_owned),
        paragraph: target.paragraphs.map(|(st, _)| st),
        repeat: repeat_of(doc, ctn),
        path,
    }
}
