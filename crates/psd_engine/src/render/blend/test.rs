use super::*;

fn approx(a: [f32; 3], b: [f32; 3]) -> bool {
    a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 1e-4)
}

#[track_caller]
fn check(mode: BlendMode, b: [f32; 3], s: [f32; 3], expected: [f32; 3]) {
    let got = blend(mode, b, s);
    assert!(
        approx(got, expected),
        "{mode:?}: B({b:?}, {s:?}) = {got:?}, expected {expected:?}"
    );
}

#[test]
fn separable_modes_match_their_formulas() {
    let b = [0.2, 0.5, 0.8];
    let s = [0.6, 0.3, 0.9];
    check(BlendMode::Normal, b, s, s);
    check(BlendMode::Darken, b, s, [0.2, 0.3, 0.8]);
    check(BlendMode::Lighten, b, s, [0.6, 0.5, 0.9]);
    check(BlendMode::Multiply, b, s, [0.12, 0.15, 0.72]);
    check(BlendMode::Screen, b, s, [0.68, 0.65, 0.98]);
    check(BlendMode::LinearBurn, b, s, [0.0, 0.0, 0.7]);
    check(BlendMode::LinearDodge, b, s, [0.8, 0.8, 1.0]);
    check(BlendMode::Difference, b, s, [0.4, 0.2, 0.1]);
    check(BlendMode::Exclusion, b, s, [0.56, 0.5, 0.26]);
    check(BlendMode::Subtract, b, s, [0.0, 0.2, 0.0]);
    check(BlendMode::Divide, b, s, [1.0 / 3.0, 1.0, 0.8 / 0.9]);
    // Color burn: 1 - (1 - b) / s.
    check(BlendMode::ColorBurn, b, s, [0.0, 0.0, 1.0 - 0.2 / 0.9]);
    // Color dodge: b / (1 - s).
    check(BlendMode::ColorDodge, b, s, [0.5, 0.5 / 0.7, 1.0]);
    // Hard light keys on the source; overlay on the backdrop.
    check(
        BlendMode::HardLight,
        b,
        s,
        [1.0 - 0.8 * 0.8, 0.3, 1.0 - 0.2 * 0.2],
    );
    check(BlendMode::Overlay, b, s, [0.24, 0.3, 1.0 - 2.0 * 0.2 * 0.1]);
    check(BlendMode::PinLight, b, s, [0.2, 0.5, 0.8]);
    check(BlendMode::HardMix, b, s, [0.0, 0.0, 1.0]);
}

#[test]
fn soft_light_uses_the_dark_backdrop_polynomial() {
    // Light source over a dark backdrop: D(b) = ((16b - 12)b + 4)b.
    let b = 0.1f32;
    let d = ((16.0 * b - 12.0) * b + 4.0) * b;
    check(
        BlendMode::SoftLight,
        [b; 3],
        [0.9; 3],
        [b + 0.8 * (d - b); 3],
    );
    // Brighter backdrops take the square root.
    check(BlendMode::SoftLight, [0.64; 3], [1.0; 3], [0.8; 3]);
    // Dark sources darken: b - (1 - 2s)·b·(1 - b).
    check(BlendMode::SoftLight, [0.5; 3], [0.0; 3], [0.25; 3]);
    // Mid gray changes nothing.
    check(BlendMode::SoftLight, [0.3; 3], [0.5; 3], [0.3; 3]);
}

#[test]
fn light_modes_treat_128_as_neutral() {
    let mid = 128.0 / 255.0;
    for mode in [BlendMode::LinearLight, BlendMode::VividLight] {
        for b in [0.0, 0.2, 0.7, 1.0] {
            check(mode, [b; 3], [mid; 3], [b; 3]);
        }
    }
    // Linear light: b + 2s - 256/255.
    check(
        BlendMode::LinearLight,
        [0.5; 3],
        [0.75; 3],
        [0.5 + 1.5 - 256.0 / 255.0; 3],
    );
    // Vivid light: the source's extremes win whatever the backdrop.
    check(BlendMode::VividLight, [1.0; 3], [0.0; 3], [0.0; 3]);
    check(BlendMode::VividLight, [0.0; 3], [1.0; 3], [1.0; 3]);
}

#[test]
fn hard_mix_ties_follow_the_backdrop() {
    let (a, b) = (100.0 / 255.0, 155.0 / 255.0);
    check(BlendMode::HardMix, [a; 3], [b; 3], [0.0; 3]);
    check(BlendMode::HardMix, [b; 3], [a; 3], [1.0; 3]);
}

#[test]
fn darker_and_lighter_color_pick_whole_colors_by_luminosity() {
    let red = [1.0, 0.0, 0.0];
    let gray = [0.4, 0.4, 0.4];
    // Lum(red) = 0.3 < 0.4.
    check(BlendMode::DarkerColor, gray, red, red);
    check(BlendMode::LighterColor, gray, red, gray);
}

