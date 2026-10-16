//! What renders keep between calls: layers, masks, and the stored composite
//! downscaled by powers of two, rasterized paths, and layers' content
//! bounds.
//!
//! Downscaled tiles are keyed by the identity (`Arc` pointer) of the tiles
//! they were made from. Rasters are copy-on-write, so an edit gives the
//! tiles it touches new pointers and their old downscales are simply never
//! asked for again: nothing needs invalidating. Entries hold the source
//! tiles they were made from, so a pointer cannot be reused while its key
//! exists; a sweep drops entries whose sources nothing else holds anymore,
//! and the least recently used entries go when the cache outgrows its
//! budget.

use crate::model::LayerMask;
use crate::raster::{IRect, Raster, TILE};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Bytes the cache may hold before evicting.
const BUDGET: usize = 160 << 20;

/// Renders between sweeps for dead entries.
const SWEEP_EVERY: u32 = 32;

/// Side of a tile, as a `usize`.
const T: usize = TILE as usize;

/// A cache key.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Key {
    /// A tile box-filtered from the level below.
    Down {
        /// Samples per pixel.
        channels: u8,
        /// Where the sources' grid starts relative to the region (mod
        /// [`TILE`]).
        align: (i32, i32),
        /// Masks: the part of the region inside the mask's rectangle and
        /// the value outside it.
        bounds: Option<(IRect, u8)>,
        /// The source tiles' pointers (0 for a missing one).
        sources: [usize; 9],
    },
    /// A rasterized path tile.
    Coverage {
        /// The path's content hash.
        hash: u64,
        /// The level.
        level: u8,
        /// Tile position in the level's canvas grid.
        tile: (i32, i32),
    },
    /// A raster's content bounds.
    Bounds {
        /// Hash of the raster's tile pointers and origin.
        hash: u64,
    },
}

/// A cached value.
struct Entry {
    /// The tile (`None`: all zero).
    tile: Option<Arc<[u8]>>,
    /// Content bounds, for [`Key::Bounds`].
    bounds: Option<IRect>,
    /// The tiles it was made from, kept so their pointers stay unique.
    holds: Vec<Arc<[u8]>>,
    /// Clock reading at the last use.
    used: u64,
}

impl Entry {
    fn bytes(&self) -> usize {
        64 + self.tile.as_ref().map_or(0, |t| t.len())
    }
}

/// Tiles and values derived from documents, kept between renders.
pub(crate) struct Cache {
    entries: HashMap<Key, Entry>,
    bytes: usize,
    /// Bytes held before evicting.
    budget: usize,
    clock: u64,
    renders: u32,
    /// Scratch for reading 2× regions.
    scratch: Vec<u8>,
}

impl Default for Cache {
    fn default() -> Self {
        Cache {
            entries: HashMap::new(),
            bytes: 0,
            budget: BUDGET,
            clock: 0,
            renders: 0,
            scratch: Vec::new(),
        }
    }
}

/// A layer mask at some level: values inside `rect` come from `raster`
/// (0 where it has no tile), `default` outside.
pub(crate) struct LevelMask<'a> {
    /// Mask values on the level's grid.
    pub(crate) raster: Cow<'a, Raster>,
    /// Where the values come from the raster.
    pub(crate) rect: IRect,
    /// The value elsewhere.
    pub(crate) default: u8,
}

impl LevelMask<'_> {
    /// The mask value at `(x, y)`.
    #[inline]
    pub(crate) fn value(&self, x: i32, y: i32) -> u8 {
        if self.rect.contains(x, y) {
            self.raster.get(x, y)[0]
        } else {
            self.default
        }
    }
}

impl Cache {
    /// Drops everything.
    pub(crate) fn clear(&mut self) {
        self.entries.clear();
        self.bytes = 0;
    }

