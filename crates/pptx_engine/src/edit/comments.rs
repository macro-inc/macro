//! Review comments (PowerPoint's Review ▸ Comments): adding, replying to,
//! editing, resolving, and deleting comment threads.
//!
//! New comments are written in the threaded ("modern") format of PowerPoint
//! for Microsoft 365: one `p188:cmLst` part per slide, related from the slide
//! and named by a `p188:commentRel` extension in it, with authors in
//! `ppt/authors.xml`. Comments are anchored with Office's command monikers:
//! the slide (`pc:sldMkLst`) or a shape (`ac:deMkLst`), which name the
//! slide's `p14:creationId` and the shape's `a16:creationId`. Comments in the
//! older ("legacy") format are kept as they are; they can be edited and
//! deleted, but not replied to or resolved.

use super::xmlutil::{find_shape, new_guid};
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::shape::c_nv_pr;
use crate::opc::{TargetMode, rel_type};
use crate::units::pt_to_emu;
use crate::xml::{NodeId, Ns, XmlDoc};

/// Slide → threaded comments.
pub(crate) const MODERN_COMMENTS_REL: &str =
    "http://schemas.microsoft.com/office/2018/10/relationships/comments";
/// Presentation → threaded comment authors.
pub(crate) const AUTHORS_REL: &str =
    "http://schemas.microsoft.com/office/2018/10/relationships/authors";
/// Presentation → legacy comment authors.
pub(crate) const LEGACY_AUTHORS_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors";
const MODERN_COMMENTS_TYPE: &str = "application/vnd.ms-powerpoint.comments+xml";
const AUTHORS_TYPE: &str = "application/vnd.ms-powerpoint.authors+xml";
/// PowerPoint 2018 namespace of threaded comments (`p188:`).
const P188: &str = "http://schemas.microsoft.com/office/powerpoint/2018/8/main";
/// Office's PowerPoint command monikers (`pc:`).
const PC: &str = "http://schemas.microsoft.com/office/powerpoint/2013/main/command";
/// Office's drawing command monikers (`ac:`).
const AC: &str = "http://schemas.microsoft.com/office/drawing/2013/main/command";
/// The slide extension naming its threaded comments part.
const COMMENT_REL_EXT: &str = "{6950BFC3-D8DA-4A85-94F7-54DA5524770B}";
/// The slide extension holding its `p14:creationId`.
const SLIDE_CREATION_EXT: &str = "{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}";
/// The `cNvPr` extension holding a shape's `a16:creationId`.
const SHAPE_CREATION_EXT: &str = "{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}";
/// Legacy comment positions are in PowerPoint's master units (1/576 inch).
pub(crate) const LEGACY_UNITS_PER_PT: f64 = 8.0;
/// Child order of `p188:cm`.
const CM_ORDER: &[&str] = &[
    "sldMkLst", "deMkLst", "txMkLst", "pos", "replyLst", "txBody", "extLst",
];
/// Child order of `a:cNvPr`.
const C_NV_PR_ORDER: &[&str] = &["hlinkClick", "hlinkHover", "extLst"];

const NEW_COMMENTS: &str = concat!(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
    "<p188:cmLst xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
    "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
    "xmlns:p188=\"http://schemas.microsoft.com/office/powerpoint/2018/8/main\"/>"
);
const NEW_AUTHORS: &str = concat!(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
    "<p188:authorLst xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
    "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
    "xmlns:p188=\"http://schemas.microsoft.com/office/powerpoint/2018/8/main\"/>"
);

/// Whether `n` is the threaded-comments element `local`.
pub(crate) fn is_p188(doc: &XmlDoc, n: NodeId, local: &str) -> bool {
    doc.local(n) == local && doc.ns_uri(doc.ns(n)) == Some(P188)
}

/// The id the outline gives a legacy comment.
pub(crate) fn legacy_id(author: &str, idx: &str) -> String {
    format!("legacy-{author}-{idx}")
}

