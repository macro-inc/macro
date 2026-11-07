use super::*;

/// Premultiplied pixels of every sort: clear, opaque, and in between.
fn pixels(w: u32, h: u32, seed: u32) -> Pixmap {
    let mut p = Pixmap::new(w, h).unwrap();
    let mut x = seed;
    for px in p.data_mut().chunks_exact_mut(4) {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        let a = match x % 5 {
            0 => 0,
            1 => 255,
            _ => (x >> 8) as u8,
        };
        px[3] = a;
        for (k, c) in px[..3].iter_mut().enumerate() {
            *c = ((u32::from(a) * ((x >> (10 + 5 * k)) & 0xff)) / 255) as u8;
        }
    }
    p
}

fn mask(w: u32, h: u32) -> Mask {
    let mut m = Mask::new(w, h).unwrap();
    for (k, v) in m.data_mut().iter_mut().enumerate() {
        *v = [0, 255, 7, 128, 200][k % 5];
    }
    m
}

/// The largest channel difference between `draw_over` and tiny-skia's
/// `draw_pixmap`.
fn worst(opacity: f32, masked: bool, at: (i32, i32)) -> u8 {
    let src = pixels(37, 23, 7);
    let base = pixels(41, 29, 11);
    let m = mask(41, 29);
    let m = masked.then_some(&m);
    let mut ours = base.clone();
    draw_over(&mut ours, src.as_ref(), at, opacity, m);
    // tiny-skia draws a row past a source placed above the destination's
    // top (repeating its last), so it gets the part that shows.
    let (cx, cy) = ((-at.0).max(0), (-at.1).max(0));
    let shown = src
        .clone_rect(
            tiny_skia::IntRect::from_xywh(
                cx,
                cy,
                src.width() - cx as u32,
                src.height() - cy as u32,
            )
            .unwrap(),
        )
        .unwrap();
    let mut theirs = base;
    theirs.draw_pixmap(
        at.0.max(0),
        at.1.max(0),
        shown.as_ref(),
        &PixmapPaint {
            opacity,
            blend_mode: BlendMode::SourceOver,
            quality: tiny_skia::FilterQuality::Nearest,
        },
        Transform::identity(),
        m,
    );
    ours.data()
        .iter()
        .zip(theirs.data())
        .map(|(a, b)| a.abs_diff(*b))
        .max()
        .unwrap()
}

#[test]
fn divides_by_255() {
    for x in 0..65535 {
        assert_eq!(div255(x), x / 255, "{x}");
    }
}

#[test]
fn blends_as_tiny_skia_does() {
    for at in [(0, 0), (3, -2), (-5, 9), (20, 15)] {
        assert_eq!(worst(1.0, false, at), 0, "opaque at {at:?}");
        for (opacity, masked) in [(0.37, false), (1.0, true), (0.6, true)] {
            let d = worst(opacity, masked, at);
            assert!(
                d <= 1,
                "opacity {opacity}, masked {masked}, at {at:?}: off by {d}"
            );
        }
    }
}

#[test]
fn keeps_pixels_premultiplied() {
    let src = pixels(16, 16, 3);
    let mut dst = pixels(16, 16, 5);
    draw_over(&mut dst, src.as_ref(), (0, 0), 0.8, Some(&mask(16, 16)));
    for px in dst.data().chunks_exact(4) {
        assert!(px[..3].iter().all(|&c| c <= px[3]), "{px:?}");
    }
}