#[test]
fn non_separable_modes_follow_set_lum_and_set_sat() {
    let gray = [0.5, 0.5, 0.5];
    let red = [1.0, 0.0, 0.0];
    // A gray backdrop has no saturation to lend: Hue and Saturation of a
    // gray stay gray.
    check(BlendMode::Hue, gray, red, gray);
    check(BlendMode::Saturation, gray, red, gray);
    // Color keeps the backdrop's luminosity: red moved to Lum 0.5,
    // clipped toward its luminosity.
    let c = blend(BlendMode::Color, gray, red);
    assert!((lum(c) - 0.5).abs() < 1e-3, "{c:?}");
    assert!(c[0] > c[1] && (c[1] - c[2]).abs() < 1e-4);
    // Luminosity of a gray source onto red: SetLum(red, 0.5).
    let l = blend(BlendMode::Luminosity, red, gray);
    assert!((lum(l) - 0.5).abs() < 1e-3, "{l:?}");
    // The reference spec's worked case: ClipColor keeps channels in gamut.
    for mode in [
        BlendMode::Hue,
        BlendMode::Saturation,
        BlendMode::Color,
        BlendMode::Luminosity,
    ] {
        let out = blend(mode, [0.9, 0.2, 0.4], [0.1, 0.8, 0.95]);
        assert!(
            out.iter().all(|v| (0.0..=1.0).contains(v)),
            "{mode:?} {out:?}"
        );
    }
    // Hue of blue onto a mid red: the result is blue-hued at red's
    // saturation and luminosity.
    let h = blend(BlendMode::Hue, [0.8, 0.2, 0.2], [0.0, 0.0, 1.0]);
    assert!((lum(h) - lum([0.8, 0.2, 0.2])).abs() < 1e-3);
    assert!(h[2] > h[0] && h[2] > h[1], "{h:?}");
}

/// Photoshop 2026's own render of each mode (`2026-blend-modes`): a layer
/// of `src` over 50% gray, then a color overlay of `ov` with the same mode
/// (interior effects blend onto the composite), as `merged`.
/// A mode, the layer's color, the overlay's, and Photoshop's result.
type Case = (BlendMode, [u8; 3], [u8; 3], [u8; 3]);

const PHOTOSHOP: [Case; 27] = [
    (
        BlendMode::Normal,
        [242, 85, 85],
        [65, 217, 217],
        [65, 217, 217],
    ),
    (
        BlendMode::Dissolve,
        [242, 120, 85],
        [65, 183, 217],
        [65, 183, 217],
    ),
    (
        BlendMode::Darken,
        [242, 155, 85],
        [65, 149, 217],
        [65, 128, 85],
    ),
    (
        BlendMode::Multiply,
        [242, 190, 85],
        [65, 116, 217],
        [31, 43, 37],
    ),
    (
        BlendMode::ColorBurn,
        [242, 225, 85],
        [65, 82, 217],
        [0, 0, 0],
    ),
    (
        BlendMode::LinearBurn,
        [225, 242, 85],
        [82, 65, 217],
        [0, 0, 0],
    ),
    (
        BlendMode::DarkerColor,
        [190, 242, 85],
        [116, 65, 217],
        [116, 65, 217],
    ),
    (
        BlendMode::Lighten,
        [155, 242, 85],
        [149, 65, 217],
        [155, 242, 217],
    ),
    (
        BlendMode::Screen,
        [120, 242, 85],
        [183, 65, 217],
        [236, 251, 242],
    ),
    (
        BlendMode::ColorDodge,
        [85, 242, 85],
        [217, 65, 217],
        [255, 255, 255],
    ),
    (
        BlendMode::LinearDodge,
        [85, 242, 120],
        [217, 65, 183],
        [255, 255, 255],
    ),
    (
        BlendMode::LighterColor,
        [85, 242, 155],
        [217, 65, 149],
        [85, 242, 155],
    ),
    (
        BlendMode::Overlay,
        [85, 242, 190],
        [217, 65, 116],
        [146, 236, 184],
    ),
    (
        BlendMode::SoftLight,
        [85, 242, 225],
        [217, 65, 82],
        [147, 148, 148],
    ),
    (
        BlendMode::HardLight,
        [85, 225, 242],
        [217, 82, 65],
        [204, 145, 123],
    ),
    (
        BlendMode::VividLight,
        [85, 190, 242],
        [217, 116, 65],
        [211, 248, 255],
    ),
    (
        BlendMode::LinearLight,
        [85, 155, 242],
        [217, 149, 65],
        [220, 224, 129],
    ),
    (
        BlendMode::PinLight,
        [85, 120, 242],
        [217, 183, 65],
        [179, 128, 129],
    ),
    (
        BlendMode::HardMix,
        [85, 85, 242],
        [217, 217, 65],
        [0, 0, 255],
    ),
    (
        BlendMode::Difference,
        [120, 85, 242],
        [183, 217, 65],
        [175, 174, 49],
    ),
    (
        BlendMode::Exclusion,
        [155, 85, 242],
        [149, 217, 65],
        [128, 128, 127],
    ),
    (
        BlendMode::Subtract,
        [190, 85, 242],
        [116, 217, 65],
        [0, 0, 0],
    ),
    (
        BlendMode::Divide,
        [225, 85, 242],
        [82, 217, 65],
        [255, 255, 255],
    ),
    (
        BlendMode::Hue,
        [242, 85, 225],
        [65, 217, 82],
        [128, 128, 128],
    ),
    (
        BlendMode::Saturation,
        [242, 85, 190],
        [65, 217, 116],
        [128, 128, 128],
    ),
    (
        BlendMode::Color,
        [242, 85, 155],
        [65, 217, 149],
        [29, 181, 113],
    ),
    (
        BlendMode::Luminosity,
        [242, 85, 120],
        [65, 217, 183],
        [168, 168, 168],
    ),
];

