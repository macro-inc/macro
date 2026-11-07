use super::*;

/// A plane with 1 inside `inside` and 0 elsewhere.
fn square(rect: IRect, inside: IRect) -> Plane {
    let mut p = Plane::filled(rect, 0.0);
    let mut i = 0;
    for y in rect.y..rect.bottom() {
        for x in rect.x..rect.right() {
            if inside.contains(x, y) {
                p.v[i] = 1.0;
            }
            i += 1;
        }
    }
    p
}

#[test]
fn crop_and_get_read_zero_outside() {
    let p = square(IRect::new(0, 0, 4, 4), IRect::new(1, 1, 2, 2));
    assert_eq!(p.get(1, 1), 1.0);
    assert_eq!(p.get(10, 1), 0.0);
    let c = p.crop(IRect::new(-2, -2, 4, 4));
    assert_eq!(c.v.iter().filter(|&&v| v == 1.0).count(), 1);
    assert_eq!(c.get(1, 1), 1.0);
}

#[test]
fn blur_keeps_flat_areas_and_spreads_edges_symmetrically() {
    let rect = IRect::new(0, 0, 80, 80);
    let mut p = square(rect, IRect::new(20, 20, 40, 40));
    blur(&mut p, 3.0);
    // Deep inside stays 1, far outside 0.
    assert!((p.get(40, 40) - 1.0).abs() < 1e-4);
    assert!(p.get(2, 2) < 1e-4);
    // The edge is half covered, and the falloff mirrors around it.
    let edge = (p.get(19, 40) + p.get(20, 40)) / 2.0;
    assert!((edge - 0.5).abs() < 0.02, "{edge}");
    for d in 1..8 {
        let out = p.get(19 - d, 40);
        let inside = p.get(20 + d, 40);
        assert!((out + inside - 1.0).abs() < 0.02, "{d}: {out} {inside}");
    }
    // Small sigmas do nothing.
    let mut q = square(rect, IRect::new(20, 20, 40, 40));
    let before = q.clone();
    blur(&mut q, 0.2);
    assert_eq!(q, before);
    // Huge ones are clamped, not a hang or a panic.
    let mut tiny = Plane::filled(IRect::new(0, 0, 3, 3), 1.0);
    blur(&mut tiny, 1e9);
    assert!(tiny.v.iter().all(|v| v.is_finite()));
}

#[test]
fn distance_matches_brute_force() {
    let rect = IRect::new(5, -3, 23, 17);
    let set: Vec<(i32, i32)> = vec![(2, 3), (17, 1), (9, 14), (20, 15)];
    let d = distance(rect, |i| {
        let (x, y) = ((i as i32) % rect.w, (i as i32) / rect.w);
        set.contains(&(x, y))
    });
    for y in 0..rect.h {
        for x in 0..rect.w {
            let expected = set
                .iter()
                .map(|&(sx, sy)| (((sx - x).pow(2) + (sy - y).pow(2)) as f32).sqrt())
                .fold(f32::MAX, f32::min);
            let got = d[(y * rect.w + x) as usize];
            assert!(
                (got - expected).abs() < 1e-4,
                "({x}, {y}): {got} vs {expected}"
            );
        }
    }
    // Nothing set: everything is infinitely far.
    let none = distance(IRect::new(0, 0, 3, 3), |_| false);
    assert!(none.iter().all(|&v| v == f32::MAX));
}

#[test]
fn dilation_and_erosion_move_edges_by_their_radius() {
    let rect = IRect::new(0, 0, 60, 60);
    let p = square(rect, IRect::new(20, 20, 20, 20));
    let grown = dilate(&p, 3.0);
    // Three more columns on each side, the next one untouched.
    for x in 17..43 {
        assert_eq!(grown.get(x, 30), 1.0, "{x}");
    }
    assert_eq!(grown.get(16, 30), 0.0);
    assert_eq!(grown.get(43, 30), 0.0);
    // Corners round off: the diagonal pixel at distance ~3.6 is partial.
    assert!(grown.get(16, 16) < 0.5);
    let half = dilate(&p, 0.5);
    assert!((half.get(19, 30) - 0.5).abs() < 1e-6);
    let shrunk = erode(&p, 4.0);
    assert_eq!(shrunk.get(23, 30), 0.0);
    assert_eq!(shrunk.get(24, 30), 1.0);
    assert_eq!(shrunk.get(35, 30), 1.0);
    assert_eq!(shrunk.get(36, 30), 0.0);
    assert_eq!(erode(&p, 0.0), p);
    // Eroding away everything leaves nothing.
    assert!(erode(&p, 15.0).v.iter().all(|&v| v == 0.0));
}

#[test]
fn shifting_moves_by_whole_and_fractional_pixels() {
    let rect = IRect::new(0, 0, 10, 10);
    let p = square(rect, IRect::new(4, 4, 1, 1));
    let s = p.shifted(2.0, -1.0, rect, 0.0);
    assert_eq!(s.get(6, 3), 1.0);
    assert_eq!(s.v.iter().sum::<f32>(), 1.0);
    let h = p.shifted(0.5, 0.0, rect, 0.0);
    assert!((h.get(4, 4) - 0.5).abs() < 1e-6 && (h.get(5, 4) - 0.5).abs() < 1e-6);
    // Outside the source, the given value.
    let o = p.shifted(3.0, 0.0, rect, 1.0);
    assert_eq!(o.get(0, 0), 1.0);
}
