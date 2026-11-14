use std::time::Duration;

use chrono::{FixedOffset, TimeDelta, TimeZone, Utc};
use ratatui::Terminal;
use ratatui::backend::TestBackend;

use agent_monitor::domain::model::{
    Timestamp, TranscriptItem, TranscriptItemKind, Update, UpdateKind,
};
use agent_monitor::outbound::demo;

use super::*;
use crate::app::App;
use crate::body::Vitals;
use crate::keys::{Key, Page};
use crate::view::ViewState;

const STEPS: u32 = 400;
const STEP: Duration = Duration::from_millis(250);

fn start() -> Timestamp {
    Utc.with_ymd_and_hms(2026, 1, 2, 10, 0, 0)
        .single()
        .expect("a valid fixed time")
}

fn clock() -> Clock {
    Clock {
        now: start() + TimeDelta::seconds(100),
        offset: FixedOffset::east_opt(0).expect("UTC is a valid offset"),
    }
}

/// The seeded demo fleet after 400 steps, at a fixed clock.
fn app() -> App {
    let snapshot = demo::snapshot(7, start(), STEP, STEPS);
    let mut view = ViewState::new(Box::new(Vitals::default()));
    view.apply(Update {
        seq: 1,
        kind: UpdateKind::Snapshot(snapshot),
    });
    App::new(view, Some(String::from("DEMO")))
}

fn render(app: &mut App, width: u16, height: u16) -> String {
    let mut terminal =
        Terminal::new(TestBackend::new(width, height)).expect("a test terminal never fails");
    terminal
        .draw(|frame| draw(frame, app, clock()))
        .expect("drawing to a test terminal never fails");

    let buffer = terminal.backend().buffer();
    let mut text = String::new();
    for y in 0..buffer.area.height {
        for x in 0..buffer.area.width {
            text.push_str(buffer[(x, y)].symbol());
        }
        text.push('\n');
    }
    text
}

#[test]
fn monitor_200x56() {
    insta::assert_snapshot!(render(&mut app(), 200, 56));
}

#[test]
fn monitor_narrow_100x30() {
    insta::assert_snapshot!(render(&mut app(), 100, 30));
}

#[test]
fn monitor_one_column_80x24() {
    insta::assert_snapshot!(render(&mut app(), 80, 24));
}

#[test]
fn wall_200x56() {
    let mut app = app();
    app.key(Key::Char('w'));
    insta::assert_snapshot!(render(&mut app, 200, 56));
}

#[test]
fn tree_200x56() {
    let mut app = app();
    app.key(Key::Char('5'));
    insta::assert_snapshot!(render(&mut app, 200, 56));
}

#[test]
fn drill_in_200x56() {
    let mut app = app();

    // The agent with the most children, so the children list fills.
    let parent = app
        .view
        .agents
        .values()
        .max_by_key(|agent| (agent.children.len(), agent.id.clone()))
        .map(|agent| agent.id.clone())
        .expect("the demo fleet has agents");
    app.pages.push(Page::Agent(parent.clone()));
    app.view.open_transcript(parent.clone());

    let at = |second: i64| start() + TimeDelta::seconds(second);
    let items = [
        (
            at(2),
            TranscriptItemKind::User,
            "Run the store tests and fix what fails.",
            None,
            None,
            false,
            None,
        ),
        (
            at(5),
            TranscriptItemKind::Assistant,
            "Running the tests first.",
            None,
            None,
            false,
            None,
        ),
        (
            at(6),
            TranscriptItemKind::ToolCall,
            "cargo test -p store",
            Some("t1"),
            Some("Bash"),
            false,
            None,
        ),
        (
            at(40),
            TranscriptItemKind::ToolResult,
            "1 failed: replay_orders",
            Some("t1"),
            Some("Bash"),
            true,
            Some(34_000),
        ),
        (
            at(42),
            TranscriptItemKind::ToolCall,
            "src/store.rs",
            Some("t2"),
            Some("Read"),
            false,
            None,
        ),
        (
            at(43),
            TranscriptItemKind::ToolResult,
            "fn replay(...)",
            Some("t2"),
            Some("Read"),
            false,
            Some(300),
        ),
        (
            at(90),
            TranscriptItemKind::ToolCall,
            "src/store.rs: keep insertion order",
            Some("t3"),
            Some("Edit"),
            false,
            None,
        ),
    ];
    for (at, kind, text, tool_id, tool_name, is_error, duration_ms) in items {
        app.view.transcript_item(
            &parent,
            TranscriptItem {
                at,
                kind,
                text: text.to_owned(),
                tool_id: tool_id.map(str::to_owned),
                tool_name: tool_name.map(str::to_owned),
                is_error,
                duration_ms,
            },
        );
    }
    app.cursors.expanded.insert(String::from("t1"));

    insta::assert_snapshot!(render(&mut app, 200, 56));
}

#[test]
fn help_overlay() {
    let mut app = app();
    app.key(Key::Char('?'));
    let screen = render(&mut app, 200, 56);
    assert!(screen.contains("AGT builder working"));
}
