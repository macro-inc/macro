//! Header & Footer (Insert ▸ Header & Footer): the slide number, date, and
//! footer of slides.
//!
//! As in PowerPoint, showing one gives the slide a placeholder shape that
//! inherits its position and formatting from the matching placeholder of the
//! slide's layout (`p:ph type="sldNum"`, `"dt"`, or `"ftr"` with the layout's
//! `idx`), starting from that placeholder's paragraph; hiding it removes the
//! shape. Slide numbers and automatic dates are fields (`a:fld
//! type="slidenum"`, `type="datetime1"`...) whose current text is cached.
//! "Apply to All" also records which elements are on in the slide masters'
//! `p:hf` (and, with "Don't show on title slide", an all-off `p:hf` in the
//! title slide layouts), which slides added later follow.

use super::shapes::{append_to_tree, ensure_tx_body, tree_item};
use super::slides::{layout_of, layouts};
use super::text;
use super::xmlutil::{esc, fresh_shape_id, import_fragment, new_guid};
use crate::error::{Error, Result};
use crate::inspect::{HeaderFooterOutline, dom_paragraph_text};
use crate::model::field::{DATE_FORMATS, FieldTime};
use crate::model::presentation::Presentation;
use crate::model::shape::{placeholder_of, sp_tree, tree_children};
use crate::opc::{IdSource, rel_type};
use crate::xml::{NodeId, Ns, XmlDoc};

/// Child order of `p:sldMaster`.
pub(super) const MASTER_ORDER: &[&str] = &[
    "cSld",
    "clrMap",
    "sldLayoutIdLst",
    "transition",
    "timing",
    "hf",
    "txStyles",
    "extLst",
];
/// Child order of `p:sldLayout`.
const LAYOUT_ORDER: &[&str] = &["cSld", "clrMapOvr", "transition", "timing", "hf", "extLst"];
/// The format of a new automatic date.
const DEFAULT_DATE_FORMAT: &str = "datetime1";

/// One of the elements Header & Footer shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Element {
    Date,
    Footer,
    SlideNumber,
}

impl Element {
    const ALL: [Element; 3] = [Element::Date, Element::Footer, Element::SlideNumber];

    /// The placeholder type (also the `p:hf` attribute name).
    fn kind(self) -> &'static str {
        match self {
            Element::Date => "dt",
            Element::Footer => "ftr",
            Element::SlideNumber => "sldNum",
        }
    }

    /// The name PowerPoint gives the slide's placeholder shape.
    fn shape_name(self) -> &'static str {
        match self {
            Element::Date => "Date Placeholder",
            Element::Footer => "Footer Placeholder",
            Element::SlideNumber => "Slide Number Placeholder",
        }
    }

    fn index(self) -> usize {
        match self {
            Element::Date => 0,
            Element::Footer => 1,
            Element::SlideNumber => 2,
        }
    }
}

/// What a date shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DateContent<'a> {
    /// Whatever the date shows now.
    Keep,
    /// Fixed text.
    Fixed(&'a str),
    /// An automatic date in this format (the current one, or `datetime1`,
    /// when `None`).
    Auto(Option<&'a str>),
}

/// The requested changes of a `setHeaderFooter` operation.
pub(super) struct HeaderFooterPatch<'a> {
    pub slides: Option<&'a [u32]>,
    pub slide_number: Option<bool>,
    pub date: Option<bool>,
    pub date_content: DateContent<'a>,
    pub footer: Option<bool>,
    pub footer_text: Option<&'a str>,
    pub not_on_title: bool,
}

impl HeaderFooterPatch<'_> {
    fn shows(&self, el: Element) -> Option<bool> {
        match el {
            Element::Date => self.date,
            Element::Footer => self.footer,
            Element::SlideNumber => self.slide_number,
        }
    }
}

/// What one slide's placeholder for an element is written with.
struct Settings<'a> {
    date: DateContent<'a>,
    footer_text: Option<&'a str>,
    number: usize,
    now: Option<FieldTime>,
}