/// The shape a threaded comment is attached to: the last element moniker
/// (`ac:spMk`, `ac:picMk`...) of its drawing or text anchor.
pub(crate) fn shape_of_anchor(doc: &XmlDoc, cm: NodeId) -> Option<u32> {
    let anchor = doc
        .children(cm)
        .find(|&c| matches!(doc.local(c), "deMkLst" | "txMkLst"))?;
    doc.children(anchor)
        .filter(|&m| {
            let local = doc.local(m);
            local.ends_with("Mk") && !matches!(local, "docMk" | "sldMk" | "txMk")
        })
        .filter_map(|m| doc.attr_i64(m, "id"))
        .filter_map(|id| u32::try_from(id).ok())
        .last()
}

/// A new comment thread.
pub(crate) struct NewComment<'a> {
    pub text: &'a str,
    pub author: &'a str,
    pub initials: Option<&'a str>,
    /// Marker position (points), for comments on the slide.
    pub at: Option<(f32, f32)>,
    /// The shape to attach the comment to.
    pub shape: Option<u32>,
}

/// Adds a threaded comment; returns its id.
pub(crate) fn add_comment(pres: &mut Presentation, slide: u32, c: &NewComment) -> Result<String> {
    let text = checked_text(c.text)?;
    let part = pres.slide_part(slide)?;
    let author = ensure_author(pres, c.author, c.initials)?;
    let created = now(pres);
    let seed = format!("comment:{slide}:{created}:{text}");
    let slide_cid = ensure_slide_creation_id(pres, &part, &seed)?;
    let monikers = match c.shape {
        Some(shape) => Some(shape_monikers(pres, &part, shape, &seed)?),
        None => None,
    };
    let comments = ensure_comments_part(pres, slide, &part, slide_cid)?;
    let taken = comment_ids(pres, &comments)?;
    let id = new_guid(pres.pkg.ids().cloned().as_deref(), &seed, &taken);
    let doc = pres.xml_mut(&comments)?;
    let p188 = doc.intern_ns(P188);
    let cm = doc.create_element(p188, "cm");
    doc.set_attr(cm, "id", &id);
    doc.set_attr(cm, "authorId", &author);
    doc.set_attr(cm, "created", &created);
    let anchor = anchor_element(doc, slide, slide_cid, monikers.as_deref());
    doc.append_child(cm, anchor);
    if let (Some((x, y)), None) = (c.at, c.shape) {
        let pos = doc.create_element(p188, "pos");
        doc.set_attr(pos, "x", &pt_to_emu(f64::from(x.max(0.0))).to_string());
        doc.set_attr(pos, "y", &pt_to_emu(f64::from(y.max(0.0))).to_string());
        doc.append_child(cm, pos);
    }
    let body = text_body(doc, p188, text);
    doc.append_child(cm, body);
    let root = doc.root();
    doc.append_child(root, cm);
    Ok(id)
}

/// Replies to a threaded comment; returns the reply's id.
pub(crate) fn reply(
    pres: &mut Presentation,
    slide: u32,
    comment: &str,
    text: &str,
    author: &str,
    initials: Option<&str>,
) -> Result<String> {
    let text = checked_text(text)?;
    let part = pres.slide_part(slide)?;
    let Some((comments, _)) = find_modern(pres, &part, comment)? else {
        return Err(match find_legacy(pres, &part, comment)? {
            Some(_) => Error::InvalidEdit("legacy comments cannot be replied to".into()),
            None => missing(comment),
        });
    };
    let author = ensure_author(pres, author, initials)?;
    let created = now(pres);
    let taken = comment_ids(pres, &comments)?;
    let seed = format!("reply:{slide}:{comment}:{created}:{text}");
    let id = new_guid(pres.pkg.ids().cloned().as_deref(), &seed, &taken);
    let doc = pres.xml_mut(&comments)?;
    let (cm, kind) = find_in(doc, comment).ok_or_else(|| missing(comment))?;
    if kind != Found::Thread {
        return Err(Error::InvalidEdit(format!(
            "`{comment}` is a reply; reply to its thread instead"
        )));
    }
    let p188 = doc.intern_ns(P188);
    let existing = doc.children(cm).find(|&c| is_p188(doc, c, "replyLst"));
    let list = match existing {
        Some(l) => l,
        None => {
            let l = doc.create_element(p188, "replyLst");
            doc.insert_in_order(cm, l, CM_ORDER);
            l
        }
    };
    let r = doc.create_element(p188, "reply");
    doc.set_attr(r, "id", &id);
    doc.set_attr(r, "authorId", &author);
    doc.set_attr(r, "created", &created);
    let body = text_body(doc, p188, text);
    doc.append_child(r, body);
    doc.append_child(list, r);
    Ok(id)
}

