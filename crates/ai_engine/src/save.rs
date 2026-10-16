//! Saving: the document written as a PDF that Illustrator and every PDF
//! reader open.
//!
//! An unedited document writes back byte for byte. Otherwise the file is
//! written again: one page per artboard, each layer as an optional content
//! group (Illustrator's own layers), objects the editor did not redraw as
//! the file drew them (their operators, renamed into the page's resources,
//! with any move in front), and everything else from the model. Illustrator
//! keeps its own copy of the artwork in private data, which it would read
//! instead of the edits; the new file leaves it out, so Illustrator reads
//! the PDF.

mod emit;
mod objects;
mod paint;
mod resources;
mod text;

use crate::build::node_bounds;
use crate::edit::artboard_for;
use crate::error::Result;
use crate::file::page_to_canvas;
use crate::geom::{Affine, Rect};
use crate::model::{Artboard, Document, Node, NodeIdx, NodeKind, flags};
use crate::pdf::{Dict, Object, Stream};
use emit::{PageWriter, Shared};
use objects::Objects;
use std::collections::{HashMap, HashSet};
use text::InvisibleFont;

/// The PDF version written.
const VERSION: &str = "1.7";

/// Whether nothing changed since the file was opened.
fn unedited(doc: &Document) -> bool {
    doc.edits == 0 && doc.nodes.iter().all(|n| n.edits == 0)
}

/// Writes the document.
pub fn save(doc: &Document) -> Result<Vec<u8>> {
    if let Some(file) = &doc.file
        && unedited(doc)
    {
        return Ok(file.pdf.bytes().to_vec());
    }
    let mut objects = Objects::new();
    let catalog = objects.reserve();
    let pages_ref = objects.reserve();

    // Layers as optional content groups.
    let mut layers = HashMap::new();
    let mut order = Vec::new();
    let mut off = Vec::new();
    let mut locked = Vec::new();
    for &l in &doc.layers {
        let n = doc.node(l);
        if n.removed {
            continue;
        }
        let mut d = Dict::new();
        d.set("Type", Object::name("OCG"));
        d.set("Name", Object::String(crate::pdf::encode_text(&n.name)));
        let r = objects.add(Object::Dict(d));
        layers.insert(l, r);
        order.insert(0, Object::Ref(r));
        if n.hidden {
            off.push(Object::Ref(r));
        }
        if n.locked {
            locked.push(Object::Ref(r));
        }
    }
    let any_hidden = doc
        .paint_order()
        .iter()
        .any(|&i| !doc.node(i).is_layer() && doc.node(i).hidden);
    let hidden = any_hidden.then(|| {
        let mut d = Dict::new();
        d.set("Type", Object::name("OCG"));
        d.set("Name", Object::String(b"Hidden objects".to_vec()));
        d.set(crate::marks::HIDDEN, Object::Bool(true));
        let r = objects.add(Object::Dict(d));
        off.push(Object::Ref(r));
        r
    });

    let placement = place(doc);
    let mut invisible = InvisibleFont::new();
    let mut images = HashMap::new();
    let mut kids = Vec::new();
    {
        let mut shared = Shared {
            doc,
            objects: &mut objects,
            layers: &layers,
            hidden,
            invisible: &mut invisible,
            images: &mut images,
        };
        for a in doc.artboards.iter().filter(|a| !a.removed) {
            let (mut page, c2p) = page_frame(doc, a, shared.objects);
            let on_page = on_page(doc, &placement, a.id);
            let mut w = PageWriter::new(&mut shared, c2p, &on_page);
            w.layers();
            let (content, resources) = w.finish();
            let contents = shared
                .objects
                .add(Object::Stream(compressed(Dict::new(), &content)));
            page.set("Type", Object::name("Page"));
            page.set(
                crate::marks::ARTBOARD,
                Object::String(crate::pdf::encode_text(&a.name)),
            );
            page.set("Parent", Object::Ref(pages_ref));
            page.set("Resources", Object::Dict(resources));
            page.set("Contents", Object::Ref(contents));
            kids.push(Object::Ref(shared.objects.add(Object::Dict(page))));
        }
    }
    invisible.finish(&mut objects);

    let mut pages = Dict::new();
    pages.set("Type", Object::name("Pages"));
    pages.set("Count", kids.len() as i64);
    pages.set("Kids", Object::Array(kids));
    objects.set(pages_ref, Object::Dict(pages));

    let mut config = Dict::new();
    config.set("Name", Object::String(b"Layers".to_vec()));
    config.set("Order", Object::Array(order));
    config.set("OFF", Object::Array(off));
    config.set("Locked", Object::Array(locked));
    let mut all: Vec<Object> = layers.values().map(|&r| Object::Ref(r)).collect();
    all.sort_by_key(|o| o.as_ref().map(|r| r.num));
    if let Some(h) = hidden {
        all.push(Object::Ref(h));
    }
    let mut oc = Dict::new();
    oc.set("OCGs", Object::Array(all));
    oc.set("D", Object::Dict(config));
    let mut cat = Dict::new();
    cat.set("Type", Object::name("Catalog"));
    cat.set("Pages", Object::Ref(pages_ref));
    cat.set("OCProperties", Object::Dict(oc));
    objects.set(catalog, Object::Dict(cat));

    let mut info = Dict::new();
    info.set("Producer", Object::String(b"Macro".to_vec()));
    let creator = doc
        .file
        .as_ref()
        .and_then(|f| f.creator.clone())
        .unwrap_or_else(|| "Macro".into());
    info.set("Creator", Object::String(crate::pdf::encode_text(&creator)));
    let info = objects.add(Object::Dict(info));

    let mut trailer = Dict::new();
    trailer.set("Root", Object::Ref(catalog));
    trailer.set("Info", Object::Ref(info));
    let id = file_id(&objects);
    trailer.set(
        "ID",
        Object::Array(vec![Object::String(id.clone()), Object::String(id)]),
    );
    Ok(crate::pdf::write::file(VERSION, &objects.list, &trailer))
}

