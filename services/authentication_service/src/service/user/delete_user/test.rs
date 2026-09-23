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
    async fn delete_scheduled_actions(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.call("actions", user.as_ref())
    }
    async fn delete_agent_sessions(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.call("sessions", user.as_ref())
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
        for step in ["actions", "sessions", "items", "profile"] {
            expected.push(format!("{step}:{user}"));
        }
    }
    expected.push("account:".into());
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
