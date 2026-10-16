//! Collaborative editing: a document shared as CRDT maps of layer states
//! and pixel tiles.
//!
//! Every person opens the stored file, then applies the shared entries:
//!
//! | container | key | value |
//! | --- | --- | --- |
//! | `psdMeta` | `format` | entry layout version |
//! | `psdMeta` | `base`, `file:<fingerprint>`, `saved` | the stored files the entries apply to (the web app) |
//! | `psdMeta` | `layers:<fingerprint>` | each layer's anchors and generations in a stored file |
//! | `psdDoc` | `state` | canvas size, mode, resolution, guides |
//! | `psdLayers` | layer id | the layer's whole state (JSON): properties, parent and position, removed or not, anchors, generations, edit flags |
//! | `psdTiles` | `<id>:<plane>:<generation>:<x>,<y>` | one 256-pixel tile of a layer's pixels (`p`) or mask (`m`), deflated (empty: transparent) |
//!
//! A layer state is absolute, so applying it is idempotent and concurrent
//! edits to one layer resolve last-writer-wins. Order comes from fractional
//! positions, so concurrent moves and inserts merge. Pixels are shared as
//! tiles on the layer's own grid, whose origin (the anchor) is part of the
//! layer's state: moving a layer changes its anchor and no tiles, and a
//! stroke shares the tiles it touched. When pixels are replaced wholesale
//! (a transform, text laid out again), the layer gets a new generation and
//! every tile of it is shared; tiles of other generations are ignored, so
//! a stroke made on pixels someone else just replaced does not land on the
//! new ones. A stored file records each layer's anchor and generation
//! (`layers:<fingerprint>`), so someone opening it starts from the same
//! grid and applies the same entries.

pub mod tile;

pub use fig_engine::collab::position;

use crate::edit::Applied;
use crate::model::{
    BlendMode, BlendRanges, ColorMode, Document, Effects, Guide, Layer, LayerIdx, LayerKind,
    LayerMask, Locks, VectorMask, flags,
};
use crate::raster::{IRect, Raster};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

pub use fig_engine::collab::EntryChange;

/// Version of the entry layout, stored in `psdMeta.format`.
pub const FORMAT_VERSION: u32 = 1;

/// Names of the maps that hold a collaborative document.
pub mod container {
    /// Format metadata and stored files.
    pub const META: &str = "psdMeta";
    /// Document-level state.
    pub const DOC: &str = "psdDoc";
    /// Layer id → layer state.
    pub const LAYERS: &str = "psdLayers";
    /// Tile key → tile.
    pub const TILES: &str = "psdTiles";
    /// Every container.
    pub const ALL: [&str; 4] = [META, DOC, LAYERS, TILES];
}

/// Keys of the `psdMeta` map the engine reads and writes.
pub mod meta {
    /// The entry layout version.
    pub const FORMAT: &str = "format";
    /// Prefix of a stored file's layer anchors (`layers:<fingerprint>`).
    pub const LAYERS: &str = "layers:";
}

/// The key of the document state in `psdDoc`.
pub const DOC_STATE: &str = "state";

/// Pixel planes.
const PIXELS: u8 = b'p';
const MASK: u8 = b'm';

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaskState {
    rect: IRect,
    default_color: u8,
    disabled: bool,
    linked: bool,
    density: f32,
    feather: f32,
    anchor: (i32, i32),
    generation: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerState {
    id: u32,
    parent: Option<u32>,
    position: String,
    removed: bool,
    edits: u64,
    /// The id of the layer in the stored file whose record saving starts
    /// from (a copy's original).
    source: Option<u32>,
    name: String,
    kind: LayerKind,
    visible: bool,
    opacity: u8,
    fill_opacity: u8,
    blend: BlendMode,
    clipping: bool,
    locks: Locks,
    color_tag: u8,
    background: bool,
    anchor: (i32, i32),
    generation: u32,
    mask: Option<MaskState>,
    vector_mask: Option<VectorMask>,
    effects: Option<Effects>,
    blend_ranges: Option<BlendRanges>,
    knockout: u8,
    blend_clipped_as_group: bool,
    blend_interior_as_group: bool,
    transparency_shapes: bool,
    mask_hides_effects: bool,
    vector_mask_hides_effects: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocState {
    width: u32,
    height: u32,
    mode: ColorMode,
    depth: u16,
    resolution: f64,
    guides: Vec<Guide>,
    edits: u64,
}

/// A layer's grid and generations in a stored file.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerBase {
    anchor: (i32, i32),
    generation: u32,
    mask_anchor: (i32, i32),
    mask_generation: u32,
}

/// What applying other people's changes did.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    /// Layers that changed (indices).
    #[serde(skip)]
    pub touched: Vec<LayerIdx>,
    /// Canvas area whose pixels may have changed.
    pub dirty: Option<IRect>,
    /// Everything may have changed (the canvas changed size).
    pub all: bool,
    /// The layer tree changed.
    pub structure: bool,
    /// Tile key prefixes whose every entry the caller should pass back
    /// (layers that switched to a generation whose tiles arrived earlier).
    pub wants: Vec<String>,
}