/// Replaces the text of a thread's first comment or of a reply.
pub(crate) fn edit_comment(
    pres: &mut Presentation,
    slide: u32,
    comment: &str,
    text: &str,
) -> Result<()> {
    let text = checked_text(text)?;
    let part = pres.slide_part(slide)?;
    if let Some((comments, _)) = find_modern(pres, &part, comment)? {
        let doc = pres.xml_mut(&comments)?;
        let (node, _) = find_in(doc, comment).ok_or_else(|| missing(comment))?;
        let p188 = doc.intern_ns(P188);
        let old: Vec<NodeId> = doc
            .children(node)
            .filter(|&c| is_p188(doc, c, "txBody"))
            .collect();
        for o in old {
            doc.detach(o);
        }
        let body = text_body(doc, p188, text);
        doc.insert_in_order(node, body, CM_ORDER);
        return Ok(());
    }
    let (comments, cm) = find_legacy(pres, &part, comment)?.ok_or_else(|| missing(comment))?;
    let doc = pres.xml_mut(&comments)?;
    let t = doc.ensure_child(cm, Ns::P, "text", &["pos", "text", "extLst"]);
    doc.set_text(t, text);
    Ok(())
}

/// Marks a thread resolved, or active again.
pub(crate) fn resolve(
    pres: &mut Presentation,
    slide: u32,
    comment: &str,
    resolved: bool,
) -> Result<()> {
    let part = pres.slide_part(slide)?;
    let Some((comments, _)) = find_modern(pres, &part, comment)? else {
        return Err(match find_legacy(pres, &part, comment)? {
            Some(_) => Error::InvalidEdit("legacy comments cannot be resolved".into()),
            None => missing(comment),
        });
    };
    let doc = pres.xml_mut(&comments)?;
    let (cm, kind) = find_in(doc, comment).ok_or_else(|| missing(comment))?;
    if kind != Found::Thread {
        return Err(Error::InvalidEdit(format!(
            "`{comment}` is a reply; resolve its thread instead"
        )));
    }
    if resolved {
        doc.set_attr(cm, "status", "resolved");
    } else {
        doc.remove_attr(cm, "status");
    }
    Ok(())
}

