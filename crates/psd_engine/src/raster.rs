//! Pixels: sparse grids of copy-on-write tiles.
//!
//! A [`Raster`] holds 8-bit straight (unassociated) samples, either RGBA or
//! one gray channel, in [`TILE`]-pixel square tiles keyed by their position
//! in the raster's own grid. The grid's origin sits at a canvas position, so
//! moving a layer moves its origin and touches no pixels. Tiles that were
//! never written are fully transparent (or zero, for gray), and tiles are
//! shared by reference: cloning a raster (an undo snapshot, a duplicated
//! layer) copies no pixels until one side writes.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

/// Side of a tile, in pixels.
pub const TILE: i32 = 256;

/// An integer rectangle: `x`, `y` of its top left, `w` by `h` pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IRect {
    /// Left edge.
    pub x: i32,
    /// Top edge.
    pub y: i32,
    /// Width (never negative).
    pub w: i32,
    /// Height (never negative).
    pub h: i32,
}

impl IRect {
    /// A rectangle from its top left and size (negative sizes become 0).
    pub const fn new(x: i32, y: i32, w: i32, h: i32) -> IRect {
        IRect {
            x,
            y,
            w: if w > 0 { w } else { 0 },
            h: if h > 0 { h } else { 0 },
        }
    }

    /// A rectangle from its edges.
    pub const fn from_ltrb(left: i32, top: i32, right: i32, bottom: i32) -> IRect {
        IRect::new(left, top, right - left, bottom - top)
    }

    /// One past the right edge.
    pub const fn right(&self) -> i32 {
        self.x + self.w
    }

    /// One past the bottom edge.
    pub const fn bottom(&self) -> i32 {
        self.y + self.h
    }

    /// Whether it covers no pixels.
    pub const fn is_empty(&self) -> bool {
        self.w <= 0 || self.h <= 0
    }

    /// Pixel count.
    pub const fn area(&self) -> i64 {
        self.w as i64 * self.h as i64
    }

    /// Whether the pixel at `(x, y)` is inside.
    pub const fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && y >= self.y && x < self.right() && y < self.bottom()
    }

    /// Whether `other` lies entirely inside.
    pub fn contains_rect(&self, other: &IRect) -> bool {
        other.is_empty()
            || (other.x >= self.x
                && other.y >= self.y
                && other.right() <= self.right()
                && other.bottom() <= self.bottom())
    }

    /// The overlap of two rectangles (empty when they do not overlap).
    pub fn intersect(&self, other: &IRect) -> IRect {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        IRect::from_ltrb(
            x,
            y,
            self.right().min(other.right()),
            self.bottom().min(other.bottom()),
        )
    }

    /// Whether the rectangles share any pixel.
    pub fn intersects(&self, other: &IRect) -> bool {
        !self.intersect(other).is_empty()
    }

    /// The smallest rectangle holding both (an empty one is ignored).
    pub fn union(&self, other: &IRect) -> IRect {
        if self.is_empty() {
            return *other;
        }
        if other.is_empty() {
            return *self;
        }
        IRect::from_ltrb(
            self.x.min(other.x),
            self.y.min(other.y),
            self.right().max(other.right()),
            self.bottom().max(other.bottom()),
        )
    }

    /// Moved by `(dx, dy)`.
    pub const fn translate(&self, dx: i32, dy: i32) -> IRect {
        IRect {
            x: self.x + dx,
            y: self.y + dy,
            w: self.w,
            h: self.h,
        }
    }

    /// Grown by `d` pixels on every side (shrunk for negative `d`).
    pub const fn outset(&self, d: i32) -> IRect {
        IRect::new(self.x - d, self.y - d, self.w + 2 * d, self.h + 2 * d)
    }

    /// The tile positions (in a grid whose origin is `(0, 0)`) this
    /// rectangle touches, row by row.
    pub fn tiles(&self) -> impl Iterator<Item = (i32, i32)> + use<> {
        let (x0, y0) = (self.x.div_euclid(TILE), self.y.div_euclid(TILE));
        let (x1, y1) = if self.is_empty() {
            (x0 - 1, y0 - 1)
        } else {
            (
                (self.right() - 1).div_euclid(TILE),
                (self.bottom() - 1).div_euclid(TILE),
            )
        };
        (y0..=y1).flat_map(move |ty| (x0..=x1).map(move |tx| (tx, ty)))
    }

    /// The rectangle of tile `(tx, ty)` in a grid whose origin is `(0, 0)`.
    pub const fn tile(tx: i32, ty: i32) -> IRect {
        IRect {
            x: tx * TILE,
            y: ty * TILE,
            w: TILE,
            h: TILE,
        }
    }

    /// Scaled down by `2^level` (rounding outward), for mip levels.
    pub fn at_level(&self, level: u8) -> IRect {
        if level == 0 {
            return *self;
        }
        let s = 1i32 << level;
        IRect::from_ltrb(
            self.x.div_euclid(s),
            self.y.div_euclid(s),
            (self.right() + s - 1).div_euclid(s),
            (self.bottom() + s - 1).div_euclid(s),
        )
    }
}