fn hash(s: &str) -> u64 {
    tile::hash(s.as_bytes())
}

fn tile_key(id: u32, plane: u8, generation: u32, tx: i32, ty: i32) -> String {
    format!("{id}:{}:{generation}:{tx},{ty}", plane as char)
}

/// The tile key prefix of a layer plane's generation.
pub fn tile_prefix(id: u32, plane: u8, generation: u32) -> String {
    format!("{id}:{}:{generation}:", plane as char)
}

fn parse_tile_key(key: &str) -> Option<(u32, u8, u32, i32, i32)> {
    let mut parts = key.split(':');
    let id = parts.next()?.parse().ok()?;
    let plane = *parts.next()?.as_bytes().first()?;
    let generation = parts.next()?.parse().ok()?;
    let (x, y) = parts.next()?.split_once(',')?;
    Some((id, plane, generation, x.parse().ok()?, y.parse().ok()?))
}

/// A layer's pixels and mask as the opened file has them, each with its
/// generation: `(generation, pixels, mask)`.
type Base = (u32, Raster, Option<(u32, Raster)>);

/// One person's view of the shared maps.
pub struct Collab {
    session: u32,
    positions: HashMap<u32, String>,
    /// Each layer's pixels and mask as the opened file has them (and the
    /// generations they are), to start a plane over from.
    base: HashMap<u32, Base>,
    /// Hash of each layer state as last written or applied.
    states: HashMap<u32, u64>,
    /// Hash of each tile as last written or applied.
    tiles: HashMap<String, u64>,
    /// Layers changed here since the last [`Collab::changes`], with the
    /// canvas area whose tiles to compare.
    dirty: BTreeMap<u32, Option<IRect>>,
    /// Planes whose every tile the next changes share (new generations).
    full: BTreeSet<(u32, u8)>,
    /// The generation of each plane as last shared or applied.
    generations: HashMap<(u32, u8), u32>,
    doc_state: u64,
    /// Edit flags of every layer changed during the collaboration.
    flags: HashMap<u32, u64>,
    /// Layers whose parent has not arrived, with the parent's id.
    unlinked: HashMap<u32, u32>,
    /// Stored-file record index of each layer id.
    records: HashMap<u32, u32>,
}

