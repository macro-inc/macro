use std::sync::Mutex;

use mcp_auth_proxy::domain::models::AccessToken;
use onboarding::domain::models::OnboardingStatus;

use super::*;
use crate::public_mcp::test_support::{
    FakeAccounts, FakeOnboarding, MemoryStore, onboarding_row, user,
};

struct FixedIdentity;

impl TokenIdentity for FixedIdentity {
    fn user_of(&self, _access_token: &str) -> Option<MacroUserIdStr<'static>> {
        Some(user())
    }
}

#[derive(Default)]
struct FakeInbox {
    outcome: Option<FirstInboxProvisionOutcome>,
    calls: Mutex<Vec<String>>,
}

impl FirstInboxProvisioner for FakeInbox {
    async fn provision_first_inbox(
        &self,
        access_token: &str,
    ) -> anyhow::Result<FirstInboxProvisionOutcome> {
        self.calls.lock().unwrap().push(access_token.to_owned());
        self.outcome
            .ok_or_else(|| anyhow::anyhow!("email service unavailable"))
    }
}

struct Fixture {
    sign_in: AgentSignIn<FixedIdentity, FakeInbox, FakeOnboarding, FakeAccounts, MemoryStore>,
    inbox: Arc<FakeInbox>,
    onboarding: Arc<FakeOnboarding>,
    accounts: FakeAccounts,
    attribution: ClientAttribution<MemoryStore>,
}

fn fixture(
    inbox: Option<FirstInboxProvisionOutcome>,
    onboarding: FakeOnboarding,
    accounts: FakeAccounts,
) -> Fixture {
    let inbox = Arc::new(FakeInbox {
        outcome: inbox,
        ..FakeInbox::default()
    });
    let onboarding = Arc::new(onboarding);
    let attribution = ClientAttribution::new(MemoryStore::default());
    Fixture {
        sign_in: AgentSignIn::new(
            Arc::new(FixedIdentity),
            inbox.clone(),
            AgentHandover::new(onboarding.clone(), accounts.clone()),
            attribution.clone(),
            McpTelemetry::disabled(),
        ),
        inbox,
        onboarding,
        accounts,
        attribution,
    }
}

fn sign_in(client_name: &str) -> SignIn {
    SignIn {
        access_token: AccessToken::from("fresh-access-token"),
        client_id: "client-1".to_owned(),
        client_name: Some(client_name.to_owned()),
    }
}

#[tokio::test]
async fn a_new_signup_gets_its_inbox_and_is_handed_to_the_agent() {
    let fixture = fixture(
        Some(FirstInboxProvisionOutcome::Provisioned),
        FakeOnboarding::default(),
        FakeAccounts::with_tutorial(&[Some(false)]),
    );

    fixture
        .sign_in
        .after_sign_in(user(), sign_in("claude-code"))
        .await;

    assert_eq!(
        fixture.inbox.calls.lock().unwrap().as_slice(),
        &["fresh-access-token".to_owned()]
    );
    assert_eq!(
        fixture.onboarding.markings.lock().unwrap().as_slice(),
        &[Some("claude-code".to_owned())]
    );
    assert_eq!(*fixture.accounts.completed.lock().unwrap(), 1);
}

#[tokio::test]
async fn the_sign_in_attributes_the_token_to_its_registered_client() {
    let fixture = fixture(
        Some(FirstInboxProvisionOutcome::Skipped),
        FakeOnboarding::default(),
        FakeAccounts::with_tutorial(&[Some(false)]),
    );

    fixture
        .sign_in
        .after_sign_in(user(), sign_in("claude-code"))
        .await;

    let client = fixture
        .attribution
        .client_for("fresh-access-token", user().as_ref())
        .await
        .expect("attributed");
    assert_eq!(client.name.as_deref(), Some("claude-code"));
}

#[tokio::test]
async fn an_inbox_failure_still_hands_the_account_over() {
    // No Gmail grant, or the email service is down: setup continues and the
    // setup tools offer a "connect Gmail" handoff instead.
    let fixture = fixture(
        None,
        FakeOnboarding::default(),
        FakeAccounts::with_tutorial(&[Some(false)]),
    );

    fixture
        .sign_in
        .after_sign_in(user(), sign_in("codex"))
        .await;

    assert_eq!(fixture.onboarding.markings.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn an_existing_web_user_signing_in_from_an_agent_keeps_their_account_as_is() {
    let fixture = fixture(
        Some(FirstInboxProvisionOutcome::Skipped),
        FakeOnboarding {
            existing: Some(onboarding_row(OnboardingStatus::Completed, false)),
            ..FakeOnboarding::default()
        },
        FakeAccounts::with_tutorial(&[Some(true)]),
    );

    fixture
        .sign_in
        .after_sign_in(user(), sign_in("claude-ai"))
        .await;

    assert!(fixture.onboarding.markings.lock().unwrap().is_empty());
    assert_eq!(*fixture.accounts.completed.lock().unwrap(), 0);
}

#[tokio::test]
async fn an_account_someone_already_had_is_left_alone_on_an_agent_sign_in() {
    // Never finished web onboarding, but has had Macro for weeks: no inbox is
    // added and nothing about their onboarding changes.
    let fixture = fixture(
        Some(FirstInboxProvisionOutcome::Provisioned),
        FakeOnboarding::default(),
        FakeAccounts::existing(&[Some(false)], 21),
    );

    fixture
        .sign_in
        .after_sign_in(user(), sign_in("claude-ai"))
        .await;

    assert!(fixture.inbox.calls.lock().unwrap().is_empty());
    assert!(fixture.onboarding.markings.lock().unwrap().is_empty());
    assert_eq!(*fixture.accounts.completed.lock().unwrap(), 0);
}
