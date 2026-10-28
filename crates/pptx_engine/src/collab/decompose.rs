//! Splitting package parts into collaborative entries.

use super::KEY_SEPARATOR;
use crate::error::Result;
use crate::model::presentation::Presentation;
use crate::model::shape::sp_tree;
use crate::opc::{CONTENT_TYPES_PART, Package, Relationship, Relationships, TargetMode};
use crate::xml::{Ns, XmlDoc};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::collections::HashSet;

/// The entries one part contributes.
#[derive(Debug, Default)]
pub(super) struct Decomposed {
    /// The `PARTS` value (absent for relationship parts).
    pub part: Option<String>,
    /// Relationships of a relationships part: `(rId, element)`.
    pub rels: Option<Vec<(String, String)>>,
    /// Top-level shapes of a slide in z-order: `(shape key, fragment)`.
    pub shapes: Option<Vec<(String, String)>>,
    /// Slides of the main part in order: `(slide id, rId)`.
    pub slides: Option<Vec<(String, String)>>,
}

/// Whether `name` is a relationships part.
pub(super) fn is_rels_part(name: &str) -> bool {
    name.ends_with(".rels") && name.contains("/_rels/")
}

/// The part a relationships part belongs to (`/` for the package).
pub(super) fn rels_source(rels_part: &str) -> String {
    let Some((dir, file)) = rels_part.rsplit_once("/_rels/") else {
        return "/".to_owned();
    };
    let file = file.strip_suffix(".rels").unwrap_or(file);
    if dir.is_empty() && file.is_empty() {
        "/".to_owned()
    } else {
        format!("{dir}/{file}")
    }
}

/// `prefix|item`, the key of an item scoped to a part.
pub(super) fn scoped(part: &str, item: &str) -> String {
    format!("{part}{KEY_SEPARATOR}{item}")
}

/// Shape-tree children that belong to the slide rather than to one shape.
fn is_tree_header(local: &str) -> bool {
    matches!(local, "nvGrpSpPr" | "grpSpPr" | "extLst")
}

/// The top-level shapes of a slide's shape tree.
pub(super) fn tree_shapes(doc: &XmlDoc, tree: crate::xml::NodeId) -> Vec<crate::xml::NodeId> {
    doc.children(tree)
        .filter(|&c| !is_tree_header(doc.local(c)))
        .collect()
}

/// A stable key for each top-level shape: its `cNvPr` id, suffixed for
/// duplicates (malformed decks repeat ids), or its position when it has none.
fn shape_keys(doc: &XmlDoc, shapes: &[crate::xml::NodeId]) -> Vec<String> {
    let mut seen = HashSet::new();
    shapes
        .iter()
        .enumerate()
        .map(|(index, &shape)| {
            let id = doc
                .descendants(shape)
                .into_iter()
                .find(|&n| doc.local(n) == "cNvPr")
                .and_then(|n| doc.attr(n, "id"))
                .map(str::to_owned);
            let base = id.unwrap_or_else(|| format!("x{index}"));
            let mut key = base.clone();
            let mut n = 2;
            while !seen.insert(key.clone()) {
                key = format!("{base}~{n}");
                n += 1;
            }
            key
        })
        .collect()
}

fn utf8(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

/// A part's bytes as a CRDT string: XML as text, anything else as base64.
fn encode_part(pkg: &Package, name: &str, bytes: Vec<u8>) -> String {
    let xml =
        pkg.content_type(name).is_some_and(|ct| ct.ends_with("xml")) || name.ends_with(".xml");
    if xml && !bytes.starts_with(b"b64:") {
        match String::from_utf8(bytes) {
            Ok(text) => return text,
            Err(e) => return format!("b64:{}", STANDARD.encode(e.as_bytes())),
        }
    }
    format!("b64:{}", STANDARD.encode(&bytes))
}

fn escape_attr(out: &mut String, value: &str) {
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\t' => out.push_str("&#9;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            _ => out.push(c),
        }
    }
}

/// One relationship as a `<Relationship/>` element.
fn relationship_xml(rel: &Relationship) -> String {
    let mut out = String::from("<Relationship Id=\"");
    escape_attr(&mut out, &rel.id);
    out.push_str("\" Type=\"");
    escape_attr(&mut out, &rel.rel_type);
    out.push_str("\" Target=\"");
    escape_attr(&mut out, &rel.target);
    out.push('"');
    if rel.mode == TargetMode::External {
        out.push_str(" TargetMode=\"External\"");
    }
    out.push_str("/>");
    out
}

/// The entries of part `name` in its current state.
pub(super) fn decompose(pres: &mut Presentation, name: &str) -> Result<Decomposed> {
    if is_rels_part(name) {
        let bytes = pres.pkg.read(name)?;
        let rels = Relationships::parse(&rels_source(name), &bytes)?;
        let entries = rels
            .iter()
            .map(|r| (r.id.clone(), relationship_xml(r)))
            .collect();
        return Ok(Decomposed {
            rels: Some(entries),
            ..Decomposed::default()
        });
    }
    let is_slide = pres.pkg.content_type(name) == Some(crate::opc::content_type::SLIDE);
    if name == pres.main_part {
        let doc = pres.xml(name)?;
        let mut frame = (*doc).clone();
        let mut slides = Vec::new();
        if let Some(list) = doc.child(doc.root(), Ns::P, "sldIdLst") {
            for s in doc.children_named(list, Ns::P, "sldId").collect::<Vec<_>>() {
                if let (Some(id), Some(rid)) = (doc.attr(s, "id"), doc.attr_ns(s, Ns::R, "id")) {
                    slides.push((id.to_owned(), rid.to_owned()));
                }
                frame.detach(s);
            }
        }
        return Ok(Decomposed {
            part: Some(utf8(frame.to_bytes())),
            slides: Some(slides),
            ..Decomposed::default()
        });
    }
    if is_slide {
        let doc = pres.xml(name)?;
        if let Some(tree) = sp_tree(&doc) {
            let nodes = tree_shapes(&doc, tree);
            let keys = shape_keys(&doc, &nodes);
            let mut frame = (*doc).clone();
            let mut shapes = Vec::with_capacity(nodes.len());
            for (key, &node) in keys.into_iter().zip(&nodes) {
                shapes.push((key, utf8(doc.fragment(node).to_bytes())));
                frame.detach(node);
            }
            return Ok(Decomposed {
                part: Some(utf8(frame.to_bytes())),
                shapes: Some(shapes),
                ..Decomposed::default()
            });
        }
    }
    let bytes = pres.pkg.read(name)?.into_owned();
    Ok(Decomposed {
        part: Some(encode_part(&pres.pkg, name, bytes)),
        ..Decomposed::default()
    })
}

/// The `TYPES` entries of the package's content types.
pub(super) fn content_types(pkg: &Package) -> Vec<(String, String)> {
    let types = pkg.content_types();
    types
        .defaults()
        .map(|(ext, ct)| (scoped("default", ext), ct.to_owned()))
        .chain(
            types
                .overrides()
                .filter(|(part, _)| !part.eq_ignore_ascii_case(CONTENT_TYPES_PART))
                .map(|(part, ct)| (scoped("override", part), ct.to_owned())),
        )
        .collect()
}
