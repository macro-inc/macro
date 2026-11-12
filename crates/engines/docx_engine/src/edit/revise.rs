//! Tracked changes. While the document tracks changes, typed text is
//! recorded as an insertion and deleting marks text deleted instead of
//! removing it, each attributed to the editing author; text an author
//! inserted themselves is simply removed again. Accepting or rejecting
//! turns revisions back into plain text.

use super::txn::Txn;
use super::xmledit::{Element, PPR_ORDER};
use crate::document::{Document, rel_kind};
use crate::error::Result;
use crate::model::block::{BlockId, BlockKind};
use crate::model::content::{Attrs, Content, Wrapper, encode_wrappers, key};
use crate::model::write::rpr_xml;
use crate::xml::{Decl, SnippetContext, XmlTree, escape_attr};
use std::collections::HashSet;
use std::sync::Arc;

/// Schema order of a paragraph mark's run properties (CT_ParaRPr): the
/// revision marks come first and `rPrChange` last.
const MARK_RPR_ORDER: &[&str] = &[
    "ins",
    "del",
    "moveFrom",
    "moveTo",
    "rStyle",
    "rFonts",
    "b",
    "bCs",
    "i",
    "iCs",
    "caps",
    "smallCaps",
    "strike",
    "dstrike",
    "outline",
    "shadow",
    "emboss",
    "imprint",
    "noProof",
    "snapToGrid",
    "vanish",
    "webHidden",
    "color",
    "spacing",
    "w",
    "kern",
    "position",
    "sz",
    "szCs",
    "highlight",
    "u",
    "effect",
    "bdr",
    "shd",
    "fitText",
    "vertAlign",
    "rtl",
    "cs",
    "em",
    "lang",
    "eastAsianLayout",
    "specVanish",
    "oMath",
    "rPrChange",
];

/// Schema order of the settings part's children (CT_Settings).
const SETTINGS_ORDER: &[&str] = &[
    "writeProtection",
    "view",
    "zoom",
    "removePersonalInformation",
    "removeDateAndTime",
    "doNotDisplayPageBoundaries",
    "displayBackgroundShape",
    "printPostScriptOverText",
    "printFractionalCharacterWidth",
    "printFormsData",
    "embedTrueTypeFonts",
    "embedSystemFonts",
    "saveSubsetFonts",
    "saveFormsData",
    "mirrorMargins",
    "alignBordersAndEdges",
    "bordersDoNotSurroundHeader",
    "bordersDoNotSurroundFooter",
    "gutterAtTop",
    "hideSpellingErrors",
    "hideGrammaticalErrors",
    "activeWritingStyle",
    "proofState",
    "formsDesign",
    "attachedTemplate",
    "linkStyles",
    "stylePaneFormatFilter",
    "stylePaneSortMethod",
    "documentType",
    "mailMerge",
    "revisionView",
    "trackRevisions",
    "doNotTrackMoves",
    "doNotTrackFormatting",
    "documentProtection",
    "autoFormatOverride",
    "styleLockTheme",
    "styleLockQFSet",
    "defaultTabStop",
    "autoHyphenation",
    "consecutiveHyphenLimit",
    "hyphenationZone",
    "doNotHyphenateCaps",
    "showEnvelope",
    "summaryLength",
    "clickAndTypeStyle",
    "defaultTableStyle",
    "evenAndOddHeaders",
    "bookFoldRevPrinting",
    "bookFoldPrinting",
    "bookFoldPrintingSheets",
    "drawingGridHorizontalSpacing",
    "drawingGridVerticalSpacing",
    "displayHorizontalDrawingGridEvery",
    "displayVerticalDrawingGridEvery",
    "doNotUseMarginsForDrawingGridOrigin",
    "drawingGridHorizontalOrigin",
    "drawingGridVerticalOrigin",
    "doNotShadeFormData",
    "noPunctuationKerning",
    "characterSpacingControl",
    "printTwoOnOne",
    "strictFirstAndLastChars",
    "noLineBreaksAfter",
    "noLineBreaksBefore",
    "savePreviewPicture",
    "doNotValidateAgainstSchema",
    "saveInvalidXml",
    "ignoreMixedContent",
    "alwaysShowPlaceholderText",
    "doNotDemarcateInvalidXml",
    "saveXmlDataOnly",
    "useXSLTWhenSaving",
    "saveThroughXslt",
    "showXMLTags",
    "alwaysMergeEmptyNamespace",
    "updateFields",
    "hdrShapeDefaults",
    "footnotePr",
    "endnotePr",
    "compat",
    "docVars",
    "rsids",
    "mathPr",
    "attachedSchema",
    "themeFontLang",
    "clrSchemeMapping",
    "doNotIncludeSubdocsInStats",
    "doNotAutoCompressPictures",
    "forceUpgrade",
    "captions",
    "readModeInkLockDown",
    "smartTagType",
    "schemaLibrary",
    "shapeDefaults",
    "doNotEmbedSmartTags",
    "decimalSymbol",
    "listSeparator",
];

