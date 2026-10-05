//! Bulleted and numbered lists: list definitions in the numbering part and
//! list membership of paragraphs.

use super::ListKind;
use crate::document::{Document, rel_kind};
use crate::error::Result;
use crate::model::numbering::NumFmt;
use crate::xml::XmlTree;
use std::sync::Arc;

const NUMBERING_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
const NUMBERING_CT: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";
const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/// The kind of list a level's number format makes.
pub(super) fn kind_of(fmt: &NumFmt) -> Option<ListKind> {
    match fmt {
        NumFmt::Bullet => Some(ListKind::Bullet),
        NumFmt::None => None,
        _ => Some(ListKind::Number),
    }
}

/// Word's default levels for a new list (`w` is the part's prefix).
fn default_levels(kind: ListKind, w: &str) -> String {
    let q = |l: &str| format!("{w}:{l}");
    let mut out = String::new();
    for i in 0..9u32 {
        let left = 720 * (i + 1);
        let (fmt, text, jc, hanging, font) = match kind {
            ListKind::Bullet => {
                let (text, font) = match i % 3 {
                    0 => ("\u{F0B7}", "Symbol"),
                    1 => ("o", "Courier New"),
                    _ => ("\u{F0A7}", "Wingdings"),
                };
                ("bullet", text.to_owned(), "left", 360, Some(font))
            }
            ListKind::Number => {
                let (fmt, jc, hanging) = match i % 3 {
                    0 => ("decimal", "left", 360),
                    1 => ("lowerLetter", "left", 360),
                    _ => ("lowerRoman", "right", 180),
                };
                (fmt, format!("%{}.", i + 1), jc, hanging, None)
            }
        };
        out.push_str(&format!(
            "<{lvl} {ilvl}=\"{i}\"><{start} {val}=\"1\"/><{numFmt} {val}=\"{fmt}\"/><{lvlText} {val}=\"{text}\"/><{lvlJc} {val}=\"{jc}\"/><{pPr}><{ind} {left_a}=\"{left}\" {hanging_a}=\"{hanging}\"/></{pPr}>",
            lvl = q("lvl"),
            ilvl = q("ilvl"),
            start = q("start"),
            val = q("val"),
            numFmt = q("numFmt"),
            lvlText = q("lvlText"),
            lvlJc = q("lvlJc"),
            pPr = q("pPr"),
            ind = q("ind"),
            left_a = q("left"),
            hanging_a = q("hanging"),
        ));
        if let Some(font) = font {
            out.push_str(&format!(
                "<{rPr}><{rFonts} {a}=\"{font}\" {h}=\"{font}\" {hint}=\"default\"/></{rPr}>",
                rPr = q("rPr"),
                rFonts = q("rFonts"),
                a = q("ascii"),
                h = q("hAnsi"),
                hint = q("hint"),
            ));
        }
        out.push_str(&format!("</{}>", q("lvl")));
    }
    out
}

/// A list instance id no peer is likely to pick at the same time.
fn fresh_id(used: impl Iterator<Item = i64>, doc: &Document) -> i64 {
    let used: Vec<i64> = used.collect();
    let random = doc.ids.lock().ok().and_then(|g| g.source().cloned());
    match random {
        Some(source) => loop {
            let id = source.next_in(10_000..1_000_000_000) as i64;
            if !used.contains(&id) {
                return id;
            }
        },
        None => used.iter().copied().max().unwrap_or(0).max(0) + 1,
    }
}

/// The numbering part, creating it (with its relationship and content
/// type) when the document has none. Returns its name.
fn numbering_part(doc: &mut Document) -> Result<String> {
    let existing = doc
        .main_rels
        .iter()
        .find(|r| rel_kind(&r.rel_type) == "numbering")
        .map(|r| doc.main_rels.resolve(r))
        .filter(|p| doc.pkg.has_part(p));
    if let Some(p) = existing {
        return Ok(p);
    }
    let name = "/word/numbering.xml".to_owned();
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:numbering xmlns:w=\"{W_NS}\"></w:numbering>"
    );
    doc.pkg.write(&name, xml.into_bytes(), Some(NUMBERING_CT));
    let main = doc.main.clone();
    let mut rels = doc.pkg.rels(&main)?;
    rels.add_internal(NUMBERING_REL, &name);
    doc.pkg.write_rels(&rels);
    doc.main_rels = Arc::new(doc.pkg.rels(&main)?);
    Ok(name)
}

