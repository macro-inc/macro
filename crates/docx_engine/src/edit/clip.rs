//! The clipboard. A copy is a list of paragraphs: in Macro's own form
//! (every run's attributes and the paragraph properties, which paste back
//! losslessly) and as HTML for other applications. Pasted HTML arrives as
//! the same paragraphs with plain formatting flags instead of attributes.

use super::ListKind;
use super::revise::{self, Revisor};
use super::txn::Txn;
use super::xmledit::{Element, PPR_ORDER};
use super::{Pos, text};
use crate::layout::format::{Formats, ParaFormat};
use crate::model::block::BlockId;
use crate::model::content::{Attrs, Wrapper, encode_wrappers, key, utf16_len};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

fn is_false(v: &bool) -> bool {
    !*v
}

fn is_zero(v: &u8) -> bool {
    *v == 0
}

/// One copied or pasted paragraph.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipParagraph {
    /// Its text, run by run.
    pub runs: Vec<ClipRun>,
    /// Paragraph properties (`w:pPr`), from a copy in this editor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub props: Option<String>,
    /// Heading level, 1 to 9.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading: Option<u8>,
    /// The kind of list it is an item of.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<ListKind>,
    /// Its list level (0 is the outermost).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub level: u8,
}

/// One run of copied or pasted text.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRun {
    /// The text (object characters stand for pictures and fields).
    pub text: String,
    /// The run's attributes, from a copy in this editor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attrs: Option<BTreeMap<String, String>>,
    /// Bold.
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    /// Italic.
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    /// Underlined.
    #[serde(default, skip_serializing_if = "is_false")]
    pub underline: bool,
    /// Struck through.
    #[serde(default, skip_serializing_if = "is_false")]
    pub strike: bool,
    /// Superscript.
    #[serde(default, skip_serializing_if = "is_false")]
    pub superscript: bool,
    /// Subscript.
    #[serde(default, skip_serializing_if = "is_false")]
    pub subscript: bool,
}

/// What a selection copies.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Clip {
    /// The paragraphs, in Macro's own form.
    pub paragraphs: Vec<ClipParagraph>,
    /// The same content as HTML.
    pub html: String,
    /// The plain text, paragraphs separated by newlines.
    pub text: String,
}

/// A copied span: its text and attributes, without tracked deletions
/// (copies read as if every change were accepted) and without markers
/// (bookmarks and comment ranges belong to where they are).
pub(crate) fn copy_spans(
    content: &crate::model::content::Content,
    from: usize,
    to: usize,
) -> Vec<ClipRun> {
    let mut out = Vec::new();
    for (at, span) in content.spans_at() {
        let len = utf16_len(&span.text);
        if at + len <= from || at >= to {
            continue;
        }
        let wrappers = span.attrs.wrappers();
        if wrappers.iter().any(revise::is_deleted) || span.attrs.marker().is_some() {
            continue;
        }
        let lo = from.saturating_sub(at);
        let hi = (to - at).min(len);
        let a = crate::model::content::byte_at(&span.text, lo);
        let b = crate::model::content::byte_at(&span.text, hi);
        // Insertions are just text in a copy.
        let kept: Vec<Wrapper> = wrappers
            .into_iter()
            .filter(|w| !revise::is_revision(w))
            .collect();
        let attrs = span
            .attrs
            .with(key::WRAP, encode_wrappers(&kept).as_deref())
            .without(|k| {
                k.strip_prefix(key::RUN_PROP)
                    .is_some_and(|q| q.ends_with(":rPrChange"))
            });
        out.push(ClipRun {
            text: span.text[a..b].to_owned(),
            attrs: Some(
                attrs
                    .iter()
                    .map(|(k, v)| (k.to_owned(), v.to_owned()))
                    .collect(),
            ),
            ..ClipRun::default()
        });
    }
    out
}

/// Whether markup refers to a relationship of its part (pictures, links,
/// embedded objects), which another document does not have.
fn refers_to_relationship(xml: &str) -> bool {
    ["r:id=", "r:embed=", "r:link=", "r:pict=", "r:dm="]
        .iter()
        .any(|a| xml.contains(a))
}