/// Deletes a thread (with its replies) or one reply.
pub(crate) fn delete_comment(pres: &mut Presentation, slide: u32, comment: &str) -> Result<()> {
    let part = pres.slide_part(slide)?;
    if let Some((comments, _)) = find_modern(pres, &part, comment)? {
        let doc = pres.xml_mut(&comments)?;
        let (node, kind) = find_in(doc, comment).ok_or_else(|| missing(comment))?;
        let list = doc.parent(node);
        doc.detach(node);
        if let (Found::Reply, Some(list)) = (kind, list)
            && doc.children(list).all(|c| !is_p188(doc, c, "reply"))
        {
            doc.detach(list);
        }
        let empty = doc.children(doc.root()).all(|c| !is_p188(doc, c, "cm"));
        if empty {
            unlink(pres, &part, &comments)?;
        }
        return Ok(());
    }
    let (comments, cm) = find_legacy(pres, &part, comment)?.ok_or_else(|| missing(comment))?;
    let doc = pres.xml_mut(&comments)?;
    let id = legacy_id(
        doc.attr(cm, "authorId").unwrap_or_default(),
        doc.attr(cm, "idx").unwrap_or_default(),
    );
    // The thread's replies go with it.
    let replies: Vec<NodeId> = doc
        .children_named(doc.root(), Ns::P, "cm")
        .filter(|&c| {
            doc.descendants(c).into_iter().any(|n| {
                doc.local(n) == "parentCm"
                    && legacy_id(
                        doc.attr(n, "authorId").unwrap_or_default(),
                        doc.attr(n, "idx").unwrap_or_default(),
                    ) == id
            })
        })
        .collect();
    doc.detach(cm);
    for r in replies {
        doc.detach(r);
    }
    if doc.children_named(doc.root(), Ns::P, "cm").next().is_none() {
        unlink(pres, &part, &comments)?;
    }
    Ok(())
}

/// Deletes every comment on one slide, or on every slide.
pub(crate) fn delete_all(pres: &mut Presentation, slide: Option<u32>) -> Result<()> {
    let parts: Vec<String> = match slide {
        Some(id) => vec![pres.slide_part(id)?],
        None => pres.slides.iter().map(|s| s.part.clone()).collect(),
    };
    for part in parts {
        for target in comment_parts(pres, &part, None)? {
            unlink(pres, &part, &target)?;
        }
    }
    Ok(())
}

/// Whether slide extension `ext` names the slide's threaded comments part
/// (`p188:commentRel`); slide copies drop it, as their comments are not copied.
pub(crate) fn is_comment_rel_ext(doc: &XmlDoc, ext: NodeId) -> bool {
    doc.attr(ext, "uri")
        .is_some_and(|u| u.eq_ignore_ascii_case(COMMENT_REL_EXT))
        || doc
            .descendants(ext)
            .iter()
            .any(|&n| doc.local(n) == "commentRel")
}

// ---- lookups ---------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Found {
    Thread,
    Reply,
}

fn missing(comment: &str) -> Error {
    Error::NotFound(format!("comment {comment}"))
}

fn checked_text(text: &str) -> Result<&str> {
    let text = text.trim_matches(|c: char| c == '\r' || c == '\n');
    if text.trim().is_empty() {
        return Err(Error::InvalidEdit("a comment needs text".into()));
    }
    Ok(text)
}

/// The slide's comment parts of `kind` (`None`: both kinds).
fn comment_parts(
    pres: &mut Presentation,
    slide_part: &str,
    kind: Option<&str>,
) -> Result<Vec<String>> {
    let rels = pres.part_rels(slide_part)?;
    Ok(rels
        .iter()
        .filter(|r| r.mode == TargetMode::Internal)
        .filter(|r| match kind {
            Some(k) => r.rel_type == k,
            None => r.rel_type == MODERN_COMMENTS_REL || r.rel_type == rel_type::COMMENTS,
        })
        .map(|r| rels.resolve(r))
        .filter(|p| pres.pkg.has_part(p))
        .collect())
}

/// The threaded comments part holding comment or reply `id`, if any.
fn find_modern(
    pres: &mut Presentation,
    slide_part: &str,
    id: &str,
) -> Result<Option<(String, Found)>> {
    for part in comment_parts(pres, slide_part, Some(MODERN_COMMENTS_REL))? {
        let doc = pres.xml(&part)?;
        if let Some((_, kind)) = find_in(&doc, id) {
            return Ok(Some((part, kind)));
        }
    }
    Ok(None)
}

