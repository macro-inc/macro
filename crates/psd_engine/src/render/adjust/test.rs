use super::*;
use crate::model::{HueRange, Rgb};

/// Applies an adjustment to one opaque pixel.
fn one(adjustment: &Adjustment, rgb: [u8; 3]) -> [u8; 3] {
    let mut px = [rgb[0], rgb[1], rgb[2], 255];
    apply(adjustment, &mut px);
    assert_eq!(px[3], 255, "alpha is unchanged");
    [px[0], px[1], px[2]]
}

#[track_caller]
fn near(actual: [u8; 3], expected: [u8; 3], tol: u8) {
    assert!(
        actual
            .iter()
            .zip(&expected)
            .all(|(a, e)| a.abs_diff(*e) <= tol),
        "{actual:?} != {expected:?} (±{tol})"
    );
}

#[test]
fn levels_gamma_and_ranges() {
    let gamma = Adjustment::Levels {
        channels: vec![LevelsChannel {
            gamma: 2.0,
            ..LevelsChannel::default()
        }],
    };
    // 0.25 ^ (1/2) = 0.5.
    near(one(&gamma, [64, 64, 64]), [128, 128, 128], 1);
    near(one(&gamma, [0, 255, 255]), [0, 255, 255], 0);
    // Input range 64..192 stretched to 0..255.
    let stretch = Adjustment::Levels {
        channels: vec![LevelsChannel {
            in_black: 64,
            in_white: 192,
            ..LevelsChannel::default()
        }],
    };
    near(one(&stretch, [64, 128, 192]), [0, 128, 255], 1);
    near(one(&stretch, [10, 250, 100]), [0, 255, 72], 1);
    // Output range, red channel only; the composite applies after it.
    let red = Adjustment::Levels {
        channels: vec![
            LevelsChannel::default(),
            LevelsChannel {
                out_black: 100,
                out_white: 200,
                ..LevelsChannel::default()
            },
        ],
    };
    near(one(&red, [0, 0, 255]), [100, 0, 255], 0);
    near(one(&red, [255, 255, 0]), [200, 255, 0], 0);
}

#[test]
fn curves_pass_smoothly_through_their_points() {
    let curves = Adjustment::Curves {
        channels: vec![(0, vec![(0, 0), (128, 192), (255, 255)])],
    };
    near(one(&curves, [128, 0, 255]), [192, 0, 255], 1);
    // A spline, not straight segments: straight would give 96 at 64.
    let [v, ..] = one(&curves, [64, 64, 64]);
    assert!(v > 100, "{v}");
    // Monotone between the points here.
    let samples: Vec<u8> = (0..=255)
        .step_by(15)
        .map(|i| one(&curves, [i as u8; 3])[0])
        .collect();
    assert!(samples.windows(2).all(|w| w[0] <= w[1]), "{samples:?}");
    // Flat beyond the first and last points.
    let clipped = Adjustment::Curves {
        channels: vec![(1, vec![(50, 20), (200, 230)])],
    };
    near(one(&clipped, [10, 10, 10]), [20, 10, 10], 0);
    near(one(&clipped, [250, 250, 250]), [230, 250, 250], 0);
    // Identity curves change nothing.
    let identity = Adjustment::Curves {
        channels: vec![(0, vec![(0, 0), (255, 255)])],
    };
    assert!(Prepared::new(&identity).is_identity());
}

#[test]
fn hue_shifts_rotate_colors() {
    let shift = |hue: i16| Adjustment::HueSaturation {
        colorize: false,
        colorization: (0, 25, 0),
        master: (hue, 0, 0),
        ranges: Vec::new(),
    };
    near(one(&shift(120), [255, 0, 0]), [0, 255, 0], 1);
    near(one(&shift(-120), [255, 0, 0]), [0, 0, 255], 1);
    // Grays have no hue to shift.
    near(one(&shift(90), [128, 128, 128]), [128, 128, 128], 0);
    // Desaturating fully leaves the HSL lightness.
    let gray = Adjustment::HueSaturation {
        colorize: false,
        colorization: (0, 25, 0),
        master: (0, -100, 0),
        ranges: Vec::new(),
    };
    near(one(&gray, [255, 0, 0]), [128, 128, 128], 1);
    // Colorize: one hue at the given saturation, the pixel's lightness.
    let colorize = Adjustment::HueSaturation {
        colorize: true,
        colorization: (240, 100, 0),
        master: (0, 0, 0),
        ranges: Vec::new(),
    };
    near(one(&colorize, [128, 128, 128]), [0, 0, 255], 1);
}