const SETTINGS_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings";
const SETTINGS_CT: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml";
const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/// Who records tracked changes, and when.
#[derive(Clone, Debug)]
pub(crate) struct Revisor {
    /// The author's name.
    pub author: String,
    /// When (ISO 8601).
    pub date: String,
    /// The document's WordprocessingML prefix.
    pub(crate) w: String,
    /// The id of revisions this edit records.
    pub(crate) id: u32,
}

impl Revisor {
    fn q(&self, local: &str) -> String {
        if self.w.is_empty() {
            local.to_owned()
        } else {
            format!("{}:{local}", self.w)
        }
    }

    /// `w:id`, `w:author` and `w:date` of a revision element. Each kind of
    /// revision one edit records gets an id of its own, so they are
    /// accepted and rejected separately.
    fn attributes(&self, kind: u32) -> String {
        let id = (self.id.wrapping_add(kind) & 0x7fff_ffff).max(1);
        let mut s = format!(" {}=\"{id}\" {}=\"", self.q("id"), self.q("author"));
        escape_attr(&mut s, &self.author);
        s.push('"');
        if !self.date.is_empty() {
            s.push_str(&format!(" {}=\"", self.q("date")));
            escape_attr(&mut s, &self.date);
            s.push('"');
        }
        s
    }

    /// Records a formatting change made to a run while tracking: the run
    /// keeps its formatting from before in a `w:rPrChange` (the earliest
    /// one when it already has a record). Text tracked as inserted is new
    /// anyway and records nothing.
    pub(crate) fn format_change(&self, old: &Attrs, new: &Attrs) -> Attrs {
        let props = |a: &Attrs| {
            let mut v: Vec<(String, String)> = a
                .run_props()
                .filter(|(q, _)| !q.ends_with("rPrChange"))
                .map(|(q, x)| (q.to_owned(), x.to_owned()))
                .collect();
            v.sort();
            v
        };
        if props(old) == props(new) || old.wrappers().iter().any(is_inserted) {
            return new.clone();
        }
        let change_key = format!("{}{}", key::RUN_PROP, self.q("rPrChange"));
        let existing = old
            .iter()
            .find(|(k, _)| k.starts_with(key::RUN_PROP) && k.ends_with(":rPrChange"))
            .map(|(_, v)| v.to_owned());
        let record = match existing {
            // Formatting changed back to what was recorded: no change left.
            Some(x) if x.contains(&rpr_xml(new, &self.w)) => None,
            Some(x) => Some(x),
            None => {
                let tag = self.q("rPrChange");
                Some(format!(
                    "<{tag}{}>{}</{tag}>",
                    self.attributes(4),
                    rpr_xml(old, &self.w)
                ))
            }
        };
        new.with(&change_key, record.as_deref())
    }

    /// Records a change to a paragraph's properties made while tracking:
    /// the paragraph keeps its properties from before in a `w:pPrChange`
    /// (the earliest record when it already has one). The mark's
    /// formatting and section break are not part of the record, and a
    /// paragraph whose mark is tracked as inserted is new anyway.
    pub(crate) fn para_change(&self, before: &Element, after: &mut Element, decls: &[Decl]) {
        let recorded = |e: &Element| -> Vec<String> {
            e.children
                .iter()
                .filter(|c| !matches!(c.local(), "rPr" | "sectPr" | "pPrChange"))
                .map(|c| c.xml.clone())
                .collect()
        };
        let old = recorded(before);
        let new = recorded(after);
        if old == new {
            return;
        }
        let mark_inserted = before.get("rPr").is_some_and(|r| {
            let r = Element::open(r, "rPr", &self.w, decls, MARK_RPR_ORDER);
            r.has("ins") || r.has("moveTo")
        });
        if mark_inserted {
            return;
        }
        if let Some(existing) = before.get("pPrChange") {
            // Properties changed back to what was recorded: no change left.
            let change = Element::open(existing, "pPrChange", &self.w, decls, PPR_ORDER);
            let back = change.get("pPr").is_some_and(|p| {
                recorded(&Element::open(p, "pPr", &self.w, decls, PPR_ORDER)) == new
            }) || (change.get("pPr").is_none() && new.is_empty());
            if back {
                after.set("pPrChange", None);
            }
            return;
        }
        let tag = self.q("pPrChange");
        let ppr = self.q("pPr");
        let xml = format!(
            "<{tag}{}><{ppr}>{}</{ppr}></{tag}>",
            self.attributes(5),
            old.concat()
        );
        after.set("pPrChange", Some(xml));
    }