/// A comment (`p188:cm`) or reply (`p188:reply`) by id, compared ignoring case.
fn find_in(doc: &XmlDoc, id: &str) -> Option<(NodeId, Found)> {
    let same = |n: NodeId| {
        doc.attr(n, "id")
            .is_some_and(|v| v.eq_ignore_ascii_case(id))
    };
    for cm in doc.children(doc.root()).filter(|&c| is_p188(doc, c, "cm")) {
        if same(cm) {
            return Some((cm, Found::Thread));
        }
        for list in doc.children(cm).filter(|&c| is_p188(doc, c, "replyLst")) {
            if let Some(r) = doc
                .children(list)
                .find(|&r| is_p188(doc, r, "reply") && same(r))
            {
                return Some((r, Found::Reply));
            }
        }
    }
    None
}

/// The legacy comments part and `p:cm` of a `legacy-<author>-<idx>` id.
fn find_legacy(
    pres: &mut Presentation,
    slide_part: &str,
    id: &str,
) -> Result<Option<(String, NodeId)>> {
    if !id.starts_with("legacy-") {
        return Ok(None);
    }
    for part in comment_parts(pres, slide_part, Some(rel_type::COMMENTS))? {
        let doc = pres.xml(&part)?;
        if let Some(cm) = doc.children_named(doc.root(), Ns::P, "cm").find(|&cm| {
            legacy_id(
                doc.attr(cm, "authorId").unwrap_or_default(),
                doc.attr(cm, "idx").unwrap_or_default(),
            ) == id
        }) {
            return Ok(Some((part, cm)));
        }
    }
    Ok(None)
}

/// Every comment and reply id in a part (new GUIDs avoid them).
fn comment_ids(pres: &mut Presentation, part: &str) -> Result<Vec<String>> {
    let doc = pres.xml(part)?;
    Ok(doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| is_p188(&doc, n, "cm") || is_p188(&doc, n, "reply"))
        .filter_map(|n| doc.attr(n, "id").map(str::to_owned))
        .collect())
}

// ---- writing ---------------------------------------------------------------

/// The time comments are stamped with: UTC, to the millisecond, as
/// PowerPoint writes `created` (natively, the presentation's clock when set).
fn now(pres: &Presentation) -> String {
    #[cfg(target_arch = "wasm32")]
    let (t, millis) = {
        let _ = pres;
        let ms = js_sys::Date::now() as i64;
        (
            crate::model::field::FieldTime::from_unix(ms.div_euclid(1000), 0),
            ms.rem_euclid(1000),
        )
    };
    #[cfg(not(target_arch = "wasm32"))]
    let (t, millis) = (
        pres.clock
            .unwrap_or_else(crate::model::field::FieldTime::now_utc),
        0,
    );
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{millis:03}",
        t.year, t.month, t.day, t.hour, t.minute, t.second
    )
}

/// A number for `p14:creationId`: random with collaborative ids, else from `seed`.
fn creation_number(pres: &Presentation, seed: &str) -> u32 {
    match pres.pkg.ids() {
        Some(ids) => ids.next_in(1..u64::from(u32::MAX)) as u32,
        None => {
            let h = seed.bytes().fold(0x811C_9DC5_u32, |h, b| {
                (h ^ u32::from(b)).wrapping_mul(0x0100_0193)
            });
            h.max(1)
        }
    }
}

/// `initials` or the initials of `name` (up to two words).
fn initials_of(name: &str, initials: Option<&str>) -> String {
    match initials.map(str::trim).filter(|i| !i.is_empty()) {
        Some(i) => i.to_owned(),
        None => name
            .split_whitespace()
            .filter_map(|w| w.chars().next())
            .take(2)
            .flat_map(char::to_uppercase)
            .collect(),
    }
}

