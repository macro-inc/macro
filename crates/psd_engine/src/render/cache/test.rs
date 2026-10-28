use super::*;
use crate::raster::tile_bytes;
use crate::render::testing::{painted, solid};

/// Reads a pixel of a level raster (zeros where it has no tile).
fn at(r: &Raster, x: i32, y: i32) -> [u8; 4] {
    r.get(x, y)
}

#[test]
fn level_zero_is_the_raster_itself() {
    let mut cache = Cache::default();
    let r = solid(IRect::new(3, 4, 10, 10), [1, 2, 3, 255]);
    let l0 = cache.level_raster(&r, 0, IRect::new(0, 0, 50, 50));
    assert!(matches!(l0, Cow::Borrowed(_)));
}

#[test]
fn halves_average_premultiplied_on_the_canvas_grid() {
    let mut cache = Cache::default();
    // Odd origin: canvas 2×2 blocks straddle the raster's pixels.
    let rect = IRect::new(1, 1, 4, 2);
    let r = painted(rect, |x, _| {
        if x < 3 {
            [255, 0, 0, 255]
        } else {
            [0, 0, 255, 128]
        }
    });
    let l1 = cache.level_raster(&r, 1, IRect::new(0, 0, 4, 4));
    // Level pixel (0, 0) covers canvas (0..2, 0..2): one red pixel.
    assert_eq!(at(&l1, 0, 0), [255, 0, 0, 64]);
    // (1, 0) covers canvas (2..4, 0..2): one red, one half-blue.
    let p = at(&l1, 1, 0);
    assert_eq!(p[3], ((255 + 128 + 2) / 4) as u8);
    assert_eq!(p[0], ((255 * 255 + 383 / 2) / 383) as u8);
    assert_eq!(p[2], ((255 * 128 + 191) / 383) as u8);
    // Transparent pixels don't darken colors.
    let edge = painted(IRect::new(0, 0, 2, 2), |x, _| {
        if x == 0 { [200, 100, 50, 255] } else { [0; 4] }
    });
    let l = cache.level_raster(&edge, 1, IRect::new(0, 0, 1, 1));
    assert_eq!(at(&l, 0, 0), [200, 100, 50, 128]);
}

#[test]
fn deeper_levels_chain_halves() {
    let mut cache = Cache::default();
    let rect = IRect::new(0, 0, 1024, 600);
    let r = painted(rect, |x, y| {
        [(x / 4 % 256) as u8, (y / 4 % 256) as u8, 7, 255]
    });
    let l2 = cache.level_raster(&r, 2, IRect::new(0, 0, 256, 150));
    // Each level-2 pixel is a 4×4 block of identical pixels.
    assert_eq!(at(&l2, 10, 20), [10, 20, 7, 255]);
    assert_eq!(at(&l2, 255, 149), [255, 149, 7, 255]);
    assert_eq!(at(&l2, 10, 150), [0; 4]);
}

#[test]
fn cached_tiles_are_reused_until_their_sources_change() {
    let mut cache = Cache::default();
    let mut r = solid(IRect::new(0, 0, 600, 300), [9, 9, 9, 255]);
    let region = IRect::new(0, 0, 300, 150);
    let a = cache.level_raster(&r, 1, region).tile_arc(0, 0).unwrap();
    let b = cache.level_raster(&r, 1, region).tile_arc(0, 0).unwrap();
    assert!(Arc::ptr_eq(&a, &b), "a hit returns the same tile");
    // Copy-on-write: editing a pixel gives its tile a new pointer.
    r.put(5, 5, &[255, 0, 0, 255]);
    let c = cache.level_raster(&r, 1, region).tile_arc(0, 0).unwrap();
    assert!(!Arc::ptr_eq(&a, &c));
    assert_eq!(c[(2 * 256 + 2) * 4], ((255 + 3 * 9 + 2) / 4) as u8);
    // An untouched neighbor keeps its tile.
    let d = cache
        .level_raster(&r, 1, IRect::new(256, 0, 44, 150))
        .tile_arc(1, 0);
    let e = cache
        .level_raster(&r, 1, IRect::new(256, 0, 44, 150))
        .tile_arc(1, 0);
    assert!(Arc::ptr_eq(&d.unwrap(), &e.unwrap()));
}

#[test]
fn sweeps_drop_entries_whose_sources_are_gone() {
    let mut cache = Cache::default();
    let r = solid(IRect::new(0, 0, 300, 300), [1, 1, 1, 255]);
    let region = IRect::new(0, 0, 150, 150);
    let _ = cache.level_raster(&r, 2, region);
    let held = cache.len();
    assert!(held >= 2, "level 1 and level 2 entries");
    cache.sweep_now();
    assert_eq!(cache.len(), held, "live sources keep their entries");
    let snapshot = r.clone();
    drop(r);
    cache.sweep_now();
    assert_eq!(cache.len(), held, "an undo snapshot still holds the tiles");
    drop(snapshot);
    cache.sweep_now();
    assert_eq!(cache.len(), 0);
    assert_eq!(cache.bytes(), 0);
}

#[test]
fn the_budget_evicts_least_recent_entries() {
    let tile = tile_bytes(4);
    let mut cache = Cache::with_budget(tile * 3);
    let r = solid(IRect::new(0, 0, 2048, 512), [5, 5, 5, 255]);
    let _ = cache.level_raster(&r, 1, IRect::new(0, 0, 1024, 256));
    assert!(cache.bytes() <= tile * 3);
    assert!(cache.len() >= 1);
}

#[test]
fn masks_take_their_outside_value_beyond_their_rectangle() {
    let mut cache = Cache::default();
    let rect = IRect::new(10, 10, 20, 20);
    let mask = LayerMask {
        generation: 0,
        raster: Raster::from_region(1, rect, &vec![0u8; 400]),
        rect,
        default_color: 255,
        disabled: false,
        linked: true,
        density: 1.0,
        feather: 0.0,
    };
    let l1 = cache.level_mask(&mask, 1, IRect::new(0, 0, 40, 40));
    assert_eq!(l1.rect, IRect::new(5, 5, 10, 10));
    // Inside: black; outside: white; the border mixes both.
    assert_eq!(l1.value(8, 8), 0);
    assert_eq!(l1.value(30, 30), 255);
    let rect2 = IRect::new(11, 11, 20, 20);
    let mask2 = LayerMask {
        raster: Raster::from_region(1, rect2, &vec![0u8; 400]),
        rect: rect2,
        ..mask.clone()
    };
    let l = cache.level_mask(&mask2, 1, IRect::new(0, 0, 40, 40));
    // Level pixel (5, 5) covers canvas (10..12, 10..12): one inside.
    assert_eq!(l.value(5, 5), ((3 * 255 + 2) / 4) as u8);
    // Deeper levels keep the outside value.
    let l3 = cache.level_mask(&mask, 3, IRect::new(0, 0, 10, 10));
    assert_eq!(l3.value(0, 0), 255);
}

#[test]
fn path_coverage_and_bounds_are_remembered() {
    let mut cache = Cache::default();
    let mut made = 0;
    for _ in 0..3 {
        let _ = cache.coverage(42, 0, (0, 0), || {
            made += 1;
            Some(Arc::from(vec![1u8; 4]))
        });
    }
    assert_eq!(made, 1);
    let r = solid(IRect::new(7, 8, 3, 4), [1, 1, 1, 255]);
    assert_eq!(cache.content_bounds(&r), Some(IRect::new(7, 8, 3, 4)));
    assert_eq!(cache.content_bounds(&r), Some(IRect::new(7, 8, 3, 4)));
    cache.clear();
    assert_eq!(cache.len(), 0);
}
