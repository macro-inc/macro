//! Review comments on slides, as PowerPoint shows them in its Comments pane:
//! the threaded comments PowerPoint for Microsoft 365 writes ("modern",
//! `p188:cmLst` parts with authors in `ppt/authors.xml`) and the flat
//! comments of earlier versions ("legacy", `p:cmLst` parts with authors in
//! `ppt/commentAuthors.xml`).

use super::dom_paragraph_text;
use crate::edit::comments::{
    AUTHORS_REL, LEGACY_AUTHORS_REL, LEGACY_UNITS_PER_PT, MODERN_COMMENTS_REL, is_p188, legacy_id,
    shape_of_anchor,
};
use crate::error::Result;
use crate::model::presentation::Presentation;
use crate::opc::{TargetMode, rel_type};
use crate::units::emu_to_pt;
use crate::xml::{NodeId, Ns, XmlDoc};
use serde::Serialize;
use std::collections::HashMap;

/// A comment thread on a slide.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentOutline {
    /// Thread id, as the comment operations take it: a GUID such as
    /// `{8D2E61C4-0B1F-4E6A-9C3B-2A1D5F7E9B10}`, or `legacy-<author>-<n>` for
    /// a comment in the pre-2021 format.
    pub id: String,
    /// The author's name.
    pub author: String,
    /// The author's initials.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub initials: String,
    /// The comment's text (`\n` between paragraphs).
    pub text: String,
    /// When it was written (ISO 8601): UTC (ending in `Z`) for threaded
    /// comments, the author's local time for legacy ones.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    /// The shape the comment is attached to (its marker sits at the shape's
    /// top-right corner); absent for comments on the slide itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<u32>,
    /// Where the comment's marker sits on the slide (points from the left),
    /// when the comment has a position.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f32>,
    /// Where the marker sits (points from the top).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f32>,
    /// Marked resolved (PowerPoint's Resolve thread).
    pub resolved: bool,
    /// A comment in the pre-2021 format: it can be edited and deleted, but
    /// not replied to or resolved.
    pub legacy: bool,
    /// Replies, oldest first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub replies: Vec<CommentReplyOutline>,
}

/// A reply in a comment thread.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentReplyOutline {
    /// Reply id (as `editComment` and `deleteComment` take it).
    pub id: String,
    /// The author's name.
    pub author: String,
    /// The author's initials.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub initials: String,
    /// The reply's text.
    pub text: String,
    /// When it was written (ISO 8601).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
}

/// Names and initials by author id.
type Authors = HashMap<String, (String, String)>;

/// The comment threads of a slide: threaded comments first, then legacy ones.
pub(crate) fn read(pres: &mut Presentation, slide_part: &str) -> Result<Vec<CommentOutline>> {
    let rels = pres.part_rels(slide_part)?;
    let targets = |ty: &str| -> Vec<String> {
        rels.iter()
            .filter(|r| r.rel_type == ty && r.mode == TargetMode::Internal)
            .map(|r| rels.resolve(r))
            .collect()
    };
    let present = |parts: Vec<String>| -> Vec<String> {
        parts.into_iter().filter(|p| pres.pkg.has_part(p)).collect()
    };
    let modern = present(targets(MODERN_COMMENTS_REL));
    let legacy = present(targets(rel_type::COMMENTS));
    if modern.is_empty() && legacy.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    if !modern.is_empty() {
        let authors = authors(pres, AUTHORS_REL, |doc, n| {
            is_p188(doc, n, "author").then(|| doc.attr(n, "id").map(str::to_ascii_uppercase))?
        })?;
        for part in &modern {
            let doc = pres.xml(part)?;
            for cm in doc.children(doc.root()).filter(|&c| is_p188(&doc, c, "cm")) {
                out.push(modern_thread(&doc, cm, &authors));
            }
        }
    }
    if !legacy.is_empty() {
        let authors = authors(pres, LEGACY_AUTHORS_REL, |doc, n| {
            doc.is(n, Ns::P, "cmAuthor")
                .then(|| doc.attr(n, "id").map(str::to_owned))?
        })?;
        for part in &legacy {
            let doc = pres.xml(part)?;
            out.extend(legacy_threads(&doc, &authors));
        }
    }
    Ok(out)
}

/// The deck's authors list (modern or legacy), keyed by `key_of` each entry.
fn authors(
    pres: &mut Presentation,
    rel: &str,
    key_of: impl Fn(&XmlDoc, NodeId) -> Option<String>,
) -> Result<Authors> {
    let main = pres.main_part.clone();
    let rels = pres.part_rels(&main)?;
    let Some(part) = rels
        .iter()
        .find(|r| r.rel_type == rel && r.mode == TargetMode::Internal)
        .map(|r| rels.resolve(r))
        .filter(|p| pres.pkg.has_part(p))
    else {
        return Ok(Authors::new());
    };
    let doc = pres.xml(&part)?;
    Ok(doc
        .children(doc.root())
        .filter_map(|n| {
            let key = key_of(&doc, n)?;
            let name = doc.attr(n, "name").unwrap_or_default().to_owned();
            let initials = doc.attr(n, "initials").unwrap_or_default().to_owned();
            Some((key, (name, initials)))
        })
        .collect())
}