#[test]
fn hue_ranges_affect_only_their_colors() {
    let reds = HueRange {
        range: [315, 345, 15, 45],
        hue: 120,
        saturation: 0,
        lightness: 0,
    };
    let adj = Adjustment::HueSaturation {
        colorize: false,
        colorization: (0, 25, 0),
        master: (0, 0, 0),
        ranges: vec![reds],
    };
    near(one(&adj, [255, 0, 0]), [0, 255, 0], 1);
    // Blue is outside the reds' range.
    near(one(&adj, [0, 0, 255]), [0, 0, 255], 0);
    // In the falloff, part of the shift.
    let orange = one(&adj, [255, 128, 0]); // hue 30°, half way down the falloff
    assert!(orange[1] > 128 && orange[0] < 255, "{orange:?}");
}

#[test]
fn brightness_contrast() {
    let none = Adjustment::BrightnessContrast {
        brightness: 0,
        contrast: 0,
        legacy: false,
    };
    assert!(Prepared::new(&none).is_identity());
    let brighter = Adjustment::BrightnessContrast {
        brightness: 60,
        contrast: 0,
        legacy: false,
    };
    let [v, ..] = one(&brighter, [128; 3]);
    assert!(v > 140, "{v}");
    // Black and white stay put in the modern mode.
    near(one(&brighter, [0, 255, 0]), [0, 255, 0], 1);
    let contrast = Adjustment::BrightnessContrast {
        brightness: 0,
        contrast: 80,
        legacy: false,
    };
    let [dark, mid, light] = one(&contrast, [60, 128, 196]);
    assert!(
        dark < 60 && light > 196 && mid.abs_diff(128) <= 3,
        "{dark} {mid} {light}"
    );
    // Legacy brightness shifts every level.
    let legacy = Adjustment::BrightnessContrast {
        brightness: 50,
        contrast: 0,
        legacy: true,
    };
    near(one(&legacy, [0, 100, 250]), [50, 150, 255], 1);
}

#[test]
fn exposure_works_in_linear_light() {
    let plus_one = Adjustment::Exposure {
        exposure: 1.0,
        offset: 0.0,
        gamma: 1.0,
    };
    // sRGB 188 is about 0.5 linear; one stop doubles it to white.
    near(one(&plus_one, [188, 188, 188]), [255, 255, 255], 1);
    // sRGB 128 (0.2159 linear) doubles to 0.4317: sRGB 175.6.
    near(one(&plus_one, [128, 0, 0]), [176, 0, 0], 1);
    let minus_one = Adjustment::Exposure {
        exposure: -1.0,
        offset: 0.0,
        gamma: 1.0,
    };
    near(one(&minus_one, [255, 255, 255]), [188, 188, 188], 1);
}

#[test]
fn invert_posterize_threshold() {
    near(one(&Adjustment::Invert, [0, 100, 255]), [255, 155, 0], 0);
    let poster = Adjustment::Posterize { levels: 2 };
    near(one(&poster, [100, 127, 129]), [0, 0, 255], 0);
    let poster4 = Adjustment::Posterize { levels: 4 };
    near(one(&poster4, [0, 70, 255]), [0, 85, 255], 0);
    let threshold = Adjustment::Threshold { level: 128 };
    near(one(&threshold, [127, 127, 127]), [0, 0, 0], 0);
    near(one(&threshold, [128, 128, 128]), [255, 255, 255], 0);
    // By luminosity: pure green (Lum 0.59) is white, pure blue black.
    near(one(&threshold, [0, 255, 0]), [255, 255, 255], 0);
    near(one(&threshold, [0, 0, 255]), [0, 0, 0], 0);
}

#[test]
fn gradient_maps_luminosity_through_the_gradient() {
    let mut g = Gradient::default();
    g.colors[0].color = Rgb::new(1.0, 0.0, 0.0);
    g.colors[1].color = Rgb::new(0.0, 0.0, 1.0);
    let map = Adjustment::GradientMap {
        gradient: g.clone(),
        dither: false,
        reverse: false,
    };
    near(one(&map, [0, 0, 0]), [255, 0, 0], 0);
    near(one(&map, [255, 255, 255]), [0, 0, 255], 0);
    let reversed = Adjustment::GradientMap {
        gradient: g,
        dither: false,
        reverse: true,
    };
    near(one(&reversed, [0, 0, 0]), [0, 0, 255], 0);
}

