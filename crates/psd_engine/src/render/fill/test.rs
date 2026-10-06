use super::*;
use crate::model::{Pattern, Rgb};
use std::sync::Arc;

/// A black-to-white gradient without easing, so positions read directly.
fn ramp(kind: GradientKind, angle: f32) -> Gradient {
    Gradient {
        kind,
        angle,
        smoothness: 0.0,
        ..Gradient::default()
    }
}

/// The gradient position (red channel) at canvas pixel `(x, y)`.
fn t_at(g: &Gradient, frame: IRect, x: i32, y: i32) -> f32 {
    let doc = Document::new(1, 1);
    let px = paint(
        &doc,
        &Fill::Gradient {
            gradient: g.clone(),
        },
        frame,
        0,
        IRect::new(x, y, 1, 1),
    );
    px[0][0]
}

#[track_caller]
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.02, "{a} vs {b}");
}

#[test]
fn solid_fills_paint_one_color() {
    let doc = Document::new(1, 1);
    let px = paint(
        &doc,
        &Fill::Solid {
            color: Rgb::new(1.0, 0.5, 0.0),
        },
        IRect::new(0, 0, 1, 1),
        0,
        IRect::new(0, 0, 2, 1),
    );
    assert_eq!(px, vec![[1.0, 0.5, 0.0, 1.0]; 2]);
}

#[test]
fn linear_gradients_span_the_frame_along_their_angle() {
    let frame = IRect::new(0, 0, 100, 50);
    // 0°: left (start) to right (end).
    let g = ramp(GradientKind::Linear, 0.0);
    near(t_at(&g, frame, 0, 25), 0.005);
    near(t_at(&g, frame, 49, 25), 0.495);
    near(t_at(&g, frame, 99, 25), 0.995);
    // 90°: bottom to top.
    let up = ramp(GradientKind::Linear, 90.0);
    near(t_at(&up, frame, 50, 49), 0.01);
    near(t_at(&up, frame, 50, 0), 0.99);
    // Scale shortens the run around the center; beyond it, the ends.
    let half = Gradient {
        scale: 0.5,
        ..g.clone()
    };
    near(t_at(&half, frame, 20, 25), 0.0);
    near(t_at(&half, frame, 37, 25), 0.25);
    near(t_at(&half, frame, 49, 25), 0.49);
    near(t_at(&half, frame, 80, 25), 1.0);
    // Reversed runs end to start.
    let rev = Gradient {
        reverse: true,
        ..g.clone()
    };
    near(t_at(&rev, frame, 0, 25), 0.995);
    // Offsets move the center by fractions of the frame.
    let moved = Gradient {
        offset: (0.25, 0.0),
        ..g
    };
    near(t_at(&moved, frame, 74, 25), 0.495);
}

#[test]
fn diagonal_gradients_run_along_the_frames_chord() {
    // Photoshop's run is the frame's chord through the center: at 45° on
    // a 100×50 frame it ends where the line meets the top and bottom.
    let frame = IRect::new(0, 0, 100, 50);
    let g = ramp(GradientKind::Linear, 45.0);
    let half_chord = 25.0 * std::f32::consts::SQRT_2;
    // A point on the direction line, `d` from the center (y points down).
    let at = |d: f32| {
        let (x, y) = (
            50.0 + d / std::f32::consts::SQRT_2,
            25.0 - d / std::f32::consts::SQRT_2,
        );
        t_at(
            &g,
            frame,
            (x - 0.5).round() as i32,
            (y - 0.5).round() as i32,
        )
    };
    near(at(0.0), 0.5);
    assert!((at(half_chord * 0.5) - 0.75).abs() < 0.03);
}

