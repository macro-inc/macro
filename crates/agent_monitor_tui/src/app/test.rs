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
