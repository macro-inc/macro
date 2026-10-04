//! Creating footnotes and endnotes: the notes part (with Word's separators)
//! when the document has none, the note and reference styles when its
//! styles lack them, and the new note itself.

use crate::document::{Document, rel_kind};
use crate::error::Result;
use crate::xml::XmlTree;
use std::sync::Arc;

const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const CT: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.";

/// Names of the two kinds of notes in the package and the XML.
struct Kind {
    /// The relationship (and part) name: `footnotes`.
    part: &'static str,
    /// The note element: `footnote`.
    element: &'static str,
    /// The reference mark inside the note: `footnoteRef`.
    mark: &'static str,
    /// Built-in paragraph style of the note's text.
    text_style: (&'static str, &'static str),
    /// Built-in character style of the references.
    reference_style: (&'static str, &'static str),
}

const FOOTNOTE: Kind = Kind {
    part: "footnotes",
    element: "footnote",
    mark: "footnoteRef",
    text_style: ("FootnoteText", "footnote text"),
    reference_style: ("FootnoteReference", "footnote reference"),
};

const ENDNOTE: Kind = Kind {
    part: "endnotes",
    element: "endnote",
    mark: "endnoteRef",
    text_style: ("EndnoteText", "endnote text"),
    reference_style: ("EndnoteReference", "endnote reference"),
};

fn kind(endnote: bool) -> &'static Kind {
    if endnote { &ENDNOTE } else { &FOOTNOTE }
}

/// The prefix a part binds to WordprocessingML (from its root element).
fn prefix_of(tree: &XmlTree) -> String {
    tree.qname(tree.root())
        .split_once(':')
        .map_or(String::new(), |(p, _)| p.to_owned())
}

fn qualify(w: &str, local: &str) -> String {
    if w.is_empty() {
        local.to_owned()
    } else {
        format!("{w}:{local}")
    }
}

/// Inserts `xml` as the last children of a part's root element.
fn append_to_root(tree: &XmlTree, xml: &str) -> String {
    let src = tree.source();
    let root = tree.root();
    let span = tree.span(root);
    let tag = tree.start_tag(root);
    if let Some(open) = tag.strip_suffix("/>") {
        return format!(
            "{}{}>{xml}</{}>{}",
            &src[..span.start],
            open.trim_end(),
            tree.qname(root),
            &src[span.end..]
        );
    }
    let close = span.end - (tree.qname(root).len() + 3);
    format!("{}{xml}{}", &src[..close], &src[close..])
}

/// The notes part, creating it (with the separator and continuation
/// separator Word draws above notes, its relationship and content type)
/// when the document has none. Returns its name.
fn notes_part(doc: &mut Document, endnote: bool) -> Result<String> {
    let k = kind(endnote);
    let existing = doc
        .main_rels
        .iter()
        .find(|r| rel_kind(&r.rel_type) == k.part)
        .map(|r| doc.main_rels.resolve(r))
        .filter(|p| doc.pkg.has_part(p));
    if let Some(p) = existing {
        return Ok(p);
    }
    let name = format!("/word/{}.xml", k.part);
    let separator = |kind: &str, id: i32, mark: &str| {
        format!(
            "<w:{e} w:type=\"{kind}\" w:id=\"{id}\"><w:p><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr><w:r><w:{mark}/></w:r></w:p></w:{e}>",
            e = k.element
        )
    };
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:{part} xmlns:w=\"{W_NS}\">{}{}</w:{part}>",
        separator("separator", -1, "separator"),
        separator("continuationSeparator", 0, "continuationSeparator"),
        part = k.part,
    );
    let content_type = format!("{CT}{}+xml", k.part);
    doc.pkg.write(&name, xml.into_bytes(), Some(&content_type));
    let main = doc.main.clone();
    let mut rels = doc.pkg.rels(&main)?;
    rels.add_internal(&format!("{REL}{}", k.part), &name);
    doc.pkg.write_rels(&rels);
    doc.main_rels = Arc::new(doc.pkg.rels(&main)?);
    Ok(name)
}