    /// A revision element wrapping runs (`ins` or `del`).
    pub(crate) fn wrapper(&self, local: &str) -> Wrapper {
        let kind = if local == "ins" { 0 } else { 1 };
        Wrapper {
            open: format!("<{}{}>", self.q(local), self.attributes(kind)),
            close: format!("</{}>", self.q(local)),
        }
    }

    /// A revision mark on a paragraph mark (`ins` or `del`).
    fn mark(&self, local: &str) -> String {
        let kind = if local == "ins" { 2 } else { 3 };
        format!("<{}{}/>", self.q(local), self.attributes(kind))
    }

    /// Whether a wrapper is an insertion this author made.
    fn owns(&self, w: &Wrapper) -> bool {
        is_inserted(w) && attribute(&w.open, "author").as_deref() == Some(self.author.as_str())
    }
}

/// Whether a wrapper records inserted (or moved-in) text.
pub(crate) fn is_inserted(w: &Wrapper) -> bool {
    matches!(w.local(), "ins" | "moveTo")
}

/// Whether a wrapper records deleted (or moved-away) text.
pub(crate) fn is_deleted(w: &Wrapper) -> bool {
    matches!(w.local(), "del" | "moveFrom")
}

/// Whether a wrapper is a tracked change.
pub(crate) fn is_revision(w: &Wrapper) -> bool {
    is_inserted(w) || is_deleted(w)
}

/// An attribute of a start tag by local name, with entities decoded.
pub(crate) fn attribute(tag: &str, local: &str) -> Option<String> {
    let (start, end) = attribute_span(tag, local)?;
    Some(unescape(&tag[start..end]))
}

/// The tag with the value of its attribute `local` replaced by `value` (a
/// plain value, needing no escaping), or `None` when it has no such
/// attribute.
pub(crate) fn with_attribute(tag: &str, local: &str, value: &str) -> Option<String> {
    let (start, end) = attribute_span(tag, local)?;
    Some(format!("{}{value}{}", &tag[..start], &tag[end..]))
}

/// Where the (raw) value of attribute `local` sits in a start tag.
fn attribute_span(tag: &str, local: &str) -> Option<(usize, usize)> {
    let bytes = tag.as_bytes();
    let mut search = 0;
    while let Some(i) = tag[search..].find(local) {
        let at = search + i;
        search = at + local.len();
        let before = at.checked_sub(1).map(|b| bytes[b]);
        if !matches!(before, Some(b' ' | b':' | b'\t' | b'\n' | b'\r')) {
            continue;
        }
        let after = &tag[search..];
        let rest = after.trim_start();
        let Some(rest) = rest.strip_prefix('=') else {
            continue;
        };
        let rest = rest.trim_start();
        let Some(quote) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') else {
            continue;
        };
        let start = tag.len() - rest.len() + 1;
        let end = start + tag[start..].find(quote)?;
        return Some((start, end));
    }
    None
}

fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_owned();
    }
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// A revision id from a per-edit unique token (positive, 31 bits).
pub(crate) fn revision_id(token: &str) -> u32 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    token.hash(&mut h);
    ((h.finish() as u32) & 0x7fff_ffff).max(1)
}