impl Collab {
    /// Starts collaborating on an opened document. New layers get ids in
    /// `session` (unique per person and visit). `layers` is the
    /// `layers:<fingerprint>` entry of the opened file when the shared maps
    /// have one: layers move onto the grids it names.
    pub fn new(doc: &mut Document, session: u16, layers: Option<&str>) -> Collab {
        let session = u32::from(session.max(1));
        let first = session << 16;
        let used = doc
            .layers
            .iter()
            .map(|l| l.id)
            .filter(|&id| id >> 16 == session)
            .max();
        doc.next_id = used.map_or(first + 1, |m| m + 1);

        let bases: HashMap<u32, LayerBase> = layers
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        let mut base = HashMap::new();
        for layer in &mut doc.layers {
            if let Some(b) = bases.get(&layer.id) {
                if layer.pixels.origin() != b.anchor {
                    layer.pixels = layer.pixels.realigned(b.anchor);
                }
                layer.generation = b.generation;
                if let Some(mask) = &mut layer.mask {
                    if mask.raster.origin() != b.mask_anchor {
                        mask.raster = mask.raster.realigned(b.mask_anchor);
                    }
                    mask.generation = b.mask_generation;
                }
            }
            base.insert(
                layer.id,
                (
                    layer.generation,
                    layer.pixels.clone(),
                    layer
                        .mask
                        .as_ref()
                        .map(|m| (m.generation, m.raster.clone())),
                ),
            );
        }
        let records = doc
            .layers
            .iter()
            .filter_map(|l| Some((l.id, l.record?)))
            .collect();
        let mut collab = Collab {
            session,
            positions: HashMap::new(),
            base,
            states: HashMap::new(),
            tiles: HashMap::new(),
            dirty: BTreeMap::new(),
            full: BTreeSet::new(),
            generations: HashMap::new(),
            doc_state: 0,
            flags: HashMap::new(),
            unlinked: HashMap::new(),
            records,
        };
        for layer in &doc.layers {
            collab
                .generations
                .insert((layer.id, PIXELS), layer.generation);
            if let Some(m) = &layer.mask {
                collab.generations.insert((layer.id, MASK), m.generation);
            }
        }
        let stacks: Vec<Vec<LayerIdx>> = std::iter::once(doc.roots.clone())
            .chain(
                doc.layers
                    .iter()
                    .filter(|l| l.is_group())
                    .map(|l| l.children.clone()),
            )
            .collect();
        for stack in stacks {
            for (&i, key) in stack.iter().zip(position::spread(stack.len())) {
                collab.positions.insert(doc.layer(i).id, key);
            }
        }
        collab
    }

    /// The id session this person creates layers in.
    pub fn session(&self) -> u32 {
        self.session
    }

    /// The entries a new shared document starts with: every layer's state
    /// and the document's (no tiles: those are in the file).
    pub fn seed(&mut self, doc: &Document) -> Vec<EntryChange> {
        for layer in &doc.layers {
            if !layer.removed {
                self.dirty.entry(layer.id).or_insert(None);
            }
        }
        self.doc_state = 0;
        let mut out = vec![EntryChange {
            container: container::META.into(),
            key: meta::FORMAT.into(),
            value: Some(FORMAT_VERSION.to_string()),
        }];
        out.extend(self.changes(doc));
        out
    }

    /// The `layers:<fingerprint>` value for a file saved from the document
    /// as it is now.
    pub fn file_layers(&self, doc: &Document) -> String {
        let map: BTreeMap<u32, LayerBase> = doc
            .layers
            .iter()
            .filter(|l| !l.removed)
            .map(|l| {
                (
                    l.id,
                    LayerBase {
                        anchor: l.pixels.origin(),
                        generation: l.generation,
                        mask_anchor: l.mask.as_ref().map_or((0, 0), |m| m.raster.origin()),
                        mask_generation: l.mask.as_ref().map_or(0, |m| m.generation),
                    },
                )
            })
            .collect();
        serde_json::to_string(&map).unwrap_or_default()
    }

    /// Notes what a local step (an edit, undo, or redo) changed, so the
    /// next [`Collab::changes`] shares it.
    pub fn record(&mut self, doc: &Document, applied: &Applied) {
        let area = if applied.all { None } else { applied.dirty };
        for &i in &applied.touched {
            let layer = doc.layer(i);
            let f = self.flags.entry(layer.id).or_default();
            *f |= layer.edits & !flags::CREATED;
            let rect = match area {
                Some(r) => Some(r),
                None => layer.pixels.bounds(),
            };
            let entry = self.dirty.entry(layer.id).or_insert(None);
            *entry = match (*entry, rect) {
                (Some(a), Some(b)) => Some(a.union(&b)),
                (a, b) => a.or(b),
            };
            if self.generations.get(&(layer.id, PIXELS)) != Some(&layer.generation)
                || layer.edits & flags::CREATED != 0 && !self.states.contains_key(&layer.id)
            {
                self.full.insert((layer.id, PIXELS));
            }
            if let Some(m) = &layer.mask
                && self.generations.get(&(layer.id, MASK)) != Some(&m.generation)
            {
                self.full.insert((layer.id, MASK));
            }
        }
        if applied.structure {
            self.reposition(doc, &applied.touched);
        }
    }

