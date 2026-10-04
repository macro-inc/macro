use super::*;

fn pt(x: f64, y: f64) -> Pt {
    Pt::new(x, y)
}

fn poly(points: &[(f64, f64)]) -> Vec<Seg> {
    (0..points.len())
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % points.len()]);
            Seg::Line(pt(a.0, a.1), pt(b.0, b.1))
        })
        .collect()
}

fn shape(loops: Vec<Vec<Seg>>) -> Operand {
    Operand {
        paths: vec![FillPath { loops }],
    }
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> Operand {
    shape(vec![poly(&[
        (x, y),
        (x + w, y),
        (x + w, y + h),
        (x, y + h),
    ])])
}

/// A circle as four cubics (counter-clockwise on screen, to show direction does not matter).
fn circle_loop(cx: f64, cy: f64, r: f64) -> Vec<Seg> {
    let k = 0.552_284_749_8 * r;
    let p = |x: f64, y: f64| pt(cx + x, cy + y);
    vec![
        Seg::Cubic(p(r, 0.0), p(r, -k), p(k, -r), p(0.0, -r)),
        Seg::Cubic(p(0.0, -r), p(-k, -r), p(-r, -k), p(-r, 0.0)),
        Seg::Cubic(p(-r, 0.0), p(-r, k), p(-k, r), p(0.0, r)),
        Seg::Cubic(p(0.0, r), p(k, r), p(r, k), p(r, 0.0)),
    ]
}

fn circle(cx: f64, cy: f64, r: f64) -> Operand {
    shape(vec![circle_loop(cx, cy, r)])
}

fn total_area(pieces: &[Piece]) -> f64 {
    pieces.iter().flat_map(|p| &p.loops).map(|l| area(l)).sum()
}

fn close(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

fn bounds(pieces: &[Piece]) -> (f64, f64, f64, f64) {
    let mut b = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in pieces.iter().flat_map(|p| &p.loops).flatten() {
        for i in 0..=16 {
            let q = p.at(f64::from(i) / 16.0);
            b = (b.0.min(q.x), b.1.min(q.y), b.2.max(q.x), b.3.max(q.y));
        }
    }
    b
}

/// Every loop is closed, and its segments connect.
fn assert_closed(pieces: &[Piece]) {
    for l in pieces.iter().flat_map(|p| &p.loops) {
        for i in 0..l.len() {
            let (a, b) = (l[i].end(), l[(i + 1) % l.len()].start());
            assert!(
                close(a.x, b.x, 1e-6) && close(a.y, b.y, 1e-6),
                "gap {a:?} → {b:?}"
            );
        }
    }
}

#[test]
fn cubic_area_matches_the_circle() {
    let a = area(&circle_loop(0.0, 0.0, 10.0));
    // Counter-clockwise on screen is negative; four cubics are within 0.03%.
    assert!(close(a, -std::f64::consts::PI * 100.0, 0.1), "{a}");
    assert!(close(
        area(&poly(&[(0.0, 0.0), (4.0, 0.0), (4.0, 3.0)])),
        6.0,
        1e-9
    ));
}

#[test]
fn overlapping_squares_in_every_mode() {
    let ops = [rect(0.0, 0.0, 10.0, 10.0), rect(5.0, 5.0, 10.0, 10.0)];
    let union = merge(&ops, MergeMode::Union);
    assert_eq!(union.len(), 1);
    assert_eq!(union[0].loops.len(), 1);
    // An L of two squares: eight straight sides.
    assert_eq!(union[0].loops[0].len(), 8);
    assert!(close(total_area(&union), 175.0, 1e-6));
    assert_eq!(bounds(&union), (0.0, 0.0, 15.0, 15.0));

    let inter = merge(&ops, MergeMode::Intersect);
    assert!(close(total_area(&inter), 25.0, 1e-6));
    assert_eq!(bounds(&inter), (5.0, 5.0, 10.0, 10.0));

    let sub = merge(&ops, MergeMode::Subtract);
    assert!(close(total_area(&sub), 75.0, 1e-6));
    assert_eq!(bounds(&sub), (0.0, 0.0, 10.0, 10.0));

    let comb = merge(&ops, MergeMode::Combine);
    assert_eq!(comb.len(), 1);
    // Two L shapes touching at corners stay two loops.
    assert_eq!(comb[0].loops.len(), 2);
    assert!(close(total_area(&comb), 150.0, 1e-6));

    let frag = merge(&ops, MergeMode::Fragment);
    let mut areas: Vec<f64> = frag
        .iter()
        .map(|p| total_area(std::slice::from_ref(p)))
        .collect();
    areas.sort_by(f64::total_cmp);
    assert_eq!(frag.len(), 3);
    assert!(close(areas[0], 25.0, 1e-6) && close(areas[2], 75.0, 1e-6));
    for p in [&union, &inter, &sub, &comb, &frag] {
        assert_closed(p);
        // Outer contours run clockwise on screen.
        assert!(p.iter().flat_map(|p| &p.loops).all(|l| area(l) > 0.0));
    }
}

#[test]
fn holes_are_kept_and_grouped() {
    let ops = [rect(0.0, 0.0, 100.0, 100.0), rect(25.0, 25.0, 50.0, 50.0)];
    let sub = merge(&ops, MergeMode::Subtract);
    assert_eq!(sub.len(), 1);
    let loops = &sub[0].loops;
    assert_eq!(loops.len(), 2);
    let mut signed: Vec<f64> = loops.iter().map(|l| area(l)).collect();
    signed.sort_by(f64::total_cmp);
    // The hole runs the other way.
    assert!(close(signed[0], -2500.0, 1e-6) && close(signed[1], 10_000.0, 1e-6));

    assert!(close(
        total_area(&merge(&ops, MergeMode::Combine)),
        7500.0,
        1e-6
    ));
    assert!(close(
        total_area(&merge(&ops, MergeMode::Union)),
        10_000.0,
        1e-6
    ));
    assert!(close(
        total_area(&merge(&ops, MergeMode::Intersect)),
        2500.0,
        1e-6
    ));

    // Fragment: the ring (with its hole) and the middle.
    let frag = merge(&ops, MergeMode::Fragment);
    assert_eq!(frag.len(), 2);
    let ring = frag.iter().find(|p| p.loops.len() == 2).expect("ring");
    assert!(close(total_area(std::slice::from_ref(ring)), 7500.0, 1e-6));
    assert!(frag.iter().any(|p| p.loops.len() == 1
        && close(total_area(std::slice::from_ref(p)), 2500.0, 1e-6)));
}

#[test]
fn island_in_a_hole_is_its_own_fragment() {
    // A frame (square with a square hole in one path) around a small square.
    let frame = shape(vec![
        poly(&[(0.0, 0.0), (90.0, 0.0), (90.0, 90.0), (0.0, 90.0)]),
        // The hole runs counter-clockwise.
        poly(&[(10.0, 10.0), (10.0, 80.0), (80.0, 80.0), (80.0, 10.0)]),
    ]);
    let island = rect(40.0, 40.0, 10.0, 10.0);
    let frag = merge(&[frame.clone(), island.clone()], MergeMode::Fragment);
    assert_eq!(frag.len(), 2);
    assert!(close(total_area(&frag), 8100.0 - 4900.0 + 100.0, 1e-6));
    let union = merge(&[frame, island], MergeMode::Union);
    // Outer, hole, and the island inside the hole.
    assert_eq!(union[0].loops.len(), 3);
    assert!(close(total_area(&union), 3300.0, 1e-6));
}

#[test]
fn circles_stay_curves() {
    let ops = [circle(0.0, 0.0, 50.0), circle(60.0, 0.0, 50.0)];
    let r: f64 = 50.0;
    let d: f64 = 60.0;
    let lens = 2.0 * r * r * (d / (2.0 * r)).acos() - d / 2.0 * (4.0 * r * r - d * d).sqrt();
    let disc = std::f64::consts::PI * r * r;

    let union = merge(&ops, MergeMode::Union);
    assert!(
        close(total_area(&union), 2.0 * disc - lens, 3.0),
        "{}",
        total_area(&union)
    );
    let segs = &union[0].loops[0];
    assert!(segs.iter().all(|s| matches!(s, Seg::Cubic(..))));
    // Each circle keeps its own quarter arcs, cut where they cross.
    assert!(segs.len() <= 8, "{} segments", segs.len());
    let (l, t, rr, b) = bounds(&union);
    assert!(close(l, -50.0, 0.05) && close(rr, 110.0, 0.05));
    assert!(close(t, -50.0, 0.05) && close(b, 50.0, 0.05));

    let inter = merge(&ops, MergeMode::Intersect);
    assert!(
        close(total_area(&inter), lens, 3.0),
        "{}",
        total_area(&inter)
    );
    let (l, _, rr, _) = bounds(&inter);
    assert!(close(l, 10.0, 0.05) && close(rr, 50.0, 0.05));

    let sub = merge(&ops, MergeMode::Subtract);
    assert!(close(total_area(&sub), disc - lens, 3.0));
    let frag = merge(&ops, MergeMode::Fragment);
    assert_eq!(frag.len(), 3);
    assert_closed(&frag);
}

#[test]
fn rotated_square_intersects_exactly() {
    // A diamond (square turned 45°) with half-diagonal 10 around (10, 10),
    // against the square's axis-aligned twin.
    let diamond = shape(vec![poly(&[
        (10.0, 0.0),
        (20.0, 10.0),
        (10.0, 20.0),
        (0.0, 10.0),
    ])]);
    let square = rect(0.0, 0.0, 20.0, 20.0);
    let inter = merge(&[square.clone(), diamond.clone()], MergeMode::Intersect);
    assert!(close(total_area(&inter), 200.0, 1e-6));
    // The corners outside the diamond.
    let sub = merge(&[square, diamond], MergeMode::Subtract);
    assert!(close(total_area(&sub), 200.0, 1e-6));
    assert_eq!(sub[0].loops.len(), 4);
}

#[test]
fn degenerate_inputs() {
    let a = rect(0.0, 0.0, 10.0, 10.0);
    // The same shape twice.
    assert!(close(
        total_area(&merge(&[a.clone(), a.clone()], MergeMode::Union)),
        100.0,
        1e-6
    ));
    assert!(close(
        total_area(&merge(&[a.clone(), a.clone()], MergeMode::Intersect)),
        100.0,
        1e-6
    ));
    assert!(merge(&[a.clone(), a.clone()], MergeMode::Subtract).is_empty());
    assert!(merge(&[a.clone(), a.clone()], MergeMode::Combine).is_empty());
    // Sharing a side: one rectangle with four sides.
    let b = rect(10.0, 0.0, 10.0, 10.0);
    let union = merge(&[a.clone(), b.clone()], MergeMode::Union);
    assert_eq!(union[0].loops.len(), 1);
    assert_eq!(union[0].loops[0].len(), 4);
    assert!(close(total_area(&union), 200.0, 1e-6));
    assert!(merge(&[a.clone(), b], MergeMode::Intersect).is_empty());
    // Overlapping sides along part of their length.
    let c = rect(5.0, 0.0, 10.0, 10.0);
    let union = merge(&[a.clone(), c], MergeMode::Union);
    assert_eq!(union[0].loops[0].len(), 4);
    assert!(close(total_area(&union), 150.0, 1e-6));
    // Touching at a corner: two loops.
    let d = rect(10.0, 10.0, 10.0, 10.0);
    let union = merge(&[a.clone(), d], MergeMode::Union);
    assert_eq!(union[0].loops.len(), 2);
    // Apart: Intersect leaves nothing.
    assert!(merge(&[a, rect(50.0, 50.0, 1.0, 1.0)], MergeMode::Intersect).is_empty());
    // Nothing at all.
    assert!(merge(&[], MergeMode::Union).is_empty());
    assert!(merge(&[Operand::default(), Operand::default()], MergeMode::Union).is_empty());
}

#[test]
fn non_zero_fill_within_a_shape() {
    // Two overlapping loops running the same way fill their overlap once.
    let both = shape(vec![
        poly(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]),
        poly(&[(5.0, 0.0), (15.0, 0.0), (15.0, 10.0), (5.0, 10.0)]),
    ]);
    let other = rect(100.0, 0.0, 1.0, 1.0);
    assert!(close(
        total_area(&merge(&[both.clone(), other.clone()], MergeMode::Union)),
        151.0,
        1e-6
    ));
    // Separate filled paths of one shape are united too.
    let two_paths = Operand {
        paths: vec![
            FillPath {
                loops: vec![poly(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)])],
            },
            FillPath {
                loops: vec![poly(&[(5.0, 0.0), (15.0, 0.0), (15.0, 10.0), (5.0, 10.0)])],
            },
        ],
    };
    assert!(close(
        total_area(&merge(&[two_paths, other], MergeMode::Combine)),
        151.0,
        1e-6
    ));
}

