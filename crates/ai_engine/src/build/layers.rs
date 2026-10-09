//! Layers from optional content groups: Illustrator writes each top-level
//! layer as one, ordered in the optional content configuration.

use crate::marks;
use crate::model::{Document, Node, NodeIdx, NodeKind};
use crate::pdf::{ObjRef, Object, Pdf};
use std::collections::HashMap;

/// Colors Illustrator gives layers in the layers panel, in order.
pub const LAYER_COLORS: [[u8; 3]; 10] = [
    [79, 128, 255],
    [255, 79, 79],
    [79, 255, 79],
    [79, 79, 255],
    [255, 255, 79],
    [255, 79, 255],
    [79, 255, 255],
    [153, 153, 153],
    [0, 102, 0],
    [255, 153, 0],
];

/// The layers of a document being read.
pub struct LayerTable {
    /// Layers by their optional content group's object number.
    by_ocg: HashMap<u32, NodeIdx>,
    /// The layer for content outside every optional content group.
    default: Option<NodeIdx>,
}

impl LayerTable {
    /// Layers for the optional content groups the file lists, so empty
    /// layers show and the order follows the file.
    pub fn read(pdf: &Pdf, doc: &mut Document) -> LayerTable {
        let mut table = LayerTable {
            by_ocg: HashMap::new(),
            default: None,
        };
        let Some(props) = pdf
            .catalog()
            .and_then(|c| c.get("OCProperties").map(|v| pdf.resolve(v)))
            .and_then(|v| v.as_dict().cloned())
        else {
            return table;
        };
        let config = props
            .get("D")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_dict().cloned())
            .unwrap_or_default();
        let refs = |key: &str| -> Vec<u32> {
            config
                .get(key)
                .map(|v| pdf.resolve(v))
                .and_then(|v| {
                    v.as_array()
                        .map(|a| a.iter().filter_map(Object::as_ref).map(|r| r.num).collect())
                })
                .unwrap_or_default()
        };
        let off = refs("OFF");
        let locked = refs("Locked");
        // The panel order, top first; groups the order leaves out after.
        let mut order = Vec::new();
        if let Some(o) = config.get("Order").map(|v| pdf.resolve(v)) {
            flatten_order(pdf, &o, &mut order, 0);
        }
        if let Some(all) = props.get("OCGs").map(|v| pdf.resolve(v))
            && let Some(all) = all.as_array()
        {
            for r in all.iter().filter_map(Object::as_ref) {
                if !order.iter().any(|o: &ObjRef| o.num == r.num) {
                    order.push(r);
                }
            }
        }
        for &r in order.iter().rev() {
            let num = r.num;
            let Some(ocg) = pdf.get(r) else {
                continue;
            };
            let Some(d) = ocg.as_dict() else { continue };
            if marks::is_hidden_group(pdf, d) || !d.is("Type", "OCG") {
                continue;
            }
            let name = d
                .get("Name")
                .map(|v| pdf.resolve(v))
                .and_then(|v| v.as_text())
                .unwrap_or_else(|| format!("Layer {}", doc.layers.len() + 1));
            let i = new_layer(doc, name, false);
            let n = doc.node_mut(i);
            n.hidden = off.contains(&num);
            n.locked = locked.contains(&num);
            table.by_ocg.insert(num, i);
        }
        table
    }

    /// The layer content marked with an optional content group (or a
    /// membership dictionary naming one) goes in.
    pub fn layer_for(&mut self, pdf: &Pdf, doc: &mut Document, ocg: &Object) -> Option<NodeIdx> {
        let resolved = pdf.resolve(ocg);
        let d = resolved.as_dict()?;
        let (num, d) = if d.is("Type", "OCMD") {
            let first = match d.get("OCGs") {
                Some(Object::Array(a)) => a.first().cloned(),
                Some(v) => Some(v.clone()),
                None => None,
            }?;
            let num = first.as_ref().map(|r| r.num);
            (num, pdf.resolve(&first).as_dict()?.clone())
        } else {
            (ocg.as_ref().map(|r| r.num), d.clone())
        };
        if let Some(num) = num
            && let Some(&i) = self.by_ocg.get(&num)
        {
            return Some(i);
        }
        let name = d
            .get("Name")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_text())
            .unwrap_or_else(|| format!("Layer {}", doc.layers.len() + 1));
        let i = new_layer(doc, name, false);
        if let Some(num) = num {
            self.by_ocg.insert(num, i);
        }
        Some(i)
    }

    /// The layer for content outside every layer: made once, at the
    /// bottom when content comes before the page's layers, else on top.
    pub fn default_layer(&mut self, doc: &mut Document, bottom: bool) -> NodeIdx {
        if let Some(i) = self.default {
            return i;
        }
        let name = format!("Layer {}", doc.layers.len() + 1);
        let i = new_layer(doc, name, bottom);
        self.default = Some(i);
        i
    }

    /// Ensures the document has a layer.
    pub fn finish(&mut self, doc: &mut Document) {
        if doc.layers.iter().all(|&l| doc.node(l).removed) {
            self.default_layer(doc, false);
        }
    }
}

/// A new layer, on top (or at the bottom).
pub fn new_layer(doc: &mut Document, name: String, bottom: bool) -> NodeIdx {
    let color = LAYER_COLORS[doc.layers.len() % LAYER_COLORS.len()];
    let mut node = Node::new(
        doc.allocate_id(),
        NodeKind::Layer {
            color,
            printable: true,
        },
    );
    node.edits = 0;
    node.name = name;
    let i = doc.push(node);
    if bottom {
        doc.layers.insert(0, i);
    } else {
        doc.layers.push(i);
    }
    i
}

/// Object numbers of the groups an `Order` array lists, in order (nested
/// arrays are sublayers, listed after their parent).
fn flatten_order(pdf: &Pdf, o: &Object, out: &mut Vec<ObjRef>, depth: usize) {
    if depth > 8 {
        return;
    }
    match o {
        Object::Array(a) => {
            for item in a {
                match item {
                    Object::Ref(r) if !out.iter().any(|o| o.num == r.num) => {
                        // Only groups; labels are strings.
                        if pdf
                            .get(*r)
                            .and_then(|v| v.as_dict().map(|d| d.is("Type", "OCG")))
                            == Some(true)
                        {
                            out.push(*r);
                        }
                    }
                    Object::Array(_) => flatten_order(pdf, item, out, depth + 1),
                    _ => {}
                }
            }
        }
        Object::Ref(_) => flatten_order(pdf, &pdf.resolve(o), out, depth + 1),
        _ => {}
    }
}