/// The id of the threaded-comments author `name`, adding the author (and
/// the authors part) when missing.
fn ensure_author(pres: &mut Presentation, name: &str, initials: Option<&str>) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::InvalidEdit("a comment needs an author".into()));
    }
    let main = pres.main_part.clone();
    let rels = pres.part_rels(&main)?;
    let existing = rels
        .iter()
        .find(|r| r.rel_type == AUTHORS_REL && r.mode == TargetMode::Internal)
        .map(|r| rels.resolve(r))
        .filter(|p| pres.pkg.has_part(p));
    let part = match existing {
        Some(p) => p,
        None => {
            let created = if pres.pkg.has_part("/ppt/authors.xml") {
                pres.pkg.unique_part_name("/ppt/authors", ".xml")
            } else {
                "/ppt/authors.xml".to_owned()
            };
            pres.pkg.write(
                &created,
                NEW_AUTHORS.as_bytes().to_vec(),
                Some(AUTHORS_TYPE),
            );
            pres.rels_mut(&main)?.add_internal(AUTHORS_REL, &created);
            created
        }
    };
    let doc = pres.xml(&part)?;
    let authors: Vec<NodeId> = doc
        .children(doc.root())
        .filter(|&a| is_p188(&doc, a, "author"))
        .collect();
    if let Some(id) = authors
        .iter()
        .find(|&&a| doc.attr(a, "name") == Some(name))
        .and_then(|&a| doc.attr(a, "id"))
    {
        return Ok(id.to_owned());
    }
    let taken: Vec<String> = authors
        .iter()
        .filter_map(|&a| doc.attr(a, "id").map(str::to_owned))
        .collect();
    let id = new_guid(
        pres.pkg.ids().cloned().as_deref(),
        &format!("author:{name}"),
        &taken,
    );
    let doc = pres.xml_mut(&part)?;
    let p188 = doc.intern_ns(P188);
    let a = doc.create_element(p188, "author");
    doc.set_attr(a, "id", &id);
    doc.set_attr(a, "name", name);
    doc.set_attr(a, "initials", &initials_of(name, initials));
    doc.set_attr(a, "userId", name);
    doc.set_attr(a, "providerId", "None");
    let root = doc.root();
    doc.append_child(root, a);
    Ok(id)
}

/// The slide's `p14:creationId`, added when missing (comment anchors name it).
fn ensure_slide_creation_id(pres: &mut Presentation, part: &str, seed: &str) -> Result<u32> {
    let doc = pres.xml(part)?;
    let existing = doc
        .child(doc.root(), Ns::P, "extLst")
        .and_then(|l| {
            doc.descendants(l)
                .into_iter()
                .find(|&n| doc.is(n, Ns::P14, "creationId"))
        })
        .and_then(|n| doc.attr_i64(n, "val"))
        .and_then(|v| u32::try_from(v).ok());
    if let Some(v) = existing {
        return Ok(v);
    }
    let value = creation_number(pres, seed);
    let doc = pres.xml_mut(part)?;
    let ext_lst = slide_ext_lst(doc);
    let ext = doc.create_element(Ns::P, "ext");
    doc.set_attr(ext, "uri", SLIDE_CREATION_EXT);
    let id = doc.create_element(Ns::P14, "creationId");
    doc.set_attr(id, "val", &value.to_string());
    doc.append_child(ext, id);
    doc.insert_child(ext_lst, 0, ext);
    Ok(value)
}

/// The slide's `p:extLst` (always its last child), created when missing.
fn slide_ext_lst(doc: &mut XmlDoc) -> NodeId {
    let root = doc.root();
    match doc.child(root, Ns::P, "extLst") {
        Some(l) => l,
        None => {
            let l = doc.create_element(Ns::P, "extLst");
            doc.append_child(root, l);
            l
        }
    }
}

