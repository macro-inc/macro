#[cfg(test)]
mod test;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tui_input::{Input, InputRequest};

pub(crate) fn handle_text_input(input: &mut Input, key: KeyEvent) {
    let request = match (key.code, key.modifiers) {
        (KeyCode::Backspace, KeyModifiers::NONE) => Some(InputRequest::DeletePrevChar),
        (KeyCode::Delete, KeyModifiers::NONE) => Some(InputRequest::DeleteNextChar),
        (KeyCode::Left, KeyModifiers::NONE) => Some(InputRequest::GoToPrevChar),
        (KeyCode::Right, KeyModifiers::NONE) => Some(InputRequest::GoToNextChar),
        (KeyCode::Left, KeyModifiers::CONTROL) => Some(InputRequest::GoToPrevWord),
        (KeyCode::Right, KeyModifiers::CONTROL) => Some(InputRequest::GoToNextWord),
        (KeyCode::Home, KeyModifiers::NONE) | (KeyCode::Char('a'), KeyModifiers::CONTROL) => {
            Some(InputRequest::GoToStart)
        }
        (KeyCode::End, KeyModifiers::NONE) | (KeyCode::Char('e'), KeyModifiers::CONTROL) => {
            Some(InputRequest::GoToEnd)
        }
        (KeyCode::Char('w'), KeyModifiers::CONTROL) => Some(InputRequest::DeletePrevWord),
        (KeyCode::Char('u'), KeyModifiers::CONTROL) => Some(InputRequest::DeleteLine),
        (KeyCode::Char('k'), KeyModifiers::CONTROL) => Some(InputRequest::DeleteTillEnd),
        (KeyCode::Char(ch), KeyModifiers::NONE | KeyModifiers::SHIFT) => {
            Some(InputRequest::InsertChar(ch))
        }
        _ => None,
    };
    if let Some(request) = request {
        input.handle(request);
    }
}
