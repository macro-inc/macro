//! Setup ends cleanly, and the plan the person approves is the one imported.

use std::time::Duration;

use import::domain::models::{ImportSource, ImportStatus, RunStatus};
use serde_json::json;

use super::{apps, connect_all, golden, reference};
use crate::domain::models::{AppStage, DiscoveryStatus, PlanRequest, ReportStatus, Selection};
use crate::domain::ports::{AccountStatus, SetupError};
use crate::test_support::{
    FakeAccounts, FakeConnections, FakeImports, FakeInbox, fixture, notion_page, row, run, user,
};

fn all(app: &str) -> Selection {
    Selection {
        app: app.to_owned(),
        all: true,
        refs: Vec::new(),
    }
}

fn plan(selections: Vec<Selection>, declined: &[String]) -> PlanRequest {
    PlanRequest {
        selections,
        declined: declined.to_vec(),
        other_apps: Vec::new(),
        scope_notes: None,
        notion_sharing: None,
    }
}

fn agent_led() -> FakeAccounts {
    FakeAccounts {
        status: std::sync::Mutex::new(AccountStatus {
            agent_led: true,
            ..AccountStatus::default()
        }),
        ..FakeAccounts::default()
    }
}

#[tokio::test]
async fn an_email_only_setup_finishes_and_stops_leading_with_setup() {
    // The inbox came with sign-in and the person uses nothing else.
    let fixture = fixture(
        FakeImports::new(Vec::new(), Vec::new(), Vec::new()),
        FakeConnections::with(&[]),
        FakeInbox(vec!["founder@startup.example".to_owned()]),
        agent_led(),
    );
    assert!(fixture.service.leads_with_setup(&user()).await.unwrap());

    let state = fixture
        .service
        .state(&user(), &apps(&["gmail"]))
        .await
        .expect("state");

    assert!(
        state.next_step.contains("Then call SetupGetStatus"),
        "{}",
        state.next_step
    );
    let report = fixture
        .service
        .status(&user(), &apps(&["gmail"]), Duration::ZERO)
        .await
        .expect("status");

    // Nothing came in, and nothing is left: the report ends setup.
    assert_eq!(report.status, ReportStatus::Done);
    assert!(!fixture.service.leads_with_setup(&user()).await.unwrap());
}

#[tokio::test]
async fn rows_staged_without_a_run_are_ready_not_still_being_looked_through() {
    // A page staged from chat: Notion was never planned.
    let fixture = fixture(
        FakeImports::new(
            Vec::new(),
            vec![notion_page(1, "Roadmap", ImportStatus::Staged)],
            Vec::new(),
        ),
        FakeConnections::with(&["notion"]),
        FakeInbox::default(),
        FakeAccounts::default(),
    );

    let state = fixture
        .service
        .state(&user(), &apps(&["notion"]))
        .await
        .expect("state");
    assert_eq!(state.apps[0].stage, AppStage::ReadyForPlan);

    let discovery = fixture
        .service
        .discover(&user(), &apps(&["notion"]), Duration::from_secs(45))
        .await
        .expect("discover");
    assert_eq!(discovery.apps[0].status, DiscoveryStatus::Ready);
    assert!(discovery.next_step.contains("SetupProposePlan"));
}

#[tokio::test]
async fn a_plan_waits_until_macro_has_finished_looking() {
    let fixture = fixture(
        FakeImports::new(
            vec![run(ImportSource::Notion, RunStatus::Running)],
            vec![notion_page(1, "Roadmap", ImportStatus::Staged)],
            Vec::new(),
        ),
        FakeConnections::with(&["notion"]),
        FakeInbox::default(),
        FakeAccounts::default(),
    );

    let refused = fixture
        .service
        .propose_plan(&user(), &plan(vec![all("notion")], &[]))
        .await;

    assert!(
        matches!(&refused, Err(SetupError::Actionable(message)) if message.contains("still looking through Notion")),
        "{refused:?}"
    );
}

#[tokio::test]
async fn a_declined_ref_that_matches_nothing_is_refused() {
    // Otherwise the item the person said no to would quietly come in with
    // `all: true`.
    let fixture = golden();
    connect_all(&fixture, &["notion"]);
    fixture
        .service
        .connect(&user(), &apps(&["notion"]))
        .await
        .expect("connect");

    let refused = fixture
        .service
        .propose_plan(
            &user(),
            &plan(vec![all("notion")], &["zzzz9999".to_owned()]),
        )
        .await;
    assert!(
        matches!(&refused, Err(SetupError::Actionable(message)) if message.contains("\"zzzz9999\"")),
        "{refused:?}"
    );

    let declined = fixture
        .service
        .propose_plan(&user(), &plan(vec![all("notion")], &[reference(1)]))
        .await
        .expect("a real ref is fine");
    assert_eq!(declined.will_import, 1);
}