    /// Gives layers whose stack order no longer matches their positions new
    /// positions between their neighbors.
    fn reposition(&mut self, doc: &Document, touched: &[LayerIdx]) {
        let mut stacks: Vec<Option<LayerIdx>> = vec![None];
        for &i in touched {
            let p = doc.layer(i).parent;
            if !stacks.contains(&p) {
                stacks.push(p);
            }
            if doc.layer(i).is_group() && !stacks.contains(&Some(i)) {
                stacks.push(Some(i));
            }
        }
        for parent in stacks {
            let stack = doc.stack(parent).to_vec();
            let ids: Vec<u32> = stack.iter().map(|&i| doc.layer(i).id).collect();
            for k in 0..ids.len() {
                let below = (k > 0)
                    .then(|| self.positions.get(&ids[k - 1]).cloned())
                    .flatten();
                let above = ids[k + 1..]
                    .iter()
                    .find_map(|id| self.positions.get(id).cloned())
                    .filter(|a| below.as_ref().is_none_or(|b| b < a));
                let current = self.positions.get(&ids[k]);
                let fits = current.is_some_and(|c| {
                    below.as_ref().is_none_or(|b| b < c) && above.as_ref().is_none_or(|a| c < a)
                });
                if !fits {
                    let key = position::between(below.as_deref(), above.as_deref());
                    self.positions.insert(ids[k], key);
                    self.dirty.entry(ids[k]).or_insert(None);
                }
            }
        }
    }

    fn state_of(&self, doc: &Document, layer: &Layer) -> LayerState {
        let source = layer.record.and_then(|r| {
            let s = doc.source.as_ref()?;
            crate::document::blocks::layer_id(s.layers.info.records.get(r as usize)?)
        });
        LayerState {
            id: layer.id,
            parent: layer.parent.map(|p| doc.layer(p).id),
            position: self.positions.get(&layer.id).cloned().unwrap_or_default(),
            removed: layer.removed,
            edits: layer.edits | self.flags.get(&layer.id).copied().unwrap_or(0),
            source,
            name: layer.name.clone(),
            kind: layer.kind.clone(),
            visible: layer.visible,
            opacity: layer.opacity,
            fill_opacity: layer.fill_opacity,
            blend: layer.blend,
            clipping: layer.clipping,
            locks: layer.locks,
            color_tag: layer.color_tag,
            background: layer.background,
            anchor: layer.pixels.origin(),
            generation: layer.generation,
            mask: layer.mask.as_ref().map(|m| MaskState {
                rect: m.rect,
                default_color: m.default_color,
                disabled: m.disabled,
                linked: m.linked,
                density: m.density,
                feather: m.feather,
                anchor: m.raster.origin(),
                generation: m.generation,
            }),
            vector_mask: layer.vector_mask.clone(),
            effects: layer.effects.clone(),
            blend_ranges: layer.blend_ranges.clone(),
            knockout: layer.knockout,
            blend_clipped_as_group: layer.blend_clipped_as_group,
            blend_interior_as_group: layer.blend_interior_as_group,
            transparency_shapes: layer.transparency_shapes,
            mask_hides_effects: layer.mask_hides_effects,
            vector_mask_hides_effects: layer.vector_mask_hides_effects,
        }
    }

    /// Tile entries of one plane: every tile (`full`) or those in `area`
    /// that differ from what was last shared (or from the file).
    #[expect(clippy::too_many_arguments, reason = "one plane of one layer")]
    fn plane_changes(
        &mut self,
        id: u32,
        plane: u8,
        raster: &Raster,
        generation: u32,
        area: Option<IRect>,
        full: bool,
        out: &mut Vec<EntryChange>,
    ) {
        let channels = raster.channels();
        let keys: Vec<(i32, i32)> = if full {
            raster.tile_keys().collect()
        } else {
            let Some(area) = area else { return };
            let (ox, oy) = raster.origin();
            area.translate(-ox, -oy).tiles().collect()
        };
        let base = self
            .base
            .get(&id)
            .and_then(|(g, pixels, mask)| match plane {
                PIXELS if *g == generation => Some(pixels),
                MASK => mask
                    .as_ref()
                    .filter(|(mg, _)| *mg == generation)
                    .map(|(_, r)| r),
                _ => None,
            });
        for (tx, ty) in keys {
            let key = tile_key(id, plane, generation, tx, ty);
            let data = raster.tile(tx, ty);
            let blank = data.is_none_or(|d| tile::is_blank(d, channels));
            let h = if blank {
                0
            } else {
                tile::hash(data.unwrap_or_default())
            };
            let last = self.tiles.get(&key).copied().or_else(|| {
                // Never shared: compare with the file's tile, if this is
                // the file's generation.
                match base {
                    Some(b) => Some(
                        b.tile(tx, ty)
                            .filter(|d| !tile::is_blank(d, channels))
                            .map_or(0, tile::hash),
                    ),
                    None => Some(0),
                }
            });
            if !full && last == Some(h) {
                continue;
            }
            if full && blank {
                continue;
            }
            self.tiles.insert(key.clone(), h);
            out.push(EntryChange {
                container: container::TILES.into(),
                key,
                value: Some(if blank {
                    String::new()
                } else {
                    tile::encode(data.unwrap_or_default(), channels)
                }),
            });
        }
    }

