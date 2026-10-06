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
