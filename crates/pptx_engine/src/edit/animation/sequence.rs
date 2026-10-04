//! Writing a slide's timing: the main sequence laid out as PowerPoint lays
//! it out (click groups of time groups of effects), the build list, effects
//! elsewhere in the timing whose shapes are gone, and time node ids.

use super::read::{
    NODE_TYPES, ShapeIndex, ctn_of, is_effect, is_shape_target, main_seq, root_ctn, target_of,
    timing,
};
use crate::edit::AnimationStart;
use crate::edit::xmlutil::import_fragment;
use crate::error::Result;
use crate::xml::{NodeId, Ns, XmlDoc};
use std::collections::{HashMap, HashSet};

/// Child order of `p:timing`.
const TIMING_ORDER: &[&str] = &["tnLst", "bldLst", "extLst"];
/// Child order of `p:cTn`.
pub(super) const CTN_ORDER: &[&str] = &[
    "stCondLst",
    "endCondLst",
    "endSync",
    "iterate",
    "childTnLst",
    "subTnLst",
];
/// Elements of `p:bldLst`.
const BUILDS: &[&str] = &["bldP", "bldDgm", "bldOleChart", "bldGraphic"];

/// An effect placed in the main sequence.
pub(super) struct Placed {
    /// The effect's `p:par` (in the document, attached or not).
    pub par: NodeId,
    pub start: AnimationStart,
    /// From the effect's start to its end: delay, then every play.
    pub span_ms: u64,
    pub shape: u32,
    pub build: Build,
}

/// The build group (`grpId`) an effect belongs to.
pub(super) enum Build {
    /// An effect kept from the file, with its `grpId` there.
    Kept(Option<u32>),
    /// A new effect on one paragraph: new effects with the same key on the
    /// same shape build its text paragraph by paragraph, as one group.
    Paragraph(String),
    /// A new effect on the whole shape.
    Shape,
}

/// Rewrites a slide's main sequence as `effects` and tidies the rest of
/// its timing (see the module documentation).
pub(super) fn write(doc: &mut XmlDoc, effects: Vec<Placed>, shapes: &ShapeIndex) -> Result<()> {
    let mut timing = timing(doc).map(|t| unwrap_alternate(doc, t));
    if let Some(t) = timing.filter(|&t| root_ctn(doc, t).is_none()) {
        // Without a root time node there is nothing to keep.
        doc.detach(t);
        timing = None;
    }
    let timing = match timing {
        Some(t) => t,
        None if effects.is_empty() => return Ok(()),
        None => create_timing(doc)?,
    };
    let Some(root) = root_ctn(doc, timing) else {
        return Ok(());
    };
    let old_builds = build_entries(doc, timing);
    let main = main_seq(doc, timing).map(|(seq, _)| seq);
    prune(doc, root, main, shapes);
    let kept_groups = groups_outside(doc, root, main);
    let laid_out = if effects.is_empty() {
        if let Some(seq) = main {
            doc.detach(seq);
        }
        Vec::new()
    } else {
        lay_out(doc, timing, root, &effects)?;
        assign_groups(doc, &effects, &kept_groups)
    };
    write_builds(
        doc,
        timing,
        &effects,
        &laid_out,
        &old_builds,
        &kept_groups,
        shapes,
    )?;
    let list = doc.child(root, Ns::P, "childTnLst");
    if list.is_none_or(|l| doc.first_child(l).is_none()) {
        doc.detach(timing);
        return Ok(());
    }
    renumber(doc, timing);
    Ok(())
}

