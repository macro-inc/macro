use super::*;
use crate::domain::models::{ImportEntity, ImportStatus, Initiator, LinearState};
use crate::domain::ports::ImportedTaskProperties;
use crate::domain::service::notion::test::DocCreator;
use crate::domain::service::test::admission::{NoConnector, Repo, user};
use crate::domain::service::{ApiSources, ImportServiceImpl};
use chrono::{DateTime, NaiveDate, Utc};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

fn at(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339).unwrap().to_utc()
}

fn issue(identifier: &str, kind: LinearStateType, state: &str, updated: &str) -> LinearIssue {
    LinearIssue {
        id: format!("id-{identifier}"),
        identifier: identifier.to_string(),
        title: format!("Title of {identifier}"),
        description: Some(format!("Body of {identifier}.")),
        url: format!("https://linear.app/example-co/issue/{identifier}"),
        priority: 2,
        due_date: None,
        updated_at: at(updated),
        archived: false,
        state: LinearState {
            name: state.to_string(),
            kind,
        },
    }
}

#[test]
fn selection_keeps_open_unarchived_issues_freshest_first_and_caps() {
    let mut archived = issue(
        "ENG-4",
        LinearStateType::Backlog,
        "Backlog",
        "2026-10-09T00:00:00Z",
    );
    archived.archived = true;
    let issues = vec![
        issue(
            "ENG-1",
            LinearStateType::Started,
            "In Progress",
            "2026-10-01T00:00:00Z",
        ),
        issue(
            "ENG-2",
            LinearStateType::Completed,
            "Done",
            "2026-10-08T00:00:00Z",
        ),
        issue(
            "ENG-3",
            LinearStateType::Triage,
            "Triage",
            "2026-10-05T00:00:00Z",
        ),
        archived,
        issue(
            "ENG-5",
            LinearStateType::Canceled,
            "Canceled",
            "2026-10-07T00:00:00Z",
        ),
        issue(
            "ENG-6",
            LinearStateType::Unstarted,
            "Todo",
            "2026-10-06T00:00:00Z",
        ),
    ];

    let selected: Vec<String> = select_linear_issues(issues.clone(), 50)
        .into_iter()
        .map(|issue| issue.identifier)
        .collect();
    assert_eq!(selected, ["ENG-6", "ENG-3", "ENG-1"]);

    let capped: Vec<String> = select_linear_issues(issues, 2)
        .into_iter()
        .map(|issue| issue.identifier)
        .collect();
    assert_eq!(capped, ["ENG-6", "ENG-3"]);
}

#[test]
fn status_maps_by_state_type_with_review_states_detected_by_name() {
    let status = |kind, name: &str| {
        let mut meta = linear_issue_meta(&issue("ENG-1", kind, name, "2026-10-01T00:00:00Z"));
        meta.status = Some(name.to_string());
        linear_task_status(&meta)
    };
    assert_eq!(
        status(LinearStateType::Triage, "Triage"),
        Some("Not Started")
    );
    assert_eq!(
        status(LinearStateType::Backlog, "Icebox"),
        Some("Not Started")
    );
    assert_eq!(
        status(LinearStateType::Unstarted, "Todo"),
        Some("Not Started")
    );
    assert_eq!(
        status(LinearStateType::Started, "Doing"),
        Some("In Progress")
    );
    assert_eq!(
        status(LinearStateType::Started, "In Review"),
        Some("In Review")
    );
    assert_eq!(
        status(LinearStateType::Started, "Code review"),
        Some("In Review")
    );
    assert_eq!(
        status(LinearStateType::Completed, "Shipped"),
        Some("Completed")
    );
    assert_eq!(
        status(LinearStateType::Canceled, "Won't fix"),
        Some("Canceled")
    );
}

#[test]
fn priority_maps_from_linears_numeric_scale() {
    let priority = |value: u8| {
        let mut source = issue(
            "ENG-1",
            LinearStateType::Started,
            "In Progress",
            "2026-10-01T00:00:00Z",
        );
        source.priority = value;
        linear_task_properties(&linear_issue_meta(&source), &user()).priority
    };
    assert_eq!(priority(0), None);
    assert_eq!(priority(1).as_deref(), Some("Urgent"));
    assert_eq!(priority(2).as_deref(), Some("High"));
    assert_eq!(priority(3).as_deref(), Some("Medium"));
    assert_eq!(priority(4).as_deref(), Some("Low"));
}

