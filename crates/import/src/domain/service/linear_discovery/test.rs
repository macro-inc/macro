use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{ImportSource, ImportStatus, LinearIssueMeta};
use crate::domain::ports::{ImportError, ImportRepo, LinearIssueSource, LinearSourceError};
use crate::domain::service::test::admission::{Creator, NoConnector, Repo, user};
use crate::domain::service::{ImportService, ImportServiceImpl};

type Service = ImportServiceImpl<Repo, NoConnector, Creator>;

/// A Linear workspace with these open issues, or not connected.
struct Workspace(Mutex<Option<Vec<LinearIssueMeta>>>);

#[async_trait]
impl LinearIssueSource for Workspace {
    async fn open_issues(
        &self,
        _user: &MacroUserIdStr<'static>,
        limit: usize,
    ) -> Result<Option<Vec<LinearIssueMeta>>, LinearSourceError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .clone()
            .map(|issues| issues.into_iter().take(limit).collect()))
    }
}

fn issue(identifier: &str, title: &str) -> LinearIssueMeta {
    LinearIssueMeta {
        identifier: Some(identifier.to_owned()),
        title: title.to_owned(),
        description: Some("Steps to reproduce".to_owned()),
        status: Some("In Progress".to_owned()),
        priority: Some("High".to_owned()),
        assignee: Some("Ada".to_owned()),
        assignee_email: None,
        due_date: None,
        url: None,
    }
}

fn service(issues: Option<Vec<LinearIssueMeta>>) -> Service {
    ImportServiceImpl::new(
        Repo::default(),
        Arc::new(NoConnector),
        Arc::new(Creator::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_linear_source(Arc::new(Workspace(Mutex::new(issues))))
}

#[tokio::test]
async fn open_issues_are_staged_once_each() {
    let service = service(Some(vec![
        issue("ENG-12", "Fix login"),
        issue("ENG-13", "Ship search"),
    ]));

    assert_eq!(service.discover_linear(&user()).await, Ok(2));
    // Looking again refreshes the same rows instead of adding more.
    assert_eq!(service.discover_linear(&user()).await, Ok(2));

    let rows = service
        .repo
        .list(&user(), Some(ImportSource::Linear), None)
        .await
        .unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.status == ImportStatus::Staged));
    let fix = rows
        .iter()
        .find(|row| row.foreign_id == "ENG-12")
        .expect("ENG-12");
    assert_eq!(fix.metadata["title"], "Fix login");
    assert_eq!(fix.metadata["status"], "In Progress");
}

#[tokio::test]
async fn without_a_connection_discovery_fails_readably() {
    let service = service(None);

    assert_eq!(
        service.discover_linear(&user()).await,
        Err("Linear is not connected".to_owned())
    );
}

#[tokio::test]
async fn linear_discovery_starts_only_where_a_source_is_attached() {
    let without = ImportServiceImpl::new(
        Repo::default(),
        Arc::new(NoConnector),
        Arc::new(Creator::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    );
    assert!(matches!(
        without.start_discovery(user(), ImportSource::Linear).await,
        Err(ImportError::UnsupportedDiscovery(ImportSource::Linear))
    ));

    let with = service(Some(Vec::new()));
    assert!(
        with.start_discovery(user(), ImportSource::Linear)
            .await
            .unwrap()
    );
    // A second start while the first runs is refused, not doubled.
    assert!(
        !with
            .start_discovery(user(), ImportSource::Linear)
            .await
            .unwrap()
    );
}
