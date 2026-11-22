use super::*;
use crate::domain::models::OnboardingStatus;
use connectors::domain::service::Connectors;
use connectors::fake::{FakeConnection, FakeConnectors};
use std::sync::Mutex;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|tester@macro.com".to_string()).expect("valid test user id")
}

fn active_row() -> OnboardingRow {
    OnboardingRow {
        status: OnboardingStatus::Active,
        skipped: false,
        started_at: chrono::Utc::now(),
        completed_at: None,
    }
}

struct MockRepo {
    status: OnboardingStatus,
    completions: Mutex<Vec<bool>>,
    dismissed: Mutex<Vec<String>>,
}

impl MockRepo {
    fn new(status: OnboardingStatus) -> Self {
        Self {
            status,
            completions: Mutex::new(Vec::new()),
            dismissed: Mutex::new(Vec::new()),
        }
    }
}

impl OnboardingRepo for MockRepo {
    async fn ensure_row(&self, _user: &MacroUserIdStr<'static>) -> Result<OnboardingRow> {
        Ok(OnboardingRow {
            status: self.status,
            ..active_row()
        })
    }

    async fn get_row(&self, _user: &MacroUserIdStr<'static>) -> Result<Option<OnboardingRow>> {
        Ok(Some(OnboardingRow {
            status: self.status,
            ..active_row()
        }))
    }

    async fn complete(
        &self,
        _user: &MacroUserIdStr<'static>,
        skipped: bool,
    ) -> Result<OnboardingRow> {
        self.completions.lock().unwrap().push(skipped);
        Ok(OnboardingRow {
            status: OnboardingStatus::Completed,
            skipped,
            completed_at: Some(chrono::Utc::now()),
            ..active_row()
        })
    }

    async fn delete_row(&self, _user: &MacroUserIdStr<'static>) -> Result<()> {
        Ok(())
    }

    async fn dismissed_prompts(&self, _user: &MacroUserIdStr<'static>) -> Result<Vec<String>> {
        Ok(self.dismissed.lock().unwrap().clone())
    }

    async fn dismiss_prompt(
        &self,
        _user: &MacroUserIdStr<'static>,
        prompt: &PromptId,
    ) -> Result<()> {
        let mut dismissed = self.dismissed.lock().unwrap();
        if !dismissed.iter().any(|id| id == prompt.as_ref()) {
            dismissed.push(prompt.as_ref().to_owned());
        }
        Ok(())
    }
}

fn no_connections() -> Arc<Connectors> {
    Arc::new(FakeConnectors::new().build())
}

/// The setup page lists what the connectors services count as usable:
/// a connected app and a server added by URL, not a disabled app or one
/// that needs authorizing again.
#[tokio::test]
async fn get_state_lists_usable_connections_without_starting_imports() {
    let fake = FakeConnectors::new()
        .with_connection(&user(), FakeConnection::app("linear").named("Linear"))
        .with_connection(&user(), FakeConnection::app("jira").disabled())
        .with_connection(&user(), FakeConnection::app("github").needs_reauth())
        .with_connection(
            &user(),
            FakeConnection::server("https://mcp.example.com/mcp").named("Example"),
        );
    let service = OnboardingServiceImpl::new(
        MockRepo::new(OnboardingStatus::Active),
        Arc::new(fake.build()),
    );

    let state = service.get_state(user()).await.expect("state");
    assert_eq!(
        state.connected_servers,
        vec![
            ConnectedServer {
                name: "Linear".into(),
                url: "linear".into(),
                authenticated: true,
            },
            ConnectedServer {
                name: "Example".into(),
                url: "https://mcp.example.com/mcp".into(),
                authenticated: true,
            },
        ]
    );
}

#[tokio::test]
async fn completing_records_how_the_flow_ended() {
    let repo = MockRepo::new(OnboardingStatus::Active);
    let service = OnboardingServiceImpl::new(repo, no_connections());

    let row = service.complete(user(), true).await.expect("complete");
    assert_eq!(row.status, OnboardingStatus::Completed);
    assert!(row.skipped);
    assert_eq!(service.repo.completions.lock().unwrap().as_slice(), &[true]);
}

#[test]
fn suggested_team_domain_offers_custom_domains_only() {
    // Custom domain: worth suggesting a domain team — the same judgment
    // the teams service applies when claiming a domain on create.
    assert_eq!(suggested_team_domain(&user()).as_deref(), Some("macro.com"));

    // Generic consumer provider: no domain team to suggest.
    let gmail =
        MacroUserIdStr::try_from("macro|tester@gmail.com".to_string()).expect("valid test user id");
    assert_eq!(suggested_team_domain(&gmail), None);
}

#[tokio::test]
async fn get_state_carries_the_suggested_team_domain() {
    let service =
        OnboardingServiceImpl::new(MockRepo::new(OnboardingStatus::Active), no_connections());

    let state = service.get_state(user()).await.expect("get_state");
    assert_eq!(state.suggested_team_domain.as_deref(), Some("macro.com"));
}

#[test]
fn prompt_ids_accept_card_slugs_and_reject_everything_else() {
    for valid in [
        "import:files",
        "home-setup",
        "pull-request-repositories",
        "a1_b",
    ] {
        assert!(PromptId::parse(valid).is_some(), "{valid}");
    }
    for invalid in [
        "",
        "Import:files",
        ":files",
        "has space",
        "slash/id",
        &"a".repeat(65),
    ] {
        assert!(PromptId::parse(invalid).is_none(), "{invalid}");
    }
}

#[tokio::test]
async fn dismissed_prompts_round_trip_without_entering_onboarding() {
    let service =
        OnboardingServiceImpl::new(MockRepo::new(OnboardingStatus::Active), no_connections());
    service
        .dismiss_prompt(user(), PromptId::parse("import:tasks").unwrap())
        .await
        .unwrap();
    service
        .dismiss_prompt(user(), PromptId::parse("import:tasks").unwrap())
        .await
        .unwrap();

    assert_eq!(
        service.dismissed_prompts(user()).await.unwrap().dismissed,
        vec!["import:tasks".to_string()]
    );
}