/// The attributes text typed at a position gets while tracking: `base`
/// (the formatting it gets anyway) inside an insertion by the author. It
/// continues the insertion just before it when that is the author's and
/// sits in the same elements.
pub(crate) fn inserted(base: &Attrs, before: Option<&Attrs>, rev: &Revisor) -> Attrs {
    let mut stack: Vec<Wrapper> = base
        .wrappers()
        .into_iter()
        .filter(|w| !is_revision(w))
        .collect();
    let continued = before.and_then(|b| {
        let ws = b.wrappers();
        let (last, outer) = ws.split_last()?;
        (rev.owns(last) && outer == stack.as_slice()).then(|| last.clone())
    });
    stack.push(continued.unwrap_or_else(|| rev.wrapper("ins")));
    base.with(key::WRAP, encode_wrappers(&stack).as_deref())
}

/// Marks `[start, end)` of a paragraph's content deleted by the author.
/// Text the author inserted is removed outright; text already deleted and
/// markers (bookmarks, comment ranges) stay as they are. Returns where
/// `end` is afterwards.
pub(crate) fn delete_in(content: &mut Content, start: usize, end: usize, rev: &Revisor) -> usize {
    let len = content.len();
    let (start, end) = (start.min(len), end.min(len));
    if start >= end {
        return start;
    }
    let middle = content.slice(start, end);
    let del = rev.wrapper("del");
    let mut out = Content::new();
    for span in middle.spans() {
        let ws = span.attrs.wrappers();
        let deleted = ws.iter().any(is_deleted);
        if !deleted && ws.iter().any(|w| rev.owns(w)) {
            continue;
        }
        if deleted || span.attrs.marker().is_some() {
            out.push(&span.text, span.attrs.clone());
            continue;
        }
        let mut stack = ws;
        stack.push(del.clone());
        out.push(
            &span.text,
            span.attrs
                .with(key::WRAP, encode_wrappers(&stack).as_deref()),
        );
    }
    content.delete(start, end);
    content.insert_content(start, &out);
    start + out.len()
}

/// The revision on a paragraph's mark: inserted (`true`) or deleted, its
/// author and its id.
pub(crate) fn mark_revision(
    ppr: &str,
    w: &str,
    decls: &[Decl],
) -> Option<(bool, Option<String>, Option<String>)> {
    if !(ppr.contains("ins") || ppr.contains("del") || ppr.contains("move")) {
        return None;
    }
    let e = Element::open(ppr, "pPr", w, decls, PPR_ORDER);
    let r = Element::open(e.get("rPr")?, "rPr", w, decls, MARK_RPR_ORDER);
    for (local, inserted) in [
        ("ins", true),
        ("moveTo", true),
        ("del", false),
        ("moveFrom", false),
    ] {
        if let Some(x) = r.get(local) {
            return Some((inserted, attribute(x, "author"), attribute(x, "id")));
        }
    }
    None
}

/// The id of a paragraph's tracked property change (`w:pPrChange`).
pub(crate) fn ppr_change_id(ppr: &str, w: &str, decls: &[Decl]) -> Option<String> {
    if !ppr.contains("pPrChange") {
        return None;
    }
    Element::open(ppr, "pPr", w, decls, PPR_ORDER)
        .get("pPrChange")
        .and_then(|x| attribute(x, "id"))
}

/// Records (`Some(inserted)`) or clears a revision on a paragraph's mark.
pub(crate) fn set_mark_revision(
    ppr: &str,
    change: Option<(bool, &Revisor)>,
    w: &str,
    decls: &[Decl],
) -> String {
    let mut e = Element::open(ppr, "pPr", w, decls, PPR_ORDER);
    let mut r = Element::open(e.get("rPr").unwrap_or(""), "rPr", w, decls, MARK_RPR_ORDER);
    for local in ["ins", "del", "moveFrom", "moveTo"] {
        r.set(local, None);
    }
    if let Some((inserted, rev)) = change {
        let local = if inserted { "ins" } else { "del" };
        r.set(local, Some(rev.mark(local)));
    }
    let rpr = r.finish(true);
    e.set("rPr", (!rpr.is_empty()).then_some(rpr));
    e.finish(true)
}

/// The revision element on a paragraph's mark, as written.
fn mark_element(ppr: &str, w: &str, decls: &[Decl]) -> Option<(String, String)> {
    let e = Element::open(ppr, "pPr", w, decls, PPR_ORDER);
    let r = Element::open(e.get("rPr")?, "rPr", w, decls, MARK_RPR_ORDER);
    ["ins", "del", "moveFrom", "moveTo"]
        .into_iter()
        .find_map(|l| r.get(l).map(|x| (l.to_owned(), x.to_owned())))
}

