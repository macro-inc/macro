use super::*;

fn signed_in() -> ClaudeAccount {
    ClaudeAccount::SignedIn {
        account: Some("ada@example.com".to_owned()),
        expires_at: None,
    }
}

#[test]
fn a_computer_on_macro_credits_chosen_at_setup_never_starts_a_sign_in() {
    assert!(!wants_sign_in(
        ClaudeMode::MacroCredits,
        Some(&ClaudeAccount::SignedOut),
        true
    ));
    assert!(!wants_sign_in(ClaudeMode::MacroCredits, None, true));
}

#[test]
fn an_unfinished_setup_starts_one_until_an_account_is_signed_in() {
    assert!(wants_sign_in(ClaudeMode::MacroCredits, None, false));
    assert!(wants_sign_in(
        ClaudeMode::MacroCredits,
        Some(&ClaudeAccount::SignedOut),
        false
    ));
    assert!(!wants_sign_in(
        ClaudeMode::MacroCredits,
        Some(&signed_in()),
        false
    ));
}

#[test]
fn the_teams_own_account_starts_one_only_once_it_reported_signed_out() {
    assert!(wants_sign_in(
        ClaudeMode::OwnAccount,
        Some(&ClaudeAccount::SignedOut),
        true
    ));
    assert!(!wants_sign_in(ClaudeMode::OwnAccount, None, true));
    assert!(!wants_sign_in(
        ClaudeMode::OwnAccount,
        Some(&signed_in()),
        true
    ));
}