/// What a placeholder's paragraph shows.
enum Content<'a> {
    /// A slide number field showing this number.
    Number(usize),
    /// Plain text (nothing when empty).
    Text(&'a str),
    /// An automatic date field in `format`, showing `text`.
    Date { format: &'a str, text: String },
}

/// The placeholder shapes of a part's shape tree for an element (top level).
fn placeholders(doc: &XmlDoc, el: Element) -> Vec<NodeId> {
    let Some(tree) = sp_tree(doc) else {
        return Vec::new();
    };
    tree_children(doc, tree)
        .into_iter()
        .filter(|&n| placeholder_of(doc, n).is_some_and(|p| p.kind == el.kind()))
        .collect()
}

/// The text body's paragraphs of a shape.
fn paragraphs(doc: &XmlDoc, shape: NodeId) -> Vec<NodeId> {
    doc.children(shape)
        .find(|&c| doc.local(c) == "txBody")
        .map(|b| doc.children_named(b, Ns::A, "p").collect())
        .unwrap_or_default()
}

/// The fields of a shape's text whose type `matches`.
fn fields(doc: &XmlDoc, shape: NodeId, matches: impl Fn(&str) -> bool) -> Vec<NodeId> {
    paragraphs(doc, shape)
        .into_iter()
        .flat_map(|p| doc.children_named(p, Ns::A, "fld").collect::<Vec<_>>())
        .filter(|&f| matches(doc.attr(f, "type").unwrap_or("")))
        .collect()
}

fn is_date_field(kind: &str) -> bool {
    kind.starts_with("datetime")
}

fn shape_text(doc: &XmlDoc, shape: NodeId) -> String {
    paragraphs(doc, shape)
        .into_iter()
        .map(|p| dom_paragraph_text(doc, p))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The Header & Footer elements a slide shows (`None` when it shows none).
pub(crate) fn read(doc: &XmlDoc) -> Option<HeaderFooterOutline> {
    let date = placeholders(doc, Element::Date).first().copied();
    let date_field = date.and_then(|d| fields(doc, d, is_date_field).first().copied());
    let footer = placeholders(doc, Element::Footer).first().copied();
    let out = HeaderFooterOutline {
        slide_number: !placeholders(doc, Element::SlideNumber).is_empty(),
        date: date.is_some(),
        date_text: date
            .filter(|_| date_field.is_none())
            .map(|d| shape_text(doc, d)),
        date_format: date_field.and_then(|f| doc.attr(f, "type").map(str::to_owned)),
        footer: footer.is_some(),
        footer_text: footer.map(|f| shape_text(doc, f)),
    };
    (out.slide_number || out.date || out.footer).then_some(out)
}

/// Checks an automatic date format.
fn check_format(format: Option<&str>) -> Result<()> {
    match format {
        Some(f) if !DATE_FORMATS.contains(&f) => Err(Error::InvalidEdit(format!(
            "unknown date format `{f}` (use datetime1 to datetime13)"
        ))),
        _ => Ok(()),
    }
}

/// Shows, hides, or changes the slide number, date, and footer of slides
/// (every slide when `patch.slides` is `None`, which also records the
/// settings in the slide masters for new slides).
pub(super) fn set_header_footer(
    pres: &mut Presentation,
    patch: &HeaderFooterPatch<'_>,
) -> Result<()> {
    if let DateContent::Auto(format) = patch.date_content {
        check_format(format)?;
    }
    let targets: Vec<usize> = match patch.slides {
        None => (0..pres.slides.len()).collect(),
        Some(ids) => ids
            .iter()
            .map(|&id| {
                pres.slides
                    .iter()
                    .position(|s| s.id == id)
                    .ok_or_else(|| Error::NotFound(format!("slide {id}")))
            })
            .collect::<Result<_>>()?,
    };
    let now = pres.field_time();
    let mut shown = [false; 3];
    for index in targets {
        let part = pres.slides[index].part.clone();
        let Some(layout) = layout_of(pres, &part) else {
            continue;
        };
        let layout = pres.xml(&layout)?;
        let title = patch.not_on_title && is_title_layout(&layout);
        let settings = Settings {
            date: patch.date_content,
            footer_text: patch.footer_text,
            number: pres.slide_number(index),
            now,
        };
        let ids = pres.pkg.ids().cloned();
        let doc = pres.xml_mut(&part)?;
        for el in Element::ALL {
            let existing = placeholders(doc, el);
            let show = !title && patch.shows(el).unwrap_or(!existing.is_empty());
            match (existing.first(), show) {
                (Some(_), false) => {
                    for node in existing {
                        let item = tree_item(doc, node);
                        doc.detach(item);
                    }
                }
                (None, true) => {
                    let seed = format!("{part} {}", el.kind());
                    add_placeholder(doc, &layout, el, &settings, ids.as_deref(), &seed)?;
                }
                (Some(&node), true) => {
                    let seed = format!("{part} {}", el.kind());
                    update(doc, node, el, &settings, ids.as_deref(), &seed)?;
                }
                (None, false) => {}
            }
            if !title && !placeholders(doc, el).is_empty() {
                shown[el.index()] = true;
            }
        }
    }
    if patch.slides.is_none() {
        let flags = Element::ALL.map(|el| patch.shows(el).unwrap_or(shown[el.index()]));
        record_on_masters(pres, flags, patch.not_on_title)?;
    }
    Ok(())
}

fn is_title_layout(layout: &XmlDoc) -> bool {
    layout.attr(layout.root(), "type") == Some("title")
}

/// The layout placeholder an element's slide placeholder inherits from.
fn layout_placeholder(layout: &XmlDoc, el: Element) -> Option<NodeId> {
    placeholders(layout, el).first().copied()
}

/// The content a new or changed placeholder shows.
fn content<'a>(
    el: Element,
    settings: &Settings<'a>,
    current_format: Option<&'a str>,
) -> Option<Content<'a>> {
    match el {
        Element::SlideNumber => Some(Content::Number(settings.number)),
        Element::Footer => settings.footer_text.map(Content::Text),
        Element::Date => match settings.date {
            DateContent::Keep => None,
            DateContent::Fixed(text) => Some(Content::Text(text)),
            DateContent::Auto(format) => {
                let format = format
                    .or(current_format.filter(|f| DATE_FORMATS.contains(f)))
                    .unwrap_or(DEFAULT_DATE_FORMAT);
                let text = settings
                    .now
                    .and_then(|now| now.format(format))
                    .unwrap_or_default();
                Some(Content::Date { format, text })
            }
        },
    }
}