/// Joins two paragraphs. The joined paragraph ends with the second's mark,
/// so it takes that mark's revision (if any).
pub(crate) fn join(txn: &mut Txn<'_>, first: &BlockId, second: &BlockId) -> Option<super::Pos> {
    let w = txn.doc.w_prefix().to_owned();
    let decls = Arc::clone(txn.doc.decls());
    let kept = mark_element(&txn.get(second)?.props, &w, &decls);
    let pos = super::text::join(txn, first, second)?;
    let props = txn.get(first)?.props.clone();
    let mut e = Element::open(&props, "pPr", &w, &decls, PPR_ORDER);
    let mut r = Element::open(
        e.get("rPr").unwrap_or(""),
        "rPr",
        &w,
        &decls,
        MARK_RPR_ORDER,
    );
    for local in ["ins", "del", "moveFrom", "moveTo"] {
        r.set(local, None);
    }
    if let Some((local, xml)) = kept {
        r.set(&local, Some(xml));
    }
    let rpr = r.finish(true);
    e.set("rPr", (!rpr.is_empty()).then_some(rpr));
    let props = e.finish(true);
    if let Some(b) = txn.block_mut(first)
        && b.props != props
    {
        b.props = props;
    }
    Some(pos)
}

/// Marks the paragraph mark of `id` inserted by the author.
pub(crate) fn mark_inserted(txn: &mut Txn<'_>, id: &BlockId, rev: &Revisor) {
    let w = txn.doc.w_prefix().to_owned();
    let decls = Arc::clone(txn.doc.decls());
    let Some(b) = txn.get(id) else {
        return;
    };
    let props = set_mark_revision(&b.props, Some((true, rev)), &w, &decls);
    if let Some(b) = txn.block_mut(id) {
        b.props = props;
    }
}

/// The paragraph before `id` among its siblings.
pub(crate) fn previous_paragraph(txn: &Txn<'_>, id: &BlockId) -> Option<BlockId> {
    let parent = txn.get(id)?.parent.clone();
    let kids = txn.story().children(parent.as_ref());
    let i = kids.iter().position(|k| k == id)?;
    let prev = kids.get(i.checked_sub(1)?)?;
    (txn.get(prev)?.kind == BlockKind::Paragraph).then(|| prev.clone())
}

/// Deletes a paragraph mark while tracking: a mark the author inserted
/// goes (joining the paragraphs), any other is marked deleted. Returns
/// whether the paragraphs were joined.
pub(crate) fn delete_mark(
    txn: &mut Txn<'_>,
    first: &BlockId,
    second: &BlockId,
    rev: &Revisor,
) -> bool {
    let w = txn.doc.w_prefix().to_owned();
    let decls = Arc::clone(txn.doc.decls());
    let Some(b) = txn.get(first) else {
        return false;
    };
    let revision = mark_revision(&b.props, &w, &decls);
    let own = revision
        .as_ref()
        .is_some_and(|(inserted, author, _)| *inserted && author.as_deref() == Some(&rev.author));
    if own {
        return join(txn, first, second).is_some();
    }
    if revision.is_some_and(|(inserted, _, _)| !inserted) {
        return false;
    }
    let props = set_mark_revision(&b.props, Some((false, rev)), &w, &decls);
    if let Some(b) = txn.block_mut(first) {
        b.props = props;
    }
    false
}

/// Deletes `[from, to)` across paragraphs while tracking: text is marked
/// deleted (the author's own insertions go), and so are the marks of every
/// paragraph but the last. Returns the range's ends afterwards.
pub(crate) fn delete_range(
    txn: &mut Txn<'_>,
    from: &super::Pos,
    to: &super::Pos,
    rev: &Revisor,
) -> (super::Pos, super::Pos) {
    use super::Pos;
    let list = txn.story().paragraphs();
    let i = list.iter().position(|id| *id == from.block);
    let j = list.iter().position(|id| *id == to.block);
    let (Some(i), Some(j)) = (i, j) else {
        return (from.clone(), from.clone());
    };
    if i > j {
        return (from.clone(), from.clone());
    }
    let paras = list[i..=j].to_vec();
    let last = paras.len() - 1;
    let mut end = Pos {
        upstream: false,
        ..to.clone()
    };
    for (k, id) in paras.iter().enumerate().rev() {
        let s = if k == 0 { from.offset } else { 0 };
        let e = if k == last { to.offset } else { usize::MAX };
        if let Some(b) = txn.block_mut(id) {
            let e = e.min(b.content.len());
            let new_end = delete_in(&mut b.content, s, e, rev);
            if k == last {
                end.offset = new_end;
            }
        }
        if k < last {
            let next = &paras[k + 1];
            let parent = |id: &BlockId| txn.get(id).map(|b| b.parent.clone());
            if parent(id) == parent(next) {
                let len = txn.get(id).map_or(0, |b| b.content.len());
                if delete_mark(txn, id, next, rev) && end.block == *next {
                    end = Pos::new(id.clone(), len + end.offset);
                }
            }
        }
    }
    (
        Pos {
            upstream: false,
            ..from.clone()
        },
        end,
    )
}

