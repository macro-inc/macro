use super::*;

/// One box blur pass by definition: each output is the rounded mean of the
/// `2r + 1` inputs around it along a line, with zeros outside.
fn reference_pass<const C: usize>(
    src: &[u8],
    w: usize,
    h: usize,
    r: usize,
    horizontal: bool,
) -> Vec<u8> {
    let d = (2 * r + 1) as u32;
    let mut out = vec![0u8; src.len()];
    for y in 0..h {
        for x in 0..w {
            for c in 0..C {
                let mut sum = 0u32;
                for k in -(r as i64)..=r as i64 {
                    let (sx, sy) = if horizontal {
                        (x as i64 + k, y as i64)
                    } else {
                        (x as i64, y as i64 + k)
                    };
                    if sx >= 0 && sy >= 0 && (sx as usize) < w && (sy as usize) < h {
                        sum += u32::from(src[(sy as usize * w + sx as usize) * C + c]);
                    }
                }
                out[(y * w + x) * C + c] = ((sum + d / 2) / d) as u8;
            }
        }
    }
    out
}

fn noise(len: usize) -> Vec<u8> {
    let mut x = 0x2545_f491u32;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            (x >> 24) as u8
        })
        .collect()
}

fn check<const C: usize>(w: usize, h: usize, r: usize) {
    let src = noise(w * h * C);
    let expected = reference_pass::<C>(&reference_pass::<C>(&src, w, h, r, true), w, h, r, false);
    let mut data = src.clone();
    let mut tmp = vec![0u8; data.len()];
    box_pass::<C>(&mut data, &mut tmp, w, r);
    assert_eq!(data, expected, "{C} channels, {w}x{h}, radius {r}");
}

#[test]
fn box_passes_match_their_definition() {
    for &(w, h) in &[(1, 1), (7, 3), (19, 11), (40, 2)] {
        for r in [1, 2, 5, 9, 30] {
            check::<1>(w, h, r);
            check::<4>(w, h, r);
        }
    }
}

#[test]
fn divisors_are_exact_below_the_bound() {
    for d in [1u32, 3, 5, 7, 255, 1001, 65_535] {
        let divisor = Divisor::new(d);
        let limit = (255 * (d + 1)).min(1 << 24);
        let step = (limit / 50_000).max(1);
        for n in (0..limit).step_by(step as usize).chain(limit - 64..limit) {
            assert_eq!(divisor.div(n), n / d, "{n} / {d}");
        }
    }
}

/// Bilinear resampling by definition, in floating point.
fn reference_resample(
    src: &[u8],
    (sw, sh): (usize, usize),
    (dw, dh): (usize, usize),
    k: f64,
    (ox, oy): (f64, f64),
) -> Vec<f64> {
    let at = |i: f64, j: f64| -> f64 {
        if i < 0.0 || j < 0.0 || i >= sw as f64 || j >= sh as f64 {
            0.0
        } else {
            f64::from(src[j as usize * sw + i as usize])
        }
    };
    let mut out = Vec::with_capacity(dw * dh);
    for y in 0..dh {
        for x in 0..dw {
            let u = ox + (x as f64 + 0.5) / k - 0.5;
            let v = oy + (y as f64 + 0.5) / k - 0.5;
            let (i, j) = (u.floor(), v.floor());
            let (s, t) = (u - i, v - j);
            out.push(
                (1.0 - t) * ((1.0 - s) * at(i, j) + s * at(i + 1.0, j))
                    + t * ((1.0 - s) * at(i, j + 1.0) + s * at(i + 1.0, j + 1.0)),
            );
        }
    }
    out
}

#[test]
fn resampling_matches_bilinear_filtering() {
    let (sw, sh) = (13, 9);
    let src = noise(sw * sh);
    for (k, origin, (dw, dh)) in [
        (1.0, (0.0, 0.0), (13, 9)),
        (1.0, (-0.37, 0.81), (15, 11)),
        (4.0, (0.0, 0.0), (52, 36)),
        (4.0, (2.6, -1.3), (40, 30)),
        (16.0, (-0.75, 3.25), (100, 64)),
    ] {
        let mut dst = vec![0u8; dw * dh];
        resample::<1>(&src, (sw, sh), &mut dst, dw, k, origin);
        let expected = reference_resample(&src, (sw, sh), (dw, dh), k, origin);
        for (n, (&got, want)) in dst.iter().zip(&expected).enumerate() {
            assert!(
                (f64::from(got) - want).abs() <= 1.0,
                "{k}× from {origin:?}: pixel {} of {dw}: {got} for {want:.2}",
                n
            );
        }
    }
    // Channels resample alike.
    let rgba: Vec<u8> = src.iter().flat_map(|&v| [v, v / 2, v / 3, v]).collect();
    let mut one = vec![0u8; 40 * 30];
    let mut four = vec![0u8; 40 * 30 * 4];
    resample::<1>(&src, (sw, sh), &mut one, 40, 4.0, (2.6, -1.3));
    resample::<4>(&rgba, (sw, sh), &mut four, 40, 4.0, (2.6, -1.3));
    for (a, px) in one.iter().zip(four.chunks_exact(4)) {
        assert_eq!((*a, px[3]), (px[0], *a));
        assert!(px[1] <= px[3] && px[2] <= px[3], "stays premultiplied");
    }
}

#[test]
fn fractional_spreads_lie_between_whole_ones() {
    let (w, h) = (24, 18);
    let mut base = vec![0u8; w * h];
    for y in 6..12 {
        for x in 8..15 {
            base[y * w + x] = 255;
        }
    }
    base[4 * w + 3] = 128;
    let spread_to = |r: f32| {
        let mut a = base.clone();
        spread_by(&mut a, w, h, r);
        a
    };
    let whole = |r: i32| {
        let mut a = base.clone();
        spread(&mut a, w, h, r);
        a
    };
    for r in [-2, -1, 0, 1, 3] {
        assert_eq!(spread_to(r as f32), whole(r), "spread {r}");
    }
    for (r, lo, hi) in [(1.25, 1, 2), (-1.5, -2, -1), (-0.25, -1, 0), (2.75, 2, 3)] {
        let (a, b, got) = (whole(lo), whole(hi), spread_to(r));
        for ((&a, &b), &g) in a.iter().zip(&b).zip(&got) {
            assert!(
                a.min(b) <= g && g <= a.max(b),
                "spread {r}: {g} not within {a}..{b}"
            );
        }
        assert_ne!(got, a, "spread {r} moves past {lo}");
        assert_ne!(got, b, "spread {r} stops short of {hi}");
    }
}
