use std::sync::Arc;

use ai_toolset::{RequestContext, ServiceContext, ToolAnnotated, ToolKind};

use super::*;
use crate::test_support::{FakeAccounts, FakeConnections, FakeImports, FakeInbox, fixture, user};

fn context() -> SetupToolContext {
    let fixture = fixture(
        FakeImports::new(Vec::new(), Vec::new(), Vec::new()),
        FakeConnections::with(&[]),
        FakeInbox::default(),
        FakeAccounts::default(),
    );
    SetupToolContext::wired(Arc::new(fixture.service))
}

#[test]
fn the_toolset_builds_with_valid_schemas() {
    // add_tool panics on an invalid schema or a duplicate name.
    let toolset = setup_toolset();
    let mut names: Vec<&str> = toolset.tools.keys().map(String::as_str).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "SetupConnect",
            "SetupDiscover",
            "SetupGetState",
            "SetupGetStatus",
            "SetupImport",
            "SetupProposePlan",
        ]
    );
}

#[test]
fn reads_are_read_only_and_writes_are_idempotent_and_never_destructive() {
    // Only two steps change anything, so clients that confirm writes ask the
    // person at most twice.
    for kind in [
        SetupGetState::ANNOTATIONS.kind,
        SetupDiscover::ANNOTATIONS.kind,
        SetupProposePlan::ANNOTATIONS.kind,
        SetupGetStatus::ANNOTATIONS.kind,
    ] {
        assert_eq!(kind, ToolKind::ReadOnly);
    }
    for annotations in [SetupConnect::ANNOTATIONS, SetupImport::ANNOTATIONS] {
        assert_eq!(annotations.kind, ToolKind::Additive);
        assert!(annotations.idempotent);
    }
    const { assert!(SetupImport::ANNOTATIONS.open_world) };
}

#[tokio::test]
async fn an_unwired_host_says_where_to_set_up_instead() {
    let result = SetupGetState {
        apps: Vec::new(),
        setup_id: None,
    }
    .call(
        ServiceContext(SetupToolContext::unavailable()),
        RequestContext::new(user()),
    )
    .await;

    let error = result.expect_err("unavailable");
    assert!(error.description.contains("web app"));
}

#[tokio::test]
async fn actionable_errors_reach_the_agent_verbatim() {
    let result = SetupConnect {
        apps: Vec::new(),
        setup_id: None,
    }
    .call(ServiceContext(context()), RequestContext::new(user()))
    .await;

    let error = result.expect_err("no apps");
    assert!(error.description.starts_with("Name the apps to connect"));
}

#[tokio::test]
async fn a_foreign_setup_id_is_refused_before_anything_runs() {
    let result = SetupImport {
        plan_id: "plan_x".to_owned(),
        selections: Vec::new(),
        declined: Vec::new(),
        approved: true,
        notion_sharing: None,
        setup_id: Some("setup_someone_else".to_owned()),
    }
    .call(ServiceContext(context()), RequestContext::new(user()))
    .await;

    let error = result.expect_err("foreign setup id");
    assert!(error.description.contains("different Macro account"));
}

#[tokio::test]
async fn get_state_returns_the_next_step() {
    let state = SetupGetState {
        apps: vec!["notion".to_owned()],
        setup_id: None,
    }
    .call(ServiceContext(context()), RequestContext::new(user()))
    .await
    .expect("state");

    assert!(state.next_step.contains("SetupConnect(apps: [\"notion\"])"));
}

#[tokio::test]
async fn internal_failures_tell_the_agent_to_retry_once_then_move_on() {
    use crate::domain::service::{AgentSetupService, SetupConfig, SetupPorts};
    use crate::test_support::BrokenConnections;

    let service = AgentSetupService::new(
        SetupPorts {
            imports: Arc::new(FakeImports::new(Vec::new(), Vec::new(), Vec::new())),
            connections: Arc::new(BrokenConnections),
            inbox: Arc::new(FakeInbox::default()),
            accounts: Arc::new(FakeAccounts::default()),
        },
        SetupConfig::new("https://macro.com"),
    );

    let error = SetupGetState {
        apps: vec!["notion".to_owned()],
        setup_id: None,
    }
    .call(
        ServiceContext(SetupToolContext::wired(Arc::new(service))),
        RequestContext::new(user()),
    )
    .await
    .expect_err("broken connections");

    assert!(error.description.contains("Try once more"));
    assert!(!error.description.contains("database unavailable"));
}