    /// Bookkeeping at the start of a render: occasional sweeps.
    pub(crate) fn begin_render(&mut self) {
        self.renders += 1;
        if self.renders >= SWEEP_EVERY {
            self.renders = 0;
            self.sweep();
        }
    }

    /// Bytes held (approximately).
    #[cfg(test)]
    pub(crate) fn bytes(&self) -> usize {
        self.bytes
    }

    /// A cache that evicts beyond `budget` bytes.
    #[cfg(test)]
    pub(crate) fn with_budget(budget: usize) -> Cache {
        Cache {
            budget,
            ..Cache::default()
        }
    }

    /// Entries held.
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    /// Runs the sweep for entries whose sources are gone.
    #[cfg(test)]
    pub(crate) fn sweep_now(&mut self) {
        self.sweep();
    }

    fn touch(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    fn insert(&mut self, key: Key, entry: Entry) {
        self.bytes += entry.bytes();
        if let Some(old) = self.entries.insert(key, entry) {
            self.bytes -= old.bytes();
        }
        if self.bytes > self.budget {
            self.evict();
        }
    }

    /// Drops entries whose sources are held by nothing but the cache (an
    /// edit replaced them), repeating while drops orphan more entries.
    fn sweep(&mut self) {
        loop {
            let made: HashSet<usize> = self
                .entries
                .values()
                .filter_map(|e| e.tile.as_ref().map(ptr))
                .collect();
            let mut held: HashMap<usize, usize> = HashMap::new();
            for e in self.entries.values() {
                for h in &e.holds {
                    *held.entry(ptr(h)).or_default() += 1;
                }
            }
            let dead = |h: &Arc<[u8]>| {
                let p = ptr(h);
                !made.contains(&p) && Arc::strong_count(h) <= held.get(&p).copied().unwrap_or(0)
            };
            let before = self.entries.len();
            let mut freed = 0;
            self.entries.retain(|_, e| {
                let keep = !e.holds.iter().any(dead);
                if !keep {
                    freed += e.bytes();
                }
                keep
            });
            self.bytes -= freed;
            if self.entries.len() == before {
                break;
            }
        }
    }

    /// Drops the least recently used entries down to three quarters of the
    /// budget.
    fn evict(&mut self) {
        self.sweep();
        if self.bytes <= self.budget {
            return;
        }
        let mut order: Vec<(u64, Key)> = self
            .entries
            .iter()
            .map(|(k, e)| (e.used, k.clone()))
            .collect();
        order.sort_unstable_by_key(|(u, _)| *u);
        for (_, key) in order {
            if self.bytes <= self.budget / 4 * 3 {
                break;
            }
            if let Some(e) = self.entries.remove(&key) {
                self.bytes -= e.bytes();
            }
        }
    }

    /// A rasterized path tile, made by `make` on a miss.
    pub(crate) fn coverage(
        &mut self,
        hash: u64,
        level: u8,
        tile: (i32, i32),
        make: impl FnOnce() -> Option<Arc<[u8]>>,
    ) -> Option<Arc<[u8]>> {
        let key = Key::Coverage { hash, level, tile };
        let now = self.touch();
        if let Some(e) = self.entries.get_mut(&key) {
            e.used = now;
            return e.tile.clone();
        }
        let tile = make();
        self.insert(
            key,
            Entry {
                tile: tile.clone(),
                bounds: None,
                holds: Vec::new(),
                used: now,
            },
        );
        tile
    }

    /// The tight bounds of a raster's pixels that are not transparent,
    /// remembered while its tiles are unchanged.
    pub(crate) fn content_bounds(&mut self, raster: &Raster) -> Option<IRect> {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        raster.origin().hash(&mut h);
        raster.channels().hash(&mut h);
        let mut holds = Vec::new();
        for (tx, ty) in raster.tile_keys() {
            (tx, ty).hash(&mut h);
            if let Some(t) = raster.tile_arc(tx, ty) {
                ptr(&t).hash(&mut h);
                holds.push(t);
            }
        }
        let key = Key::Bounds { hash: h.finish() };
        let now = self.touch();
        if let Some(e) = self.entries.get_mut(&key) {
            e.used = now;
            return e.bounds;
        }
        let bounds = raster.content_bounds();
        self.insert(
            key,
            Entry {
                tile: None,
                bounds,
                holds,
                used: now,
            },
        );
        bounds
    }

    /// A raster (RGBA or gray) at `level`: on that level's canvas grid
    /// (origin `(0, 0)`), holding at least the tiles that touch `region`
    /// (level pixels).
    pub(crate) fn level_raster<'a>(
        &mut self,
        raster: &'a Raster,
        level: u8,
        region: IRect,
    ) -> Cow<'a, Raster> {
        if level == 0 {
            return Cow::Borrowed(raster);
        }
        let mut out = Raster::new(raster.channels());
        let Some(bounds) = raster.bounds() else {
            return Cow::Owned(out);
        };
        let wanted = region.intersect(&bounds.at_level(level));
        for (tx, ty) in wanted.tiles() {
            if let Some(t) = self.down_tile(raster, bounds, None, level, tx, ty) {
                out.set_tile(tx, ty, Some(t));
            }
        }
        Cow::Owned(out)
    }

    /// A layer mask at `level`, holding the tiles that touch `region`.
    pub(crate) fn level_mask<'a>(
        &mut self,
        mask: &'a LayerMask,
        level: u8,
        region: IRect,
    ) -> LevelMask<'a> {
        if level == 0 {
            return LevelMask {
                raster: Cow::Borrowed(&mask.raster),
                rect: mask.rect,
                default: mask.default_color,
            };
        }
        let rect = mask.rect.at_level(level);
        let mut out = Raster::gray();
        let wanted = region.intersect(&rect);
        for (tx, ty) in wanted.tiles() {
            let source = Some((mask.rect, mask.default_color));
            if let Some(t) = self.down_tile(&mask.raster, mask.rect, source, level, tx, ty) {
                out.set_tile(tx, ty, Some(t));
            }
        }
        LevelMask {
            raster: Cow::Owned(out),
            rect,
            default: mask.default_color,
        }
    }

    /// Tile `(tx, ty)` of `src` at `level` (≥ 1) on that level's canvas
    /// grid. Only tiles touching `extent` (level 0) are made; `bounds`
    /// gives a mask's rectangle (level 0) and outside value.
    fn down_tile(
        &mut self,
        src: &Raster,
        extent: IRect,
        bounds: Option<(IRect, u8)>,
        level: u8,
        tx: i32,
        ty: i32,
    ) -> Option<Arc<[u8]>> {
        let channels = src.channels();
        // The region one level down this tile is made from.
        let region = IRect::new(tx * 2 * TILE, ty * 2 * TILE, 2 * TILE, 2 * TILE);
        let below_bounds = bounds.map(|(r, d)| (r.at_level(level - 1), d));
        let mut sources = [0usize; 9];
        let mut holds: Vec<Arc<[u8]>> = Vec::new();
        let align;
        // Tiles one level down, in row order over `region`.
        let mut below: Vec<(IRect, Option<Arc<[u8]>>)> = Vec::new();
        if level == 1 {
            let (ox, oy) = src.origin();
            align = (ox.rem_euclid(TILE), oy.rem_euclid(TILE));
            let local = region.translate(-ox, -oy);
            for (i, (sx, sy)) in local.tiles().enumerate() {
                let t = src.tile_arc(sx, sy);
                if let Some(t) = &t {
                    sources[i] = ptr(t);
                    holds.push(t.clone());
                }
                below.push((src.tile_rect(sx, sy), t));
            }
        } else {
            align = (0, 0);
            let wanted = extent.at_level(level - 1);
            for (i, (sx, sy)) in region.tiles().enumerate() {
                let t = if wanted.intersects(&IRect::tile(sx, sy)) {
                    self.down_tile(src, extent, bounds, level - 1, sx, sy)
                } else {
                    None
                };
                if let Some(t) = &t {
                    sources[i] = ptr(t);
                    holds.push(t.clone());
                }
                below.push((IRect::tile(sx, sy), t));
            }
        }
        let rel =
            below_bounds.map(|(r, d)| (r.intersect(&region).translate(-region.x, -region.y), d));
        // Nothing to filter: no sources, and no outside value showing.
        let shows_default =
            rel.is_some_and(|(r, d)| d != 0 && r != IRect::new(0, 0, 2 * TILE, 2 * TILE));
        if holds.is_empty() && !shows_default {
            return None;
        }
        let key = Key::Down {
            channels,
            align,
            bounds: rel,
            sources,
        };
        let now = self.touch();
        if let Some(e) = self.entries.get_mut(&key) {
            e.used = now;
            return e.tile.clone();
        }
        let tile = self.filter(channels, region, &below, rel);
        self.insert(
            key,
            Entry {
                tile: tile.clone(),
                bounds: None,
                holds,
                used: now,
            },
        );
        tile
    }

    /// Box-filters a 2× region (given as the tiles covering it) into one
    /// tile, premultiplied for RGBA; `None` when all zero.
    fn filter(
        &mut self,
        channels: u8,
        region: IRect,
        below: &[(IRect, Option<Arc<[u8]>>)],
        bounds: Option<(IRect, u8)>,
    ) -> Option<Arc<[u8]>> {
        let c = channels as usize;
        let side = 2 * T;
        let mut buf = std::mem::take(&mut self.scratch);
        buf.clear();
        buf.resize(side * side * c, 0);
        for (rect, tile) in below {
            let Some(tile) = tile else { continue };
            let part = rect.intersect(&region);
            for y in part.y..part.bottom() {
                let src = ((y - rect.y) as usize * T + (part.x - rect.x) as usize) * c;
                let dst = ((y - region.y) as usize * side + (part.x - region.x) as usize) * c;
                let n = part.w as usize * c;
                buf[dst..dst + n].copy_from_slice(&tile[src..src + n]);
            }
        }
        if let Some((inside, value)) = bounds {
            for y in 0..side as i32 {
                for x in 0..side as i32 {
                    if !inside.contains(x, y) {
                        buf[(y as usize * side + x as usize) * c] = value;
                    }
                }
            }
        }
        let mut out = vec![0u8; T * T * c];
        let mut any = false;
        for y in 0..T {
            let r0 = 2 * y * side * c;
            let r1 = r0 + side * c;
            for x in 0..T {
                let i0 = r0 + 2 * x * c;
                let i1 = r1 + 2 * x * c;
                let o = (y * T + x) * c;
                if c == 1 {
                    let s =
                        buf[i0] as u32 + buf[i0 + 1] as u32 + buf[i1] as u32 + buf[i1 + 1] as u32;
                    out[o] = ((s + 2) / 4) as u8;
                    any |= out[o] != 0;
                } else {
                    let px = [i0, i0 + 4, i1, i1 + 4];
                    let a: u32 = px.iter().map(|&i| buf[i + 3] as u32).sum();
                    if a == 0 {
                        continue;
                    }
                    for k in 0..3 {
                        let s: u32 = px
                            .iter()
                            .map(|&i| buf[i + k] as u32 * buf[i + 3] as u32)
                            .sum();
                        out[o + k] = ((s + a / 2) / a).min(255) as u8;
                    }
                    out[o + 3] = ((a + 2) / 4) as u8;
                    any |= out[o + 3] != 0;
                }
            }
        }
        self.scratch = buf;
        any.then(|| Arc::from(out))
    }
}

/// A tile's identity.
fn ptr(t: &Arc<[u8]>) -> usize {
    Arc::as_ptr(t) as *const u8 as usize
}

#[cfg(test)]
mod test;