#[tokio::test]
async fn slack_channels_need_a_team_and_the_plan_says_who_sees_them() {
    let channel = row(
        ImportSource::Slack,
        7,
        ImportStatus::Staged,
        json!({ "name": "eng", "member_count": 4 }),
    );
    let without_team = fixture(
        FakeImports::new(
            vec![run(ImportSource::Slack, RunStatus::Ready)],
            vec![channel.clone()],
            Vec::new(),
        ),
        FakeConnections::with(&["slack"]),
        FakeInbox::default(),
        FakeAccounts::default(),
    );

    let discovery = without_team
        .service
        .discover(&user(), &apps(&["slack"]), Duration::ZERO)
        .await
        .expect("discover");
    assert!(
        discovery.apps[0]
            .note
            .as_deref()
            .unwrap_or_default()
            .contains("need a Macro team")
    );
    let refused = without_team
        .service
        .propose_plan(&user(), &plan(vec![all("slack")], &[]))
        .await;
    assert!(
        matches!(&refused, Err(SetupError::Actionable(message)) if message.contains("https://macro.com/app/settings/team")),
        "{refused:?}"
    );

    let with_team = fixture(
        FakeImports::new(
            vec![run(ImportSource::Slack, RunStatus::Ready)],
            vec![channel],
            Vec::new(),
        ),
        FakeConnections::with(&["slack"]),
        FakeInbox::default(),
        FakeAccounts {
            status: std::sync::Mutex::new(AccountStatus {
                has_team: true,
                ..AccountStatus::default()
            }),
            ..FakeAccounts::default()
        },
    );
    let proposed = with_team
        .service
        .propose_plan(&user(), &plan(vec![all("slack")], &[]))
        .await
        .expect("plan");
    assert!(
        proposed
            .plan_text
            .contains("Slack channels come in as team channels")
    );
    assert!(
        !proposed
            .plan_text
            .contains("Everything stays private to you")
    );
}

#[tokio::test]
async fn a_failed_look_through_is_retried_not_counted_as_done() {
    let fixture = fixture(
        FakeImports::new(
            vec![run(ImportSource::Notion, RunStatus::Failed)],
            Vec::new(),
            Vec::new(),
        ),
        FakeConnections::with(&["notion"]),
        FakeInbox::default(),
        agent_led(),
    );

    let state = fixture
        .service
        .state(&user(), &apps(&["notion"]))
        .await
        .expect("state");
    assert!(
        state
            .next_step
            .starts_with("Call SetupConnect(apps: [\"notion\"])"),
        "{}",
        state.next_step
    );
    let report = fixture
        .service
        .status(&user(), &apps(&["notion"]), Duration::ZERO)
        .await
        .expect("status");
    assert_eq!(report.status, ReportStatus::NotStarted);
    assert_eq!(*fixture.accounts.finished.lock().unwrap(), 0);
}

#[tokio::test]
async fn slack_without_a_team_doesnt_hold_setup_open() {
    let fixture = fixture(
        FakeImports::new(
            vec![run(ImportSource::Slack, RunStatus::Ready)],
            vec![row(
                ImportSource::Slack,
                7,
                ImportStatus::Staged,
                json!({ "name": "eng" }),
            )],
            Vec::new(),
        ),
        FakeConnections::with(&["slack"]),
        FakeInbox::default(),
        agent_led(),
    );

    let state = fixture
        .service
        .state(&user(), &apps(&["slack"]))
        .await
        .expect("state");
    assert!(
        state
            .next_step
            .contains("https://macro.com/app/settings/team"),
        "{}",
        state.next_step
    );
    let report = fixture
        .service
        .status(&user(), &apps(&["slack"]), Duration::ZERO)
        .await
        .expect("status");
    assert_eq!(report.status, ReportStatus::Done);
}

#[tokio::test]
async fn a_plan_that_brings_nothing_in_ends_setup() {
    let fixture = golden();
    connect_all(&fixture, &["notion"]);
    fixture
        .service
        .connect(&user(), &apps(&["notion"]))
        .await
        .expect("connect");
    let request = plan(
        vec![Selection {
            app: "notion".to_owned(),
            all: false,
            refs: Vec::new(),
        }],
        &[],
    );
    let proposed = fixture
        .service
        .propose_plan(&user(), &request)
        .await
        .expect("plan");

    let started = fixture
        .service
        .import(&user(), &request, &proposed.plan_id, true)
        .await
        .expect("import");

    assert_eq!(started.started, 0);
    assert!(
        started.next_step.contains("Setup is done"),
        "{}",
        started.next_step
    );
    assert_eq!(*fixture.accounts.finished.lock().unwrap(), 1);
}

#[tokio::test]
async fn a_gmail_inbox_doesnt_count_as_outlook() {
    let fixture = fixture(
        FakeImports::new(Vec::new(), Vec::new(), Vec::new()),
        FakeConnections::with(&[]),
        FakeInbox(vec!["founder@startup.example".to_owned()]),
        FakeAccounts::default(),
    );

    let connect = fixture
        .service
        .connect(&user(), &apps(&["gmail", "outlook"]))
        .await
        .expect("connect");

    assert_eq!(connect.already_connected, ["gmail"]);
    assert_eq!(connect.handoffs.len(), 1);
    assert_eq!(connect.handoffs[0].app, "outlook");
}

#[tokio::test]
async fn setup_isnt_done_while_a_named_app_is_still_to_connect() {
    // Notion came in, but the Linear link is still out.
    let fixture = fixture(
        FakeImports::new(
            vec![run(ImportSource::Notion, RunStatus::Completed)],
            vec![notion_page(1, "Roadmap", ImportStatus::Imported)],
            Vec::new(),
        ),
        FakeConnections::with(&["notion"]),
        FakeInbox(vec!["founder@startup.example".to_owned()]),
        agent_led(),
    );

    let report = fixture
        .service
        .status(&user(), &apps(&["notion", "linear"]), Duration::ZERO)
        .await
        .expect("status");

    assert_eq!(report.status, ReportStatus::NotStarted);
    assert_eq!(*fixture.accounts.finished.lock().unwrap(), 0);
    assert_eq!(report.imported.len(), 1);
}