#[test]
fn color_balance_shifts_tone_ranges() {
    let warm_shadows = Adjustment::ColorBalance {
        shadows: [100, 0, 0],
        midtones: [0; 3],
        highlights: [0; 3],
        preserve_luminosity: false,
    };
    let [r, g, b] = one(&warm_shadows, [40, 40, 40]);
    assert!(r > 80 && g == 40 && b == 40, "{r} {g} {b}");
    // Highlights are out of the shadows' range.
    near(one(&warm_shadows, [230, 230, 230]), [230, 230, 230], 0);
    let preserved = Adjustment::ColorBalance {
        shadows: [0; 3],
        midtones: [0, 0, 60],
        highlights: [0; 3],
        preserve_luminosity: true,
    };
    let out = one(&preserved, [128, 128, 128]);
    assert!(out[2] > out[0], "{out:?}");
    let l = |c: [u8; 3]| {
        (c.iter().max().copied().unwrap() as u16 + c.iter().min().copied().unwrap() as u16) / 2
    };
    assert!(l(out).abs_diff(128) <= 1, "{out:?}");
}

#[test]
fn black_and_white_weights_colors() {
    let bw = Adjustment::BlackWhite {
        weights: [40, 60, 40, 60, 20, 80],
        tint: None,
    };
    // Red alone counts 40%; yellow (red and green) 60%; white fully.
    near(one(&bw, [255, 0, 0]), [102, 102, 102], 1);
    near(one(&bw, [255, 255, 0]), [153, 153, 153], 1);
    near(one(&bw, [255, 255, 255]), [255, 255, 255], 0);
    near(one(&bw, [0, 0, 255]), [51, 51, 51], 1);
    let tinted = Adjustment::BlackWhite {
        weights: [40, 60, 40, 60, 20, 80],
        tint: Some(Rgb::new(0.9, 0.8, 0.6)),
    };
    let out = one(&tinted, [128, 128, 128]);
    assert!(out[0] > out[2], "tinted warm: {out:?}");
}

#[test]
fn photo_filter_channel_mixer_vibrance() {
    let filter = Adjustment::PhotoFilter {
        color: Rgb::new(1.0, 0.5, 0.0),
        density: 0.5,
        preserve_luminosity: false,
    };
    // Half way to the multiplied color.
    near(one(&filter, [200, 200, 200]), [200, 150, 100], 1);
    let swap = Adjustment::ChannelMixer {
        monochrome: false,
        rows: [[0, 0, 100, 0], [0, 100, 0, 0], [100, 0, 0, 0]],
    };
    near(one(&swap, [10, 20, 30]), [30, 20, 10], 0);
    let mono = Adjustment::ChannelMixer {
        monochrome: true,
        rows: [[0, 100, 0, 0], [0; 4], [0; 4]],
    };
    near(one(&mono, [10, 200, 30]), [200, 200, 200], 0);
    let vibrance = Adjustment::Vibrance {
        vibrance: 100,
        saturation: 0,
    };
    near(one(&vibrance, [128, 128, 128]), [128, 128, 128], 0);
    let dull = one(&vibrance, [140, 120, 120]);
    assert!(dull[0] - dull[1] > 20, "{dull:?}");
}

#[test]
fn selective_color_relative_and_absolute() {
    let mut colors = [[0i16; 4]; 9];
    // Reds: +100% cyan.
    colors[0] = [100, 0, 0, 0];
    let relative = Adjustment::SelectiveColor {
        absolute: false,
        colors,
    };
    // Pure red has no cyan ink for a relative change to scale.
    near(one(&relative, [255, 0, 0]), [255, 0, 0], 0);
    let absolute = Adjustment::SelectiveColor {
        absolute: true,
        colors,
    };
    near(one(&absolute, [255, 0, 0]), [0, 0, 0], 0);
    // Blue is not red.
    near(one(&absolute, [0, 0, 255]), [0, 0, 255], 0);
}

#[test]
fn other_adjustments_and_transparency_are_untouched() {
    let other = Adjustment::Other { key: "clrL".into() };
    near(one(&other, [1, 2, 3]), [1, 2, 3], 0);
    let mut px = [10, 20, 30, 0];
    apply(&Adjustment::Invert, &mut px);
    assert_eq!(px[3], 0);
}