/// The author's name and initials (`Unknown` when the authors list lacks them).
fn author_of(authors: &Authors, id: &str) -> (String, String) {
    authors
        .get(id)
        .cloned()
        .unwrap_or_else(|| ("Unknown".to_owned(), String::new()))
}

/// The text of a comment's `txBody` (paragraphs joined by `\n`).
pub(crate) fn body_text(doc: &XmlDoc, body: NodeId) -> String {
    doc.children_named(body, Ns::A, "p")
        .map(|p| dom_paragraph_text(doc, p).replace('\u{b}', "\n"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// `created` as UTC with a zone designator (threaded comments store UTC without one).
fn utc(created: Option<&str>) -> Option<String> {
    let c = created?.trim();
    if c.is_empty() {
        return None;
    }
    let zoned = c.ends_with('Z') || c.get(19..).is_some_and(|t| t.contains(['+', '-']));
    Some(if zoned { c.to_owned() } else { format!("{c}Z") })
}

fn modern_thread(doc: &XmlDoc, cm: NodeId, authors: &Authors) -> CommentOutline {
    let author_id = doc.attr(cm, "authorId").unwrap_or_default();
    let (author, initials) = author_of(authors, &author_id.to_ascii_uppercase());
    let body = doc.children(cm).find(|&c| is_p188(doc, c, "txBody"));
    let pos = doc.children(cm).find(|&c| is_p188(doc, c, "pos"));
    let replies = doc
        .children(cm)
        .find(|&c| is_p188(doc, c, "replyLst"))
        .map(|list| {
            doc.children(list)
                .filter(|&r| is_p188(doc, r, "reply"))
                .map(|r| {
                    let id = doc.attr(r, "authorId").unwrap_or_default();
                    let (author, initials) = author_of(authors, &id.to_ascii_uppercase());
                    CommentReplyOutline {
                        id: doc.attr(r, "id").unwrap_or_default().to_owned(),
                        author,
                        initials,
                        text: doc
                            .children(r)
                            .find(|&c| is_p188(doc, c, "txBody"))
                            .map(|b| body_text(doc, b))
                            .unwrap_or_default(),
                        created: utc(doc.attr(r, "created")),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    let status = doc.attr(cm, "status").unwrap_or("active");
    CommentOutline {
        id: doc.attr(cm, "id").unwrap_or_default().to_owned(),
        author,
        initials,
        text: body.map(|b| body_text(doc, b)).unwrap_or_default(),
        created: utc(doc.attr(cm, "created")),
        shape: shape_of_anchor(doc, cm),
        x: pos.and_then(|p| doc.attr_f64(p, "x")).map(emu_to_pt),
        y: pos.and_then(|p| doc.attr_f64(p, "y")).map(emu_to_pt),
        resolved: matches!(status, "resolved" | "closed"),
        legacy: false,
        replies,
    }
}

/// Legacy comments, with replies (PowerPoint 2013's `p15:parentCm`) under their thread.
fn legacy_threads(doc: &XmlDoc, authors: &Authors) -> Vec<CommentOutline> {
    let mut threads: Vec<CommentOutline> = Vec::new();
    let mut replies: Vec<(String, CommentReplyOutline)> = Vec::new();
    for cm in doc.children_named(doc.root(), Ns::P, "cm") {
        let author_id = doc.attr(cm, "authorId").unwrap_or_default();
        let (author, initials) = author_of(authors, author_id);
        let id = legacy_id(author_id, doc.attr(cm, "idx").unwrap_or_default());
        let text = doc
            .child(cm, Ns::P, "text")
            .map(|t| doc.text(t))
            .unwrap_or_default();
        let created = doc.attr(cm, "dt").map(str::to_owned);
        let parent = doc
            .descendants(cm)
            .into_iter()
            .find(|&n| doc.local(n) == "parentCm")
            .map(|p| {
                legacy_id(
                    doc.attr(p, "authorId").unwrap_or_default(),
                    doc.attr(p, "idx").unwrap_or_default(),
                )
            });
        if let Some(parent) = parent {
            replies.push((
                parent,
                CommentReplyOutline {
                    id,
                    author,
                    initials,
                    text,
                    created,
                },
            ));
            continue;
        }
        let pos = doc.child(cm, Ns::P, "pos");
        let at = |name: &str| {
            pos.and_then(|p| doc.attr_f64(p, name))
                .map(|v| (v / LEGACY_UNITS_PER_PT) as f32)
        };
        threads.push(CommentOutline {
            id,
            author,
            initials,
            text,
            created,
            shape: None,
            x: at("x"),
            y: at("y"),
            resolved: false,
            legacy: true,
            replies: Vec::new(),
        });
    }
    for (parent, reply) in replies {
        match threads.iter_mut().find(|t| t.id == parent) {
            Some(t) => t.replies.push(reply),
            // A reply whose thread is gone shows as a thread of its own.
            None => threads.push(CommentOutline {
                id: reply.id,
                author: reply.author,
                initials: reply.initials,
                text: reply.text,
                created: reply.created,
                shape: None,
                x: None,
                y: None,
                resolved: false,
                legacy: true,
                replies: Vec::new(),
            }),
        }
    }
    threads
}
