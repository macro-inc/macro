use crate::body::Vitals;
use crate::keys::{Key, Mode, Page, Pane};
use crate::view::LaneSort;
use crate::view::ViewState;

use super::*;

fn app() -> App {
    App::new(ViewState::new(Box::new(Vitals::default())), None)
}

fn type_line(app: &mut App, line: &str) {
    for character in line.chars() {
        app.key(Key::Char(character));
    }
    app.key(Key::Enter);
}

#[test]
fn filters_belong_to_their_page_and_leave_monitor_unfiltered() {
    use agent_monitor::domain::model::{AgentKind, Status};
    let mut app = changes_app();
    app.key(Key::Char('1'));
    app.key(Key::Char('t'));
    app.key(Key::Char('t'));
    app.key(Key::Char('s'));
    assert_eq!(app.filter.kind, Some(AgentKind::Builder));
    assert_eq!(app.filter.status, Some(Status::Working));
    let rows = app.view.sorted_agents(&app.filter);
    assert!(!rows.is_empty());
    assert!(
        rows.iter()
            .all(|agent| agent.kind == AgentKind::Builder && agent.status == Status::Working)
    );
    type_line(&mut app, "/task");
    let agents_filter = app.filter.clone();
    app.key(Key::Char('/'));
    app.key(Key::Backspace);
    app.key(Key::Esc);
    assert_eq!(app.filter, agents_filter);

    app.key(Key::Char('2'));
    assert_eq!(app.filter, Filter::default());
    type_line(&mut app, "/error");
    app.key(Key::Esc);
    assert_eq!(*app.page(), Page::Zoom(Pane::Agents));
    assert_eq!(app.filter, agents_filter);
    app.key(Key::Char('0'));
    for key in ['/', 't', 's', 'a', 'x'] {
        app.key(Key::Char(key));
    }
    assert_eq!(app.mode, Mode::default());
    assert_eq!(app.filter, Filter::default());
    app.key(Key::Char('1'));
    assert_eq!(app.filter, agents_filter);
    app.key(Key::Char('x'));
    assert_eq!(app.filter, Filter::default());
    app.key(Key::Char('2'));
    assert_eq!(app.filter.find, "error");
}

#[test]
fn a_toggles_and_esc_walks_back_one_page() {
    let mut app = app();
    app.key(Key::Char('1'));
    app.key(Key::Char('a'));
    assert!(app.filter.all);
    app.key(Key::Char('a'));
    assert!(!app.filter.all);

    app.key(Key::Char('0'));
    app.key(Key::Char('w'));
    app.key(Key::Char('5'));
    assert_eq!(*app.page(), Page::Tree);
    app.key(Key::Esc);
    assert_eq!(*app.page(), Page::Wall);
    app.key(Key::Esc);
    assert_eq!(*app.page(), Page::Monitor);
    app.key(Key::Esc);
    assert_eq!(*app.page(), Page::Monitor);
}

#[test]
fn ctrl_t_cycles_every_theme_and_names_it_until_the_next_key() {
    use strum::IntoEnumIterator as _;

    let mut app = app();
    assert_eq!(app.theme, ThemeName::Classic);
    let mut seen = vec![app.theme];
    for _ in 1..ThemeName::iter().count() {
        app.key(Key::NextTheme);
        assert!(app.theme_notice);
        seen.push(app.theme);
    }
    assert_eq!(seen, ThemeName::iter().collect::<Vec<_>>());

    app.key(Key::NextTheme);
    assert_eq!(app.theme, ThemeName::Classic, "wraps around");
    app.key(Key::Down);
    assert!(!app.theme_notice);
}

/// The demo fleet's state, on the CHANGES page.
fn changes_app() -> App {
    let start = chrono::TimeZone::with_ymd_and_hms(&chrono::Utc, 2026, 1, 2, 10, 0, 0)
        .single()
        .expect("a time");
    let snapshot = agent_monitor::outbound::demo::snapshot(
        7,
        start,
        std::time::Duration::from_millis(250),
        400,
    );
    let mut view = ViewState::new(Box::new(Vitals::default()));
    view.apply(agent_monitor::domain::model::Update {
        seq: 1,
        kind: agent_monitor::domain::model::UpdateKind::Snapshot(snapshot),
    });
    let mut app = App::new(view, None);
    app.key(Key::Char('8'));
    app
}

