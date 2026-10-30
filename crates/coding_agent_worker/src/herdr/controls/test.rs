use super::*;

#[test]
fn unknown_questions_cannot_be_approved_by_pressing_enter() {
    assert_eq!(approve_key(TuiAgent::Codex, "Please sign in"), None);
    assert_eq!(
        approve_key(TuiAgent::Claude, "Which repository?\n1. Yes"),
        None
    );
    assert_eq!(
        approve_key(
            TuiAgent::Codex,
            "Would you like to run this?\n1. Yes, proceed (y)"
        ),
        Some("y")
    );
}

#[test]
fn local_answers_and_replaced_dialogs_invalidate_remote_replies() {
    assert!(same_dialog("approve A", "approve A", 3, 3, "blocked"));
    assert!(!same_dialog("approve A", "approve A", 3, 4, "blocked"));
    assert!(!same_dialog("approve A", "approve B", 3, 3, "blocked"));
    assert!(!same_dialog("approve A", "approve A", 3, 3, "working"));
}

#[test]
fn dont_ask_again_answers_are_found_with_the_key_that_picks_them() {
    let codex = "Would you like to run the following command?\n\n  $ cargo test\n\n› 1. Yes, proceed (y)\n  2. Yes, and don't ask again for commands that start with `cargo test` (p)\n  3. No, and tell Codex what to do differently (esc)\n";
    assert_eq!(
        always_choice(TuiAgent::Codex, codex),
        Some(NativeAlways {
            key: "p".to_owned(),
            name: "Yes, and don't ask again for commands that start with `cargo test`".to_owned(),
        })
    );
    let claude = " Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don't ask again for ls commands in /repo\n   3. No, and tell Claude what to do differently (esc)\n";
    assert_eq!(
        always_choice(TuiAgent::Claude, claude),
        Some(NativeAlways {
            key: "2".to_owned(),
            name: "Yes, and don't ask again for ls commands in /repo".to_owned(),
        })
    );
    let claude_edits = " Do you want to make this edit to a.rs?\n ❯ 1. Yes\n   2. Yes, allow all edits during this session (shift+tab)\n   3. No\n";
    assert_eq!(
        always_choice(TuiAgent::Claude, claude_edits),
        Some(NativeAlways {
            key: "2".to_owned(),
            name: "Yes, allow all edits during this session".to_owned(),
        })
    );
    // Without a one-key shortcut (a wrapped line), Codex's answer can't be pressed.
    assert_eq!(
        always_choice(
            TuiAgent::Codex,
            "› 1. Yes, proceed (y)\n  2. Yes, and don't ask again for commands that start with\n"
        ),
        None
    );
    assert_eq!(
        always_choice(TuiAgent::Codex, "› 1. Yes, proceed (y)\n  2. No (esc)\n"),
        None
    );
}

#[test]
fn only_claudes_exit_confirmation_is_dismissed_to_stay() {
    let exit = "  Background work is running\n  The following will stop when you exit:\n  shell · Sleep for 30 seconds in background\n  ❯ 1. Exit and stop tasks\n    2. Move to background and exit\n    3. Stay\n  Enter to confirm · Esc to cancel\n";
    assert!(exit_confirmation(TuiAgent::Claude, exit));
    assert!(!exit_confirmation(TuiAgent::Codex, exit));
    assert!(!exit_confirmation(
        TuiAgent::Claude,
        " Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel\n"
    ));
}
