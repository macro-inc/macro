//! Rebuilding package parts from collaborative entries.

use super::decompose::{is_rels_part, rels_source, scoped};
use super::order::sorted_by_key;
use super::{Entries, container};
use crate::edit::slides::PRESENTATION_ORDER;
use crate::error::Result;
use crate::model::shape::sp_tree;
use crate::opc::{Relationships, normalize_part_name, rel_type, rels_part_name};
use crate::xml::{Ns, XmlDoc};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::collections::BTreeSet;

const RELATIONSHIPS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS: &str = "http://schemas.openxmlformats.org/package/2006/content-types";

/// Every part the entries describe (content types excluded).
pub(super) fn part_names(entries: &Entries) -> BTreeSet<String> {
    let mut names: BTreeSet<String> = entries.keys(container::PARTS).map(str::to_owned).collect();
    for key in entries.keys(container::RELS) {
        if let Some((part, _)) = key.rsplit_once(super::KEY_SEPARATOR) {
            names.insert(part.to_owned());
        }
    }
    names
}

/// The main presentation part, from the package relationships.
pub(super) fn main_part(entries: &Entries) -> Option<String> {
    let prefix = scoped(crate::opc::PACKAGE_RELS_PART, "");
    entries
        .prefixed(container::RELS, &prefix)
        .filter_map(|(_, xml)| parse_relationship(xml))
        .find(|(rel_type, _)| {
            rel_type == rel_type::OFFICE_DOCUMENT || rel_type == rel_type::OFFICE_DOCUMENT_STRICT
        })
        .map(|(_, target)| normalize_part_name(&target))
}

/// `(Type, Target)` of a stored `<Relationship/>` element.
fn parse_relationship(xml: &str) -> Option<(String, String)> {
    let wrapped = format!("<Relationships xmlns=\"{RELATIONSHIPS_NS}\">{xml}</Relationships>");
    let rels = Relationships::parse("/", wrapped.as_bytes()).ok()?;
    let rel = rels.iter().next()?;
    Some((rel.rel_type.clone(), rel.target.clone()))
}

/// rIds sort numerically when they can (`rId2` before `rId10`).
fn rid_order(id: &str) -> (u64, &str) {
    let n = id
        .strip_prefix("rId")
        .and_then(|n| n.parse().ok())
        .unwrap_or(u64::MAX);
    (n, id)
}

fn relationships_part(entries: &Entries, name: &str) -> Option<Vec<u8>> {
    let prefix = scoped(name, "");
    let mut rels: Vec<(&str, &str)> = entries
        .prefixed(container::RELS, &prefix)
        .map(|(key, xml)| (&key[prefix.len()..], xml))
        .collect();
    if rels.is_empty() {
        return None;
    }
    rels.sort_by(|a, b| rid_order(a.0).cmp(&rid_order(b.0)));
    let mut out = String::from(crate::xml::STANDARD_DECLARATION);
    out.push_str(&format!("<Relationships xmlns=\"{RELATIONSHIPS_NS}\">"));
    for (_, xml) in rels {
        out.push_str(xml);
    }
    out.push_str("</Relationships>");
    Some(out.into_bytes())
}

fn decode(value: &str) -> Vec<u8> {
    match value.strip_prefix("b64:") {
        Some(data) => STANDARD.decode(data).unwrap_or_default(),
        None => value.as_bytes().to_vec(),
    }
}

/// The main part with its slide list.
fn presentation_part(entries: &Entries, name: &str, frame: &str) -> Result<Vec<u8>> {
    let mut doc = XmlDoc::parse(frame.as_bytes(), name)?;
    let rels_prefix = scoped(&rels_part_name(name), "");
    let slides = entries.map(container::SLIDES);
    let order = entries.map(container::SLIDE_ORDER);
    let ids = sorted_by_key(order.iter().filter_map(|(id, key)| {
        let rid = slides.get(id)?;
        // A slide whose relationship another peer removed is not listed.
        entries
            .get(container::RELS, &format!("{rels_prefix}{rid}"))
            .map(|_| (id.as_str(), key.as_str()))
    }));
    if !ids.is_empty() {
        let root = doc.root();
        let list = doc.ensure_child(root, Ns::P, "sldIdLst", PRESENTATION_ORDER);
        for id in ids {
            let el = doc.create_element(Ns::P, "sldId");
            doc.set_attr(el, "id", id);
            doc.set_attr_ns(el, Ns::R, "id", &slides[id]);
            doc.append_child(list, el);
        }
    }
    Ok(doc.to_bytes())
}

