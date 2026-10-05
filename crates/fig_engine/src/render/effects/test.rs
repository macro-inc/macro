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