/// Adds the slide's placeholder for an element, copied from the layout's
/// (nothing when the layout has none, as in PowerPoint).
fn add_placeholder(
    doc: &mut XmlDoc,
    layout: &XmlDoc,
    el: Element,
    settings: &Settings<'_>,
    ids: Option<&IdSource>,
    seed: &str,
) -> Result<()> {
    let Some(source) = layout_placeholder(layout, el) else {
        return Ok(());
    };
    let Some(tree) = sp_tree(doc) else {
        return Ok(());
    };
    let ph = layout
        .children(source)
        .find(|&c| layout.local(c).starts_with("nv"))
        .and_then(|nv| layout.child(nv, Ns::P, "nvPr"))
        .and_then(|nv| layout.child(nv, Ns::P, "ph"));
    let attrs: String = ["type", "orient", "sz", "idx"]
        .iter()
        .filter_map(|a| {
            ph.and_then(|ph| layout.attr(ph, a))
                .map(|v| format!(" {a}=\"{}\"", esc(v)))
        })
        .collect();
    let id = fresh_shape_id(doc, ids);
    let xml = format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{} {}\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr><p:nvPr><p:ph{attrs}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/></p:txBody></p:sp>",
        el.shape_name(),
        id.saturating_sub(1)
    );
    let shape = import_fragment(doc, &xml)?;
    let body = ensure_tx_body(doc, shape)?;
    // Start from the layout's paragraph, which carries the run formatting
    // (and the field ids) PowerPoint copies onto the slide.
    if let Some(&p) = paragraphs(layout, source).first() {
        let copy = doc.import(layout, p);
        drop_links(doc, copy);
        doc.append_child(body, copy);
    }
    append_to_tree(doc, tree, shape);
    // A new date is automatic unless the layout's is fixed text.
    let fixed_layout_date = fields(layout, source, is_date_field).is_empty()
        && !shape_text(layout, source).trim().is_empty();
    let date = match settings.date {
        DateContent::Keep if !fixed_layout_date => DateContent::Auto(None),
        other => other,
    };
    let settings = Settings { date, ..*settings };
    update(doc, shape, el, &settings, ids, seed)
}