    /// The entry changes that bring the shared maps up to date with this
    /// person's steps since the last call.
    pub fn changes(&mut self, doc: &Document) -> Vec<EntryChange> {
        let mut out = Vec::new();
        let doc_state = DocState {
            width: doc.width,
            height: doc.height,
            mode: doc.mode,
            depth: doc.depth,
            resolution: doc.resolution,
            guides: doc.guides.clone(),
            edits: doc.edits,
        };
        if let Ok(json) = serde_json::to_string(&doc_state) {
            let h = hash(&json);
            if h != self.doc_state {
                self.doc_state = h;
                out.push(EntryChange {
                    container: container::DOC.into(),
                    key: DOC_STATE.into(),
                    value: Some(json),
                });
            }
        }
        let dirty = std::mem::take(&mut self.dirty);
        for (id, area) in dirty {
            let Some(i) = doc.find(id) else { continue };
            let layer = doc.layer(i);
            let state = self.state_of(doc, layer);
            if let Ok(json) = serde_json::to_string(&state) {
                let h = hash(&json);
                if self.states.get(&id) != Some(&h) {
                    self.states.insert(id, h);
                    out.push(EntryChange {
                        container: container::LAYERS.into(),
                        key: id.to_string(),
                        value: Some(json),
                    });
                }
            }
            if layer.removed {
                continue;
            }
            let full = self.full.remove(&(id, PIXELS));
            self.generations.insert((id, PIXELS), layer.generation);
            self.plane_changes(
                id,
                PIXELS,
                &layer.pixels,
                layer.generation,
                area,
                full,
                &mut out,
            );
            if let Some(m) = &layer.mask {
                let full = self.full.remove(&(id, MASK));
                self.generations.insert((id, MASK), m.generation);
                let mask_area = area.map(|a| a.intersect(&m.rect.union(&a)));
                self.plane_changes(id, MASK, &m.raster, m.generation, mask_area, full, &mut out);
            }
        }
        // Tiles go before the states that need them.
        out.sort_by_key(|c| c.container != container::TILES);
        out
    }

