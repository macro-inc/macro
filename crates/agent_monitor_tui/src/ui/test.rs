use std::time::Duration;

use chrono::{FixedOffset, TimeDelta, TimeZone, Utc};
use ratatui::Terminal;
use ratatui::backend::TestBackend;

use agent_monitor::domain::model::{
    PrId, RepoName, Timestamp, TranscriptItem, TranscriptItemKind, Update, UpdateKind,
};
use agent_monitor::outbound::demo;

use super::*;
use crate::app::{App, ChangeRow, ChangeTab};
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
        let mut row = String::new();
        for x in 0..buffer.area.width {
            row.push_str(buffer[(x, y)].symbol());
        }
        text.push_str(row.trim_end());
        text.push('\n');
    }
    text
}

#[test]
fn monitor_200x56() {
    insta::assert_snapshot!(render(&mut app(), 200, 56));
}

#[test]
fn monitor_wide_240x60_grows_the_body() {
    insta::assert_snapshot!(render(&mut app(), 240, 60));
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
fn changes_240x45() {
    let mut app = app();
    app.key(Key::Char('8'));
    insta::assert_snapshot!(render(&mut app, 240, 45));
}

#[test]
fn changes_200x56() {
    let mut app = app();
    app.key(Key::Char('8'));
    insta::assert_snapshot!(render(&mut app, 200, 56));
}

#[test]
fn changes_narrow_100x30() {
    let mut app = app();
    app.key(Key::Char('8'));
    insta::assert_snapshot!(render(&mut app, 100, 30));
}

#[test]
fn changes_compact_80x24() {
    let mut app = app();
    app.key(Key::Char('8'));
    insta::assert_snapshot!(render(&mut app, 80, 24));
}

#[test]
fn changes_failing_lane_selected_and_enter_drills_into_the_author() {
    let mut app = app();
    app.key(Key::Char('8'));
    // `n` jumps to the lane whose CI fails: the demo's ui-pages at this step.
    app.key(Key::Char('n'));
    insta::assert_snapshot!(render(&mut app, 240, 45));
    app.key(Key::Enter);
    let Page::Agent(author) = app.page().clone() else {
        panic!("Enter opens the lane's agent");
    };
    assert_eq!(app.view.name_of(&author), "ui-pages");
}

#[test]
fn changes_without_repositories_lists_the_prs_and_enter_opens_the_author() {
    let mut app = app();
    app.view.repos.clear();
    app.key(Key::Char('8'));
    let screen = render(&mut app, 240, 45);
    insta::assert_snapshot!(screen);
    let first = app.view.sorted_prs(&app.filter)[0].clone();
    assert!(screen.contains(&format!("#{}", first.number)), "{screen}");
    // The cursor starts on the first pull request, not the second.
    assert_eq!(app.change_row(), Some(ChangeRow::Pr(first.id.clone())));
    app.key(Key::Enter);
    assert_eq!(
        app.page(),
        &Page::Agent(
            ViewState::pr_agent(&first)
                .cloned()
                .expect("the demo PR has an author")
        )
    );
}

#[test]
fn changes_puts_a_pr_in_an_unmapped_repository_on_its_own_tab() {
    let mut app = app();
    let mut other = app
        .view
        .sorted_prs(&app.filter)
        .into_iter()
        .find(|pr| !pr.state.is_final())
        .cloned()
        .expect("an open demo PR");
    other.repo = RepoName::parse("elsewhere/tools").expect("a repository name");
    other.number = 42;
    other.id = PrId::from_wire(String::from("elsewhere/tools#42"));
    other.title = Some(String::from("Pin the toolchain"));
    app.view.prs.insert(other.id.clone(), other.clone());
    app.key(Key::Char('8'));
    let mapped = render(&mut app, 240, 45);
    assert!(mapped.contains(" other PRs 1 "), "{mapped}");
    assert!(app.change_repo().is_some());

    while app.change_tab() != Some(ChangeTab::OtherPrs) {
        app.key(Key::Char(']'));
    }
    let screen = render(&mut app, 240, 45);
    insta::assert_snapshot!(screen);
    assert_eq!(app.change_rows(), vec![ChangeRow::Pr(other.id.clone())]);
    app.key(Key::Enter);
    assert!(matches!(app.page(), Page::Agent(_)));
}

#[test]
fn lane_detail_200x56() {
    let mut app = app();
    app.key(Key::Char('8'));
    app.key(Key::Char('n'));
    app.key(Key::Char('p'));
    assert!(matches!(app.page(), Page::Lane(..)));
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
fn ctrl_t_names_the_new_theme_in_the_footer() {
    let mut app = app();
    app.key(Key::NextTheme);
    let screen = render(&mut app, 200, 56);
    let footer = screen.lines().last().unwrap_or_default();
    assert!(footer.contains("THEME EMBER"), "{footer}");
    assert_eq!(app.theme, crate::theme::ThemeName::Ember);
}

#[test]
fn help_overlay() {
    let mut app = app();
    app.key(Key::Char('?'));
    let screen = render(&mut app, 200, 56);
    assert!(screen.contains("filter words: kind, status, name, task or program"));
    assert!(screen.contains("clear shared filters"));
}