#[test]
fn bar_across_a_circle_fragments_into_five() {
    let ops = [circle(50.0, 50.0, 40.0), rect(0.0, 45.0, 100.0, 10.0)];
    let frag = merge(&ops, MergeMode::Fragment);
    assert_eq!(frag.len(), 5);
    let union = merge(&ops, MergeMode::Union);
    let pieces = total_area(&frag);
    assert!(close(pieces, total_area(&union), 0.5), "{pieces}");
    // Combine cuts the bar out of the circle and the circle out of the bar.
    let comb = merge(&ops, MergeMode::Combine);
    assert_eq!(comb[0].loops.len(), 4);
}

#[test]
fn many_shapes_and_three_way_modes() {
    let ops = [
        rect(0.0, 0.0, 10.0, 10.0),
        rect(5.0, 0.0, 10.0, 10.0),
        rect(2.0, 5.0, 10.0, 10.0),
    ];
    let inter = merge(&ops, MergeMode::Intersect);
    // Common to all three: x 5..10, y 5..10.
    assert!(close(total_area(&inter), 25.0, 1e-6));
    let sub = merge(&ops, MergeMode::Subtract);
    // The first without the others: x 0..2 × y 0..10, and x 2..5 × y 0..5.
    assert!(close(total_area(&sub), 35.0, 1e-6));
    let comb = merge(&ops, MergeMode::Combine);
    let union = merge(&ops, MergeMode::Union);
    assert!(total_area(&comb) < total_area(&union));
    // Fragment pieces tile the union.
    let frag = merge(&ops, MergeMode::Fragment);
    assert!(close(total_area(&frag), total_area(&union), 1e-6));
}

