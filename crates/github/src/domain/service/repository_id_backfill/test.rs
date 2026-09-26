use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use foreign_entity::domain::models::ForeignEntityError;

use super::*;
use crate::domain::models::GithubRepository;

const TEST_PEM: &str = include_str!("../installation_tokens/test_key.pem");

fn config() -> InstallationTokenConfig {
    InstallationTokenConfig {
        client_id: "Iv1.testclient".to_owned(),
        private_key_pem: TEST_PEM.to_owned(),
    }
}

fn repository(id: u64, owner: &str, name: &str) -> GithubRepository {
    GithubRepository {
        owner: owner.to_owned(),
        name: name.to_owned(),
        html_url: format!("https://github.com/{owner}/{name}"),
        default_branch: Some("main".to_owned()),
        private: true,
        id,
    }
}

fn identity(id: u64, owner: &str, name: &str) -> GithubRepositoryIdentity {
    GithubRepositoryIdentity {
        id,
        owner: owner.to_owned(),
        name: name.to_owned(),
    }
}

struct FakeInstallations(Vec<String>);

impl GithubInstallationLister for FakeInstallations {
    type Err = anyhow::Error;

    async fn list_installation_ids(
        &self,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Vec<String>, Self::Err> {
        Ok(self
            .0
            .iter()
            .filter(|id| after.is_none_or(|after| id.as_str() > after))
            .take(limit as usize)
            .cloned()
            .collect())
    }
}

#[derive(Default)]
struct FakeClient {
    repositories: HashMap<u64, Vec<GithubRepository>>,
    unavailable: Vec<u64>,
}

impl GithubRepositoryClient for FakeClient {
    async fn repositories_for_installation(
        &self,
        _jwt: &AppJwt,
        installation_id: u64,
    ) -> Result<Vec<GithubRepository>, GithubError> {
        if self.unavailable.contains(&installation_id) {
            return Err(GithubError::Internal(anyhow::anyhow!(
                "installation suspended"
            )));
        }
        Ok(self
            .repositories
            .get(&installation_id)
            .cloned()
            .unwrap_or_default())
    }
}

/// Records every batch it is given and reports one updated record per repository.
#[derive(Clone, Default)]
struct RecordingPullRequests {
    batches: Arc<Mutex<Vec<Vec<GithubRepositoryIdentity>>>>,
    fail: bool,
}

impl RecordingPullRequests {
    fn batches(&self) -> Vec<Vec<GithubRepositoryIdentity>> {
        self.batches.lock().expect("lock").clone()
    }
}

impl GithubRepositoryIdBackfillService for RecordingPullRequests {
    async fn set_missing_github_repository_ids(
        &self,
        repositories: &[GithubRepositoryIdentity],
    ) -> Result<u64, ForeignEntityError> {
        if self.fail {
            return Err(ForeignEntityError::Internal(anyhow::anyhow!(
                "database unavailable"
            )));
        }
        self.batches
            .lock()
            .expect("lock")
            .push(repositories.to_vec());
        Ok(repositories.len() as u64)
    }
}

fn service(
    installations: &[&str],
    client: FakeClient,
    pull_requests: RecordingPullRequests,
) -> RepositoryIdBackfillService<FakeInstallations, FakeClient, RecordingPullRequests> {
    RepositoryIdBackfillService::new(
        config(),
        FakeInstallations(installations.iter().map(|id| id.to_string()).collect()),
        client,
        pull_requests,
    )
}

fn two_installation_client() -> FakeClient {
    FakeClient {
        repositories: HashMap::from([
            (
                1,
                vec![
                    repository(100, "macro-inc", "macro"),
                    repository(200, "macro-inc", "docs"),
                ],
            ),
            (3, vec![repository(300, "other-org", "tools")]),
        ]),
        unavailable: Vec::new(),
    }
}

#[tokio::test]
async fn pages_through_installations_and_reports_where_to_resume() {
    let pull_requests = RecordingPullRequests::default();
    let service = service(
        &["1", "2", "3"],
        two_installation_client(),
        pull_requests.clone(),
    );

    let first = service
        .backfill_repository_ids(RepositoryIdBackfillRequest {
            after: None,
            limit: Some(2),
        })
        .await
        .expect("first page should succeed");
    assert_eq!(
        first,
        RepositoryIdBackfillPage {
            installations: 2,
            repositories: 2,
            updated_pull_requests: 2,
            failed_installation_ids: Vec::new(),
            next_after: Some("2".to_string()),
        }
    );

    let second = service
        .backfill_repository_ids(RepositoryIdBackfillRequest {
            after: first.next_after,
            limit: Some(2),
        })
        .await
        .expect("second page should succeed");
    assert_eq!(
        second,
        RepositoryIdBackfillPage {
            installations: 1,
            repositories: 1,
            updated_pull_requests: 1,
            failed_installation_ids: Vec::new(),
            next_after: None,
        }
    );

    assert_eq!(
        pull_requests.batches(),
        vec![
            vec![
                identity(100, "macro-inc", "macro"),
                identity(200, "macro-inc", "docs"),
            ],
            vec![],
            vec![identity(300, "other-org", "tools")],
        ]
    );
}

#[tokio::test]
async fn installations_github_will_not_list_are_reported_and_skipped() {
    let pull_requests = RecordingPullRequests::default();
    let client = FakeClient {
        unavailable: vec![1],
        ..two_installation_client()
    };
    let service = service(&["1", "3"], client, pull_requests.clone());

    let page = service
        .backfill_repository_ids(RepositoryIdBackfillRequest::default())
        .await
        .expect("page should succeed");

    assert_eq!(page.failed_installation_ids, vec!["1".to_string()]);
    assert_eq!(page.installations, 2);
    assert_eq!(page.updated_pull_requests, 1);
    assert_eq!(page.next_after, None);
    assert_eq!(
        pull_requests.batches(),
        vec![vec![identity(300, "other-org", "tools")]]
    );
}

#[tokio::test]
async fn a_storage_failure_stops_the_page() {
    let pull_requests = RecordingPullRequests {
        fail: true,
        ..RecordingPullRequests::default()
    };
    let service = service(&["1"], two_installation_client(), pull_requests);

    let error = service
        .backfill_repository_ids(RepositoryIdBackfillRequest::default())
        .await
        .expect_err("a storage failure should fail the page");

    assert!(matches!(error, GithubError::Internal(_)));
}

#[tokio::test]
async fn a_zero_limit_still_processes_one_installation() {
    let service = service(
        &["1", "3"],
        two_installation_client(),
        RecordingPullRequests::default(),
    );

    let page = service
        .backfill_repository_ids(RepositoryIdBackfillRequest {
            after: None,
            limit: Some(0),
        })
        .await
        .expect("page should succeed");

    assert_eq!(page.installations, 1);
    assert_eq!(page.next_after, Some("1".to_string()));
}