/// The monikers of a shape and the groups around it, outermost first:
/// (`spMk`/`picMk`/..., shape id, creation id). Shapes without an
/// `a16:creationId` get one.
fn shape_monikers(
    pres: &mut Presentation,
    part: &str,
    shape: u32,
    seed: &str,
) -> Result<Vec<(String, u32, String)>> {
    let doc = pres.xml_mut(part)?;
    let node = find_shape(doc, shape).ok_or_else(|| Error::NotFound(format!("shape {shape}")))?;
    let mut chain = vec![node];
    let mut at = node;
    while let Some(parent) = doc.parent(at) {
        if doc.local(parent) == "grpSp" {
            chain.push(parent);
        }
        at = parent;
    }
    chain.reverse();
    let mut out = Vec::new();
    for n in chain {
        let Some(nv) = c_nv_pr(doc, n) else {
            continue;
        };
        let id = doc
            .attr_i64(nv, "id")
            .and_then(|v| u32::try_from(v).ok())
            .unwrap_or(shape);
        let kind = match doc.local(n) {
            "pic" => "picMk",
            "graphicFrame" => "graphicFrameMk",
            "grpSp" => "grpSpMk",
            "cxnSp" => "cxnSpMk",
            _ => "spMk",
        };
        let creation = ensure_shape_creation_id(doc, nv, &format!("{seed}:{id}"));
        out.push((kind.to_owned(), id, creation));
    }
    Ok(out)
}

/// A shape's `a16:creationId`, added to its `cNvPr` when missing.
fn ensure_shape_creation_id(doc: &mut XmlDoc, nv: NodeId, seed: &str) -> String {
    let existing = doc
        .child(nv, Ns::A, "extLst")
        .and_then(|l| {
            doc.descendants(l)
                .into_iter()
                .find(|&n| doc.is(n, Ns::A16, "creationId"))
        })
        .and_then(|n| doc.attr(n, "id"))
        .map(str::to_owned);
    if let Some(id) = existing {
        return id;
    }
    let id = new_guid(None, seed, &[]);
    let list = doc.ensure_child(nv, Ns::A, "extLst", C_NV_PR_ORDER);
    let ext = doc.create_element(Ns::A, "ext");
    doc.set_attr(ext, "uri", SHAPE_CREATION_EXT);
    let c = doc.create_element(Ns::A16, "creationId");
    doc.set_attr(c, "id", &id);
    doc.append_child(ext, c);
    doc.append_child(list, ext);
    id
}

/// The slide's threaded comments part, created (with its relationship,
/// content type, and `p188:commentRel` reference) when missing.
fn ensure_comments_part(
    pres: &mut Presentation,
    slide: u32,
    part: &str,
    slide_cid: u32,
) -> Result<String> {
    if let Some(existing) = comment_parts(pres, part, Some(MODERN_COMMENTS_REL))?
        .into_iter()
        .next()
    {
        return Ok(existing);
    }
    // PowerPoint names the part after the slide id and creation id, in hex.
    let preferred = format!("/ppt/comments/modernComment_{slide:X}_{slide_cid:X}.xml");
    let name = if pres.pkg.has_part(&preferred) || pres.pkg.ids().is_some() {
        pres.pkg
            .unique_part_name(&format!("/ppt/comments/modernComment_{slide:X}_"), ".xml")
    } else {
        preferred
    };
    pres.pkg.write(
        &name,
        NEW_COMMENTS.as_bytes().to_vec(),
        Some(MODERN_COMMENTS_TYPE),
    );
    let rid = pres
        .rels_mut(part)?
        .add_internal(MODERN_COMMENTS_REL, &name);
    let doc = pres.xml_mut(part)?;
    let ext_lst = slide_ext_lst(doc);
    let ext = doc.create_element(Ns::P, "ext");
    doc.set_attr(ext, "uri", COMMENT_REL_EXT);
    let p188 = doc.intern_ns(P188);
    let rel = doc.create_element(p188, "commentRel");
    doc.declare_ns(rel, "p188", P188);
    doc.set_attr_ns(rel, Ns::R, "id", &rid);
    doc.append_child(ext, rel);
    doc.append_child(ext_lst, ext);
    Ok(name)
}