/// Adds the time node media shape `shape` plays from (`p:video` or
/// `p:audio`) to the slide's timing, as PowerPoint writes it for inserted
/// media: it plays when clicked in a slide show.
pub(crate) fn add_media_node(doc: &mut XmlDoc, shape: u32, audio: bool) -> Result<()> {
    let existing = timing(doc).map(|t| unwrap_alternate(doc, t));
    let timing = match existing.filter(|&t| root_ctn(doc, t).is_some()) {
        Some(t) => t,
        None => {
            if let Some(t) = existing {
                doc.detach(t);
            }
            create_timing(doc)?
        }
    };
    let Some(root) = root_ctn(doc, timing) else {
        return Ok(());
    };
    let list = doc.ensure_child(root, Ns::P, "childTnLst", CTN_ORDER);
    let id = max_id(doc, timing) + 1;
    let el = if audio { "audio" } else { "video" };
    let node = import_fragment(
        doc,
        &format!(
            r#"<p:{el}><p:cMediaNode vol="80000"><p:cTn id="{id}" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="{shape}"/></p:tgtEl></p:cMediaNode></p:{el}>"#
        ),
    )?;
    doc.append_child(list, node);
    Ok(())
}

/// Replaces an `mc:AlternateContent` around the timing with the timing itself.
fn unwrap_alternate(doc: &mut XmlDoc, timing: NodeId) -> NodeId {
    let root = doc.root();
    if doc.parent(timing) == Some(root) {
        return timing;
    }
    let wrapper = doc
        .children(root)
        .find(|&c| doc.descendants(c).contains(&timing));
    if let Some(w) = wrapper {
        doc.insert_before(w, timing);
        doc.detach(w);
    }
    timing
}

/// Adds an empty timing at its schema position in the slide.
fn create_timing(doc: &mut XmlDoc) -> Result<NodeId> {
    let node = import_fragment(
        doc,
        r#"<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"/></p:par></p:tnLst></p:timing>"#,
    )?;
    let root = doc.root();
    let before = doc
        .children(root)
        .find(|&c| crate::edit::transition::wrapped_local(doc, c) == "extLst");
    match before {
        Some(b) => doc.insert_before(b, node),
        None => doc.append_child(root, node),
    }
    Ok(node)
}

/// The build list's entries by shape and build group.
fn build_entries(doc: &XmlDoc, timing: NodeId) -> HashMap<(u32, u32), NodeId> {
    let Some(list) = doc.child(timing, Ns::P, "bldLst") else {
        return HashMap::new();
    };
    doc.children(list)
        .filter_map(|b| {
            let spid = doc.attr(b, "spid")?.trim().parse().ok()?;
            let grp = doc
                .attr_i64(b, "grpId")
                .and_then(|g| u32::try_from(g).ok())?;
            Some(((spid, grp), b))
        })
        .collect()
}

/// Whether anything below `node` names a shape (or paragraph) that is gone.
fn names_missing(doc: &XmlDoc, node: NodeId, shapes: &ShapeIndex) -> bool {
    doc.descendants(node)
        .into_iter()
        .filter(|&n| is_shape_target(doc, n))
        .any(|n| target_of(doc, n).is_none_or(|t| !shapes.holds(&t)))
}

/// Removes effects, media nodes, and trigger sequences outside the main
/// sequence that name missing shapes, then the groups that leaves empty.
fn prune(doc: &mut XmlDoc, root: NodeId, main: Option<NodeId>, shapes: &ShapeIndex) {
    let inside_main: HashSet<NodeId> = main
        .map(|m| doc.descendants(m).into_iter().chain([m]).collect())
        .unwrap_or_default();
    let nodes: Vec<NodeId> = doc
        .descendants(root)
        .into_iter()
        .filter(|n| !inside_main.contains(n))
        .collect();
    for &n in &nodes {
        let doomed = if is_effect(doc, n) || doc.is(n, Ns::P, "video") || doc.is(n, Ns::P, "audio")
        {
            names_missing(doc, n, shapes)
        } else if doc.is(n, Ns::P, "seq") {
            // A trigger sequence starts on a click on a shape.
            let triggers: Vec<NodeId> = ctn_of(doc, n)
                .and_then(|c| doc.child(c, Ns::P, "stCondLst"))
                .into_iter()
                .chain(doc.child(n, Ns::P, "nextCondLst"))
                .chain(doc.child(n, Ns::P, "prevCondLst"))
                .collect();
            triggers.into_iter().any(|t| names_missing(doc, t, shapes))
        } else {
            false
        };
        if doomed {
            doc.detach(n);
        }
    }
    // Groups left without effects (bottom up, so emptied parents follow).
    for &n in nodes.iter().rev() {
        let container = doc.is(n, Ns::P, "par") || doc.is(n, Ns::P, "seq");
        if !container || Some(n) == main || doc.parent(n).is_none() {
            continue;
        }
        let empty = ctn_of(doc, n)
            .and_then(|c| doc.child(c, Ns::P, "childTnLst"))
            .is_some_and(|l| doc.first_child(l).is_none());
        if empty {
            doc.detach(n);
        }
    }
    for &n in nodes.iter().rev() {
        if doc.is(n, Ns::P, "childTnLst") && doc.parent(n).is_some() && doc.first_child(n).is_none()
        {
            // An empty child list is not schema-valid; the node stays as a leaf.
            doc.detach(n);
        }
    }
}