/// A pasted run's attributes. Runs copied in this editor keep theirs, minus
/// what only makes sense in the document they came from when pasted into
/// another; other runs take the formatting at the caret plus their flags.
fn run_attrs(
    run: &ClipRun,
    base: &Attrs,
    same_document: bool,
    w: &str,
    styles: &crate::model::styles::Styles,
) -> Option<Attrs> {
    if let Some(native) = &run.attrs {
        let mut attrs = Attrs::from_pairs(native.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        if attrs.marker().is_some() {
            return None;
        }
        if !same_document {
            if attrs.object().is_some_and(refers_to_relationship) {
                return None;
            }
            let kept: Vec<Wrapper> = attrs
                .wrappers()
                .into_iter()
                .filter(|wr| !refers_to_relationship(&wr.open) && wr.local() != "hyperlink")
                .collect();
            attrs = attrs.with(key::WRAP, encode_wrappers(&kept).as_deref());
            // A character style the document lacks would be ignored anyway.
            let style_key = format!("{}{w}:rStyle", key::RUN_PROP);
            if let Some(xml) = attrs.get(&style_key)
                && revise::attribute(xml, "val").is_some_and(|id| styles.get(&id).is_none())
            {
                attrs = attrs.with(&style_key, None);
            }
        }
        return Some(attrs);
    }
    let q = |l: &str| {
        if w.is_empty() {
            l.to_owned()
        } else {
            format!("{w}:{l}")
        }
    };
    let mut attrs = base.clone();
    let mut set = |local: &str, xml: String| {
        attrs = attrs.with(&format!("{}{}", key::RUN_PROP, q(local)), Some(&xml));
    };
    if run.bold {
        set("b", format!("<{}/>", q("b")));
    }
    if run.italic {
        set("i", format!("<{}/>", q("i")));
    }
    if run.underline {
        set("u", format!("<{} {}=\"single\"/>", q("u"), q("val")));
    }
    if run.strike {
        set("strike", format!("<{}/>", q("strike")));
    }
    if run.superscript || run.subscript {
        let v = if run.superscript {
            "superscript"
        } else {
            "subscript"
        };
        set(
            "vertAlign",
            format!("<{} {}=\"{v}\"/>", q("vertAlign"), q("val")),
        );
    }
    Some(attrs)
}

/// The paragraph style for a heading level, if the document has one.
fn heading_style(styles: &crate::model::styles::Styles, level: u8) -> Option<String> {
    styles
        .id_by_name(&format!("heading {level}"))
        .or_else(|| styles.id_by_name(&format!("Heading {level}")))
        .map(str::to_owned)
}

/// Gives a pasted paragraph its properties: those it was copied with (from
/// this document, or without list numbering from another), or a heading
/// style and list numbering for pasted HTML.
fn paragraph_props(
    txn: &mut Txn<'_>,
    id: &BlockId,
    para: &ClipParagraph,
    same_document: bool,
    lists: &mut BTreeMap<ListKind, i64>,
) -> crate::Result<()> {
    let w = txn.doc.w_prefix().to_owned();
    let decls = Arc::clone(txn.doc.decls());
    let styles = Arc::clone(&txn.doc.parts().styles);
    let q = |l: &str| {
        if w.is_empty() {
            l.to_owned()
        } else {
            format!("{w}:{l}")
        }
    };
    let list_num = match para.list {
        Some(kind)
            if !(same_document && para.props.as_deref().is_some_and(|p| p.contains("numPr"))) =>
        {
            let num = match lists.get(&kind) {
                Some(n) => *n,
                None => {
                    let n = super::lists::instance_for(txn.doc, kind)?;
                    lists.insert(kind, n);
                    n
                }
            };
            Some(num)
        }
        _ => None,
    };
    let Some(b) = txn.get(id) else {
        return Ok(());
    };
    let current = b.props.clone();
    let mut e = match &para.props {
        Some(props) => {
            let mut e = Element::open(props, "pPr", &w, &decls, PPR_ORDER);
            if !same_document {
                e.set("numPr", None);
                if let Some(style) = e.get("pStyle").and_then(|x| revise::attribute(x, "val"))
                    && styles.get(&style).is_none()
                {
                    e.set("pStyle", None);
                }
            }
            e
        }
        None => Element::open(&current, "pPr", &w, &decls, PPR_ORDER),
    };
    // The section break stays with the paragraph mark it belongs to.
    let sect = Element::open(&current, "pPr", &w, &decls, PPR_ORDER)
        .get("sectPr")
        .map(str::to_owned);
    e.set("sectPr", sect);
    if para.props.is_none()
        && let Some(level) = para.heading
        && let Some(style) = heading_style(&styles, level)
    {
        e.set_val("pStyle", Some(&style));
    }
    if let Some(num) = list_num {
        e.set(
            "numPr",
            Some(format!(
                "<{np}><{il} {val}=\"{lvl}\"/><{ni} {val}=\"{num}\"/></{np}>",
                np = q("numPr"),
                il = q("ilvl"),
                ni = q("numId"),
                val = q("val"),
                lvl = para.level.min(8),
            )),
        );
        if let Some(style) = styles.id_by_name("List Paragraph")
            && !e.has("pStyle")
        {
            e.set_val("pStyle", Some(style));
        }
    }
    let props = e.finish(true);
    if props != current
        && let Some(b) = txn.block_mut(id)
    {
        b.props = props;
    }
    Ok(())
}

/// Pastes paragraphs at `at` (the selection already removed). As in Word,
/// the first pasted paragraph's mark ends the paragraph the caret is in and
/// the last pasted paragraph runs into the text after the caret, keeping
/// that paragraph's formatting. Returns where the caret goes.
#[allow(clippy::too_many_arguments)]
pub(crate) fn paste(
    txn: &mut Txn<'_>,
    at: &Pos,
    paragraphs: &[ClipParagraph],
    base: &Attrs,
    before: Option<Attrs>,
    same_document: bool,
    rev: Option<&Revisor>,
) -> crate::Result<Pos> {
    let w = txn.doc.w_prefix().to_owned();
    let styles = Arc::clone(&txn.doc.parts().styles);
    let mut pos = Pos {
        upstream: false,
        ..at.clone()
    };
    let mut lists: BTreeMap<ListKind, i64> = BTreeMap::new();
    let mut previous = before;
    for (i, para) in paragraphs.iter().enumerate() {
        if i > 0 {
            let Some(next) = text::split_tracked(txn, &pos, rev) else {
                break;
            };
            // The paragraph just ended carries the pasted paragraph's mark.
            if let Some(prev) = revise::previous_paragraph(txn, &next.block) {
                paragraph_props(txn, &prev, &paragraphs[i - 1], same_document, &mut lists)?;
            }
            pos = next;
        }
        for run in &para.runs {
            if run.text.is_empty() {
                continue;
            }
            let Some(mut attrs) = run_attrs(run, base, same_document, &w, &styles) else {
                continue;
            };
            if let Some(r) = rev {
                attrs = revise::inserted(&attrs, previous.as_ref(), r);
            }
            let Some(b) = txn.block_mut(&pos.block) else {
                break;
            };
            let offset = pos.offset.min(b.content.len());
            b.content.insert(offset, &run.text, attrs.clone());
            pos.offset = offset + utf16_len(&run.text);
            previous = Some(attrs);
        }
    }
    Ok(pos)
}

/// A colour as CSS.
fn css_color(c: &pptx_engine::model::color::Rgba) -> String {
    c.to_hex()
}

fn escape_html(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push_str("<br>"),
            crate::model::content::OBJECT_CHAR => {}
            c => out.push(c),
        }
    }
}