/// Brings a slide's placeholder up to date with the settings.
fn update(
    doc: &mut XmlDoc,
    shape: NodeId,
    el: Element,
    settings: &Settings<'_>,
    ids: Option<&IdSource>,
    seed: &str,
) -> Result<()> {
    if el == Element::SlideNumber {
        let numbers = fields(doc, shape, |k| k == "slidenum");
        if !numbers.is_empty() {
            // Keep text around the number ("Page ‹#›"); refresh what it shows.
            for f in numbers {
                set_field_text(doc, f, &settings.number.to_string());
            }
            return Ok(());
        }
    }
    let current = fields(doc, shape, is_date_field);
    let current_format = current
        .first()
        .and_then(|&f| doc.attr(f, "type"))
        .map(str::to_owned);
    let Some(content) = content(el, settings, current_format.as_deref()) else {
        return Ok(());
    };
    let field_id = current
        .first()
        .and_then(|&f| doc.attr(f, "id"))
        .map(str::to_owned)
        .unwrap_or_else(|| new_guid(ids, seed, &[]));
    let body = ensure_tx_body(doc, shape)?;
    set_content(doc, body, &content, &field_id)
}

/// Removes hyperlinks (their relationships belong to another part).
fn drop_links(doc: &mut XmlDoc, root: NodeId) {
    let links: Vec<NodeId> = doc
        .descendants(root)
        .into_iter()
        .filter(|&n| matches!(doc.local(n), "hlinkClick" | "hlinkMouseOver"))
        .collect();
    for l in links {
        doc.detach(l);
    }
}

fn set_field_text(doc: &mut XmlDoc, field: NodeId, text: &str) {
    let t = match doc.child(field, Ns::A, "t") {
        Some(t) => t,
        None => {
            let t = doc.create_element(Ns::A, "t");
            doc.append_child(field, t);
            t
        }
    };
    doc.set_text(t, text);
}

/// Makes a text body show `content`, keeping the formatting of its first
/// paragraph and run.
fn set_content(
    doc: &mut XmlDoc,
    body: NodeId,
    content: &Content<'_>,
    field_id: &str,
) -> Result<()> {
    let (kind, text) = match content {
        Content::Text(text) => return text::set_text(doc, body, text),
        Content::Number(n) => ("slidenum", n.to_string()),
        Content::Date { format, text } => (*format, text.clone()),
    };
    let mut ps = doc.children_named(body, Ns::A, "p").collect::<Vec<_>>();
    let p = match ps.first() {
        Some(&p) => p,
        None => {
            let p = doc.create_element(Ns::A, "p");
            doc.append_child(body, p);
            ps.push(p);
            p
        }
    };
    for &extra in &ps[1..] {
        doc.detach(extra);
    }
    let runs: Vec<NodeId> = doc
        .children(p)
        .filter(|&c| matches!(doc.local(c), "r" | "fld" | "br"))
        .collect();
    let template = runs
        .iter()
        .find_map(|&r| doc.child(r, Ns::A, "rPr"))
        .or_else(|| doc.child(p, Ns::A, "endParaRPr"));
    let rpr = match template {
        Some(t) => {
            let copy = doc.deep_clone(t);
            doc.rename(copy, "rPr");
            doc.remove_attr(copy, "dirty");
            copy
        }
        None => {
            let e = doc.create_element(Ns::A, "rPr");
            doc.set_attr(e, "lang", "en-US");
            e
        }
    };
    for r in runs {
        doc.detach(r);
    }
    let field = doc.create_element(Ns::A, "fld");
    doc.set_attr(field, "id", field_id);
    doc.set_attr(field, "type", kind);
    if doc.child(p, Ns::A, "endParaRPr").is_none() {
        let end = doc.deep_clone(rpr);
        doc.rename(end, "endParaRPr");
        doc.append_child(p, end);
    }
    doc.append_child(field, rpr);
    let t = doc.create_element(Ns::A, "t");
    doc.set_text(t, &text);
    doc.append_child(field, t);
    if let Some(end) = doc.child(p, Ns::A, "endParaRPr") {
        doc.insert_before(end, field);
    }
    Ok(())
}