#[test]
fn discovered_issues_map_to_task_fields_assigned_to_the_importing_user() {
    let mut source = issue(
        "ENG-142",
        LinearStateType::Started,
        "In Review",
        "2026-10-07T16:20:00Z",
    );
    source.due_date = NaiveDate::from_ymd_opt(2026, 10, 10);
    source.description = Some("It drifts.\n\n- [ ] Fix it\n".into());
    let meta = linear_issue_meta(&source);

    let properties = linear_task_properties(&meta, &user());
    assert_eq!(
        properties,
        ImportedTaskProperties {
            status: Some("In Review".into()),
            priority: Some("High".into()),
            due_date: Some("2026-10-10".into()),
            assignee_email: Some("import@example.com".into()),
        }
    );

    let (name, markdown) = linear_task_content(&meta);
    assert_eq!(name, "Title of ENG-142");
    assert_eq!(
        markdown,
        "It drifts.\n\n- [ ] Fix it\n\nImported from Linear · \
         [ENG-142](https://linear.app/example-co/issue/ENG-142)"
    );
}

#[test]
fn issues_without_descriptions_keep_only_the_footer() {
    let mut source = issue(
        "ENG-9",
        LinearStateType::Backlog,
        "Backlog",
        "2026-10-01T00:00:00Z",
    );
    source.description = None;
    let (_, markdown) = linear_task_content(&linear_issue_meta(&source));
    assert_eq!(
        markdown,
        "Imported from Linear · [ENG-9](https://linear.app/example-co/issue/ENG-9)"
    );
}

#[test]
fn hand_staged_rows_fall_back_to_their_label_fields() {
    let meta = LinearIssueMeta {
        identifier: Some("ENG-7".into()),
        title: "Hand staged".into(),
        status: Some("Blocked on vendor".into()),
        priority: Some("P0".into()),
        assignee_email: Some("sam@example.com".into()),
        ..LinearIssueMeta::default()
    };
    let properties = linear_task_properties(&meta, &user());
    assert_eq!(properties.status, None);
    assert_eq!(properties.priority, None);
    assert_eq!(
        properties.assignee_email.as_deref(),
        Some("sam@example.com")
    );
    let (_, markdown) = linear_task_content(&meta);
    assert_eq!(
        markdown,
        "Status: Blocked on vendor · Priority: P0 · Imported from Linear · ENG-7"
    );

    let labelled = LinearIssueMeta {
        title: "Labelled".into(),
        status: Some("Todo".into()),
        priority: Some("Urgent".into()),
        ..LinearIssueMeta::default()
    };
    let properties = linear_task_properties(&labelled, &user());
    assert_eq!(properties.status.as_deref(), Some("Not Started"));
    assert_eq!(properties.priority.as_deref(), Some("Urgent"));
    assert_eq!(linear_task_content(&labelled).1, "Imported from Linear");
}

struct FakeLinear(Mutex<Option<Result<Vec<LinearIssue>, ApiSourceError>>>);

impl FakeLinear {
    fn returning(result: Result<Vec<LinearIssue>, ApiSourceError>) -> Self {
        Self(Mutex::new(Some(result)))
    }
}

impl LinearSource for FakeLinear {
    async fn assigned_open_issues(
        &self,
        caller: &MacroUserIdStr<'static>,
        at_least: usize,
    ) -> Result<Vec<LinearIssue>, ApiSourceError> {
        assert_eq!(caller, &user());
        assert_eq!(at_least, MAX_LINEAR_ISSUES);
        self.0.lock().unwrap().take().expect("one read per gather")
    }
}

type Service = ImportServiceImpl<
    Repo,
    NoConnector,
    DocCreator,
    crate::domain::service::NoSlackSource,
    ApiSources<
        FakeLinear,
        crate::domain::service::NoNotionSource,
        crate::domain::service::NoImageRehoster,
    >,
>;