    /// Applies entry changes made by other people. Tiles are applied to
    /// the generation their layer is at; layers that switched generation
    /// ask for their tiles in [`Remote::wants`].
    pub fn apply(&mut self, doc: &mut Document, changes: &[EntryChange]) -> Remote {
        let mut remote = Remote::default();
        let mut dirty: Option<IRect> = None;
        let grow = |r: Option<IRect>, d: &mut Option<IRect>| {
            if let Some(r) = r.filter(|r| !r.is_empty()) {
                *d = Some(d.map_or(r, |x| x.union(&r)));
            }
        };

        // The document state first: it can change the canvas.
        for c in changes.iter().filter(|c| c.container == container::DOC) {
            let Some(value) = &c.value else { continue };
            let h = hash(value);
            if h == self.doc_state {
                continue;
            }
            let Ok(state) = serde_json::from_str::<DocState>(value) else {
                continue;
            };
            self.doc_state = h;
            if state.width != doc.width || state.height != doc.height {
                // The stored composite no longer matches the canvas.
                doc.composite = None;
                remote.all = true;
            }
            doc.width = state.width;
            doc.height = state.height;
            doc.mode = state.mode;
            doc.depth = state.depth;
            doc.resolution = state.resolution;
            doc.guides = state.guides;
            doc.edits |= state.edits;
        }

        // Layer states, the newest per layer.
        let mut states: BTreeMap<u32, LayerState> = BTreeMap::new();
        for c in changes.iter().filter(|c| c.container == container::LAYERS) {
            let (Ok(id), Some(value)) = (c.key.parse::<u32>(), &c.value) else {
                continue;
            };
            let h = hash(value);
            if self.states.get(&id) == Some(&h) {
                continue;
            }
            if let Ok(state) = serde_json::from_str::<LayerState>(value) {
                self.states.insert(id, h);
                states.insert(id, state);
            }
        }
        let mut parents: BTreeSet<Option<LayerIdx>> = BTreeSet::new();
        for (id, state) in states {
            let existing = doc.find(id);
            let i = match existing {
                Some(i) => i,
                None => {
                    let mut layer = Layer::new(id, state.name.clone());
                    layer.removed = true;
                    layer.record = state.source.and_then(|s| self.records.get(&s).copied());
                    doc.push_layer(layer)
                }
            };
            grow(crate::render::visual_bounds(doc, i), &mut dirty);
            let old_parent = doc.layer(i).parent;
            let was_listed = !doc.layer(i).removed;
            let f = self.flags.entry(id).or_default();
            *f |= state.edits & !flags::CREATED;
            let accumulated = *f;
            let new_parent = state.parent.and_then(|p| doc.find(p));
            match state.parent {
                Some(p) if new_parent.is_none() => {
                    self.unlinked.insert(id, p);
                }
                _ => {
                    self.unlinked.remove(&id);
                }
            }
            self.positions.insert(id, state.position.clone());
            let wants = self.apply_state(doc, i, &state, existing.is_none(), accumulated);
            remote.wants.extend(wants);
            let layer = doc.layer_mut(i);
            layer.parent = new_parent;
            let moved =
                old_parent != new_parent || was_listed == state.removed || existing.is_none();
            if moved {
                parents.insert(old_parent);
                parents.insert(new_parent);
                remote.structure = true;
            }
            grow(crate::render::visual_bounds(doc, i), &mut dirty);
            remote.touched.push(i);
        }
        // Layers whose parent may have arrived now.
        for (id, parent_id) in self.unlinked.clone() {
            let (Some(i), Some(p)) = (doc.find(id), doc.find(parent_id)) else {
                continue;
            };
            doc.layer_mut(i).parent = Some(p);
            parents.insert(Some(p));
            self.unlinked.remove(&id);
            remote.structure = true;
        }
        if !parents.is_empty() {
            self.relink(doc, &parents);
            doc.edits |= flags::DOC_LAYERS;
        }

        // Tiles of the generations their layers are at.
        for c in changes.iter().filter(|c| c.container == container::TILES) {
            let Some((id, plane, generation, tx, ty)) = parse_tile_key(&c.key) else {
                continue;
            };
            let Some(value) = &c.value else { continue };
            let Some(i) = doc.find(id) else { continue };
            let key = c.key.clone();
            let layer = doc.layer_mut(i);
            let raster = match plane {
                PIXELS if layer.generation == generation => &mut layer.pixels,
                MASK => match &mut layer.mask {
                    Some(m) if m.generation == generation => &mut m.raster,
                    _ => continue,
                },
                _ => continue,
            };
            let channels = raster.channels();
            let rect = raster.tile_rect(tx, ty);
            if value.is_empty() {
                raster.set_tile(tx, ty, None);
            } else if let Some(data) = tile::decode(value, channels) {
                raster.set_tile(tx, ty, Some(data.into()));
            } else {
                continue;
            }
            layer.edits |= if plane == PIXELS {
                flags::PIXELS
            } else {
                flags::MASK
            };
            // Recorded as a local comparison computes it: the content's hash.
            let content = raster.tile(tx, ty).map_or(0, tile::hash);
            self.tiles.insert(key, content);
            grow(Some(rect), &mut dirty);
            if !remote.touched.contains(&i) {
                remote.touched.push(i);
            }
        }
        if let (Some(c), Some(d)) = (&mut doc.composite, dirty) {
            c.invalidate(d);
        }
        remote.dirty = dirty;
        remote.wants.sort();
        remote.wants.dedup();
        remote
    }