/// The build groups of effects outside the main sequence, by shape.
fn groups_outside(doc: &XmlDoc, root: NodeId, main: Option<NodeId>) -> HashMap<u32, HashSet<u32>> {
    let inside_main: HashSet<NodeId> = main
        .map(|m| doc.descendants(m).into_iter().collect())
        .unwrap_or_default();
    let mut out: HashMap<u32, HashSet<u32>> = HashMap::new();
    for n in doc.descendants(root) {
        if inside_main.contains(&n) || !is_effect(doc, n) {
            continue;
        }
        let Some(ctn) = ctn_of(doc, n) else {
            continue;
        };
        let grp = doc
            .attr_i64(ctn, "grpId")
            .and_then(|g| u32::try_from(g).ok());
        let shape = doc
            .descendants(ctn)
            .into_iter()
            .filter(|&t| is_shape_target(doc, t))
            .find_map(|t| target_of(doc, t));
        if let (Some(grp), Some(target)) = (grp, shape) {
            out.entry(target.shape).or_default().insert(grp);
        }
    }
    out
}

/// The main sequence's time node, creating its `p:seq` (first among the
/// root's children) if the slide has none.
fn ensure_main_seq(doc: &mut XmlDoc, timing: NodeId, root: NodeId) -> Result<NodeId> {
    if let Some((_, ctn)) = main_seq(doc, timing) {
        return Ok(ctn);
    }
    let list = doc.ensure_child(root, Ns::P, "childTnLst", CTN_ORDER);
    // A unique id until the timing is numbered, so conditions can name it.
    let id = max_id(doc, timing) + 1;
    let seq = import_fragment(
        doc,
        &format!(
            r#"<p:seq concurrent="1" nextAc="seek"><p:cTn id="{id}" dur="indefinite" nodeType="mainSeq"><p:childTnLst/></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>"#
        ),
    )?;
    doc.insert_child(list, 0, seq);
    Ok(ctn_of(doc, seq).unwrap_or(seq))
}

/// The largest time node id in the timing.
fn max_id(doc: &XmlDoc, timing: NodeId) -> u32 {
    doc.descendants(timing)
        .into_iter()
        .filter(|&n| doc.is(n, Ns::P, "cTn"))
        .filter_map(|n| doc.attr_i64(n, "id").and_then(|v| u32::try_from(v).ok()))
        .max()
        .unwrap_or(0)
}

