//! Copying layers out of a file, in the format Figma's clipboard uses: a
//! bare `fig-kiwi` document in the file's own schema whose first page holds
//! the layers at their page positions. The components their instances show
//! and the shared styles they use ride along on an internal page, so
//! another file can still draw them, and the images they use are packed
//! beside it.
//!
//! Records are written as saving writes them (unedited ones as they are in
//! the file, edited ones patched), with blob references renumbered into the
//! copy's own blob list.

use super::{Build, created_record, document_bytes, scan_guid, with_shape_fields};
use crate::container::Container;
use crate::document::{Document, NodeIdx};
use crate::edit::flags;
use crate::error::{Result, corrupt};
use crate::kiwi::{Decoder, Msg, Reader, Schema, Value, Writer};
use crate::model::{Guid, NodeType, PropValue};
use std::collections::{HashMap, HashSet};

/// What copying layers gives.
pub struct Copied {
    /// The bare `fig-kiwi` document.
    pub document: Vec<u8>,
    /// The images the layers show: a ZIP of `images/<sha1>` entries, empty
    /// when there are none.
    pub images: Vec<u8>,
}

/// Field names holding blob indices.
const BLOB_FIELDS: [&str; 3] = ["commandsBlob", "vectorNetworkBlob", "dataBlob"];

/// Renumbers the blob references in `v` (a decoded record or part of one).
pub(crate) fn remap_blobs(schema: &Schema, v: &mut Value, map: &mut dyn FnMut(u32) -> u32) {
    match v {
        Value::Msg(m) => {
            let def = m.def;
            for (index, field) in m.fields.iter_mut() {
                let name = schema.def(def).fields[*index as usize].name.as_str();
                match field {
                    Value::Uint(b) if BLOB_FIELDS.contains(&name) => *b = map(*b),
                    other => remap_blobs(schema, other, map),
                }
            }
        }
        Value::List(items) => {
            for item in items {
                remap_blobs(schema, item, map);
            }
        }
        _ => {}
    }
}

/// The image hashes (hex) a record's paints use.
fn image_hashes(schema: &Schema, v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Msg(m) => {
            if schema.def(m.def).name == "Image"
                && let Some(Value::Bytes(h)) = m.get(schema, "hash")
                && !h.is_empty()
            {
                let hex: String = h.iter().map(|b| format!("{b:02x}")).collect();
                if !out.contains(&hex) {
                    out.push(hex);
                }
            }
            for (_, field) in &m.fields {
                image_hashes(schema, field, out);
            }
        }
        Value::List(items) => {
            for item in items {
                image_hashes(schema, item, out);
            }
        }
        _ => {}
    }
}

/// A node's place in the document (child indices from the root), to keep
/// copied layers in stacking order.
fn rank(doc: &Document, mut i: NodeIdx) -> Vec<usize> {
    let mut key = Vec::new();
    while let Some(p) = doc.node(i).parent {
        key.push(
            doc.node(p)
                .children
                .iter()
                .position(|&c| c == i)
                .unwrap_or(0),
        );
        i = p;
    }
    key.reverse();
    key
}

/// `i` and its live descendants, parents first.
fn subtree(doc: &Document, i: NodeIdx, out: &mut Vec<NodeIdx>) {
    out.push(i);
    for &c in &doc.node(i).children {
        if !doc.node(c).removed {
            subtree(doc, c, out);
        }
    }
}

/// Components the layers' instances (and instance swaps) show, and the
/// shared styles they use.
fn shown_components(doc: &Document, nodes: &[NodeIdx]) -> Vec<Guid> {
    let mut out = Vec::new();
    for &n in nodes {
        let p = doc.props(n);
        let mut add = |g: Option<Guid>| {
            if let Some(g) = g
                && !out.contains(&g)
            {
                out.push(g);
            }
        };
        add(p.symbol.as_ref().and_then(|s| s.symbol_id));
        add(p.swapped_symbol);
        // Shared styles, which overrides may name instead of paints.
        add(p.fill_style);
        add(p.stroke_style);
        add(p.effect_style);
        if let Some(s) = &p.symbol {
            for o in s.overrides.iter() {
                add(o.swapped_symbol);
                add(o.fill_style);
                add(o.stroke_style);
                add(o.effect_style);
            }
        }
        for a in p.prop_assignments.iter().flat_map(|a| a.iter()) {
            if let PropValue::Symbol(g) = a.value {
                add(Some(g));
            }
        }
    }
    out
}