/// A tiny deterministic generator for the invariant test.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// A star, a turned rectangle, or a turned ellipse at a random place.
fn random_operand(rng: &mut Lcg) -> Operand {
    let (cx, cy) = (rng.next() * 60.0, rng.next() * 60.0);
    let turn = rng.next() * std::f64::consts::TAU;
    let (s, c) = turn.sin_cos();
    let rot = |x: f64, y: f64| pt(cx + x * c - y * s, cy + x * s + y * c);
    match (rng.next() * 3.0) as u32 {
        0 => {
            let n = 5 + (rng.next() * 4.0) as usize;
            let (r0, r1) = (10.0 + rng.next() * 20.0, 3.0 + rng.next() * 8.0);
            let points: Vec<Pt> = (0..2 * n)
                .map(|i| {
                    let a = i as f64 * std::f64::consts::PI / n as f64;
                    let r = if i % 2 == 0 { r0 } else { r1 };
                    rot(r * a.cos(), r * a.sin())
                })
                .collect();
            shape(vec![
                (0..points.len())
                    .map(|i| Seg::Line(points[i], points[(i + 1) % points.len()]))
                    .collect(),
            ])
        }
        1 => {
            let (w, h) = (5.0 + rng.next() * 30.0, 5.0 + rng.next() * 30.0);
            let p = [rot(-w, -h), rot(w, -h), rot(w, h), rot(-w, h)];
            shape(vec![
                (0..4).map(|i| Seg::Line(p[i], p[(i + 1) % 4])).collect(),
            ])
        }
        _ => {
            let (rx, ry) = (5.0 + rng.next() * 25.0, 5.0 + rng.next() * 25.0);
            let k = 0.552_284_749_8;
            let q = |x: f64, y: f64| rot(x * rx, y * ry);
            shape(vec![vec![
                Seg::Cubic(q(1.0, 0.0), q(1.0, k), q(k, 1.0), q(0.0, 1.0)),
                Seg::Cubic(q(0.0, 1.0), q(-k, 1.0), q(-1.0, k), q(-1.0, 0.0)),
                Seg::Cubic(q(-1.0, 0.0), q(-1.0, -k), q(-k, -1.0), q(0.0, -1.0)),
                Seg::Cubic(q(0.0, -1.0), q(k, -1.0), q(1.0, -k), q(1.0, 0.0)),
            ]])
        }
    }
}