    /// Applies a layer state; returns tile prefixes to ask for.
    fn apply_state(
        &mut self,
        doc: &mut Document,
        i: LayerIdx,
        s: &LayerState,
        created: bool,
        accumulated: u64,
    ) -> Vec<String> {
        let mut wants = Vec::new();
        let base = self.base.get(&s.id).cloned();
        let layer = doc.layer_mut(i);
        let was_created = layer.edits & flags::CREATED != 0;
        layer.name = s.name.clone();
        layer.kind = s.kind.clone();
        layer.visible = s.visible;
        layer.opacity = s.opacity;
        layer.fill_opacity = s.fill_opacity;
        layer.blend = s.blend;
        layer.clipping = s.clipping;
        layer.locks = s.locks;
        layer.color_tag = s.color_tag;
        layer.background = s.background;
        layer.vector_mask = s.vector_mask.clone();
        layer.effects = s.effects.clone();
        layer.blend_ranges = s.blend_ranges.clone();
        layer.knockout = s.knockout;
        layer.blend_clipped_as_group = s.blend_clipped_as_group;
        layer.blend_interior_as_group = s.blend_interior_as_group;
        layer.transparency_shapes = s.transparency_shapes;
        layer.mask_hides_effects = s.mask_hides_effects;
        layer.vector_mask_hides_effects = s.vector_mask_hides_effects;
        layer.removed = s.removed;
        // Whether the layer is new to this person's file decides how saving
        // writes it, whichever file the sender opened.
        let new_here = created || was_created;
        layer.edits = (accumulated & !flags::CREATED) | if new_here { flags::CREATED } else { 0 };

        // Pixels: a new generation starts over; a new anchor moves them.
        if layer.generation != s.generation || created {
            layer.pixels = match &base {
                Some((g, pixels, _)) if *g == s.generation => pixels.realigned(s.anchor),
                _ => {
                    let mut r = Raster::rgba();
                    r.set_origin(s.anchor);
                    r
                }
            };
            layer.generation = s.generation;
            wants.push(tile_prefix(s.id, PIXELS, s.generation));
        } else if layer.pixels.origin() != s.anchor {
            let (ox, oy) = layer.pixels.origin();
            layer.pixels.translate(s.anchor.0 - ox, s.anchor.1 - oy);
        }
        self.generations.insert((s.id, PIXELS), s.generation);

        match &s.mask {
            None => layer.mask = None,
            Some(m) => {
                let restart = layer
                    .mask
                    .as_ref()
                    .is_none_or(|cur| cur.generation != m.generation);
                let raster = if restart {
                    wants.push(tile_prefix(s.id, MASK, m.generation));
                    match &base {
                        Some((_, _, Some((g, r)))) if *g == m.generation => r.realigned(m.anchor),
                        _ => {
                            let mut r = Raster::gray();
                            r.set_origin(m.anchor);
                            r
                        }
                    }
                } else {
                    let mut r = layer
                        .mask
                        .as_ref()
                        .map(|c| c.raster.clone())
                        .unwrap_or_else(Raster::gray);
                    let (ox, oy) = r.origin();
                    r.translate(m.anchor.0 - ox, m.anchor.1 - oy);
                    r
                };
                layer.mask = Some(LayerMask {
                    raster,
                    rect: m.rect,
                    default_color: m.default_color,
                    disabled: m.disabled,
                    linked: m.linked,
                    density: m.density,
                    feather: m.feather,
                    generation: m.generation,
                });
                self.generations.insert((s.id, MASK), m.generation);
            }
        }
        wants
    }

    /// Derives the stacks of `parents` from the layers' parent links and
    /// positions.
    fn relink(&self, doc: &mut Document, parents: &BTreeSet<Option<LayerIdx>>) {
        for &parent in parents {
            let mut members: Vec<LayerIdx> = (0..doc.layers.len() as LayerIdx)
                .filter(|&i| {
                    let l = doc.layer(i);
                    !l.removed && l.parent == parent && parent != Some(i)
                })
                .collect();
            members.sort_by(|&a, &b| {
                let (la, lb) = (doc.layer(a), doc.layer(b));
                let pa = self.positions.get(&la.id).map_or("", String::as_str);
                let pb = self.positions.get(&lb.id).map_or("", String::as_str);
                pa.cmp(pb).then(la.id.cmp(&lb.id))
            });
            *doc.stack_mut(parent) = members;
        }
    }
}

#[cfg(test)]
mod test;
