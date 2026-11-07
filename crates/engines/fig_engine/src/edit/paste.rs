//! Pasting layers copied from another file (or tab), as
//! [`crate::save::copy`] writes them, or as Figma's clipboard holds them.
//!
//! The copied layers get new ids. Their records are carried over into this
//! file's schema (fields by name; fields this file lacks are dropped), so
//! saving writes them with everything the engine does not model. Instances
//! whose component this file does not have are detached first, in the
//! copy, so they keep their look. Placement follows Figma: pasted into a
//! frame, layers keep their page position if it lies inside the frame, or
//! are centered in it; elsewhere they keep their position if it is in view,
//! or are centered in the view.

use super::{Applied, History, Op, Txn, flags};
use crate::container::{Container, Encoded};
use crate::document::{Document, NodeIdx};
use crate::error::{Result, corrupt};
use crate::kiwi::{Decoder, Msg, Reader, Schema, Ty, Value, Writer};
use crate::model::{Affine, Guid, NodeType, PathRef, Props, Rect, Vec2};
use crate::save::remap_blobs;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

/// Where pasted layers go.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteSpec {
    /// The page or layer they go into.
    pub parent: String,
    /// Their place among its children (bottom is 0); on top when absent.
    pub index: Option<usize>,
    /// The page area in view, for placing them when their position is not.
    pub view: Option<View>,
    /// Figma's "Paste here": the page point their top left goes to.
    #[serde(default)]
    pub at: Option<At>,
    /// Figma's "Paste to replace": layers removed in the same step; the
    /// pasted ones take the first one's parent and place, centered on
    /// where the replaced layers were.
    #[serde(default)]
    pub replace: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct At {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct View {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// A copy, ready to paste.
struct Clip {
    doc: Document,
    schema: Schema,
    /// Records by id, decoded with the copy's schema.
    records: HashMap<Guid, Msg>,
    roots: Vec<NodeIdx>,
}

/// Whether `target` has the component `g` an instance in the copy shows
/// (the same id, a component, and the same name).
fn has_component(target: &Document, clip: &Document, g: Guid) -> bool {
    let Some(t) = target.find(g) else {
        return false;
    };
    let tp = target.props(t);
    !target.node(t).removed
        && tp.node_type() == NodeType::Symbol
        && clip
            .find(g)
            .is_none_or(|c| clip.props(c).name() == tp.name())
}

fn roots_of(doc: &Document) -> Vec<NodeIdx> {
    let Some(&page) = doc.pages.first() else {
        return Vec::new();
    };
    doc.node(page)
        .children
        .iter()
        .copied()
        .filter(|&c| !doc.node(c).removed)
        .collect()
}

impl Clip {
    /// Opens a copy, detaching the instances whose components `target`
    /// lacks.
    fn prepare(target: &Document, bytes: &[u8]) -> Result<Clip> {
        let mut doc = Document::open(bytes)?;
        let roots = roots_of(&doc);
        // Detaching turns nested instances into layers too.
        let mut stack = roots.clone();
        let mut foreign = Vec::new();
        while let Some(n) = stack.pop() {
            let p = doc.props(n);
            if p.node_type() == NodeType::Instance {
                let shown = p.symbol.as_ref().and_then(|s| s.symbol_id);
                if shown.is_none_or(|g| !has_component(target, &doc, g)) {
                    foreign.extend(p.guid.map(|g| g.to_string()));
                    continue;
                }
            }
            stack.extend(doc.node(n).children.iter().copied());
        }
        if !foreign.is_empty() {
            History::default().apply(&mut doc, &[Op::Detach { ids: foreign }], None)?;
        }
        let container = Container::open_without_images(bytes)?;
        let schema = Schema::decode(&container.schema)?;
        // (A detached instance keeps its record: pasting writes its type
        // again, which drops what made it an instance.)
        let records = decode_records(&schema, &container.message)?;
        Ok(Clip {
            doc,
            schema,
            records,
            roots,
        })
    }
}

/// Every node change in a message, by id.
pub(super) fn decode_records(schema: &Schema, message: &[u8]) -> Result<HashMap<Guid, Msg>> {
    let message_def = schema
        .def_index("Message")
        .ok_or_else(|| corrupt("the schema has no Message type"))?;
    let decoder = Decoder::new(schema);
    let msg = decoder.decode(&mut Reader::new(message), message_def)?;
    let mut out = HashMap::new();
    if let Some(Value::List(nodes)) = msg.get(schema, "nodeChanges") {
        for n in nodes {
            let Value::Msg(m) = n else { continue };
            let Some(Value::Msg(g)) = m.get(schema, "guid") else {
                continue;
            };
            let part = |name| match g.get(schema, name) {
                Some(Value::Uint(v)) => *v,
                _ => 0,
            };
            out.insert(
                Guid {
                    session: part("sessionID"),
                    local: part("localID"),
                },
                (**m).clone(),
            );
        }
    }
    Ok(out)
}

/// `m` (of type `src_def` in `src`) as a message of type `dst_def` in `dst`:
/// fields by name, enum values by name; what `dst` lacks is dropped.
pub(super) fn translate(src: &Schema, dst: &Schema, m: &Msg, dst_def: u32) -> Msg {
    let mut out = Msg::new(dst_def);
    for (index, value) in &m.fields {
        let field = &src.def(m.def).fields[*index as usize];
        let Some(di) = dst.def(dst_def).index_of(&field.name) else {
            legacy_style(src, dst, &mut out, &field.name, value);
            continue;
        };
        let target = &dst.def(dst_def).fields[di as usize];
        if target.array != field.array {
            continue;
        }
        if let Some(v) = translate_value(src, dst, value, field.ty, target.ty) {
            out.set(dst, &field.name, v);
        }
    }
    out
}

/// A shared style reference older files keep in a legacy field
/// (`inheritFillStyleID`…), written in the newer one (`styleIdForFill`…)
/// when the target schema only has that.
fn legacy_style(src: &Schema, dst: &Schema, out: &mut Msg, name: &str, value: &Value) {
    let newer = match name {
        "inheritFillStyleID" => "styleIdForFill",
        "inheritFillStyleIDForStroke" => "styleIdForStrokeFill",
        "inheritEffectStyleID" => "styleIdForEffect",
        "inheritTextStyleID" => "styleIdForText",
        _ => return,
    };
    let Value::Msg(guid) = value else { return };
    let part = |f| match guid.get(src, f) {
        Some(Value::Uint(v)) => *v,
        _ => 0,
    };
    let def = dst.def(out.def);
    let Some(Ty::Def(style_def)) = def.index_of(newer).map(|i| def.fields[i as usize].ty) else {
        return;
    };
    let Some(Ty::Def(guid_def)) = dst
        .def(style_def)
        .index_of("guid")
        .map(|i| dst.def(style_def).fields[i as usize].ty)
    else {
        return;
    };
    let mut g = Msg::new(guid_def);
    g.set(dst, "sessionID", Value::Uint(part("sessionID")));
    g.set(dst, "localID", Value::Uint(part("localID")));
    let mut id = Msg::new(style_def);
    id.set(dst, "guid", Value::Msg(Box::new(g)));
    out.set(dst, newer, Value::Msg(Box::new(id)));
}

fn translate_value(src: &Schema, dst: &Schema, v: &Value, from: Ty, to: Ty) -> Option<Value> {
    match (v, to) {
        (Value::List(items), _) => Some(Value::List(
            items
                .iter()
                .filter_map(|i| translate_value(src, dst, i, from, to))
                .collect(),
        )),
        (Value::Msg(m), Ty::Def(d)) => Some(Value::Msg(Box::new(translate(src, dst, m, d)))),
        (Value::Enum(sd, value), Ty::Def(d)) => {
            let name = src.enum_name(*sd, *value)?;
            let f = dst.def(d).fields.iter().find(|f| f.name == name)?;
            Some(Value::Enum(d, f.id))
        }
        (_, Ty::Def(_)) => None,
        _ if from == to => Some(v.clone()),
        _ => None,
    }
}

/// Points a node's geometry at blobs copied into `doc`.
pub(crate) fn remap_props(p: &mut Props, map: &mut dyn FnMut(u32) -> u32) {
    let paths = |refs: &Option<Arc<[PathRef]>>, map: &mut dyn FnMut(u32) -> u32| {
        refs.as_ref().map(|r| {
            r.iter()
                .map(|g| PathRef {
                    blob: map(g.blob),
                    ..*g
                })
                .collect::<Arc<[PathRef]>>()
        })
    };
    p.fill_geometry = paths(&p.fill_geometry, map);
    p.stroke_geometry = paths(&p.stroke_geometry, map);
    if let Some(layout) = &p.text_layout {
        let mut l = (**layout).clone();
        l.glyphs = l
            .glyphs
            .iter()
            .map(|g| {
                let mut g = g.clone();
                g.blob = g.blob.map(&mut *map);
                g
            })
            .collect();
        p.text_layout = Some(Arc::new(l));
    }
    if let Some(v) = &p.vector_data {
        let mut v = **v;
        v.network_blob = v.network_blob.map(&mut *map);
        p.vector_data = Some(Arc::new(v));
    }
    if let Some(generated) = &p.generated {
        let list: Vec<Props> = generated
            .iter()
            .map(|d| {
                let mut d = d.clone();
                remap_props(&mut d, map);
                d
            })
            .collect();
        p.generated = Some(list.into());
    }
    if let Some(derived) = &p.derived {
        let list: Vec<Props> = derived
            .iter()
            .map(|d| {
                let mut d = d.clone();
                remap_props(&mut d, map);
                d
            })
            .collect();
        p.derived = Some(list.into());
    }
    if let Some(symbol) = &p.symbol {
        let mut s = (**symbol).clone();
        s.overrides = s
            .overrides
            .iter()
            .map(|o| {
                let mut o = o.clone();
                remap_props(&mut o, map);
                o
            })
            .collect();
        p.symbol = Some(Arc::new(s));
    }
}

impl History {
    /// Pastes a copy (`clip`, a `.fig` document; `images`, a ZIP of the
    /// images it uses) as one undoable step. `original` is the file `doc`
    /// was opened from (its schema is what pasted records are written in).
    pub fn paste(
        &mut self,
        doc: &mut Document,
        original: &[u8],
        clip: &[u8],
        images: Option<&[u8]>,
        spec: &PasteSpec,
    ) -> Result<Applied> {
        let clip = Clip::prepare(doc, clip)?;
        let container = Container::open_without_images(original)?;
        let schema = Schema::decode(&container.schema)?;
        if let Some(zip) = images.filter(|z| !z.is_empty()) {
            let archive = crate::zip::ZipArchive::new(zip)?;
            for entry in archive.entries() {
                if let Some(hash) = entry.name.strip_prefix("images/")
                    && !doc.images.contains_key(hash)
                {
                    let bytes = archive.read(entry)?;
                    doc.images
                        .insert(hash.to_ascii_lowercase(), Encoded::Owned(bytes));
                }
            }
        }
        for (hash, bytes) in &clip.doc.images {
            doc.images
                .entry(hash.clone())
                .or_insert_with(|| bytes.clone());
        }
        self.run(doc, None, |txn| txn.paste(&clip, &schema, spec))
    }
}

impl Txn<'_> {
    fn paste(&mut self, clip: &Clip, schema: &Schema, spec: &PasteSpec) -> Result<()> {
        let mut parent = self.resolve(&spec.parent)?;
        if clip.roots.is_empty() {
            return Ok(());
        }
        // The copied layers' page area, and where it goes.
        let bounds = clip.roots.iter().fold(Rect::EMPTY, |acc, &r| {
            let s = clip.doc.props(r).size();
            acc.union(&clip.doc.world(r).map_rect(&Rect::new(0.0, 0.0, s.x, s.y)))
        });
        let replaced: Vec<NodeIdx> = self
            .resolve_all(&spec.replace)?
            .into_iter()
            .filter(|&i| {
                !self.doc.node(i).removed
                    && !matches!(
                        self.doc.props(i).node_type(),
                        NodeType::Canvas | NodeType::Document
                    )
            })
            .collect();
        let mut index = spec.index;
        let offset = if let Some(&first) = replaced.first()
            && let Some(p) = self.doc.node(first).parent
        {
            parent = p;
            index = self.doc.node(p).children.iter().position(|&c| c == first);
            let was = replaced
                .iter()
                .fold(Rect::EMPTY, |acc, &i| acc.union(&self.frame_bounds(i)));
            Vec2::new(
                (was.x + (was.w - bounds.w) / 2.0 - bounds.x).round(),
                (was.y + (was.h - bounds.h) / 2.0 - bounds.y).round(),
            )
        } else if let Some(to) = spec.at {
            Vec2::new((to.x - bounds.x).round(), (to.y - bounds.y).round())
        } else {
            self.placement(parent, &bounds, spec.view)
        };
        let node_def = schema.def_index("NodeChange");
        let mut blob_map: HashMap<u32, u32> = HashMap::new();
        let mut at = index
            .unwrap_or(self.doc.node(parent).children.len())
            .min(self.doc.node(parent).children.len());
        let parent_world = self.doc.world(parent);
        let in_set = self.doc.props(parent).is_state_group == Some(true);
        for &root in &clip.roots {
            let world = Affine::translate(offset.x, offset.y).mul(&clip.doc.world(root));
            let local = parent_world.invert().unwrap_or_default().mul(&world);
            // A main component pasted into the file that has it places an
            // instance, as duplicating does (a variant pasted into its set
            // stays a variant).
            let main = clip
                .doc
                .props(root)
                .guid
                .filter(|&g| {
                    !in_set
                        && clip.doc.props(root).node_type() == NodeType::Symbol
                        && has_component(self.doc, &clip.doc, g)
                })
                .and_then(|g| self.doc.find(g));
            let i = match main {
                Some(m) => self.instantiate(m, parent, at, local)?,
                None => self.paste_tree(clip, schema, node_def, root, parent, at, &mut blob_map)?,
            };
            self.edit(i, flags::TRANSFORM).transform = Some(local);
            let guid = self.doc.props(i).guid.unwrap_or_default();
            self.created.push(guid.to_string());
            at += 1;
        }
        for i in replaced {
            self.remove_tree(i);
        }
        Ok(())
    }

    /// The offset that places `bounds` (page area) by Figma's rules.
    fn placement(&self, parent: NodeIdx, bounds: &Rect, view: Option<View>) -> Vec2 {
        let center_in = |area: &Rect| {
            Vec2::new(
                (area.x + area.w / 2.0 - (bounds.x + bounds.w / 2.0)).round(),
                (area.y + area.h / 2.0 - (bounds.y + bounds.h / 2.0)).round(),
            )
        };
        let inside = |area: &Rect| {
            bounds.x >= area.x - 1e-6
                && bounds.y >= area.y - 1e-6
                && bounds.right() <= area.right() + 1e-6
                && bounds.bottom() <= area.bottom() + 1e-6
        };
        if self.doc.props(parent).node_type() != NodeType::Canvas {
            let s = self.doc.props(parent).size();
            let frame = self
                .doc
                .world(parent)
                .map_rect(&Rect::new(0.0, 0.0, s.x, s.y));
            return if inside(&frame) {
                Vec2::default()
            } else {
                center_in(&frame)
            };
        }
        match view {
            Some(v) => {
                let area = Rect::new(v.x, v.y, v.w, v.h);
                if bounds.intersects(&area) {
                    Vec2::default()
                } else {
                    center_in(&area)
                }
            }
            None => Vec2::default(),
        }
    }

    /// Recreates the copy's node `n` (and what it holds) in `parent` at
    /// `index`, with new ids.
    #[allow(clippy::too_many_arguments)]
    fn paste_tree(
        &mut self,
        clip: &Clip,
        schema: &Schema,
        node_def: Option<u32>,
        n: NodeIdx,
        parent: NodeIdx,
        index: usize,
        blob_map: &mut HashMap<u32, u32>,
    ) -> Result<NodeIdx> {
        let mut props = clip.doc.props(n).clone();
        let old = props.guid.unwrap_or_default();
        let guid = self.doc.new_guid();
        let doc = &mut *self.doc;
        let mut map = |b: u32| -> u32 {
            *blob_map.entry(b).or_insert_with(|| {
                let bytes = clip.doc.blobs.bytes(b).unwrap_or_default().to_vec();
                doc.blobs.push(&bytes)
            })
        };
        remap_props(&mut props, &mut map);
        props.guid = Some(guid);
        props.override_key = None;
        // The record it was copied with, in this file's schema.
        let record = clip.records.get(&old).zip(node_def).map(|(m, def)| {
            let mut m = translate(&clip.schema, schema, m, def);
            m.remove(schema, "overrideKey");
            let mut v = Value::Msg(Box::new(m));
            remap_blobs(schema, &mut v, &mut map);
            let mut w = Writer::default();
            if let Value::Msg(m) = &v {
                schema.encode(m, &mut w);
            }
            w.bytes
        });
        // Shared styles this file lacks: the paints stand on their own.
        for style in [
            &mut props.fill_style,
            &mut props.stroke_style,
            &mut props.effect_style,
        ] {
            if style.is_some_and(|g| self.doc.find(g).is_none()) {
                *style = None;
            }
        }
        let i = self.new_node(props);
        if let Some(bytes) = record {
            self.doc.foreign.insert(guid, bytes.into());
            // What the engine reads is written again in this file's terms
            // (older files keep some of it under other names); the record
            // keeps the rest, an instance's overrides included.
            self.touch(i).edits =
                !(flags::INSTANCE_OF | flags::OVERRIDES | flags::DERIVED | flags::PROP_ASSIGNMENTS);
        }
        self.attach(i, parent, index, false);
        let children: Vec<NodeIdx> = clip
            .doc
            .node(n)
            .children
            .iter()
            .copied()
            .filter(|&c| !clip.doc.node(c).removed)
            .collect();
        for (k, c) in children.into_iter().enumerate() {
            self.paste_tree(clip, schema, node_def, c, i, k, blob_map)?;
        }
        Ok(i)
    }
}

#[cfg(test)]
mod test;