/// A stream with its data compressed.
fn compressed(mut dict: Dict, data: &[u8]) -> Stream {
    dict.set("Filter", Object::name("FlateDecode"));
    Stream::new(dict, crate::pdf::filter::deflate(data))
}

/// An identifier for the file from its content.
fn file_id(objects: &Objects) -> Vec<u8> {
    let mut a: u64 = 0xcbf2_9ce4_8422_2325;
    let mut b: u64 = 0x8422_2325_cbf2_9ce4;
    for (r, o) in &objects.list {
        let mut bytes = Vec::new();
        crate::pdf::write::object(o, &mut bytes);
        for x in r.num.to_le_bytes().iter().chain(&bytes) {
            a = (a ^ u64::from(*x)).wrapping_mul(0x0100_0000_01b3);
            b = (b ^ u64::from(*x)).wrapping_mul(0x0000_0100_0000_01b3 ^ 0x9e37);
        }
    }
    let mut out = a.to_be_bytes().to_vec();
    out.extend(b.to_be_bytes());
    out
}

/// The page dictionary's boxes for an artboard, and canvas to page space.
fn page_frame(doc: &Document, a: &Artboard, objects: &mut Objects) -> (Dict, Affine) {
    if let (Some(file), Some(p)) = (&doc.file, a.page)
        && let Some(page) = file.pages.get(p as usize)
    {
        let (w, h) = page.shown_size();
        if (a.rect.width() - w).abs() < 0.01 && (a.rect.height() - h).abs() < 0.01 {
            let p2c = page.to_canvas((a.rect.x0, a.rect.y0));
            if let Some(c2p) = p2c.invert() {
                let mut d = Dict::new();
                for key in [
                    "MediaBox", "CropBox", "TrimBox", "BleedBox", "ArtBox", "Rotate", "UserUnit",
                ] {
                    if let Some(v) = page.dict.get(key) {
                        d.set(key, file.pdf.resolve(v));
                    }
                }
                if let Some(g) = page.dict.get("Group") {
                    d.set("Group", objects.copy(&file.pdf, g));
                }
                return (d, c2p);
            }
        }
    }
    let r = Rect::new(0.0, 0.0, a.rect.width(), a.rect.height());
    let p2c = page_to_canvas(&r, 0, (a.rect.x0, a.rect.y0));
    let mut d = Dict::new();
    d.set(
        "MediaBox",
        Object::Array(vec![
            Object::number(0.0),
            Object::number(0.0),
            Object::number(r.x1),
            Object::number(r.y1),
        ]),
    );
    (d, p2c.invert().unwrap_or(Affine::IDENTITY))
}