/// Removes a comments part from its slide: the relationship and the
/// `p188:commentRel` naming it (the part itself is collected as garbage).
fn unlink(pres: &mut Presentation, slide_part: &str, comments: &str) -> Result<()> {
    let rels = pres.part_rels(slide_part)?;
    let ids: Vec<String> = rels
        .iter()
        .filter(|r| r.mode == TargetMode::Internal && rels.resolve(r) == comments)
        .map(|r| r.id.clone())
        .collect();
    if ids.is_empty() {
        return Ok(());
    }
    let rels = pres.rels_mut(slide_part)?;
    for id in &ids {
        rels.remove(id);
    }
    let doc = pres.xml(slide_part)?;
    let refers = doc
        .child(doc.root(), Ns::P, "extLst")
        .map(|l| {
            doc.children(l)
                .filter(|&ext| {
                    doc.descendants(ext).into_iter().any(|n| {
                        doc.local(n) == "commentRel"
                            && doc
                                .attr_ns(n, Ns::R, "id")
                                .is_some_and(|v| ids.iter().any(|i| i == v))
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if refers.is_empty() {
        return Ok(());
    }
    let doc = pres.xml_mut(slide_part)?;
    for ext in refers {
        doc.detach(ext);
    }
    if let Some(l) = doc.child(doc.root(), Ns::P, "extLst")
        && doc.first_child(l).is_none()
    {
        doc.detach(l);
    }
    Ok(())
}

/// The anchor of a new comment: the slide, or a shape (with its groups).
fn anchor_element(
    doc: &mut XmlDoc,
    slide: u32,
    slide_cid: u32,
    shape: Option<&[(String, u32, String)]>,
) -> NodeId {
    let slide_monikers = |doc: &mut XmlDoc, list: NodeId, pc: Ns| {
        let doc_mk = doc.create_element(pc, "docMk");
        doc.append_child(list, doc_mk);
        let sld_mk = doc.create_element(pc, "sldMk");
        doc.set_attr(sld_mk, "cId", &slide_cid.to_string());
        doc.set_attr(sld_mk, "sldId", &slide.to_string());
        doc.append_child(list, sld_mk);
    };
    match shape {
        None => {
            let pc = doc.intern_ns(PC);
            let list = doc.create_element(pc, "sldMkLst");
            doc.declare_ns(list, "pc", PC);
            slide_monikers(doc, list, pc);
            list
        }
        Some(chain) => {
            let ac = doc.intern_ns(AC);
            let list = doc.create_element(ac, "deMkLst");
            doc.declare_ns(list, "ac", AC);
            let pc = doc.declare_ns(list, "pc", PC);
            slide_monikers(doc, list, pc);
            for (kind, id, creation) in chain {
                let mk = doc.create_element(ac, kind);
                doc.set_attr(mk, "id", &id.to_string());
                doc.set_attr(mk, "creationId", creation);
                doc.append_child(list, mk);
            }
            list
        }
    }
}

/// `p188:txBody` with one paragraph per line of `text`.
fn text_body(doc: &mut XmlDoc, p188: Ns, text: &str) -> NodeId {
    let body = doc.create_element(p188, "txBody");
    let pr = doc.create_element(Ns::A, "bodyPr");
    doc.append_child(body, pr);
    let lst = doc.create_element(Ns::A, "lstStyle");
    doc.append_child(body, lst);
    for line in text.split('\n') {
        let line = line.trim_end_matches('\r');
        let p = doc.create_element(Ns::A, "p");
        if line.is_empty() {
            let end = doc.create_element(Ns::A, "endParaRPr");
            doc.set_attr(end, "lang", "en-US");
            doc.append_child(p, end);
        } else {
            let r = doc.create_element(Ns::A, "r");
            let rpr = doc.create_element(Ns::A, "rPr");
            doc.set_attr(rpr, "lang", "en-US");
            doc.append_child(r, rpr);
            let t = doc.create_element(Ns::A, "t");
            let txt = doc.create_text(line);
            doc.append_child(t, txt);
            doc.append_child(r, t);
            doc.append_child(p, r);
        }
        doc.append_child(body, p);
    }
    body
}

#[cfg(test)]
mod test;
