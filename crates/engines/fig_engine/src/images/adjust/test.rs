use super::*;

fn filters(f: impl FnOnce(&mut ImageFilters)) -> ImageFilters {
    let mut out = ImageFilters::default();
    f(&mut out);
    out
}

fn gray(v: f32, f: &ImageFilters) -> f32 {
    adjust([v, v, v], f)[0]
}

#[test]
fn no_adjustments_change_nothing() {
    let f = ImageFilters::default();
    for v in [0.0, 0.25, 0.5, 1.0] {
        assert_eq!(adjust([v, v * 0.5, 1.0 - v], &f), [v, v * 0.5, 1.0 - v]);
    }
}

#[test]
fn exposure_follows_the_measured_mid_tone_response() {
    // At exposure 0.5 Figma maps 124 to about 220 and keeps white white.
    let f = filters(|f| f.exposure = 0.5);
    assert!((gray(MID_TONE, &f) * 255.0 - 220.0).abs() < 1.5);
    assert!(
        (gray(8.0 / 255.0, &f) * 255.0 - 23.0).abs() < 2.0,
        "shadows lift"
    );
    assert!(gray(1.0, &f) > 0.999);
    // Negative exposure darkens the mid-tone to the measured ratio.
    let f = filters(|f| f.exposure = -0.5);
    assert!((gray(MID_TONE, &f) / MID_TONE - 0.379).abs() < 0.005);
}

#[test]
fn contrast_saturates_at_half() {
    let half = filters(|f| f.contrast = 0.5);
    let full = filters(|f| f.contrast = 1.0);
    assert_eq!(gray(0.8, &half), gray(0.8, &full));
    assert!(gray(0.8, &half) > 0.8, "brighter above the pivot");
    assert!(gray(0.2, &half) < 0.2, "darker below it");
}

#[test]
fn saturation_minus_one_is_grayscale() {
    let f = filters(|f| f.saturation = -1.0);
    let [r, g, b] = adjust([0.9, 0.2, 0.1], &f);
    assert!((r - g).abs() < 1e-5 && (g - b).abs() < 1e-5);
}

#[test]
fn tint_and_temperature_shift_hues() {
    let magenta = adjust([0.5; 3], &filters(|f| f.tint = 1.0));
    assert!(magenta[0] > magenta[1], "tint moves away from green");
    let warm = adjust([0.5; 3], &filters(|f| f.temperature = 1.0));
    assert!(
        warm[0] > 0.5 && warm[2] < 0.5,
        "warmer is redder, less blue"
    );
}

#[test]
fn applies_to_premultiplied_pixels() {
    let mut p = Pixmap::new(1, 1).unwrap();
    p.fill(tiny_skia::Color::from_rgba8(124, 124, 124, 255));
    apply(&mut p, &filters(|f| f.exposure = 0.5));
    let c = p.pixel(0, 0).unwrap();
    assert!((i32::from(c.red()) - 220).abs() <= 2, "{}", c.red());
    assert_eq!(c.alpha(), 255);
}