#[test]
fn radial_reflected_diamond_and_angle_shapes() {
    let frame = IRect::new(0, 0, 100, 100);
    let radial = ramp(GradientKind::Radial, 90.0);
    near(t_at(&radial, frame, 50, 50), 0.01);
    // Radius: half the chord (50 px).
    near(t_at(&radial, frame, 74, 50), 0.49);
    near(t_at(&radial, frame, 50, 74), 0.49);
    near(t_at(&radial, frame, 95, 95), 1.0);
    let reflected = ramp(GradientKind::Reflected, 0.0);
    near(t_at(&reflected, frame, 24, 10), 0.51);
    near(t_at(&reflected, frame, 75, 90), 0.51);
    let diamond = ramp(GradientKind::Diamond, 0.0);
    // |dx| + |dy| over the half chord.
    near(t_at(&diamond, frame, 59, 59), 0.38);
    let angle = ramp(GradientKind::Angle, 0.0);
    // Clockwise from the angle: a quarter turn down from the right.
    near(t_at(&angle, frame, 50, 90), 0.25);
    near(t_at(&angle, frame, 10, 50), 0.5);
}

#[test]
fn gradient_colors_follow_stops() {
    let mut g = ramp(GradientKind::Linear, 0.0);
    g.colors[0].color = Rgb::new(1.0, 0.0, 0.0);
    g.colors[1].color = Rgb::new(0.0, 0.0, 1.0);
    g.opacities[1].opacity = 0.0;
    let gp = GradientPaint::new(&g, IRect::new(0, 0, 10, 10));
    let mid = gp.color(0.5);
    assert!(
        (mid[0] - 0.5).abs() < 0.01 && (mid[2] - 0.5).abs() < 0.01 && (mid[3] - 0.5).abs() < 0.01
    );
}

fn checker() -> Pattern {
    // 2×2: red, green / blue, white.
    let rgba: Vec<u8> = [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 255, 255],
    ]
    .concat();
    Pattern {
        id: "p".into(),
        name: "checker".into(),
        width: 2,
        height: 2,
        rgba: Arc::from(rgba),
    }
}

fn pattern_fill(scale: f32, phase: (f32, f32)) -> Fill {
    Fill::Pattern {
        pattern: PatternFill {
            pattern: "p".into(),
            name: String::new(),
            scale,
            angle: 0.0,
            align_with_layer: true,
            phase,
        },
    }
}

#[test]
fn patterns_repeat_from_the_canvas_origin() {
    let mut doc = Document::new(8, 8);
    doc.patterns.push(checker());
    let frame = IRect::new(3, 3, 4, 4);
    let px = paint(
        &doc,
        &pattern_fill(1.0, (0.0, 0.0)),
        frame,
        0,
        IRect::new(0, 0, 4, 2),
    );
    let rgb = |p: [f32; 4]| [p[0], p[1], p[2]];
    assert_eq!(rgb(px[0]), [1.0, 0.0, 0.0]);
    assert_eq!(rgb(px[1]), [0.0, 1.0, 0.0]);
    assert_eq!(rgb(px[2]), [1.0, 0.0, 0.0]);
    assert_eq!(rgb(px[4]), [0.0, 0.0, 1.0]);
    // Phase shifts the tiles.
    let shifted = paint(
        &doc,
        &pattern_fill(1.0, (1.0, 0.0)),
        frame,
        0,
        IRect::new(0, 0, 2, 1),
    );
    assert_eq!(rgb(shifted[0]), [0.0, 1.0, 0.0]);
    // Scale 2 doubles the period, resampled bilinearly.
    let big = paint(
        &doc,
        &pattern_fill(2.0, (0.0, 0.0)),
        frame,
        0,
        IRect::new(0, 0, 8, 1),
    );
    assert_eq!(big[0], big[4]);
    assert_eq!(big[1], big[5]);
    assert!(
        big[1][0] > 0.6 && big[1][1] < 0.3,
        "mostly red: {:?}",
        big[1]
    );
    assert!(big[3][1] > 0.6, "mostly green: {:?}", big[3]);
    // A missing pattern paints nothing.
    let none = paint(
        &Document::new(1, 1),
        &pattern_fill(1.0, (0.0, 0.0)),
        frame,
        0,
        IRect::new(0, 0, 1, 1),
    );
    assert_eq!(none[0][3], 0.0);
}
