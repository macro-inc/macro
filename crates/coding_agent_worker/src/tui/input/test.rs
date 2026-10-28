use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tui_input::Input;

use super::handle_text_input;

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

#[test]
fn text_input_supports_cursor_movement_and_insertion() {
    let mut input: Input = "ac".into();

    handle_text_input(&mut input, key(KeyCode::Left));
    handle_text_input(&mut input, key(KeyCode::Char('b')));

    assert_eq!(input.value(), "abc");
    assert_eq!(input.cursor(), 2);
}