/// Which revisions to accept or reject.
#[derive(Clone, Debug)]
pub(crate) enum Scope {
    /// Every revision in `[from, to)` of the listed paragraphs (offsets in
    /// the first and last), including marks of all but the last.
    Range {
        /// Paragraphs in order.
        paras: Vec<BlockId>,
        /// Start offset in the first.
        from: usize,
        /// End offset in the last.
        to: usize,
    },
    /// Revisions with these ids, wherever they are in the story.
    Ids(HashSet<String>),
    /// Every revision in the story.
    All,
}

fn wrapper_id(w: &Wrapper) -> Option<String> {
    attribute(&w.open, "id")
}

/// Revision ids at a position: around the caret, and the paragraph mark's
/// when the caret is at the paragraph's end.
pub(crate) fn ids_at(content: &Content, offset: usize, mark: Option<String>) -> HashSet<String> {
    let mut out = HashSet::new();
    for at in [offset.checked_sub(1), Some(offset)].into_iter().flatten() {
        if let Some(a) = content.attrs_at(at) {
            for w in a.wrappers() {
                if is_revision(&w)
                    && let Some(id) = wrapper_id(&w)
                {
                    out.insert(id);
                }
            }
            if let Some(change) = a.run_props().find(|(q, _)| q.ends_with(":rPrChange"))
                && let Some(id) = attribute(change.1, "id")
            {
                out.insert(id);
            }
        }
    }
    if offset >= content.len()
        && let Some(id) = mark
    {
        out.insert(id);
    }
    out
}

/// Whether the content has any revision in `[start, end)`.
pub(crate) fn has_revisions(content: &Content, start: usize, end: usize) -> bool {
    let mut at = 0;
    for span in content.spans() {
        let len = crate::model::content::utf16_len(&span.text);
        let overlaps = at < end.max(start + 1) && at + len > start;
        at += len;
        if !overlaps {
            continue;
        }
        if span.attrs.wrappers().iter().any(is_revision)
            || span
                .attrs
                .run_props()
                .any(|(q, _)| q.ends_with(":rPrChange"))
        {
            return true;
        }
    }
    false
}

/// A run's formatting after its tracked formatting change is accepted
/// (the record dropped) or rejected (the recorded formatting restored).
fn resolve_format(attrs: &Attrs, accept: bool, ctx: &SnippetContext) -> Attrs {
    let Some((change_key, xml)) = attrs
        .iter()
        .find(|(k, _)| k.starts_with(key::RUN_PROP) && k.ends_with(":rPrChange"))
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
    else {
        return attrs.clone();
    };
    if accept {
        return attrs.with(&change_key, None);
    }
    // The formatting before the change, from the record's `w:rPr`.
    let old: Vec<(String, String)> = ctx
        .parse(&xml)
        .ok()
        .and_then(|t| {
            let rpr = t.w_child(t.root(), "rPr")?;
            Some(
                t.children(rpr)
                    .map(|c| (format!("{}{}", key::RUN_PROP, t.qname(c)), t.snippet(c)))
                    .collect(),
            )
        })
        .unwrap_or_default();
    let mut out = attrs.without(|k| k.starts_with(key::RUN_PROP));
    for (k, v) in old {
        out = out.with(&k, Some(&v));
    }
    out
}

