use super::*;

/// A PNG of `side × side` opaque pixels in a pattern every level shows.
fn pattern_png(side: u32) -> Vec<u8> {
    let mut pixmap = Pixmap::new(side, side).unwrap();
    for (i, px) in pixmap.data_mut().chunks_exact_mut(4).enumerate() {
        let (x, y) = (i as u32 % side, i as u32 / side);
        px.copy_from_slice(&[(x * 7) as u8, (y * 5) as u8, ((x ^ y) * 3) as u8, 255]);
    }
    encode_png(&pixmap)
}

fn stored(store: &ImageStore, hash: &str) -> Vec<bool> {
    let entry = store.entries[hash].as_ref().unwrap();
    entry.levels.iter().map(Option::is_some).collect()
}

#[test]
fn widens_pixels_to_rgba_in_place() {
    let mut gray = vec![10, 20];
    expand_to_rgba(&mut gray, 1);
    assert_eq!(gray, [10, 10, 10, 255, 20, 20, 20, 255]);
    let mut gray_alpha = vec![10, 1, 20, 2];
    expand_to_rgba(&mut gray_alpha, 2);
    assert_eq!(gray_alpha, [10, 10, 10, 1, 20, 20, 20, 2]);
    let mut rgb = vec![1, 2, 3, 4, 5, 6];
    expand_to_rgba(&mut rgb, 3);
    assert_eq!(rgb, [1, 2, 3, 255, 4, 5, 6, 255]);
}

#[test]
fn large_images_drawn_small_keep_only_small_levels() {
    // 2048² RGBA is 16 MB: decoded only to be drawn at half size, the full
    // level is let go, and drawing it full size later decodes it again.
    let png = pattern_png(2048);
    let mut store = ImageStore::default();
    assert_eq!(store.size("a", Some(&png)), Some((2048, 2048)));
    let (half, factor) = store.level("a", Some(&png), 0.4).unwrap();
    assert_eq!((half.width(), factor), (1024, 0.5));
    assert_eq!(&stored(&store, "a")[..3], [false, true, false]);

    let (full, _) = store.level("a", Some(&png), 1.0).unwrap();
    assert_eq!(full.width(), 2048);
    assert_eq!(halve(&full).unwrap().data(), half.data(), "same pixels");
    // Drawn full size, the full level stays.
    store.level("a", Some(&png), 0.2).unwrap();
    assert!(stored(&store, "a")[0]);
}

#[test]
fn eviction_drops_the_least_recently_drawn_levels() {
    let (a, b) = (pattern_png(256), pattern_png(512));
    // Room for b's full level and a little more.
    let mut store = ImageStore::new(512 * 512 * 4 + 1000);
    store.level("a", Some(&a), 1.0).unwrap();
    store.level("b", Some(&b), 1.0).unwrap();
    assert!(!stored(&store, "a")[0], "a was drawn longer ago");
    assert!(stored(&store, "b")[0]);
    // Its size is still known, and it decodes again when drawn.
    assert_eq!(store.size("a", Some(&a)), Some((256, 256)));
    let (again, _) = store.level("a", Some(&a), 1.0).unwrap();
    assert_eq!(again.width(), 256);
}

#[test]
fn missing_images_have_no_size() {
    let mut store = ImageStore::default();
    assert_eq!(store.size("x", None), None);
    assert_eq!(store.size("y", Some(b"not an image")), None);
    assert!(store.level("y", Some(b"not an image"), 1.0).is_none());
}
