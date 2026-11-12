use chrono::TimeZone as _;

use super::*;

fn noon() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 11, 12, 0, 0).unwrap()
}

#[test]
fn a_computer_on_macro_credits_chosen_at_setup_never_starts_a_sign_in() {
    let signed_out = Response::SignedOut {
        agent: AgentProvider::Claude,
    };
    assert!(!wants_sign_in(&signed_out, true, noon()));
}

#[test]
fn an_unfinished_setup_starts_one_until_claude_is_signed_in() {
    let signed_out = Response::SignedOut {
        agent: AgentProvider::Claude,
    };
    let signed_in = Response::SignedIn {
        agent: AgentProvider::Claude,
        claude: Some(ClaudeAccount {
            credential_id: "sha256:aaaa".to_owned(),
            expires_at: Some(Utc.with_ymd_and_hms(2027, 11, 11, 12, 0, 0).unwrap()),
        }),
    };
    let pending = Response::Pending {
        agent: AgentProvider::Claude,
    };
    assert!(wants_sign_in(&signed_out, false, noon()));
    assert!(!wants_sign_in(&signed_in, false, noon()));
    assert!(!wants_sign_in(&pending, false, noon()));
}

#[test]
fn an_expired_credential_starts_one_even_after_setup() {
    let expired = Response::SignedIn {
        agent: AgentProvider::Claude,
        claude: Some(ClaudeAccount {
            credential_id: "sha256:aaaa".to_owned(),
            expires_at: Some(Utc.with_ymd_and_hms(2026, 11, 10, 12, 0, 0).unwrap()),
        }),
    };
    assert!(wants_sign_in(&expired, true, noon()));
}