/// The `p:hf` flags of a master or layout (date, footer, slide number), when
/// it has the element (absent attributes are on).
fn hf_flags(doc: &XmlDoc) -> Option<[bool; 3]> {
    let hf = doc.child(doc.root(), Ns::P, "hf")?;
    Some(Element::ALL.map(|el| doc.attr_bool(hf, el.kind()).unwrap_or(true)))
}

/// Writes `p:hf` with `flags` (`None` removes it).
fn write_hf(doc: &mut XmlDoc, flags: Option<[bool; 3]>, order: &[&str]) {
    let root = doc.root();
    doc.remove_children_named(root, Ns::P, "hf");
    let Some(flags) = flags else { return };
    let hf = doc.create_element(Ns::P, "hf");
    // PowerPoint's attribute order; slides have no header.
    if !flags[Element::SlideNumber.index()] {
        doc.set_attr(hf, "sldNum", "0");
    }
    doc.set_attr(hf, "hdr", "0");
    for el in [Element::Footer, Element::Date] {
        if !flags[el.index()] {
            doc.set_attr(hf, el.kind(), "0");
        }
    }
    doc.insert_in_order(root, hf, order);
}

/// Records "Apply to All" settings: the masters' `p:hf` (removed when nothing
/// is on) and the title slide layouts' (all off with "Don't show on title
/// slide", else none, so they follow the master).
fn record_on_masters(pres: &mut Presentation, flags: [bool; 3], not_on_title: bool) -> Result<()> {
    let all = layouts(pres)?;
    let mut masters: Vec<String> = Vec::new();
    for l in &all {
        if !masters.contains(&l.master) {
            masters.push(l.master.clone());
        }
    }
    let master_flags = flags.iter().any(|&f| f).then_some(flags);
    for master in masters {
        if hf_flags(&*pres.xml(&master)?) != master_flags {
            write_hf(pres.xml_mut(&master)?, master_flags, MASTER_ORDER);
        }
    }
    let layout_flags = not_on_title.then_some([false; 3]);
    for l in all.iter().filter(|l| l.kind == "title") {
        if hf_flags(&*pres.xml(&l.part)?) != layout_flags {
            write_hf(pres.xml_mut(&l.part)?, layout_flags, LAYOUT_ORDER);
        }
    }
    Ok(())
}

/// Gives a new slide the elements its layout's (or master's) `p:hf` turns
/// on, as PowerPoint does after "Apply to All", showing what `reference` (the
/// slide it was added after) shows.
pub(super) fn follow_masters(
    pres: &mut Presentation,
    slide: u32,
    reference: Option<u32>,
) -> Result<()> {
    let Some(index) = pres.slides.iter().position(|s| s.id == slide) else {
        return Ok(());
    };
    let part = pres.slides[index].part.clone();
    let Some(layout_part) = layout_of(pres, &part) else {
        return Ok(());
    };
    let layout = pres.xml(&layout_part)?;
    let flags = match hf_flags(&layout) {
        Some(flags) => flags,
        None => {
            let rels = pres.part_rels(&layout_part)?;
            let Some(master) = rels
                .first_of_type(rel_type::SLIDE_MASTER)
                .map(|r| rels.resolve(r))
            else {
                return Ok(());
            };
            match hf_flags(&*pres.xml(&master)?) {
                Some(flags) => flags,
                None => return Ok(()),
            }
        }
    };
    if !flags.iter().any(|&f| f) {
        return Ok(());
    }
    let shown = match reference.and_then(|r| pres.slide_part(r).ok()) {
        Some(r) => read(&*pres.xml(&r)?),
        None => None,
    };
    let date = match shown.as_ref() {
        Some(s) if s.date => match (&s.date_text, &s.date_format) {
            (Some(text), _) => DateContent::Fixed(text.as_str()),
            (None, format) => DateContent::Auto(format.as_deref()),
        },
        _ => DateContent::Keep,
    };
    let settings = Settings {
        date,
        footer_text: shown.as_ref().and_then(|s| s.footer_text.as_deref()),
        number: pres.slide_number(index),
        now: pres.field_time(),
    };
    let ids = pres.pkg.ids().cloned();
    let doc = pres.xml_mut(&part)?;
    for el in Element::ALL {
        if flags[el.index()] && placeholders(doc, el).is_empty() {
            let seed = format!("{part} {}", el.kind());
            add_placeholder(doc, &layout, el, &settings, ids.as_deref(), &seed)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod test;
