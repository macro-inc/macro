//! Comments stored in the document (Word's comments part): their authors,
//! text and threads, and the text each is on, for showing beside the pages.

use super::Pos;
use crate::document::{Document, rel_kind};
use crate::xml::{NodeId, XmlTree};
use serde::Serialize;
use std::collections::HashMap;

/// A comment from the document's comments part.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocComment {
    /// Its id (`w:id`).
    pub id: String,
    /// Who wrote it.
    pub author: String,
    /// Their initials.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initials: Option<String>,
    /// When (ISO 8601, as written).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    /// Its text, paragraphs separated by newlines.
    pub text: String,
    /// Where the commented text starts in the body.
    pub from: Pos,
    /// Where it ends.
    pub to: Pos,
    /// The comment it replies to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// Marked done (resolved).
    pub done: bool,
}

/// One comment as the comments part has it.
struct Written {
    id: String,
    author: String,
    initials: Option<String>,
    date: Option<String>,
    text: String,
    /// `w14:paraId` of its last paragraph, which threads refer to.
    para_id: Option<String>,
}

/// The value of an attribute by local name, whatever its prefix.
fn attr_local<'a>(tree: &'a XmlTree, node: NodeId, local: &str) -> Option<&'a str> {
    tree.attrs(node)
        .iter()
        .find(|a| &*a.local == local)
        .map(|a| &*a.value)
}

/// The text of a comment paragraph (tabs and breaks included).
fn paragraph_text(tree: &XmlTree, node: NodeId, out: &mut String) {
    for c in tree.children(node) {
        match tree.local(c) {
            "t" => out.push_str(&tree.text(c)),
            "tab" => out.push('\t'),
            "br" | "cr" => out.push('\n'),
            // Deleted text and field codes are not part of what it says.
            "delText" | "instrText" => {}
            _ => paragraph_text(tree, c, out),
        }
    }
}

/// A part related to the main part by a relationship of `kind`.
fn related_part(doc: &Document, kind: &str) -> Option<XmlTree> {
    let rels = doc.main_rels();
    let rel = rels.iter().find(|r| rel_kind(&r.rel_type) == kind)?;
    let name = rels.resolve(rel);
    let bytes = doc.package().read(&name).ok()?;
    XmlTree::parse(&bytes, &name).ok()
}

fn written(doc: &Document) -> Vec<Written> {
    let Some(tree) = related_part(doc, "comments") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for c in tree.children(tree.root()) {
        if !tree.is_w(c, "comment") {
            continue;
        }
        let Some(id) = tree.w_attr(c, "id") else {
            continue;
        };
        let mut paragraphs = Vec::new();
        let mut para_id = None;
        for p in tree.children(c).filter(|&p| tree.is_w(p, "p")) {
            let mut text = String::new();
            paragraph_text(&tree, p, &mut text);
            paragraphs.push(text);
            para_id = attr_local(&tree, p, "paraId").map(str::to_owned);
        }
        out.push(Written {
            id: id.to_owned(),
            author: tree.w_attr(c, "author").unwrap_or_default().to_owned(),
            initials: tree.w_attr(c, "initials").map(str::to_owned),
            date: tree.w_attr(c, "date").map(str::to_owned),
            text: paragraphs.join("\n").trim().to_owned(),
            para_id,
        });
    }
    out
}

/// Thread links and done flags (`w15:commentEx`), by paragraph id: the
/// parent's paragraph id and whether it is done.
fn extended(doc: &Document) -> HashMap<String, (Option<String>, bool)> {
    let Some(tree) = related_part(doc, "commentsExtended") else {
        return HashMap::new();
    };
    tree.children(tree.root())
        .filter(|&c| tree.local(c) == "commentEx")
        .filter_map(|c| {
            let para = attr_local(&tree, c, "paraId")?.to_owned();
            let parent = attr_local(&tree, c, "paraIdParent").map(str::to_owned);
            let done = attr_local(&tree, c, "done").is_some_and(|v| v == "1" || v == "true");
            Some((para, (parent, done)))
        })
        .collect()
}

/// The comment id of comment markup (`commentRangeStart`,
/// `commentRangeEnd`, `commentReference`), with which of the three it is.
fn comment_mark(xml: &str) -> Option<(&'static str, String)> {
    let kind = ["commentRangeStart", "commentRangeEnd", "commentReference"]
        .into_iter()
        .find(|k| xml.contains(k))?;
    Some((kind, super::revise::attribute(xml, "id")?))
}

/// The document's comments in the order of their text, each with the range
/// it is on; comments whose text is gone are left out.
pub(crate) fn comments(doc: &Document) -> Vec<DocComment> {
    let written = written(doc);
    if written.is_empty() {
        return Vec::new();
    }
    // Where each comment's markers are in the body.
    let mut starts: HashMap<String, Pos> = HashMap::new();
    let mut ends: HashMap<String, Pos> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let body = doc.body();
    for id in body.paragraphs() {
        let Some(b) = body.get(&id) else {
            continue;
        };
        for (at, span) in b.content.spans_at() {
            let Some(xml) = span.attrs.marker().or(span.attrs.object()) else {
                continue;
            };
            let Some((kind, cid)) = comment_mark(xml) else {
                continue;
            };
            let len = span.text.encode_utf16().count();
            match kind {
                "commentRangeStart" => {
                    order.push(cid.clone());
                    starts.insert(cid, Pos::new(id.clone(), at + len));
                }
                "commentRangeEnd" => {
                    ends.insert(cid, Pos::new(id.clone(), at));
                }
                _ => {
                    if !starts.contains_key(&cid) {
                        order.push(cid.clone());
                        starts.insert(cid.clone(), Pos::new(id.clone(), at));
                    }
                    ends.entry(cid).or_insert_with(|| Pos::new(id.clone(), at));
                }
            }
        }
    }
    let threads = extended(doc);
    let by_para: HashMap<&str, &str> = written
        .iter()
        .filter_map(|w| Some((w.para_id.as_deref()?, w.id.as_str())))
        .collect();
    let mut by_id: HashMap<&str, &Written> = written.iter().map(|w| (w.id.as_str(), w)).collect();
    let mut out = Vec::new();
    for cid in &order {
        let Some(w) = by_id.remove(cid.as_str()) else {
            continue;
        };
        let Some(from) = starts.get(cid) else {
            continue;
        };
        let to = ends.get(cid).unwrap_or(from).clone();
        let (parent, done) = w.para_id.as_deref().and_then(|p| threads.get(p)).map_or(
            (None, false),
            |(parent, done)| {
                let parent = parent
                    .as_deref()
                    .and_then(|p| by_para.get(p))
                    .map(|id| (*id).to_owned());
                (parent, *done)
            },
        );
        out.push(DocComment {
            id: w.id.clone(),
            author: w.author.clone(),
            initials: w.initials.clone(),
            date: w.date.clone(),
            text: w.text.clone(),
            from: from.clone(),
            to,
            parent,
            done,
        });
    }
    out
}

#[cfg(test)]
mod test;