/// Bytes in a tile with `channels` channels.
pub const fn tile_bytes(channels: u8) -> usize {
    (TILE * TILE) as usize * channels as usize
}

/// A sparse grid of 8-bit tiles: RGBA (straight alpha) or one gray channel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Raster {
    channels: u8,
    /// Canvas position of the grid's `(0, 0)`.
    origin: (i32, i32),
    tiles: BTreeMap<(i32, i32), Arc<[u8]>>,
}

impl Default for Raster {
    fn default() -> Self {
        Raster::rgba()
    }
}

impl Raster {
    /// An empty raster with `channels` channels (1 or 4).
    pub fn new(channels: u8) -> Raster {
        debug_assert!(channels == 1 || channels == 4);
        Raster {
            channels,
            origin: (0, 0),
            tiles: BTreeMap::new(),
        }
    }

    /// An empty RGBA raster.
    pub fn rgba() -> Raster {
        Raster::new(4)
    }

    /// An empty one-channel raster.
    pub fn gray() -> Raster {
        Raster::new(1)
    }

    /// An empty raster like this one (channels and origin).
    pub fn empty_like(&self) -> Raster {
        Raster {
            channels: self.channels,
            origin: self.origin,
            tiles: BTreeMap::new(),
        }
    }

    /// Samples per pixel (1 or 4).
    pub fn channels(&self) -> u8 {
        self.channels
    }

    /// Canvas position of the grid's `(0, 0)`.
    pub fn origin(&self) -> (i32, i32) {
        self.origin
    }

    /// Places the grid's `(0, 0)` at a canvas position.
    pub fn set_origin(&mut self, origin: (i32, i32)) {
        self.origin = origin;
    }

    /// Moves every pixel by `(dx, dy)`.
    pub fn translate(&mut self, dx: i32, dy: i32) {
        self.origin = (self.origin.0 + dx, self.origin.1 + dy);
    }

    /// Whether no tile was ever written.
    pub fn is_empty(&self) -> bool {
        self.tiles.is_empty()
    }

    /// How many tiles hold pixels.
    pub fn tile_count(&self) -> usize {
        self.tiles.len()
    }

    /// Bytes held by tiles (shared tiles counted in full).
    pub fn byte_size(&self) -> usize {
        self.tiles.len() * tile_bytes(self.channels)
    }

