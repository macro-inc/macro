use crossterm::event::{KeyEventState, KeyModifiers};
use serde_json::json;

use super::*;

fn key(code: KeyCode, modifiers: KeyModifiers) -> TermEvent {
    TermEvent::Key(KeyEvent {
        code,
        modifiers,
        kind: KeyEventKind::Press,
        state: KeyEventState::NONE,
    })
}

fn press(view: &mut PaneView, code: KeyCode) -> PaneAction {
    view.on_event(key(code, KeyModifiers::NONE))
}

fn update(view: &mut PaneView, update: Value) {
    view.apply(ToPane::Update { update });
}

#[test]
fn streamed_output_folds_into_readable_entries() {
    let mut view = PaneView::new("s");
    view.apply(ToPane::Prompted {
        text: "fix it".to_owned(),
    });
    update(
        &mut view,
        json!({"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "hmm "}}),
    );
    update(
        &mut view,
        json!({"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "ok"}}),
    );
    update(
        &mut view,
        json!({"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Read main.rs", "status": "in_progress"}),
    );
    update(
        &mut view,
        json!({"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed"}),
    );
    update(
        &mut view,
        json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Done"}}),
    );
    update(
        &mut view,
        json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "."}}),
    );
    // Live prompts arrive as `Prompted`; an echoed user chunk is not doubled.
    update(
        &mut view,
        json!({"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": "fix it"}}),
    );

    assert_eq!(
        view.transcript.entries,
        [
            Entry::User("fix it".to_owned()),
            Entry::Thought("hmm ok".to_owned()),
            Entry::Tool {
                id: "t1".to_owned(),
                title: "Read main.rs".to_owned(),
                status: "completed".to_owned(),
            },
            Entry::Agent("Done.".to_owned()),
        ]
    );
}

#[test]
fn replayed_history_shows_user_messages() {
    let mut view = PaneView::new("s");
    update(
        &mut view,
        json!({"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": "earlier"}}),
    );
    update(
        &mut view,
        json!({"sessionUpdate": "plan", "entries": [{"content": "a", "status": "completed"}]}),
    );
    update(
        &mut view,
        json!({"sessionUpdate": "plan", "entries": [{"content": "a", "status": "completed"}, {"content": "b", "status": "pending"}]}),
    );
    assert_eq!(
        view.transcript.entries,
        [
            Entry::User("earlier".to_owned()),
            Entry::Plan(vec![
                ("a".to_owned(), "completed".to_owned()),
                ("b".to_owned(), "pending".to_owned()),
            ]),
        ]
    );
}

#[test]
fn enter_sends_the_prompt_and_clears_the_input() {
    let mut view = PaneView::new("s");
    assert_eq!(press(&mut view, KeyCode::Enter), PaneAction::Nothing);
    for ch in "hi there".chars() {
        press(&mut view, KeyCode::Char(ch));
    }
    assert_eq!(
        press(&mut view, KeyCode::Enter),
        PaneAction::Send(FromPane::Prompt {
            text: "hi there".to_owned()
        })
    );
    assert_eq!(view.input.value(), "");
}

#[test]
fn ctrl_c_interrupts_a_turn_and_otherwise_closes() {
    let mut view = PaneView::new("s");
    let ctrl_c = || key(KeyCode::Char('c'), KeyModifiers::CONTROL);
    view.apply(ToPane::State {
        state: AgentState::Working,
        detail: None,
    });
    assert_eq!(view.on_event(ctrl_c()), PaneAction::Send(FromPane::Stop));
    assert_eq!(
        press(&mut view, KeyCode::Esc),
        PaneAction::Send(FromPane::Stop)
    );

    view.apply(ToPane::State {
        state: AgentState::Idle,
        detail: Some("cancelled".to_owned()),
    });
    assert_eq!(press(&mut view, KeyCode::Esc), PaneAction::Nothing);
    assert_eq!(view.on_event(ctrl_c()), PaneAction::Quit);
    assert_eq!(
        view.transcript.entries.last(),
        Some(&Entry::Stopped("cancelled".to_owned()))
    );
}

#[test]
fn permission_requests_are_answered_in_place() {
    let mut view = PaneView::new("s");
    let choice = |id: &str, kind: &str| PermissionChoice {
        option_id: id.to_owned(),
        name: id.to_owned(),
        kind: kind.to_owned(),
    };
    view.apply(ToPane::Permission {
        request_id: json!("req-1"),
        title: Some("Run tests".to_owned()),
        options: vec![
            choice("allow", "allow_once"),
            choice("reject", "reject_once"),
        ],
    });

    // Typing does not leak into the prompt while a request is open.
    press(&mut view, KeyCode::Char('x'));
    assert_eq!(view.input.value(), "");

    press(&mut view, KeyCode::Down);
    assert_eq!(
        press(&mut view, KeyCode::Enter),
        PaneAction::Send(FromPane::Answer {
            request_id: json!("req-1"),
            option_id: Some("reject".to_owned()),
        })
    );
    assert_eq!(
        press(&mut view, KeyCode::Char('1')),
        PaneAction::Send(FromPane::Answer {
            request_id: json!("req-1"),
            option_id: Some("allow".to_owned()),
        })
    );
    assert_eq!(
        press(&mut view, KeyCode::Esc),
        PaneAction::Send(FromPane::Answer {
            request_id: json!("req-1"),
            option_id: None,
        })
    );

    view.apply(ToPane::PermissionSettled);
    assert!(view.permission.is_none());
}

#[test]
fn wrap_breaks_on_words_and_splits_long_ones() {
    use crate::tui::ui::wrap_for_test as wrap;
    assert_eq!(wrap("the quick brown fox", 9), ["the quick", "brown fox"]);
    assert_eq!(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"]);
    assert_eq!(wrap("a\n\nb", 10), ["a", "", "b"]);
}
