use std::time::Duration;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::widgets::Widget;

use super::common::BRAIN;
use super::procedural;
use crate::{Body, Look, PulseKind};

fn body_wearing(name: &str) -> Body {
    let mut body = Body::new();
    assert!(body.select_figure(name), "no figure called {name}");
    body
}

fn render_text(body: &Body) -> String {
    let area = Rect::new(0, 0, 50, 36);
    let mut buffer = Buffer::empty(area);
    body.render(area, &mut buffer);
    (0..area.height)
        .map(|y| {
            (0..area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn the_procedural_figures_follow_the_mesh_man_in_the_catalog() {
    let names: Vec<String> = Body::new().figure_names().map(str::to_owned).collect();
    assert_eq!(names.first().map(String::as_str), Some("MESH MAN"));
    assert_eq!(
        names.get(1..4).map(<[String]>::to_vec),
        Some(vec!["XRAY".to_owned(), "CYBORG".to_owned(), "NEURAL".to_owned()])
    );
}

#[test]
fn every_procedural_nerve_starts_at_the_brain() {
    for figure in procedural() {
        for nerve in &figure.nerves {
            let start = nerve.points.first().copied();
            assert_eq!(start, Some(BRAIN), "{} {}", figure.name, nerve.name);
            assert!(nerve.length() > 0.0, "{} {}", figure.name, nerve.name);
        }
    }
}

#[test]
fn each_procedural_figure_has_its_own_look_and_quiet_paths() {
    let looks: Vec<Look> = procedural().iter().map(|figure| figure.look).collect();
    assert_eq!(looks, vec![Look::Xray, Look::Cyborg, Look::Neural]);
    assert!(procedural().iter().all(|figure| figure.quiet_paths));
}

#[test]
fn neural_fork_groups_name_real_nerves_and_include_themselves() {
    let figure = body_wearing("NEURAL").figure().clone();
    assert_eq!(figure.forks.len(), figure.nerves.len());
    for (index, group) in figure.forks.iter().enumerate() {
        if group.is_empty() {
            continue;
        }
        assert!(group.contains(&index));
        assert!(group.iter().all(|member| *member < figure.nerves.len()));
    }
}

#[test]
fn firing_a_forked_nerve_sends_a_pulse_down_every_branch_but_flashes_once() {
    let mut body = body_wearing("NEURAL");
    let group = body.figure().forks.iter().map(Vec::len).max().unwrap_or(0);
    assert!(group > 3, "a limb forks into several branches");

    body.fire("left_median", PulseKind::ToolStart);
    assert!(body.pulses.len() > 3);
    let mut ends: Vec<usize> = body.pulses.iter().map(|pulse| pulse.nerve).collect();
    ends.dedup();
    assert_eq!(ends.len(), body.pulses.len(), "one pulse per branch");

    body.fire("left_median", PulseKind::Error);
    assert_eq!(body.flashes.len(), 1);
}

#[test]
fn a_classic_body_still_fires_one_pulse() {
    let mut body = Body::new();
    body.fire("left_median", PulseKind::ToolStart);
    assert_eq!(body.pulses.len(), 1);
}

#[test]
fn every_procedural_figure_renders_while_pulsing() {
    for name in ["XRAY", "CYBORG", "NEURAL"] {
        let mut body = body_wearing(name);
        body.set_load(0.6);
        let nerves: Vec<String> = body.nerve_names().map(str::to_owned).collect();
        for nerve in &nerves {
            body.fire(nerve, PulseKind::ToolStart);
        }
        body.tick(Duration::from_millis(400));
        let text = render_text(&body);
        let dots = text.chars().filter(|c| ('\u{2801}'..='\u{28ff}').contains(c)).count();
        assert!(dots > 300, "{name} draws a figure, got {dots} cells");
    }
}

#[test]
fn xray_frame_zero_snapshot() {
    insta::assert_snapshot!(render_text(&body_wearing("XRAY")));
}

#[test]
fn cyborg_frame_zero_snapshot() {
    insta::assert_snapshot!(render_text(&body_wearing("CYBORG")));
}

#[test]
fn neural_frame_zero_snapshot() {
    insta::assert_snapshot!(render_text(&body_wearing("NEURAL")));
}