#[test]
fn random_shapes_keep_the_area_identities() {
    let mut rng = Lcg(7);
    for round in 0..80 {
        let a = random_operand(&mut rng);
        let b = random_operand(&mut rng);
        let ops = [a.clone(), b.clone()];
        let area_of = |o: &Operand| total_area(&merge(std::slice::from_ref(o), MergeMode::Union));
        let (aa, ab) = (area_of(&a), area_of(&b));
        let union = total_area(&merge(&ops, MergeMode::Union));
        let inter = total_area(&merge(&ops, MergeMode::Intersect));
        let sub = total_area(&merge(&ops, MergeMode::Subtract));
        let comb = total_area(&merge(&ops, MergeMode::Combine));
        let pieces = merge(&ops, MergeMode::Fragment);
        let frag = total_area(&pieces);
        let tol = 0.01 * (aa + ab) + 0.5;
        assert!(
            close(union + inter, aa + ab, tol),
            "round {round}: union {union} + intersect {inter} vs {aa} + {ab}"
        );
        assert!(close(sub, aa - inter, tol), "round {round}: subtract {sub}");
        assert!(
            close(comb, union - inter, tol),
            "round {round}: combine {comb}"
        );
        assert!(
            close(frag, union, tol),
            "round {round}: fragments {frag} vs {union}"
        );
        assert_closed(&pieces);
        assert!(pieces.iter().all(|p| area(&p.loops[0]) > 0.0));
    }
}

#[test]
fn part_of_a_cubic() {
    let c = Seg::Cubic(pt(0.0, 0.0), pt(0.0, 10.0), pt(10.0, 10.0), pt(10.0, 0.0));
    let p = c.part(0.25, 0.75);
    for i in 0..=4 {
        let t = f64::from(i) / 4.0;
        let a = p.at(t);
        let b = c.at(0.25 + 0.5 * t);
        assert!(close(a.x, b.x, 1e-9) && close(a.y, b.y, 1e-9));
    }
    let r = c.part(0.75, 0.25);
    assert_eq!(r.start(), p.end());
}