/// Copies the layers `ids` (with what they hold) out of `doc`, opened from
/// `original`.
pub fn copy(doc: &Document, original: &[u8], ids: &[NodeIdx]) -> Result<Copied> {
    let chosen: HashSet<NodeIdx> = ids.iter().copied().collect();
    let mut roots: Vec<NodeIdx> = ids
        .iter()
        .copied()
        .filter(|&i| {
            let node = doc.node(i);
            !node.removed
                && node.parent.is_some()
                && !matches!(
                    node.props.node_type(),
                    NodeType::Canvas | NodeType::Document
                )
        })
        .filter(|&i| {
            // Not inside another copied layer.
            let mut at = doc.node(i).parent;
            while let Some(p) = at {
                if chosen.contains(&p) {
                    return false;
                }
                at = doc.node(p).parent;
            }
            true
        })
        .collect();
    roots.sort_by_key(|&i| rank(doc, i));
    roots.dedup();
    if roots.is_empty() {
        return Err(crate::FigError::Unsupported("nothing to copy".into()));
    }
    let mut layers = Vec::new();
    for &r in &roots {
        subtree(doc, r, &mut layers);
    }
    // Components shown by instances, and by instances inside those.
    let mut in_copy: HashSet<NodeIdx> = layers.iter().copied().collect();
    let mut components: Vec<NodeIdx> = Vec::new();
    let mut component_nodes: Vec<NodeIdx> = Vec::new();
    let mut scan = layers.clone();
    while !scan.is_empty() {
        let mut next = Vec::new();
        for g in shown_components(doc, &scan) {
            let Some(c) = doc.find(g) else { continue };
            if doc.node(c).removed
                || matches!(
                    doc.props(c).node_type(),
                    NodeType::Canvas | NodeType::Document
                )
                || in_copy.contains(&c)
            {
                continue;
            }
            let mut nodes = Vec::new();
            subtree(doc, c, &mut nodes);
            in_copy.extend(nodes.iter().copied());
            components.push(c);
            component_nodes.extend(nodes.iter().copied());
            next.extend(nodes);
        }
        scan = next;
    }

    let mut container = Container::open_without_images(original)?;
    let all: Vec<NodeIdx> = layers.iter().chain(&component_nodes).copied().collect();
    if all
        .iter()
        .any(|&n| doc.node(n).edits & (flags::BOOLEAN | flags::VECTOR) != 0)
        && let Some(extended) = with_shape_fields(&container.schema)?
    {
        container.schema = extended;
    }
    let schema = Schema::decode(&container.schema)?;
    let b = Build { schema: &schema };
    let message_def = b
        .def("Message")
        .ok_or_else(|| corrupt("the schema has no Message type"))?;
    let node_def = b
        .sub(message_def, "nodeChanges")
        .ok_or_else(|| corrupt("the schema has no node changes"))?;
    let blob_def = b.sub(message_def, "blobs");
    let decoder = Decoder::new(&schema);

    // The file's records of the nodes (and of created nodes' sources).
    let mut wanted: HashSet<Guid> = HashSet::new();
    for &n in &all {
        let node = doc.node(n);
        if node.edits & flags::CREATED == 0 {
            wanted.extend(node.props.guid);
        } else {
            wanted.extend(node.source);
        }
    }
    let mut records: HashMap<Guid, Msg> = HashMap::new();
    {
        let data = container.message.as_slice();
        let mut r = Reader::new(data);
        let def = schema.def(message_def);
        loop {
            let id = r.var_uint()?;
            if id == 0 {
                break;
            }
            let field = def
                .field_by_id(id)
                .ok_or_else(|| corrupt(format!("kiwi: Message has no field {id}")))?;
            if field.array && field.name == "nodeChanges" {
                let count = r.var_uint()? as usize;
                for _ in 0..count {
                    let start = r.at;
                    let guid = scan_guid(&decoder, &schema, &mut r, node_def)?;
                    let Some(g) = guid.filter(|g| wanted.contains(g)) else {
                        continue;
                    };
                    let m = decoder.decode(&mut Reader::new(&data[start..r.at]), node_def)?;
                    match records.get_mut(&g) {
                        // A later record for the same node updates it.
                        Some(base) => {
                            for (i, v) in m.fields {
                                let name = schema.def(node_def).fields[i as usize].name.clone();
                                base.set(&schema, &name, v);
                            }
                        }
                        None => {
                            records.insert(g, m);
                        }
                    }
                }
            } else {
                decoder.skip_field(&mut r, field, 0)?;
            }
        }
    }

    let doc_guid = Guid {
        session: 0,
        local: 0,
    };
    let page_guid = Guid {
        session: 0,
        local: 1,
    };
    let internal_guid = Guid {
        session: 0,
        local: 2,
    };
    let container_node = |guid: Guid, parent: Option<Guid>, t: &str, name: &str, position: &str| {
        let mut m = Msg::new(node_def);
        b.guid_field(&mut m, "guid", guid);
        b.set_enum(&mut m, "phase", "CREATED");
        if b.enum_of(node_def, "type", t).is_some() {
            b.set_enum(&mut m, "type", t);
        } else {
            // Schemas that spell node types as strings.
            m.set(&schema, "type", Value::Str(t.into()));
        }
        m.set(&schema, "name", Value::Str(name.into()));
        m.set(&schema, "visible", Value::Bool(true));
        m.set(&schema, "opacity", Value::Float(1.0));
        if let Some(p) = parent {
            set_parent(&b, &mut m, p, position);
        }
        m
    };
    let mut out = vec![
        container_node(doc_guid, None, "DOCUMENT", "Document", ""),
        container_node(page_guid, Some(doc_guid), "CANVAS", "Page 1", "!"),
    ];
    if !components.is_empty() {
        let mut internal = container_node(
            internal_guid,
            Some(doc_guid),
            "CANVAS",
            "Internal Only Canvas",
            "\"",
        );
        internal.set(&schema, "internalOnly", Value::Bool(true));
        out.push(internal);
    }
    let mut blobs: Vec<u32> = Vec::new();
    let mut blob_index: HashMap<u32, u32> = HashMap::new();
    let mut hashes = Vec::new();
    let mut position = String::new();
    let mut emit = |n: NodeIdx, root_of: Option<Guid>, out: &mut Vec<Msg>| -> Result<()> {
        let node = doc.node(n);
        let Some(guid) = node.props.guid else {
            return Ok(());
        };
        let mut m = if node.edits & flags::CREATED == 0 {
            match records.get(&guid) {
                Some(m) => {
                    let mut m = m.clone();
                    if node.edits != 0 {
                        b.patch(&mut m, node, doc, node.edits);
                    }
                    m
                }
                None => b.create(node_def, node, doc),
            }
        } else {
            let source = node.source.and_then(|s| records.get(&s).cloned());
            created_record(&b, &decoder, node_def, node, doc, source)
        };
        if let Some(page) = root_of {
            // Roots sit on the copy's page at their page position.
            position =
                crate::edit::between(&position, None).unwrap_or_else(|| format!("{position}O"));
            set_parent(&b, &mut m, page, &position);
            b.matrix(&mut m, "transform", &doc.world(n));
        }
        m.remove(&schema, "phase");
        b.set_enum(&mut m, "phase", "CREATED");
        let mut v = Value::Msg(Box::new(m));
        remap_blobs(&schema, &mut v, &mut |old| {
            *blob_index.entry(old).or_insert_with(|| {
                blobs.push(old);
                (blobs.len() - 1) as u32
            })
        });
        image_hashes(&schema, &v, &mut hashes);
        if let Value::Msg(m) = v {
            out.push(*m);
        }
        Ok(())
    };
    let root_set: HashSet<NodeIdx> = roots.iter().copied().collect();
    for &n in &layers {
        emit(n, root_set.contains(&n).then_some(page_guid), &mut out)?;
    }
    let component_set: HashSet<NodeIdx> = components.iter().copied().collect();
    for &n in &component_nodes {
        emit(
            n,
            component_set.contains(&n).then_some(internal_guid),
            &mut out,
        )?;
    }

    let mut message = Msg::new(message_def);
    b.set_enum(&mut message, "type", "NODE_CHANGES");
    message.set(
        &schema,
        "nodeChanges",
        Value::List(out.into_iter().map(|m| Value::Msg(Box::new(m))).collect()),
    );
    if let Some(blob_def) = blob_def {
        let list = blobs
            .iter()
            .map(|&k| {
                let mut m = Msg::new(blob_def);
                m.set(
                    &schema,
                    "bytes",
                    Value::Bytes(doc.blobs.bytes(k).unwrap_or_default().into()),
                );
                Value::Msg(Box::new(m))
            })
            .collect();
        message.set(&schema, "blobs", Value::List(list));
    }
    let mut w = Writer::default();
    schema.encode(&message, &mut w);
    let document = document_bytes(container.version, &container.schema, &w.bytes);

    let names: Vec<(String, &[u8])> = hashes
        .iter()
        .filter_map(|h| Some((format!("images/{h}"), &**doc.images.get(h)?)))
        .collect();
    let images = if names.is_empty() {
        Vec::new()
    } else {
        let entries: Vec<(&str, &[u8])> = names.iter().map(|(n, b)| (n.as_str(), *b)).collect();
        crate::zip::write_stored(&entries)
    };
    Ok(Copied { document, images })
}

fn set_parent(b: &Build, m: &mut Msg, parent: Guid, position: &str) {
    b.msg_field(m, "parentIndex", |b2, pm| {
        if let Some(gdef) = b2.sub(pm.def, "guid") {
            let gm = b2.guid(gdef, parent);
            pm.set(b2.schema, "guid", Value::Msg(Box::new(gm)));
        }
        pm.set(b2.schema, "position", Value::Str(position.into()));
    });
}

#[cfg(test)]
mod test;
