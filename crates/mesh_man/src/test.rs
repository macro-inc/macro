use std::f32::consts::{FRAC_PI_2, TAU};
use std::time::Duration;

use glam::Vec3;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::widgets::Widget;

use crate::model::Model;
use crate::project::{CAMERA_DISTANCE, TILT, View, project};
use crate::{Body, ColorDepth, PulseKind};

fn render_text(body: &Body, width: u16, height: u16) -> String {
    let area = Rect::new(0, 0, width, height);
    let mut buffer = Buffer::empty(area);
    body.render(area, &mut buffer);

    (0..height)
        .map(|y| {
            (0..width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn a_point_on_the_camera_axis_stays_centred() {
    for z in [-1.0, 0.0, 0.7, 2.5] {
        let screen = project(Vec3::new(0.0, 0.0, z), CAMERA_DISTANCE);
        assert_eq!(screen.x, 0.0);
        assert_eq!(screen.y, 0.0);
    }
}

#[test]
fn nearer_points_project_larger() {
    let near = project(Vec3::new(0.5, 0.5, 1.0), CAMERA_DISTANCE);
    let level = project(Vec3::new(0.5, 0.5, 0.0), CAMERA_DISTANCE);
    let far = project(Vec3::new(0.5, 0.5, -1.0), CAMERA_DISTANCE);

    assert!((level.x - 0.5).abs() < 1e-6);
    assert!(near.x > level.x && level.x > far.x);
    assert!((near.x - 0.5 * 4.0 / 3.0).abs() < 1e-6);
    assert!((far.x - 0.5 * 4.0 / 5.0).abs() < 1e-6);
}

#[test]
fn a_full_turn_is_the_identity() {
    let start = View::new(0.0, TILT);
    let turned = View::new(TAU, TILT);
    let point = Vec3::new(0.3, -0.7, 0.2);

    assert!(start.transform(point).distance(turned.transform(point)) < 1e-5);
}

#[test]
fn a_quarter_turn_brings_the_left_side_forward() {
    // A quarter turn backwards (the spin itself goes the other way) moves
    // the figure's left side (+x) toward the camera, with no tilt applied.
    let view = View::new(-FRAC_PI_2, 0.0);
    let turned = view.transform(Vec3::X);

    assert!(turned.distance(Vec3::Z) < 1e-6);
}

#[test]
fn the_figure_fits_inside_the_unit_cube() {
    let model = Model::build();
    let inside = |point: Vec3| point.abs().max_element() <= 1.0;

    for segment in &model.segments {
        assert!(inside(segment.a) && inside(segment.b), "{segment:?}");
    }
    for nerve in &model.nerves {
        for point in &nerve.points {
            assert!(inside(*point), "{} at {point}", nerve.name);
        }
    }
    for (a, b) in &model.brain {
        assert!(inside(*a) && inside(*b));
    }
}

#[test]
fn every_nerve_starts_at_the_brain_and_has_length() {
    let model = Model::build();
    let brain = model.nerves.first().map(|nerve| nerve.points[0]);

    assert!(model.nerves.len() >= 24);
    for nerve in &model.nerves {
        assert_eq!(Some(nerve.points[0]), brain, "{}", nerve.name);
        assert!(nerve.length() > 0.05, "{}", nerve.name);
    }
}

#[test]
fn an_outward_pulse_advances_and_expires_at_the_far_end() {
    let mut body = Body::new();
    body.fire("left_median", PulseKind::ToolStart);
    let length = body.model.nerves[body.nerve_index("left_median")].length();

    assert_eq!(body.pulses.len(), 1);
    assert_eq!(body.pulses[0].position, 0.0);

    body.tick(Duration::from_millis(100));
    let moved = body.pulses[0].position;
    assert!(moved > 0.0 && moved < length);

    body.tick(Duration::from_secs(5));
    assert!(body.pulses.is_empty());
}

#[test]
fn a_result_pulse_runs_back_to_the_brain() {
    let mut body = Body::new();
    body.fire("right_tibial", PulseKind::ToolResult);
    let length = body.model.nerves[body.nerve_index("right_tibial")].length();

    assert_eq!(body.pulses[0].position, length);

    body.tick(Duration::from_millis(100));
    assert!(body.pulses[0].position < length);

    body.tick(Duration::from_secs(5));
    assert!(body.pulses.is_empty());
}

#[test]
fn a_turn_end_flashes_without_a_pulse_and_the_flash_fades() {
    let mut body = Body::new();
    body.fire("vagus", PulseKind::TurnEnd);

    assert!(body.pulses.is_empty());
    assert_eq!(body.flashes.len(), 1);

    body.tick(Duration::from_secs(1));
    assert!(body.flashes.is_empty());
}

#[test]
fn an_error_pulses_back_and_flashes() {
    let mut body = Body::new();
    body.fire("spinal_cord", PulseKind::Error);

    assert_eq!(body.pulses.len(), 1);
    assert_eq!(body.flashes.len(), 1);
}

#[test]
fn any_key_maps_to_the_same_nerve_every_time() {
    let body = Body::new();
    let first = body.nerve_for("agent-7f3a").to_owned();

    assert_eq!(body.nerve_for("agent-7f3a"), first);
    assert!(body.nerve_names().any(|name| name == first));
    assert_eq!(body.nerve_for("vagus"), "vagus");
}

#[test]
fn a_burst_of_events_is_capped() {
    let mut body = Body::new();
    for _ in 0..1000 {
        body.fire("left_radial", PulseKind::Error);
    }

    assert_eq!(body.pulses.len(), 64);
    assert_eq!(body.flashes.len(), 32);
}

#[test]
fn rendering_an_area_outside_the_buffer_does_not_panic() {
    let body = Body::new();
    let mut buffer = Buffer::empty(Rect::new(0, 0, 20, 10));

    (&body).render(Rect::new(10, 5, 40, 30), &mut buffer);
    (&body).render(Rect::new(30, 30, 10, 10), &mut buffer);
}

#[test]
fn load_is_clamped() {
    let mut body = Body::new();

    body.set_load(3.0);
    assert_eq!(body.load, 1.0);
    body.set_load(-1.0);
    assert_eq!(body.load, 0.0);
    body.set_load(f32::NAN);
    assert_eq!(body.load, 0.0);
}

#[test]
fn rendering_a_tiny_area_does_not_panic() {
    let mut body = Body::new();
    body.fire("left_ulnar", PulseKind::Error);

    for (width, height) in [(1, 1), (3, 40), (120, 2), (0, 5)] {
        let area = Rect::new(0, 0, width, height);
        let mut buffer = Buffer::empty(area);
        (&body).render(area, &mut buffer);
    }
}

#[test]
fn frame_zero_snapshot() {
    let body = Body::new();
    insta::assert_snapshot!(render_text(&body, 44, 30));
}

#[test]
fn quarter_turn_snapshot() {
    let mut body = Body::new();
    // A quarter of the 30 s turn.
    body.tick(Duration::from_millis(7500));
    insta::assert_snapshot!(render_text(&body, 44, 30));
}

#[test]
fn colorterm_announces_truecolor_only_for_its_two_values() {
    assert_eq!(
        ColorDepth::from_colorterm(Some("truecolor")),
        ColorDepth::TrueColor
    );
    assert_eq!(
        ColorDepth::from_colorterm(Some("24bit")),
        ColorDepth::TrueColor
    );
    assert_eq!(
        ColorDepth::from_colorterm(Some("256color")),
        ColorDepth::Indexed
    );
    assert_eq!(ColorDepth::from_colorterm(None), ColorDepth::Indexed);
}

#[test]
fn indexed_colours_pick_the_nearest_cube_or_grey() {
    use crate::widget::indexed;
    assert_eq!(indexed((0, 0, 0)), 16);
    assert_eq!(indexed((255, 255, 255)), 231);
    assert_eq!(indexed((255, 0, 0)), 196);
    // Amber lands on the cube's orange, a mid grey on the ramp.
    assert_eq!(indexed((255, 165, 43)), 214);
    assert_eq!(indexed((128, 128, 128)), 244);
}

#[test]
fn an_indexed_body_draws_only_indexed_colours() {
    use ratatui::style::Color;
    let mut body = Body::new();
    body.set_color_depth(ColorDepth::Indexed);
    let area = ratatui::layout::Rect::new(0, 0, 40, 24);
    let mut buffer = ratatui::buffer::Buffer::empty(area);
    ratatui::widgets::Widget::render(&body, area, &mut buffer);
    assert!(
        buffer
            .content()
            .iter()
            .all(|cell| !matches!(cell.fg, Color::Rgb(..))),
        "no truecolor cell"
    );
    assert!(
        buffer
            .content()
            .iter()
            .any(|cell| matches!(cell.fg, Color::Indexed(_)))
    );
}