/// Resolves the revisions of one paragraph's `[start, end)` that `wanted`
/// selects.
fn resolve_text(
    content: &Content,
    start: usize,
    end: usize,
    accept: bool,
    wanted: &dyn Fn(&str) -> bool,
    ctx: &SnippetContext,
) -> Content {
    let len = content.len();
    let (start, end) = (start.min(len), end.min(len));
    let mut out = content.slice(0, start);
    for span in content.slice(start, end).spans() {
        let ws = span.attrs.wrappers();
        let picked = |w: &Wrapper| is_revision(w) && wrapper_id(w).is_some_and(|id| wanted(&id));
        let deleted = ws.iter().any(|w| is_deleted(w) && picked(w));
        let inserted = ws.iter().any(|w| is_inserted(w) && picked(w));
        if (accept && deleted) || (!accept && inserted) {
            continue;
        }
        let kept: Vec<Wrapper> = ws.iter().filter(|w| !picked(w)).cloned().collect();
        let mut attrs = span
            .attrs
            .with(key::WRAP, encode_wrappers(&kept).as_deref());
        let change_id = attrs
            .run_props()
            .find(|(q, _)| q.ends_with(":rPrChange"))
            .and_then(|(_, x)| attribute(x, "id"));
        if change_id.is_some_and(|id| wanted(&id)) {
            attrs = resolve_format(&attrs, accept, ctx);
        }
        out.push(&span.text, attrs);
    }
    out.insert_content(out.len(), &content.slice(end, len));
    out
}

/// A paragraph's properties after its tracked property change is
/// accepted (record dropped) or rejected (recorded properties restored).
fn resolve_ppr_change(ppr: &str, accept: bool, w: &str, decls: &[Decl]) -> String {
    let e = Element::open(ppr, "pPr", w, decls, PPR_ORDER);
    let Some(change) = e.get("pPrChange").map(str::to_owned) else {
        return ppr.to_owned();
    };
    let mut out = e.clone();
    out.set("pPrChange", None);
    if !accept {
        let old = Element::open(&change, "pPrChange", w, decls, PPR_ORDER);
        if let Some(old_ppr) = old.get("pPr") {
            let restored = Element::open(old_ppr, "pPr", w, decls, PPR_ORDER);
            // The mark's formatting and the section break are not part of
            // the recorded properties.
            let rpr = e.get("rPr").map(str::to_owned);
            let sect = e.get("sectPr").map(str::to_owned);
            out = restored;
            out.set("rPr", rpr);
            out.set("sectPr", sect);
        }
    }
    out.finish(true)
}

/// Accepts or rejects revisions in a story.
pub(crate) fn resolve(txn: &mut Txn<'_>, scope: &Scope, accept: bool) {
    let w = txn.doc.w_prefix().to_owned();
    let decls = Arc::clone(txn.doc.decls());
    let ctx = SnippetContext::new(&decls);
    let (paras, from, to, ids, every_mark): (
        Vec<BlockId>,
        usize,
        usize,
        Option<&HashSet<String>>,
        bool,
    ) = match scope {
        Scope::Range { paras, from, to } => (paras.clone(), *from, *to, None, false),
        Scope::Ids(ids) => (txn.story().paragraphs(), 0, usize::MAX, Some(ids), true),
        Scope::All => (txn.story().paragraphs(), 0, usize::MAX, None, true),
    };
    let wanted = |id: &str| ids.is_none_or(|set| set.contains(id));
    let last = paras.len().saturating_sub(1);
    // Marks to join with the paragraph after them, resolved last to first.
    let mut joins: Vec<(BlockId, BlockId)> = Vec::new();
    for (k, id) in paras.iter().enumerate() {
        let Some(b) = txn.get(id) else {
            continue;
        };
        if b.kind != BlockKind::Paragraph {
            continue;
        }
        let start = if k == 0 { from } else { 0 };
        let end = if k == last { to } else { usize::MAX };
        let content = resolve_text(&b.content, start, end, accept, &wanted, &ctx);
        let mut props = b.props.clone();
        if ppr_change_id(&props, &w, &decls).is_some_and(|i| wanted(&i)) {
            props = resolve_ppr_change(&props, accept, &w, &decls);
        }
        // The mark is in scope for every paragraph but the last of a range.
        let mark_in_scope = every_mark || k < last;
        if mark_in_scope
            && let Some((inserted, _, mark_id)) = mark_revision(&props, &w, &decls)
            && mark_id.as_deref().is_none_or(&wanted)
        {
            props = set_mark_revision(&props, None, &w, &decls);
            // An inserted mark rejected, or a deleted one accepted, goes.
            if inserted != accept
                && let Some(next) = next_paragraph(txn, id)
            {
                joins.push((id.clone(), next));
            }
        }
        let changed = content != b.content || props != b.props;
        if changed && let Some(b) = txn.block_mut(id) {
            b.content = content;
            b.props = props;
        }
    }
    for (first, second) in joins.into_iter().rev() {
        join(txn, &first, &second);
    }
}

