use super::*;

fn solid(rect: IRect, px: [u8; 4]) -> Vec<u8> {
    px.iter()
        .copied()
        .cycle()
        .take(rect.area() as usize * 4)
        .collect()
}

#[test]
fn rect_operations() {
    let a = IRect::new(0, 0, 10, 10);
    let b = IRect::new(5, 5, 10, 10);
    assert_eq!(a.intersect(&b), IRect::new(5, 5, 5, 5));
    assert_eq!(a.union(&b), IRect::new(0, 0, 15, 15));
    assert!(a.intersect(&IRect::new(20, 20, 1, 1)).is_empty());
    assert_eq!(IRect::new(0, 0, -3, 4), IRect::new(0, 0, 0, 4));
    assert_eq!(
        IRect::new(-1, -1, 2, 2).at_level(1),
        IRect::new(-1, -1, 2, 2)
    );
    assert_eq!(IRect::new(1, 1, 4, 4).at_level(1), IRect::new(0, 0, 3, 3));
}

#[test]
fn tiles_of_a_rect_cover_negative_coordinates() {
    let tiles: Vec<_> = IRect::new(-1, -1, 2, 2).tiles().collect();
    assert_eq!(tiles, vec![(-1, -1), (0, -1), (-1, 0), (0, 0)]);
    assert_eq!(IRect::new(0, 0, 0, 0).tiles().count(), 0);
}

#[test]
fn write_then_read_across_tiles() {
    let mut r = Raster::rgba();
    r.set_origin((10, -20));
    let rect = IRect::new(200, 200, 100, 80);
    r.write(rect, &solid(rect, [1, 2, 3, 255]));
    assert_eq!(r.get(250, 250), [1, 2, 3, 255]);
    assert_eq!(r.get(199, 250), [0; 4]);
    let wide = IRect::new(190, 190, 120, 100);
    let pixels = r.read_vec(wide);
    let at = |x: i32, y: i32| {
        let i = ((y - wide.y) * wide.w + (x - wide.x)) as usize * 4;
        [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
    };
    assert_eq!(at(200, 200), [1, 2, 3, 255]);
    assert_eq!(at(299, 279), [1, 2, 3, 255]);
    assert_eq!(at(300, 279), [0; 4]);
    assert_eq!(r.content_bounds(), Some(rect));
}

#[test]
fn blank_writes_create_no_tiles() {
    let mut r = Raster::rgba();
    let rect = IRect::new(0, 0, 600, 600);
    r.write(rect, &vec![0; rect.area() as usize * 4]);
    assert!(r.is_empty());
}

#[test]
fn clones_share_tiles_until_written() {
    let mut a = Raster::gray();
    a.put(3, 4, &[9]);
    let mut b = a.clone();
    assert!(a.same_tile(&b, 0, 0));
    b.put(3, 4, &[7]);
    assert_eq!(a.get(3, 4)[0], 9);
    assert_eq!(b.get(3, 4)[0], 7);
}

#[test]
fn translate_moves_pixels_without_touching_tiles() {
    let mut r = Raster::rgba();
    r.put(5, 5, &[1, 1, 1, 1]);
    let before = r.tile_arc(0, 0).unwrap();
    r.translate(-300, 7);
    assert_eq!(r.get(-295, 12), [1, 1, 1, 1]);
    assert!(Arc::ptr_eq(&before, &r.tile_arc(0, 0).unwrap()));
}

#[test]
fn realign_keeps_pixels() {
    let mut r = Raster::rgba();
    let rect = IRect::new(3, 7, 300, 20);
    r.write(rect, &solid(rect, [4, 5, 6, 200]));
    let moved = r.realigned((100, 100));
    assert_eq!(moved.origin(), (100, 100));
    assert_eq!(moved.content_bounds(), Some(rect));
    assert_eq!(moved.get(150, 10), [4, 5, 6, 200]);
}

#[test]
fn clear_and_crop() {
    let mut r = Raster::rgba();
    let rect = IRect::new(0, 0, 512, 512);
    r.write(rect, &solid(rect, [1, 1, 1, 255]));
    r.clear(IRect::new(0, 0, 256, 256));
    assert_eq!(r.tile_count(), 3);
    r.crop_to(IRect::new(300, 300, 10, 10));
    assert_eq!(r.content_bounds(), Some(IRect::new(300, 300, 10, 10)));
    r.prune();
    assert_eq!(r.tile_count(), 1);
}

#[test]
fn selection_defaults_to_gray() {
    let s = Selection::default();
    assert_eq!(s.mask.channels(), 1);
    assert!(s.is_empty());
}