/// One paragraph as HTML (its element and inline styles).
pub(crate) fn paragraph_html(
    out: &mut String,
    runs: &[ClipRun],
    formats: &Formats<'_>,
    para: &Arc<ParaFormat>,
    tag: &str,
) {
    let align = match para.props.jc {
        crate::model::props::Align::Center => "center",
        crate::model::props::Align::Right => "right",
        crate::model::props::Align::Justify | crate::model::props::Align::Distribute => "justify",
        crate::model::props::Align::Left => "left",
    };
    out.push_str(&format!("<{tag} style=\"margin:0;text-align:{align}\">"));
    if runs.iter().all(|r| {
        r.text
            .chars()
            .all(|c| c == crate::model::content::OBJECT_CHAR)
    }) {
        out.push_str("<br>");
    }
    for run in runs {
        let attrs = run
            .attrs
            .as_ref()
            .map(|m| Attrs::from_pairs(m.iter().map(|(k, v)| (k.as_str(), v.as_str()))))
            .unwrap_or_default();
        if attrs.is_instr() {
            continue;
        }
        let p = formats.run(&attrs, para);
        if p.vanish {
            continue;
        }
        let mut style = format!(
            "font-family:'{}';font-size:{}pt",
            p.ascii.replace('\'', ""),
            p.size
        );
        if p.bold {
            style.push_str(";font-weight:bold");
        }
        if p.italic {
            style.push_str(";font-style:italic");
        }
        let mut deco = Vec::new();
        if p.underline.is_some() {
            deco.push("underline");
        }
        if p.strike || p.dstrike {
            deco.push("line-through");
        }
        if !deco.is_empty() {
            style.push_str(&format!(";text-decoration:{}", deco.join(" ")));
        }
        if let Some(c) = &p.color {
            style.push_str(&format!(";color:{}", css_color(c)));
        }
        let (open, close) = match p.vert_align {
            crate::model::props::VertAlign::Super => ("<sup>", "</sup>"),
            crate::model::props::VertAlign::Sub => ("<sub>", "</sub>"),
            _ => ("", ""),
        };
        out.push_str(&format!("{open}<span style=\"{style}\">"));
        escape_html(out, &run.text);
        out.push_str(&format!("</span>{close}"));
    }
    out.push_str(&format!("</{tag}>"));
}

#[cfg(test)]
mod test;
