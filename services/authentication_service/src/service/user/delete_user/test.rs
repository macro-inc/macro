use super::*;
use std::sync::Mutex;

#[derive(Default)]
struct FakeGateway {
    calls: Mutex<Vec<String>>,
    fail_at: Option<usize>,
}

impl FakeGateway {
    fn call(&self, name: &str, user: &str) -> Result<(), Report> {
        let mut calls = self.calls.lock().unwrap();
        calls.push(format!("{name}:{user}"));
        if self.fail_at == Some(calls.len()) {
            return Err(rootcause::report!("injected cleanup failure"));
        }
        Ok(())
    }
}

impl UserDeletionGateway for FakeGateway {
    async fn list_profiles(&self, _: &Uuid) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.call("profiles", "")?;
        Ok(users())
    }
    async fn delete_scheduled_actions(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.call("actions", user.as_ref())
    }
    async fn delete_agent_sessions(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.call("sessions", user.as_ref())
    }
    async fn leave_teams(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.call("teams", user.as_ref())
    }
    async fn delete_items(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.call("items", user.as_ref())
    }
    async fn delete_profile(&self, user: &MacroUserIdStr<'static>, _: &Uuid) -> Result<(), Report> {
        self.call("profile", user.as_ref())
    }
    async fn delete_account(&self, _: &Uuid) -> Result<(), Report> {
        self.call("account", "")
    }
    async fn delete_identity(&self, _: &Uuid) -> Result<(), Report> {
        self.call("identity", "")
    }
}

fn users() -> Vec<MacroUserIdStr<'static>> {
    ["a@example.com", "b@example.com"]
        .into_iter()
        .map(|email| MacroUserIdStr::try_from_email(email).unwrap())
        .collect()
}

fn expected_calls() -> Vec<String> {
    let mut expected = Vec::new();
    for user in users() {
        for step in ["actions", "sessions", "teams", "items", "profile"] {
            expected.push(format!("{step}:{user}"));
        }
    }
    expected.push("account:".into());
    expected
}

fn expected_requested_calls() -> Vec<String> {
    let mut expected = vec!["profiles:".to_string()];
    for user in users() {
        for step in ["actions", "sessions", "teams", "items"] {
            expected.push(format!("{step}:{user}"));
        }
    }
    expected.push("identity:".into());
    expected
}

#[tokio::test]
async fn all_profiles_are_cleaned_before_the_account_is_deleted() {
    let gateway = FakeGateway::default();
    delete_user_data(&gateway, &Uuid::now_v7(), &users())
        .await
        .unwrap();
    assert_eq!(*gateway.calls.lock().unwrap(), expected_calls());
}

#[tokio::test]
async fn every_failure_stops_deletion_without_erasing_retry_state() {
    let expected = expected_calls();
    for fail_at in 1..=expected.len() {
        let gateway = FakeGateway {
            fail_at: Some(fail_at),
            ..Default::default()
        };
        assert!(
            delete_user_data(&gateway, &Uuid::now_v7(), &users())
                .await
                .is_err()
        );
        assert_eq!(*gateway.calls.lock().unwrap(), expected[..fail_at]);
    }
}

#[tokio::test]
async fn retry_after_profiles_are_gone_still_deletes_the_account() {
    let gateway = FakeGateway::default();
    delete_user_data(&gateway, &Uuid::now_v7(), &[])
        .await
        .unwrap();
    assert_eq!(*gateway.calls.lock().unwrap(), ["account:"]);
}

#[tokio::test]
async fn requested_deletion_releases_every_profile_before_the_identity() {
    let gateway = FakeGateway::default();
    delete_requested_account(&gateway, &Uuid::now_v7())
        .await
        .unwrap();
    assert_eq!(*gateway.calls.lock().unwrap(), expected_requested_calls());
}

#[tokio::test]
async fn requested_deletion_keeps_the_identity_when_cleanup_fails() {
    let expected = expected_requested_calls();
    for fail_at in 1..expected.len() {
        let gateway = FakeGateway {
            fail_at: Some(fail_at),
            ..Default::default()
        };
        assert!(
            delete_requested_account(&gateway, &Uuid::now_v7())
                .await
                .is_err()
        );
        let calls = gateway.calls.lock().unwrap();
        assert_eq!(*calls, expected[..fail_at]);
        assert!(!calls.iter().any(|call| call.starts_with("identity:")));
    }
}

#[tokio::test]
async fn requested_deletion_leaves_profiles_for_the_webhook() {
    let gateway = FakeGateway::default();
    delete_requested_account(&gateway, &Uuid::now_v7())
        .await
        .unwrap();
    let calls = gateway.calls.lock().unwrap();
    assert!(
        !calls
            .iter()
            .any(|call| call.starts_with("profile:") || call.starts_with("account:"))
    );
}