fn unit(c: [u8; 3]) -> [f32; 3] {
    c.map(|v| v as f32 / 255.0)
}

fn byte(c: [f32; 3]) -> [u8; 3] {
    c.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
}

#[test]
fn every_mode_matches_photoshops_render() {
    let gray = unit([128; 3]);
    for (mode, src, ov, merged) in PHOTOSHOP {
        // Photoshop keeps 8-bit results between layers.
        let first = unit(byte(blend(mode, gray, unit(src))));
        let got = byte(blend(mode, first, unit(ov)));
        let ok = got.iter().zip(&merged).all(|(g, m)| g.abs_diff(*m) <= 1);
        assert!(ok, "{mode:?}: {got:?}, Photoshop {merged:?}");
    }
}

#[test]
fn composite_follows_the_w3c_equations() {
    // Normal at half opacity over opaque white.
    let out = composite(BlendMode::Normal, [1.0; 4], [0.0, 0.0, 0.0, 1.0], 0.5);
    assert!(approx([out[0], out[1], out[2]], [0.5; 3]) && out[3] == 1.0);
    // Any mode over transparency is the source itself.
    let src = [0.2, 0.4, 0.6, 0.5];
    for mode in BlendMode::ALL {
        let out = composite(mode, [0.0; 4], src, 1.0);
        assert!(
            approx([out[0], out[1], out[2]], [0.2, 0.4, 0.6]),
            "{mode:?} {out:?}"
        );
        assert!((out[3] - 0.5).abs() < 1e-6);
    }
    // Multiply over a half-transparent backdrop mixes the source with the
    // blend: Cr = (1 - ab)·Cs + ab·Cb·Cs, then source-over.
    let out = composite(
        BlendMode::Multiply,
        [0.5, 0.5, 0.5, 0.5],
        [1.0, 0.0, 0.0, 1.0],
        1.0,
    );
    assert!(
        approx([out[0], out[1], out[2]], [0.75, 0.0, 0.0]),
        "{out:?}"
    );
    assert_eq!(out[3], 1.0);
}

#[test]
fn fill_inside_the_blend_matches_photoshop() {
    // Photoshop's `fill-opacity` reference: blue Normal at 60% opacity,
    // green Linear Light at 40% opacity, red Linear Light at 20% fill.
    let mut px = [0.0f32; 4];
    composite_px(BlendMode::Normal, &mut px, [0.0, 0.0, 1.0], 0.6, 1.0);
    composite_px(BlendMode::LinearLight, &mut px, [0.0, 1.0, 0.0], 0.4, 1.0);
    composite_px(BlendMode::LinearLight, &mut px, [1.0, 0.0, 0.0], 1.0, 0.2);
    let out = unpremultiply(px).map(|v| (v * 255.0).round() as u8);
    let expected = [63u8, 77, 65, 206];
    let ok = out.iter().zip(&expected).all(|(o, e)| o.abs_diff(*e) <= 1);
    assert!(ok, "{out:?}, Photoshop {expected:?}");
    // Normal modes: fill is coverage.
    let mut a = [0.5, 0.5, 0.5, 1.0];
    composite_px(BlendMode::Normal, &mut a, [1.0, 1.0, 1.0], 1.0, 0.5);
    assert!(approx([a[0], a[1], a[2]], [0.75; 3]));
    // Fill 0 keeps the special modes' coverage but leaves the color.
    let mut b = [0.3, 0.3, 0.3, 1.0];
    composite_px(BlendMode::ColorDodge, &mut b, [1.0, 1.0, 1.0], 1.0, 0.0);
    assert!(approx([b[0], b[1], b[2]], [0.3; 3]), "{b:?}");
}

#[test]
fn dissolve_picks_pixels_by_opacity() {
    let src = vec![[1.0, 0.0, 0.0, 1.0]; 4096];
    let mut dst = vec![[0.0, 0.0, 1.0, 1.0]; 4096];
    composite_row(BlendMode::Dissolve, &mut dst, &src, 0.25, 1.0, 0, 0);
    let red = dst.iter().filter(|p| p[0] == 1.0).count() as f32 / 4096.0;
    assert!((red - 0.25).abs() < 0.03, "{red}");
    // Every pixel is wholly one or the other.
    assert!(dst.iter().all(|p| p[0] == 1.0 || p[2] == 1.0));
    // Deterministic per position.
    assert_eq!(dissolve_threshold(10, 20), dissolve_threshold(10, 20));
    assert_ne!(dissolve_threshold(10, 20), dissolve_threshold(11, 20));
}