#[test]
fn changes_keys_move_lanes_commits_zoom_pan_and_toggles() {
    let mut app = changes_app();
    assert_eq!(*app.page(), Page::Zoom(Pane::Changes));
    let first = app.change_row();
    assert!(
        matches!(first, Some(ChangeRow::Lane(_))),
        "the cursor starts on the first lane"
    );

    app.key(Key::Up);
    assert_eq!(app.change_row(), Some(ChangeRow::Trunk));
    app.key(Key::Down);
    app.key(Key::Down);
    assert_ne!(app.change_row(), first);

    // ← walks back through the lane's commits, → returns to the tip.
    app.key(Key::Left);
    assert!(app.cursors.changes.commit.is_some());
    app.key(Key::Right);
    assert_eq!(app.cursors.changes.commit, None);

    app.cursors.changes.drawn_zoom = 2;
    app.key(Key::Char('+'));
    assert_eq!(app.cursors.changes.zoom, Some(1));
    app.key(Key::Char('-'));
    assert_eq!(app.cursors.changes.zoom, Some(3));
    app.key(Key::Char('<'));
    app.key(Key::Char('<'));
    assert_eq!(app.cursors.changes.pan, 32);
    app.key(Key::Char('>'));
    assert_eq!(app.cursors.changes.pan, 16);
    app.key(Key::Home);
    assert_eq!(app.cursors.changes.pan, 0);
    app.key(Key::Char('m'));
    assert!(app.cursors.changes.hide_landed);
    app.key(Key::Char('s'));
    assert_eq!(app.cursors.changes.sort, LaneSort::Attention);
    // These controls stay in the base mode.
    assert_eq!(app.mode, Mode::default());
}

#[test]
fn n_finds_the_failing_lane_and_enter_opens_its_author_or_p_its_page() {
    let mut app = changes_app();
    app.key(Key::Char('n'));
    let Some(ChangeRow::Lane(branch)) = app.change_row() else {
        panic!("n lands on a lane");
    };
    assert_eq!(branch, "feat/ui-pages");

    app.key(Key::Char('p'));
    assert!(matches!(app.page(), Page::Lane(_, lane) if *lane == branch));
    app.key(Key::Esc);
    app.key(Key::Enter);
    let Page::Agent(agent) = app.page().clone() else {
        panic!("Enter opens the lane's agent");
    };
    assert_eq!(app.view.name_of(&agent), "ui-pages");
}

#[test]
fn the_cursor_stays_on_its_lane_when_a_new_lane_appears_above_it() {
    let mut app = changes_app();
    app.key(Key::Down);
    app.key(Key::Down);
    let chosen = app.change_row();
    let mut graph = app.change_repo().cloned().expect("the demo repository");
    let mut newest = graph.lanes[0].clone();
    newest.branch = String::from("feat/brand-new");
    if let agent_monitor::domain::model::LaneBase::Trunk { at, .. } = &mut newest.base {
        *at += chrono::TimeDelta::minutes(30);
    }
    newest.agents.clear();
    newest.pr = None;
    graph.lanes.insert(0, newest);
    app.view.apply(agent_monitor::domain::model::Update {
        seq: 10_000,
        kind: agent_monitor::domain::model::UpdateKind::RepoUpsert(graph),
    });
    assert!(
        app.change_rows()
            .contains(&ChangeRow::Lane(String::from("feat/brand-new")))
    );
    assert_eq!(app.change_row(), chosen);
}

#[test]
fn spend_page_can_reach_every_agent_cost() {
    let mut app = changes_app();
    let agents = app.view.agents.len();
    assert!(agents > app.view.spend_by_kind().len());
    app.key(Key::Char('3'));
    app.key(Key::End);
    assert_eq!(app.cursors.spend_agent, agents - 1);
    app.key(Key::Up);
    assert_eq!(app.cursors.spend_agent, agents - 2);
    app.key(Key::Home);
    assert_eq!(app.cursors.spend_agent, 0);
    assert_eq!(app.cursors.spend, 0);
}
