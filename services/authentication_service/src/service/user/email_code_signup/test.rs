use std::sync::Mutex;

use serde_json::json;

use super::*;

const FUSIONAUTH_USER_ID: &str = "0198a0e0-0000-7000-8000-000000000001";
const EMAIL: &str = "new@team.example";

/// Records every call; `claim` answers the proof claim.
struct FakePort {
    claim: Result<bool, &'static str>,
    join_fails: bool,
    calls: Mutex<Vec<String>>,
}

impl FakePort {
    fn new(claim: Result<bool, &'static str>) -> Self {
        Self {
            claim,
            join_fails: false,
            calls: Mutex::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    fn record(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }
}

impl EmailCodeSignupPort for FakePort {
    async fn claim_first_proof(
        &self,
        fusionauth_user_id: &str,
        email: &str,
    ) -> anyhow::Result<bool> {
        self.record(format!("claim {fusionauth_user_id} {email}"));
        self.claim.map_err(anyhow::Error::msg)
    }

    async fn join_domain_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<Option<uuid::Uuid>> {
        self.record(format!("join {user_id}"));
        if self.join_fails {
            anyhow::bail!("join failed");
        }
        Ok(Some(uuid::Uuid::nil()))
    }

    async fn track_referral(
        &self,
        user_id: &MacroUserIdStr<'_>,
        referral_code: &str,
    ) -> anyhow::Result<()> {
        self.record(format!("referral {user_id} {referral_code}"));
        Ok(())
    }
}

fn login<'a>(user_data: Option<&'a Value>, referral_code: Option<&'a str>) -> EmailCodeLogin<'a> {
    EmailCodeLogin {
        fusionauth_user_id: FUSIONAUTH_USER_ID,
        email: EMAIL,
        user_data,
        referral_code,
    }
}

#[test]
fn signup_data_marks_email_code_accounts_and_keeps_the_agent_flag() {
    assert_eq!(
        email_code_signup_data(false),
        json!({ "emailCodeSignup": true })
    );
    assert_eq!(
        email_code_signup_data(true),
        json!({ "emailCodeSignup": true, "isAgent": true })
    );
}

#[test]
fn only_the_email_code_marker_counts() {
    assert!(created_by_email_code(Some(&email_code_signup_data(true))));
    assert!(!created_by_email_code(None));
    assert!(!created_by_email_code(Some(&json!({ "isAgent": true }))));
    assert!(!created_by_email_code(Some(
        &json!({ "emailCodeSignup": "true" })
    )));
    assert!(!created_by_email_code(Some(
        &json!({ "emailCodeSignup": false })
    )));
}

#[tokio::test]
async fn first_proof_joins_the_domain_team_and_tracks_the_referral() {
    let port = FakePort::new(Ok(true));
    let data = email_code_signup_data(false);

    let outcome = finish_email_code_signup(&port, login(Some(&data), Some("referrer-code"))).await;

    assert_eq!(outcome, EmailCodeSignupOutcome::FirstProof);
    assert_eq!(
        port.calls(),
        [
            format!("claim {FUSIONAUTH_USER_ID} {EMAIL}"),
            format!("join macro|{EMAIL}"),
            format!("referral macro|{EMAIL} referrer-code"),
        ]
    );
}

#[tokio::test]
async fn first_proof_without_a_referral_code_only_joins() {
    let port = FakePort::new(Ok(true));
    let data = email_code_signup_data(false);

    finish_email_code_signup(&port, login(Some(&data), None)).await;

    assert_eq!(
        port.calls(),
        [
            format!("claim {FUSIONAUTH_USER_ID} {EMAIL}"),
            format!("join macro|{EMAIL}"),
        ]
    );
}

#[tokio::test]
async fn a_later_code_unlocks_nothing() {
    let port = FakePort::new(Ok(false));
    let data = email_code_signup_data(false);

    let outcome = finish_email_code_signup(&port, login(Some(&data), Some("referrer-code"))).await;

    assert_eq!(outcome, EmailCodeSignupOutcome::AlreadyProven);
    assert_eq!(
        port.calls(),
        [format!("claim {FUSIONAUTH_USER_ID} {EMAIL}")]
    );
}

#[tokio::test]
async fn accounts_created_another_way_are_left_alone() {
    let port = FakePort::new(Ok(true));
    let data = json!({ "isAgent": true });

    for user_data in [None, Some(&data)] {
        let outcome =
            finish_email_code_signup(&port, login(user_data, Some("referrer-code"))).await;
        assert_eq!(outcome, EmailCodeSignupOutcome::NotEmailCodeSignup);
    }
    assert!(port.calls().is_empty());
}

#[tokio::test]
async fn a_failed_claim_unlocks_nothing() {
    let port = FakePort::new(Err("database unavailable"));
    let data = email_code_signup_data(false);

    let outcome = finish_email_code_signup(&port, login(Some(&data), Some("referrer-code"))).await;

    assert_eq!(outcome, EmailCodeSignupOutcome::ClaimFailed);
    assert_eq!(
        port.calls(),
        [format!("claim {FUSIONAUTH_USER_ID} {EMAIL}")]
    );
}

#[tokio::test]
async fn a_failed_team_join_still_tracks_the_referral() {
    let port = FakePort {
        join_fails: true,
        ..FakePort::new(Ok(true))
    };
    let data = email_code_signup_data(false);

    let outcome = finish_email_code_signup(&port, login(Some(&data), Some("referrer-code"))).await;

    assert_eq!(outcome, EmailCodeSignupOutcome::FirstProof);
    assert_eq!(
        port.calls().last().map(String::as_str),
        Some(format!("referral macro|{EMAIL} referrer-code").as_str())
    );
}