/// The artboard each object is written on: where it was read, unless it
/// moved (then where it is now).
fn place(doc: &Document) -> HashMap<NodeIdx, u32> {
    let live: HashSet<u32> = doc
        .artboards
        .iter()
        .filter(|a| !a.removed)
        .map(|a| a.id)
        .collect();
    let mut out = HashMap::new();
    for i in doc.paint_order() {
        let n = doc.node(i);
        if n.is_container() {
            continue;
        }
        let pinned = n.edits & flags::MOVED == 0 && live.contains(&n.artboard);
        let a = if pinned {
            n.artboard
        } else {
            node_bounds(doc, i).map_or(n.artboard, |b| artboard_for(doc, b))
        };
        out.insert(i, a);
    }
    out
}

/// The nodes with content on an artboard: its objects and what holds
/// them. Layers are on every page (empty ones too, so their marks stay).
fn on_page(doc: &Document, placement: &HashMap<NodeIdx, u32>, artboard: u32) -> HashSet<NodeIdx> {
    let mut out = HashSet::new();
    for (&i, &a) in placement {
        if a != artboard {
            continue;
        }
        let mut at = Some(i);
        while let Some(j) = at {
            if !out.insert(j) {
                break;
            }
            at = doc.node(j).parent;
        }
    }
    for &l in &doc.layers {
        out.insert(l);
    }
    // Groups with nothing in them stay on their own artboard.
    for (k, n) in doc.nodes.iter().enumerate() {
        if matches!(n.kind, NodeKind::Group { .. })
            && !n.removed
            && n.artboard == artboard
            && is_empty_group(doc, n)
        {
            let mut at = Some(k as NodeIdx);
            while let Some(j) = at {
                if !out.insert(j) {
                    break;
                }
                at = doc.node(j).parent;
            }
        }
    }
    out
}

fn is_empty_group(doc: &Document, n: &Node) -> bool {
    n.children.iter().all(|&c| doc.node(c).removed)
}

/// A new document: one artboard and one layer.
pub fn blank(width: f64, height: f64) -> Document {
    let mut doc = Document::new();
    let id = doc.allocate_id();
    doc.artboards.push(Artboard {
        id,
        name: "Artboard 1".into(),
        rect: Rect::from_xywh(0.0, 0.0, width.max(1.0), height.max(1.0)),
        page: None,
        removed: false,
    });
    let mut layer = Node::new(
        doc.allocate_id(),
        NodeKind::Layer {
            color: crate::build::LAYER_COLORS[0],
            printable: true,
        },
    );
    layer.name = "Layer 1".into();
    let l = doc.push(layer);
    doc.layers.push(l);
    doc.edits = crate::model::doc_flags::LAYERS | crate::model::doc_flags::ARTBOARDS;
    doc
}

/// The bytes of a new document.
pub fn blank_file(width: f64, height: f64) -> Result<Vec<u8>> {
    save(&blank(width, height))
}

#[cfg(test)]
mod test;
