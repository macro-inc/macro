use std::sync::{Arc, Mutex};

use model::project::BasicProject;
use uuid::Uuid;

use super::super::tests::{
    RecordingBulkUpload, TestEventBroker, assert_project_event, basic_project,
    service_with_event_broker,
};
use super::*;
use crate::domain::models::{PurgedProjectTree, SoftDeleteResult};
use crate::domain::ports::MockProjectRepo;

const TEAM_ID: Uuid = Uuid::from_u128(0x7ea3_0000_0000_0000_0000_0000_0000_0001);

type Steps = Arc<Mutex<Vec<&'static str>>>;

fn team() -> Owner {
    Owner::Team(TEAM_ID)
}

fn team_project(id: Uuid, deleted: bool) -> BasicProject {
    BasicProject {
        user_id: team(),
        ..basic_project(id, None, deleted)
    }
}

/// A repo that serves `project` and expects no other call.
fn serving(project: Option<BasicProject>) -> MockProjectRepo {
    let mut repo = MockProjectRepo::new();
    repo.expect_get_basic_project()
        .return_once(move |_| Box::pin(async move { Ok(project) }));
    repo
}

fn expect_trash(repo: &mut MockProjectRepo, project_id: Uuid, steps: &Steps) {
    let steps = steps.clone();
    repo.expect_soft_delete_project()
        .withf(move |id| id == project_id.to_string())
        .return_once(move |_| {
            steps.lock().unwrap().push("trash");
            Box::pin(async move {
                Ok(SoftDeleteResult {
                    project_ids: vec![project_id.to_string()],
                    document_ids: Vec::new(),
                    chat_ids: Vec::new(),
                })
            })
        });
}

fn expect_purge(repo: &mut MockProjectRepo, project_id: Uuid, steps: &Steps) {
    let steps = steps.clone();
    repo.expect_purge_deleted_project_tree()
        .withf(move |id| id == project_id.to_string())
        .return_once(move |_| {
            steps.lock().unwrap().push("purge");
            Box::pin(async move {
                Ok(PurgedProjectTree {
                    project_ids: vec![project_id.to_string()],
                    chat_ids: Vec::new(),
                    documents: Vec::new(),
                    bom_shas: Vec::new(),
                })
            })
        });
}

#[tokio::test]
async fn purge_owned_trashes_a_live_project_then_purges_its_tree() {
    let project_id = Uuid::new_v4();
    let steps = Steps::default();
    let mut repo = serving(Some(team_project(project_id, false)));
    expect_trash(&mut repo, project_id, &steps);
    expect_purge(&mut repo, project_id, &steps);
    let broker = TestEventBroker::default();
    let published = broker.published();
    let service = service_with_event_broker(repo, RecordingBulkUpload::default(), broker);

    let outcome = service.purge_owned(project_id, &team()).await.unwrap();

    assert_eq!(outcome, OwnedPurgeOutcome::Purged);
    assert_eq!(*steps.lock().unwrap(), ["trash", "purge"]);
    let published = published.lock().unwrap();
    assert_eq!(published.len(), 2);
    assert_project_event(&published[0], project_id, "project.deleted");
    assert_project_event(&published[1], project_id, "project.permanently_deleted");
    let metadata = &published[1].payload["metadata"];
    assert_eq!(metadata["owner"], TEAM_ID.to_string());
    assert!(metadata["actor_user_id"].is_null());
}

#[tokio::test]
async fn purge_owned_purges_a_trashed_project_without_trashing_it_again() {
    let project_id = Uuid::new_v4();
    let steps = Steps::default();
    let mut repo = serving(Some(team_project(project_id, true)));
    expect_purge(&mut repo, project_id, &steps);
    let service = service_with_event_broker(
        repo,
        RecordingBulkUpload::default(),
        TestEventBroker::default(),
    );

    let outcome = service.purge_owned(project_id, &team()).await.unwrap();

    assert_eq!(outcome, OwnedPurgeOutcome::Purged);
    assert_eq!(*steps.lock().unwrap(), ["purge"]);
}

#[tokio::test]
async fn purge_owned_refuses_a_project_owned_by_someone_else() {
    let project_id = Uuid::new_v4();
    let broker = TestEventBroker::default();
    let published = broker.published();
    let service = service_with_event_broker(
        serving(Some(basic_project(project_id, None, false))),
        RecordingBulkUpload::default(),
        broker,
    );

    let outcome = service.purge_owned(project_id, &team()).await.unwrap();

    assert_eq!(outcome, OwnedPurgeOutcome::OwnedElsewhere);
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn purge_owned_of_a_missing_project_is_purged() {
    let broker = TestEventBroker::default();
    let published = broker.published();
    let service = service_with_event_broker(serving(None), RecordingBulkUpload::default(), broker);

    let outcome = service.purge_owned(Uuid::new_v4(), &team()).await.unwrap();

    assert_eq!(outcome, OwnedPurgeOutcome::Purged);
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn purge_owned_stops_before_the_purge_when_trashing_fails() {
    let project_id = Uuid::new_v4();
    let mut repo = serving(Some(team_project(project_id, false)));
    repo.expect_soft_delete_project()
        .return_once(|_| Box::pin(async { Err(anyhow::anyhow!("delete failed")) }));
    let broker = TestEventBroker::default();
    let published = broker.published();
    let service = service_with_event_broker(repo, RecordingBulkUpload::default(), broker);

    assert!(service.purge_owned(project_id, &team()).await.is_err());
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn purge_owned_returns_a_failed_purge_as_an_error() {
    let project_id = Uuid::new_v4();
    let mut repo = serving(Some(team_project(project_id, true)));
    repo.expect_purge_deleted_project_tree()
        .return_once(|_| Box::pin(async { Err(anyhow::anyhow!("commit failed")) }));
    let broker = TestEventBroker::default();
    let published = broker.published();
    let service = service_with_event_broker(repo, RecordingBulkUpload::default(), broker);

    assert!(service.purge_owned(project_id, &team()).await.is_err());
    assert!(published.lock().unwrap().is_empty());
}