fn service(read: Result<Vec<LinearIssue>, ApiSourceError>) -> Service {
    ImportServiceImpl::new(
        Repo::with_roster(Vec::new()),
        Arc::new(NoConnector),
        Arc::new(DocCreator::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_api_sources(Arc::new(ApiSources::new(
        FakeLinear::returning(read),
        crate::domain::service::NoNotionSource,
        crate::domain::service::NoImageRehoster,
    )))
}

#[tokio::test]
async fn discovery_stages_selected_issues_and_skips_teammate_imports() {
    let service = service(Ok(vec![
        issue(
            "ENG-1",
            LinearStateType::Started,
            "In Progress",
            "2026-10-01T00:00:00Z",
        ),
        issue(
            "ENG-2",
            LinearStateType::Backlog,
            "Backlog",
            "2026-10-03T00:00:00Z",
        ),
        issue(
            "ENG-3",
            LinearStateType::Completed,
            "Done",
            "2026-10-04T00:00:00Z",
        ),
    ]));
    let team_id = service.repo.user_team_id(&user()).await.unwrap();
    service.repo.insert(ImportEntity {
        id: Uuid::now_v7(),
        user_id: "macro|teammate@example.com".into(),
        team_id,
        source: ImportSource::Linear,
        foreign_id: "ENG-1".into(),
        status: ImportStatus::Imported,
        initiator: Initiator::Onboarding,
        metadata: serde_json::json!({"title": "Title of ENG-1"}),
        entity_id: Some("task-1".into()),
        entity_type: Some("task".into()),
        last_error: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    });

    let staged = gather_linear(&service, &user(), GatherMode::Onboarding)
        .await
        .unwrap();

    assert_eq!(staged, 1);
    let own: Vec<ImportEntity> = service
        .repo
        .rows()
        .into_iter()
        .filter(|row| row.user_id == user().as_ref())
        .collect();
    assert_eq!(own.len(), 1);
    assert_eq!(own[0].foreign_id, "ENG-2");
    assert_eq!(own[0].initiator, Initiator::Onboarding);
    let meta: LinearIssueMeta = serde_json::from_value(own[0].metadata.clone()).unwrap();
    assert_eq!(meta.state_type, Some(LinearStateType::Backlog));
    assert_eq!(meta.linear_id.as_deref(), Some("id-ENG-2"));
    assert_eq!(
        meta.updated_at.as_deref(),
        Some("2026-10-03T00:00:00+00:00")
    );
}

#[tokio::test]
async fn users_without_a_pipedream_linear_connection_are_skipped() {
    let service = service(Err(ApiSourceError::NotConnected(ImportSource::Linear)));
    let staged = gather_linear(&service, &user(), GatherMode::Onboarding)
        .await
        .unwrap();
    assert_eq!(staged, 0);
    assert!(service.repo.rows().is_empty());
}

#[tokio::test]
async fn source_failures_fail_the_gather() {
    let service = service(Err(ApiSourceError::Unauthorized(ImportSource::Linear)));
    let error = gather_linear(&service, &user(), GatherMode::Manual)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("refused"));
}

#[tokio::test]
async fn imported_tasks_carry_the_users_team_on_the_ledger() {
    let service = service(Ok(vec![issue(
        "ENG-2",
        LinearStateType::Started,
        "In Progress",
        "2026-10-03T00:00:00Z",
    )]));
    gather_linear(&service, &user(), GatherMode::Manual)
        .await
        .unwrap();
    let row = service.repo.rows().pop().unwrap();
    assert_eq!(row.initiator, Initiator::Manual);
    let row = service
        .repo
        .mark_importing(&user(), &[row.id])
        .await
        .unwrap()
        .pop()
        .unwrap();

    let outcome = service
        .import_deterministic(
            &user(),
            &row,
            &mut crate::domain::service::SlackBatch::default(),
        )
        .await;

    assert_eq!(outcome, crate::domain::service::RowOutcome::Imported);
    let row = service.repo.get(&user(), row.id).await.unwrap().unwrap();
    assert_eq!(row.status, ImportStatus::Imported);
    assert_eq!(row.entity_type.as_deref(), Some("task"));
    assert!(row.team_id.is_some());
    assert_eq!(
        row.team_id,
        service.repo.user_team_id(&user()).await.unwrap()
    );
    let created = service.creator.tasks.lock().unwrap();
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].0, "Title of ENG-2");
    assert_eq!(created[0].2.status.as_deref(), Some("In Progress"));
    assert_eq!(
        created[0].2.assignee_email.as_deref(),
        Some("import@example.com")
    );
}