/// Lays the effects out as the main sequence: a click group per click
/// (the first effect starts one even when it does not wait for a click,
/// and then starts with the slide), a time group per click and per
/// effect that waits for the previous one, starting when that time group
/// ends.
fn lay_out(doc: &mut XmlDoc, timing: NodeId, root: NodeId, effects: &[Placed]) -> Result<()> {
    let seq_ctn = ensure_main_seq(doc, timing, root)?;
    let seq_id = doc.attr(seq_ctn, "id").unwrap_or("0").to_owned();
    let list = doc.ensure_child(seq_ctn, Ns::P, "childTnLst", CTN_ORDER);
    for c in doc.child_nodes(list).to_vec() {
        doc.detach(c);
    }
    let mut click_list = None;
    let mut time_list = None;
    let mut time_start = 0u64;
    let mut time_span = 0u64;
    for (i, e) in effects.iter().enumerate() {
        if i == 0 || e.start == AnimationStart::OnClick {
            let begin = if e.start == AnimationStart::OnClick {
                String::new()
            } else {
                format!(r#"<p:cond evt="onBegin" delay="0"><p:tn val="{seq_id}"/></p:cond>"#)
            };
            let group = import_fragment(
                doc,
                &format!(
                    r#"<p:par><p:cTn id="0" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>{begin}</p:stCondLst><p:childTnLst/></p:cTn></p:par>"#
                ),
            )?;
            doc.append_child(list, group);
            click_list = child_list(doc, group);
            time_list = None;
            time_start = 0;
            time_span = 0;
        }
        if time_list.is_none() || e.start == AnimationStart::AfterPrevious {
            if time_list.is_some() {
                time_start += time_span;
            }
            time_span = 0;
            let group = import_fragment(
                doc,
                &format!(
                    r#"<p:par><p:cTn id="0" fill="hold"><p:stCondLst><p:cond delay="{time_start}"/></p:stCondLst><p:childTnLst/></p:cTn></p:par>"#
                ),
            )?;
            if let Some(c) = click_list {
                doc.append_child(c, group);
            }
            time_list = child_list(doc, group);
        }
        time_span = time_span.max(e.span_ms);
        if let Some(t) = time_list {
            doc.append_child(t, e.par);
        }
        if let Some(ctn) = ctn_of(doc, e.par) {
            let node = NODE_TYPES
                .iter()
                .find(|(s, _)| *s == e.start)
                .map_or("clickEffect", |(_, n)| n);
            doc.set_attr(ctn, "nodeType", node);
        }
    }
    Ok(())
}

fn child_list(doc: &XmlDoc, par: NodeId) -> Option<NodeId> {
    ctn_of(doc, par).and_then(|c| doc.child(c, Ns::P, "childTnLst"))
}

/// Gives every effect its build group: per shape in playback order, a new
/// group for each whole-shape effect, one shared group for each kept group
/// and for each run of new paragraph effects alike, skipping groups that
/// trigger sequences use. Returns each effect's group.
fn assign_groups(
    doc: &mut XmlDoc,
    effects: &[Placed],
    taken: &HashMap<u32, HashSet<u32>>,
) -> Vec<u32> {
    let mut next: HashMap<u32, u32> = HashMap::new();
    let mut shared: HashMap<(u32, String), u32> = HashMap::new();
    let mut out = Vec::with_capacity(effects.len());
    for e in effects {
        let key = match &e.build {
            Build::Kept(Some(g)) => Some(format!("kept {g}")),
            Build::Paragraph(k) => Some(format!("new {k}")),
            Build::Kept(None) | Build::Shape => None,
        };
        let existing = key.as_ref().and_then(|k| shared.get(&(e.shape, k.clone())));
        let grp = match existing {
            Some(&g) => g,
            None => {
                let counter = next.entry(e.shape).or_insert(0);
                let used = taken.get(&e.shape);
                while used.is_some_and(|u| u.contains(counter)) {
                    *counter += 1;
                }
                let g = *counter;
                *counter += 1;
                if let Some(k) = key {
                    shared.insert((e.shape, k), g);
                }
                g
            }
        };
        if let Some(ctn) = ctn_of(doc, e.par) {
            doc.set_attr(ctn, "grpId", &grp.to_string());
        }
        out.push(grp);
    }
    out
}

/// Rebuilds the build list: entries for the main sequence's groups (kept
/// effects keep theirs; new effects on shapes with text get a `p:bldP`),
/// then the entries trigger sequences use. Others are dropped.
fn write_builds(
    doc: &mut XmlDoc,
    timing: NodeId,
    effects: &[Placed],
    groups: &[u32],
    old: &HashMap<(u32, u32), NodeId>,
    taken: &HashMap<u32, HashSet<u32>>,
    shapes: &ShapeIndex,
) -> Result<()> {
    let mut entries: Vec<NodeId> = Vec::new();
    let mut seen: HashSet<(u32, u32)> = HashSet::new();
    for (e, &grp) in effects.iter().zip(groups) {
        if !seen.insert((e.shape, grp)) {
            continue;
        }
        let entry = match &e.build {
            Build::Kept(g) => g.and_then(|g| old.get(&(e.shape, g))).map(|&b| {
                let copy = doc.deep_clone(b);
                doc.set_attr(copy, "grpId", &grp.to_string());
                copy
            }),
            Build::Paragraph(_) | Build::Shape => {
                // Text shapes build their text with the shape (`p:bldP`).
                let Some(facts) = shapes
                    .get(e.shape)
                    .filter(|f| f.element == "sp" && f.paragraphs.is_some())
                else {
                    continue;
                };
                let by_paragraph = matches!(e.build, Build::Paragraph(_));
                let extra = if by_paragraph {
                    r#" build="p""#
                } else if !facts.text_frame {
                    r#" animBg="1""#
                } else {
                    ""
                };
                Some(import_fragment(
                    doc,
                    &format!(r#"<p:bldP spid="{}" grpId="{grp}"{extra}/>"#, e.shape),
                )?)
            }
        };
        entries.extend(entry);
    }
    let mut kept: Vec<(&(u32, u32), &NodeId)> = old
        .iter()
        .filter(|((shape, grp), _)| taken.get(shape).is_some_and(|g| g.contains(grp)))
        .collect();
    kept.sort_by_key(|&(_, node)| *node);
    let kept: Vec<NodeId> = kept.into_iter().map(|(_, &n)| n).collect();
    let list = match doc.child(timing, Ns::P, "bldLst") {
        Some(l) => l,
        None if entries.is_empty() && kept.is_empty() => return Ok(()),
        None => doc.ensure_child(timing, Ns::P, "bldLst", TIMING_ORDER),
    };
    for c in doc.child_nodes(list).to_vec() {
        let is_build = BUILDS.contains(&doc.local(c));
        if is_build && !kept.contains(&c) {
            doc.detach(c);
        }
    }
    for (i, e) in entries.into_iter().enumerate() {
        doc.insert_child(list, i, e);
    }
    if doc.first_child(list).is_none() {
        doc.detach(list);
    }
    Ok(())
}

/// Numbers the time nodes 1, 2, 3... in document order, as PowerPoint
/// does, and points conditions naming a node (`p:tn`) at its new id;
/// conditions naming a node that is gone are dropped.
fn renumber(doc: &mut XmlDoc, timing: NodeId) {
    let Some(tn_lst) = doc.child(timing, Ns::P, "tnLst") else {
        return;
    };
    let mut ids: HashMap<String, String> = HashMap::new();
    let mut next = 1u32;
    for n in doc.descendants(tn_lst) {
        if !doc.is(n, Ns::P, "cTn") {
            continue;
        }
        let new = next.to_string();
        next += 1;
        if let Some(old) = doc.attr(n, "id").filter(|v| *v != "0") {
            ids.entry(old.to_owned()).or_insert_with(|| new.clone());
        }
        doc.set_attr(n, "id", &new);
    }
    for n in doc.descendants(tn_lst) {
        if !doc.is(n, Ns::P, "tn") {
            continue;
        }
        match doc.attr(n, "val").and_then(|v| ids.get(v)).cloned() {
            Some(new) => doc.set_attr(n, "val", &new),
            None => {
                let cond = doc.parent(n).filter(|&c| doc.is(c, Ns::P, "cond"));
                let list = cond.and_then(|c| doc.parent(c));
                if let Some(c) = cond {
                    doc.detach(c);
                }
                if let Some(l) = list.filter(|&l| doc.first_child(l).is_none()) {
                    doc.detach(l);
                }
            }
        }
    }
}