/// The ids of the note text and reference styles, adding Word's built-in
/// definitions to the styles part when it lacks them. `None` when the
/// document has no styles part (the note then uses direct formatting).
fn note_styles(doc: &mut Document, endnote: bool) -> Result<Option<(String, String)>> {
    let k = kind(endnote);
    let part = doc
        .main_rels
        .iter()
        .find(|r| rel_kind(&r.rel_type) == "styles")
        .map(|r| doc.main_rels.resolve(r))
        .filter(|p| doc.pkg.has_part(p));
    let Some(part) = part else {
        return Ok(None);
    };
    let styles = Arc::clone(&doc.parts.styles);
    let found = |(_, name): (&str, &str)| styles.id_by_name(name).map(str::to_owned);
    if let (Some(text), Some(reference)) = (found(k.text_style), found(k.reference_style)) {
        return Ok(Some((text, reference)));
    }
    let bytes = doc.pkg.read(&part)?.into_owned();
    let tree = XmlTree::parse(&bytes, &part)?;
    let w = prefix_of(&tree);
    let q = |l: &str| qualify(&w, l);
    let mut add = String::new();
    let mut ids = (String::new(), String::new());
    for (slot, (id, name), paragraph) in [
        (&mut ids.0, k.text_style, true),
        (&mut ids.1, k.reference_style, false),
    ] {
        if let Some(existing) = found((id, name)) {
            *slot = existing;
            continue;
        }
        // A free id (the built-in one unless another style took it).
        let mut sid = id.to_owned();
        let mut n = 1;
        while styles.get(&sid).is_some() {
            n += 1;
            sid = format!("{id}{n}");
        }
        let based_on = if paragraph {
            styles
                .default_paragraph_id()
                .map(|d| format!("<{} {}=\"{d}\"/>", q("basedOn"), q("val")))
                .unwrap_or_default()
        } else {
            String::new()
        };
        let props = if paragraph {
            format!(
                "<{pPr}><{sp} {after}=\"0\" {line}=\"240\" {rule}=\"auto\"/></{pPr}><{rPr}><{sz} {val}=\"20\"/><{szCs} {val}=\"20\"/></{rPr}>",
                pPr = q("pPr"),
                sp = q("spacing"),
                after = q("after"),
                line = q("line"),
                rule = q("lineRule"),
                rPr = q("rPr"),
                sz = q("sz"),
                szCs = q("szCs"),
                val = q("val"),
            )
        } else {
            format!(
                "<{rPr}><{va} {val}=\"superscript\"/></{rPr}>",
                rPr = q("rPr"),
                va = q("vertAlign"),
                val = q("val"),
            )
        };
        add.push_str(&format!(
            "<{style} {type}=\"{t}\" {styleId}=\"{sid}\"><{nm} {val}=\"{name}\"/>{based_on}<{prio} {val}=\"99\"/><{semi}/><{unhide}/>{props}</{style}>",
            style = q("style"),
            type = q("type"),
            t = if paragraph { "paragraph" } else { "character" },
            styleId = q("styleId"),
            nm = q("name"),
            val = q("val"),
            prio = q("uiPriority"),
            semi = q("semiHidden"),
            unhide = q("unhideWhenUsed"),
        ));
        *slot = sid;
    }
    let xml = append_to_root(&tree, &add);
    doc.pkg.write(&part, xml.into_bytes(), None);
    doc.load_parts()?;
    Ok(Some(ids))
}

/// What a new note needs from the body: the reference's character style
/// (or `None` for direct superscript).
pub(super) struct NewNote {
    /// The note's id.
    pub id: i64,
    /// The reference style id.
    pub reference_style: Option<String>,
}

/// Adds a note holding its reference mark and a space, ready for text.
/// The body's reference to it is the caller's to insert.
pub(super) fn add_note(doc: &mut Document, endnote: bool) -> Result<NewNote> {
    let k = kind(endnote);
    let styles = note_styles(doc, endnote)?;
    let part = notes_part(doc, endnote)?;
    let bytes = doc.pkg.read(&part)?.into_owned();
    let tree = XmlTree::parse(&bytes, &part)?;
    let w = prefix_of(&tree);
    let q = |l: &str| qualify(&w, l);
    // An id no other note has, and that a peer adding a note at the same
    // time is unlikely to pick; kept small, as Word's are.
    let used: Vec<i64> = tree
        .children(tree.root())
        .filter_map(|n| tree.w_attr(n, "id").and_then(crate::xml::parse_int))
        .collect();
    let next = used.iter().copied().max().unwrap_or(0).max(0) + 1;
    let random = doc.ids.lock().ok().and_then(|g| g.source().cloned());
    let id = match random {
        Some(source) => (0..64)
            .map(|_| source.next_in(1_000..30_000) as i64)
            .find(|id| !used.contains(id))
            .unwrap_or(next),
        None => next,
    };
    let (ppr, mark_rpr) = match &styles {
        Some((text, reference)) => (
            format!(
                "<{pPr}><{ps} {val}=\"{text}\"/></{pPr}>",
                pPr = q("pPr"),
                ps = q("pStyle"),
                val = q("val"),
            ),
            format!(
                "<{rPr}><{rs} {val}=\"{reference}\"/></{rPr}>",
                rPr = q("rPr"),
                rs = q("rStyle"),
                val = q("val"),
            ),
        ),
        None => (
            format!(
                "<{pPr}><{sp} {after}=\"0\"/><{rPr}><{sz} {val}=\"20\"/></{rPr}></{pPr}>",
                pPr = q("pPr"),
                sp = q("spacing"),
                after = q("after"),
                rPr = q("rPr"),
                sz = q("sz"),
                val = q("val"),
            ),
            format!(
                "<{rPr}><{va} {val}=\"superscript\"/></{rPr}>",
                rPr = q("rPr"),
                va = q("vertAlign"),
                val = q("val"),
            ),
        ),
    };
    let text_rpr = if styles.is_none() {
        format!(
            "<{rPr}><{sz} {val}=\"20\"/></{rPr}>",
            rPr = q("rPr"),
            sz = q("sz"),
            val = q("val"),
        )
    } else {
        String::new()
    };
    let note = format!(
        "<{e} {idq}=\"{id}\"><{p}>{ppr}<{r}>{mark_rpr}<{mark}/></{r}><{r}>{text_rpr}<{t} xml:space=\"preserve\"> </{t}></{r}></{p}></{e}>",
        e = q(k.element),
        idq = q("id"),
        p = q("p"),
        r = q("r"),
        t = q("t"),
        mark = q(k.mark),
    );
    let xml = append_to_root(&tree, &note);
    doc.pkg.write(&part, xml.into_bytes(), None);
    doc.load_parts()?;
    Ok(NewNote {
        id,
        reference_style: styles.map(|(_, reference)| reference),
    })
}

#[cfg(test)]
mod test;