/// A slide with its shapes spliced into the shape tree in z-order.
fn slide_part(entries: &Entries, name: &str, frame: &str) -> Result<Vec<u8>> {
    let mut doc = XmlDoc::parse(frame.as_bytes(), name)?;
    let Some(tree) = sp_tree(&doc) else {
        return Ok(frame.as_bytes().to_vec());
    };
    let prefix = scoped(name, "");
    let shapes = entries.map(container::SHAPES);
    let keys = sorted_by_key(
        entries
            .prefixed(container::SHAPE_ORDER, &prefix)
            .filter(|(key, _)| shapes.contains_key(*key)),
    );
    let tail = doc.child(tree, Ns::P, "extLst");
    for key in keys {
        // A fragment that does not parse is skipped rather than losing the slide.
        let Ok(fragment) = XmlDoc::parse(shapes[key].as_bytes(), key) else {
            continue;
        };
        let node = doc.import_verbatim(&fragment, fragment.root());
        match tail {
            Some(tail) => doc.insert_before(tail, node),
            None => doc.append_child(tree, node),
        }
        doc.drop_redundant_ns_decls(node);
    }
    Ok(doc.to_bytes())
}

/// The bytes of part `name`, or `None` when the entries no longer hold it.
pub(super) fn part(entries: &Entries, name: &str, main: Option<&str>) -> Result<Option<Vec<u8>>> {
    if is_rels_part(name) {
        return Ok(relationships_part(entries, name));
    }
    let Some(value) = entries.get(container::PARTS, name) else {
        return Ok(None);
    };
    if main == Some(name) {
        return presentation_part(entries, name, value).map(Some);
    }
    let prefix = scoped(name, "");
    if entries
        .prefixed(container::SHAPES, &prefix)
        .next()
        .is_some()
    {
        return slide_part(entries, name, value).map(Some);
    }
    Ok(Some(decode(value)))
}

/// `[Content_Types].xml` from the `TYPES` entries.
pub(super) fn content_types(entries: &Entries) -> Vec<u8> {
    let mut out = String::from(crate::xml::STANDARD_DECLARATION);
    out.push_str(&format!("<Types xmlns=\"{CONTENT_TYPES_NS}\">"));
    let mut overrides = Vec::new();
    for (key, ct) in entries.map(container::TYPES) {
        let Some((kind, item)) = key.split_once(super::KEY_SEPARATOR) else {
            continue;
        };
        let mut attrs = String::new();
        escape_into(&mut attrs, item);
        let mut ct_attr = String::new();
        escape_into(&mut ct_attr, ct);
        match kind {
            "default" => out.push_str(&format!(
                "<Default Extension=\"{attrs}\" ContentType=\"{ct_attr}\"/>"
            )),
            "override" => overrides.push(format!(
                "<Override PartName=\"{attrs}\" ContentType=\"{ct_attr}\"/>"
            )),
            _ => {}
        }
    }
    for o in overrides {
        out.push_str(&o);
    }
    out.push_str("</Types>");
    out.into_bytes()
}

fn escape_into(out: &mut String, value: &str) {
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
}

/// A complete `.pptx` built from the entries (parts stored uncompressed).
pub(super) fn package(entries: &Entries) -> Result<Vec<u8>> {
    let main = main_part(entries);
    let mut writer = crate::zip::Writer::new();
    let types = content_types(entries);
    writer.add(
        "[Content_Types].xml",
        crate::zip::WriteData::Fresh {
            data: &types,
            compress: false,
        },
    )?;
    for name in part_names(entries) {
        if let Some(bytes) = part(entries, &name, main.as_deref())? {
            writer.add(
                name.trim_start_matches('/'),
                crate::zip::WriteData::Fresh {
                    data: &bytes,
                    compress: false,
                },
            )?;
        }
    }
    writer.finish()
}

/// The part a change to `(container, key)` rewrites (`None` = content types).
pub(super) fn affected_part(container_name: &str, key: &str, main: &str) -> Option<String> {
    match container_name {
        container::PARTS => Some(key.to_owned()),
        container::RELS | container::SHAPES | container::SHAPE_ORDER => key
            .rsplit_once(super::KEY_SEPARATOR)
            .map(|(part, _)| part.to_owned()),
        container::SLIDES | container::SLIDE_ORDER => Some(main.to_owned()),
        _ => None,
    }
}

/// The source part of a relationships part, for cache invalidation.
pub(super) fn source_of(name: &str) -> Option<String> {
    is_rels_part(name).then(|| rels_source(name))
}