/// The paragraph after `id` among its siblings.
fn next_paragraph(txn: &Txn<'_>, id: &BlockId) -> Option<BlockId> {
    let parent = txn.get(id)?.parent.clone();
    let kids = txn.story().children(parent.as_ref());
    let i = kids.iter().position(|k| k == id)?;
    let next = kids.get(i + 1)?;
    (txn.get(next)?.kind == BlockKind::Paragraph).then(|| next.clone())
}

/// The settings part, creating it (with its relationship and content type)
/// when the document has none. Returns its name.
fn settings_part(doc: &mut Document) -> Result<String> {
    let existing = doc
        .main_rels
        .iter()
        .find(|r| rel_kind(&r.rel_type) == "settings")
        .map(|r| doc.main_rels.resolve(r))
        .filter(|p| doc.pkg.has_part(p));
    if let Some(p) = existing {
        return Ok(p);
    }
    let name = "/word/settings.xml".to_owned();
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:settings xmlns:w=\"{W_NS}\"></w:settings>"
    );
    doc.pkg.write(&name, xml.into_bytes(), Some(SETTINGS_CT));
    let main = doc.main.clone();
    let mut rels = doc.pkg.rels(&main)?;
    rels.add_internal(SETTINGS_REL, &name);
    doc.pkg.write_rels(&rels);
    doc.main_rels = Arc::new(doc.pkg.rels(&main)?);
    Ok(name)
}

/// Turns tracking changes on or off for everyone (`w:trackRevisions` in
/// the settings part). Returns whether anything changed.
pub(crate) fn set_tracking(doc: &mut Document, on: bool) -> Result<bool> {
    if doc.parts().settings.track_revisions == on {
        return Ok(false);
    }
    let part = settings_part(doc)?;
    let bytes = doc.pkg.read(&part)?;
    let tree = XmlTree::parse(&bytes, &part)?;
    let root = tree.root();
    let src = tree.source();
    let w = tree
        .qname(root)
        .split_once(':')
        .map_or("", |(p, _)| p)
        .to_owned();
    let tag = if w.is_empty() {
        "trackRevisions".to_owned()
    } else {
        format!("{w}:trackRevisions")
    };
    let kids: Vec<_> = tree.children(root).collect();
    let existing = kids
        .iter()
        .copied()
        .find(|&c| tree.is_w(c, "trackRevisions"));
    let out = match (existing, on) {
        (Some(c), false) => {
            let span = tree.span(c);
            format!("{}{}", &src[..span.start], &src[span.end..])
        }
        (Some(c), true) => {
            // Present but off (`w:val="0"`).
            let span = tree.span(c);
            format!("{}<{tag}/>{}", &src[..span.start], &src[span.end..])
        }
        (None, false) => return Ok(false),
        (None, true) => {
            let rank = |local: &str| SETTINGS_ORDER.iter().position(|n| *n == local);
            let mine = rank("trackRevisions").unwrap_or(0);
            let before = kids.iter().copied().find(|&c| {
                let known = tree.is_w(c, tree.local(c));
                !known || rank(tree.local(c)).is_none_or(|r| r > mine)
            });
            let root_span = tree.span(root);
            let start_tag = tree.start_tag(root);
            if start_tag.ends_with("/>") {
                let open = format!("{}>", start_tag.trim_end_matches("/>").trim_end());
                format!(
                    "{}{open}<{tag}/></{}>{}",
                    &src[..root_span.start],
                    tree.qname(root),
                    &src[root_span.end..]
                )
            } else {
                let at = before.map_or(root_span.end - (tree.qname(root).len() + 3), |c| {
                    tree.span(c).start
                });
                format!("{}<{tag}/>{}", &src[..at], &src[at..])
            }
        }
    };
    doc.pkg.write(&part, out.into_bytes(), None);
    doc.load_parts()?;
    Ok(true)
}

#[cfg(test)]
mod test;
