use crate::body::Vitals;
use crate::keys::{Key, Page, Pane};
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
fn all_on_the_command_line_lists_ended_agents() {
    let mut app = app();
    type_line(&mut app, "AGT all builder");
    assert!(app.filter.all);
    assert_eq!(app.filter.words, vec![String::from("builder")]);
    assert_eq!(*app.page(), Page::Zoom(Pane::Agents));

    // A command without it lists current agents again.
    type_line(&mut app, "AGT");
    assert!(!app.filter.all);
    assert!(app.filter.words.is_empty());
}

#[test]
fn a_toggles_and_esc_walks_back_one_page() {
    let mut app = app();
    app.key(Key::Char('a'));
    assert!(app.filter.all);
    app.key(Key::Char('a'));
    assert!(!app.filter.all);

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

#[test]
fn the_theme_command_switches_theme_or_reports_an_unknown_one() {
    let mut app = app();
    for key in "THEME phosphor".chars().map(Key::Char) {
        app.key(key);
    }
    app.key(Key::Enter);
    assert_eq!(app.theme, ThemeName::Phosphor);
    assert!(app.theme_notice);

    for key in "THEME neon".chars().map(Key::Char) {
        app.key(key);
    }
    app.key(Key::Enter);
    assert_eq!(app.theme, ThemeName::Phosphor);
    assert_eq!(
        app.message.as_deref(),
        Some("UNKNOWN THEME: neon (classic, ember, phosphor, dusk)")
    );
}