    /// Positions of the tiles that hold pixels, in grid coordinates.
    pub fn tile_keys(&self) -> impl Iterator<Item = (i32, i32)> + '_ {
        self.tiles.keys().copied()
    }

    /// A tile's samples (`TILE`² × channels, row by row), if written.
    pub fn tile(&self, tx: i32, ty: i32) -> Option<&[u8]> {
        self.tiles.get(&(tx, ty)).map(|t| &t[..])
    }

    /// A tile, shared.
    pub fn tile_arc(&self, tx: i32, ty: i32) -> Option<Arc<[u8]>> {
        self.tiles.get(&(tx, ty)).cloned()
    }

    /// Whether two rasters hold the same tile at a position (by reference,
    /// so unchanged tiles compare in constant time).
    pub fn same_tile(&self, other: &Raster, tx: i32, ty: i32) -> bool {
        match (self.tiles.get(&(tx, ty)), other.tiles.get(&(tx, ty))) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, b) || a == b,
            _ => false,
        }
    }

    /// A tile to write, created blank when missing and copied first when
    /// shared.
    pub fn tile_mut(&mut self, tx: i32, ty: i32) -> &mut [u8] {
        let size = tile_bytes(self.channels);
        let entry = self
            .tiles
            .entry((tx, ty))
            .or_insert_with(|| Arc::from(vec![0u8; size]));
        if Arc::get_mut(entry).is_none() {
            *entry = Arc::from(&entry[..]);
        }
        Arc::get_mut(entry).expect("tile is unique after copying")
    }

    /// Replaces a tile (`None` clears it).
    pub fn set_tile(&mut self, tx: i32, ty: i32, data: Option<Arc<[u8]>>) {
        match data {
            Some(d) => {
                debug_assert_eq!(d.len(), tile_bytes(self.channels));
                self.tiles.insert((tx, ty), d);
            }
            None => {
                self.tiles.remove(&(tx, ty));
            }
        }
    }

    /// Canvas rectangle of tile `(tx, ty)`.
    pub fn tile_rect(&self, tx: i32, ty: i32) -> IRect {
        IRect::tile(tx, ty).translate(self.origin.0, self.origin.1)
    }

    /// The canvas rectangle covered by tiles that hold pixels.
    pub fn bounds(&self) -> Option<IRect> {
        self.tiles
            .keys()
            .map(|&(tx, ty)| self.tile_rect(tx, ty))
            .reduce(|a, b| a.union(&b))
    }

    /// The tight canvas bounds of pixels that are not fully transparent
    /// (RGBA) or not zero (gray).
    pub fn content_bounds(&self) -> Option<IRect> {
        let c = self.channels as usize;
        let alpha = c - 1;
        let mut out: Option<IRect> = None;
        for (&(tx, ty), tile) in &self.tiles {
            let r = self.tile_rect(tx, ty);
            let (mut x0, mut y0, mut x1, mut y1) = (TILE, TILE, -1, -1);
            for y in 0..TILE {
                let row = &tile[(y * TILE) as usize * c..((y + 1) * TILE) as usize * c];
                let first = (0..TILE as usize).find(|&x| row[x * c + alpha] != 0);
                let Some(first) = first else { continue };
                let last = (0..TILE as usize)
                    .rev()
                    .find(|&x| row[x * c + alpha] != 0)
                    .unwrap_or(first);
                x0 = x0.min(first as i32);
                x1 = x1.max(last as i32);
                y0 = y0.min(y);
                y1 = y1.max(y);
            }
            if x1 >= 0 {
                let rect = IRect::from_ltrb(r.x + x0, r.y + y0, r.x + x1 + 1, r.y + y1 + 1);
                out = Some(out.map_or(rect, |o| o.union(&rect)));
            }
        }
        out
    }

    /// The samples of the pixel at canvas `(x, y)` (zeros outside tiles),
    /// padded to four.
    pub fn get(&self, x: i32, y: i32) -> [u8; 4] {
        let (lx, ly) = (x - self.origin.0, y - self.origin.1);
        let key = (lx.div_euclid(TILE), ly.div_euclid(TILE));
        let Some(tile) = self.tiles.get(&key) else {
            return [0; 4];
        };
        let c = self.channels as usize;
        let i = (ly.rem_euclid(TILE) * TILE + lx.rem_euclid(TILE)) as usize * c;
        let mut px = [0u8; 4];
        px[..c].copy_from_slice(&tile[i..i + c]);
        px
    }

    /// Sets the pixel at canvas `(x, y)` (the first `channels` samples).
    pub fn put(&mut self, x: i32, y: i32, px: &[u8]) {
        let (lx, ly) = (x - self.origin.0, y - self.origin.1);
        let c = self.channels as usize;
        let tile = self.tile_mut(lx.div_euclid(TILE), ly.div_euclid(TILE));
        let i = (ly.rem_euclid(TILE) * TILE + lx.rem_euclid(TILE)) as usize * c;
        tile[i..i + c].copy_from_slice(&px[..c]);
    }

    /// Copies a canvas rectangle into `out` (row by row, `channels` samples
    /// per pixel); pixels outside tiles read as zeros.
    pub fn read(&self, rect: IRect, out: &mut [u8]) {
        let c = self.channels as usize;
        let stride = rect.w.max(0) as usize * c;
        debug_assert!(out.len() >= stride * rect.h.max(0) as usize);
        if rect.is_empty() {
            return;
        }
        out[..stride * rect.h as usize].fill(0);
        let local = rect.translate(-self.origin.0, -self.origin.1);
        for (tx, ty) in local.tiles() {
            let Some(tile) = self.tiles.get(&(tx, ty)) else {
                continue;
            };
            let tr = IRect::tile(tx, ty);
            let part = tr.intersect(&local);
            let row_bytes = part.w as usize * c;
            for y in part.y..part.bottom() {
                let src = ((y - tr.y) * TILE + (part.x - tr.x)) as usize * c;
                let dst = (y - local.y) as usize * stride + (part.x - local.x) as usize * c;
                out[dst..dst + row_bytes].copy_from_slice(&tile[src..src + row_bytes]);
            }
        }
    }

    /// A canvas rectangle's samples as a new buffer (see [`Raster::read`]).
    pub fn read_vec(&self, rect: IRect) -> Vec<u8> {
        let mut out = vec![0u8; rect.area().max(0) as usize * self.channels as usize];
        self.read(rect, &mut out);
        out
    }

    /// Writes `data` (row by row, `channels` samples per pixel) over a
    /// canvas rectangle. Tiles that do not exist yet are created only where
    /// the written samples are not all zero.
    pub fn write(&mut self, rect: IRect, data: &[u8]) {
        let c = self.channels as usize;
        let stride = rect.w.max(0) as usize * c;
        if rect.is_empty() {
            return;
        }
        debug_assert!(data.len() >= stride * rect.h as usize);
        let local = rect.translate(-self.origin.0, -self.origin.1);
        for (tx, ty) in local.tiles() {
            let tr = IRect::tile(tx, ty);
            let part = tr.intersect(&local);
            let row_bytes = part.w as usize * c;
            if !self.tiles.contains_key(&(tx, ty)) {
                let blank = (part.y..part.bottom()).all(|y| {
                    let src = (y - local.y) as usize * stride + (part.x - local.x) as usize * c;
                    data[src..src + row_bytes].iter().all(|&b| b == 0)
                });
                if blank {
                    continue;
                }
            }
            let tile = self.tile_mut(tx, ty);
            for y in part.y..part.bottom() {
                let src = (y - local.y) as usize * stride + (part.x - local.x) as usize * c;
                let dst = ((y - tr.y) * TILE + (part.x - tr.x)) as usize * c;
                tile[dst..dst + row_bytes].copy_from_slice(&data[src..src + row_bytes]);
            }
        }
    }

    /// A raster holding `data` over a canvas rectangle, its grid placed at
    /// the rectangle's top left.
    pub fn from_region(channels: u8, rect: IRect, data: &[u8]) -> Raster {
        let mut r = Raster::new(channels);
        r.origin = (rect.x, rect.y);
        r.write(rect, data);
        r
    }

    /// Clears a canvas rectangle (dropping tiles it covers entirely).
    pub fn clear(&mut self, rect: IRect) {
        let c = self.channels as usize;
        let local = rect.translate(-self.origin.0, -self.origin.1);
        let keys: Vec<(i32, i32)> = local
            .tiles()
            .filter(|k| self.tiles.contains_key(k))
            .collect();
        for (tx, ty) in keys {
            let tr = IRect::tile(tx, ty);
            let part = tr.intersect(&local);
            if part == tr {
                self.tiles.remove(&(tx, ty));
                continue;
            }
            let tile = self.tile_mut(tx, ty);
            for y in part.y..part.bottom() {
                let dst = ((y - tr.y) * TILE + (part.x - tr.x)) as usize * c;
                tile[dst..dst + part.w as usize * c].fill(0);
            }
        }
    }

    /// Drops tiles whose samples are all zero (fully transparent).
    pub fn prune(&mut self) {
        let c = self.channels as usize;
        self.tiles.retain(|_, t| {
            if c == 4 {
                t.chunks_exact(4).any(|p| p[3] != 0)
            } else {
                t.iter().any(|&v| v != 0)
            }
        });
    }

    /// Keeps only the pixels inside a canvas rectangle.
    pub fn crop_to(&mut self, rect: IRect) {
        let Some(bounds) = self.bounds() else { return };
        for strip in [
            IRect::from_ltrb(bounds.x, bounds.y, bounds.right(), rect.y),
            IRect::from_ltrb(bounds.x, rect.bottom(), bounds.right(), bounds.bottom()),
            IRect::from_ltrb(bounds.x, rect.y, rect.x, rect.bottom()),
            IRect::from_ltrb(rect.right(), rect.y, bounds.right(), rect.bottom()),
        ] {
            if !strip.is_empty() {
                self.clear(strip);
            }
        }
    }

    /// The same pixels with the grid's origin at `origin` (tiles are cut
    /// again when the shift is not a whole number of tiles).
    pub fn realigned(&self, origin: (i32, i32)) -> Raster {
        let (dx, dy) = (self.origin.0 - origin.0, self.origin.1 - origin.1);
        if dx.rem_euclid(TILE) == 0 && dy.rem_euclid(TILE) == 0 {
            let (sx, sy) = (dx.div_euclid(TILE), dy.div_euclid(TILE));
            return Raster {
                channels: self.channels,
                origin,
                tiles: self
                    .tiles
                    .iter()
                    .map(|(&(tx, ty), t)| ((tx + sx, ty + sy), t.clone()))
                    .collect(),
            };
        }
        let mut out = Raster::new(self.channels);
        out.origin = origin;
        for (&(tx, ty), tile) in &self.tiles {
            out.write(self.tile_rect(tx, ty), tile);
        }
        out
    }
}

/// A selection: how much of each canvas pixel is selected (0 to 255), in a
/// one-channel raster whose grid starts at the canvas origin. Nothing is
/// selected where no tile exists.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    /// Coverage per canvas pixel.
    pub mask: Raster,
}

impl Default for Selection {
    fn default() -> Self {
        Selection::none()
    }
}

impl Selection {
    /// Nothing selected.
    pub fn none() -> Selection {
        Selection {
            mask: Raster::gray(),
        }
    }

    /// Whether nothing is selected.
    pub fn is_empty(&self) -> bool {
        self.mask.is_empty()
    }

    /// How much of the pixel at `(x, y)` is selected.
    pub fn coverage(&self, x: i32, y: i32) -> u8 {
        self.mask.get(x, y)[0]
    }

    /// The tight bounds of what is selected.
    pub fn bounds(&self) -> Option<IRect> {
        self.mask.content_bounds()
    }
}

#[cfg(test)]
mod test;