/// Adds an abstract definition (when `abstract_xml` is given) and a list
/// instance to the numbering part. Returns the new instance's id.
fn add_definition(
    doc: &mut Document,
    kind: ListKind,
    abstract_id: Option<i64>,
    restart: bool,
) -> Result<i64> {
    let part = numbering_part(doc)?;
    let bytes = doc.pkg.read(&part)?.into_owned();
    let tree = XmlTree::parse(&bytes, &part)?;
    let root = tree.root();
    let w = tree
        .qname(root)
        .split_once(':')
        .map_or(String::new(), |(p, _)| p.to_owned());
    let q = |l: &str| {
        if w.is_empty() {
            l.to_owned()
        } else {
            format!("{w}:{l}")
        }
    };
    let numbering = &doc.parts.numbering;
    let num_id = fresh_id(numbering.num_ids(), doc);
    let (abstract_id, new_abstract) = match abstract_id {
        Some(a) => (a, None),
        None => {
            let a = fresh_id(numbering.abstract_ids(), doc).max(0);
            let xml = format!(
                "<{an} {id}=\"{a}\"><{mlt} {val}=\"hybridMultilevel\"/>{levels}</{an}>",
                an = q("abstractNum"),
                id = q("abstractNumId"),
                mlt = q("multiLevelType"),
                val = q("val"),
                levels = default_levels(kind, if w.is_empty() { "w" } else { &w }),
            );
            (a, Some(xml))
        }
    };
    let mut num = format!(
        "<{n} {id}=\"{num_id}\"><{a} {val}=\"{abstract_id}\"/>",
        n = q("num"),
        id = q("numId"),
        a = q("abstractNumId"),
        val = q("val"),
    );
    if restart {
        num.push_str(&format!(
            "<{o} {ilvl}=\"0\"><{s} {val}=\"1\"/></{o}>",
            o = q("lvlOverride"),
            ilvl = q("ilvl"),
            s = q("startOverride"),
            val = q("val"),
        ));
    }
    num.push_str(&format!("</{}>", q("num")));
    // Schema order: pictures, abstract definitions, instances, cleanup id.
    let src = tree.source();
    let kids: Vec<_> = tree.children(root).collect();
    let first_num = kids
        .iter()
        .find(|&&k| tree.is_w(k, "num") || tree.is_w(k, "numIdMacAtCleanup"))
        .map(|&k| tree.span(k).start);
    let after_nums = kids
        .iter()
        .rev()
        .find(|&&k| tree.is_w(k, "num"))
        .map(|&k| tree.span(k).end);
    let root_span = tree.span(root);
    let close = root_span.end - (tree.qname(root).len() + 3);
    let self_closing = tree.start_tag(root).ends_with("/>");
    let mut out = String::with_capacity(src.len() + 4096);
    if self_closing {
        let tag = tree.start_tag(root);
        out.push_str(&src[..root_span.start]);
        out.push_str(tag.trim_end_matches("/>").trim_end());
        out.push('>');
        out.push_str(new_abstract.as_deref().unwrap_or(""));
        out.push_str(&num);
        out.push_str(&format!("</{}>", tree.qname(root)));
        out.push_str(&src[root_span.end..]);
    } else {
        let a_at = first_num.unwrap_or(close);
        let n_at = after_nums.unwrap_or(a_at).max(a_at);
        out.push_str(&src[..a_at]);
        out.push_str(new_abstract.as_deref().unwrap_or(""));
        out.push_str(&src[a_at..n_at]);
        out.push_str(&num);
        out.push_str(&src[n_at..]);
    }
    doc.pkg.write(&part, out.into_bytes(), None);
    doc.load_parts()?;
    Ok(num_id)
}

/// A list instance of `kind` for new list paragraphs: an existing bullet
/// list, or a new instance of an existing numbered definition starting at
/// one, or a new definition.
pub(super) fn instance_for(doc: &mut Document, kind: ListKind) -> Result<i64> {
    let styles = Arc::clone(&doc.parts.styles);
    let numbering = Arc::clone(&doc.parts.numbering);
    let mut candidates: Vec<i64> = numbering
        .num_ids()
        .filter(|&id| id > 0)
        .filter(|&id| {
            numbering
                .level(id, 0, &styles)
                .is_some_and(|l| kind_of(&l.fmt) == Some(kind) && is_plain(l, kind))
        })
        .collect();
    candidates.sort_unstable();
    if kind == ListKind::Bullet
        && let Some(&id) = candidates.first()
    {
        return Ok(id);
    }
    if let Some(&id) = candidates.first()
        && let Some(abs) = numbering.abstract_of(id)
        && numbering
            .abstract_num(abs)
            .is_some_and(|a| a.num_style_link.is_none())
    {
        return add_definition(doc, kind, Some(abs), true);
    }
    add_definition(doc, kind, None, false)
}

/// Whether a level looks like an ordinary list (not a heading or legal
/// outline numbering with its own style).
fn is_plain(l: &crate::model::numbering::Level, kind: ListKind) -> bool {
    if l.style.is_some() {
        return false;
    }
    match kind {
        ListKind::Bullet => true,
        ListKind::Number => l
            .text
            .as_deref()
            .is_some_and(|t| t.starts_with("%1") && t.len() <= 3),
    }
}
