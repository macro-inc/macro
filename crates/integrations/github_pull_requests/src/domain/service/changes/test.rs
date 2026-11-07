use std::collections::HashMap;
use std::convert::Infallible;
use std::num::NonZeroU64;
use std::sync::{Arc, Mutex};

use entity_access::domain::models::EntityType;
use foreign_entity::domain::models::ForeignEntity;
use git_patch::wire::GitRefDto;

use super::*;
use crate::domain::models::{
    EnrichedGithubPullRequest, GitRef, GithubPullRequestError, UpsertGithubPullRequest,
    UpsertedGithubPullRequest,
};

const USER: &str = "macro|user@example.com";
const PATCH: &str = "diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n@@ -1 +1 @@\n-old\n+new\n";

#[derive(Default)]
struct StubReader {
    head: Mutex<String>,
    patch: Mutex<String>,
    calls: Mutex<usize>,
}

impl StubReader {
    fn answering(head: &str, patch: &str) -> Arc<Self> {
        let reader = Arc::new(Self::default());
        reader.answer(head, patch);
        reader
    }

    fn answer(&self, head: &str, patch: &str) {
        *self.head.lock().unwrap() = head.to_string();
        *self.patch.lock().unwrap() = patch.to_string();
    }

    fn calls(&self) -> usize {
        *self.calls.lock().unwrap()
    }
}

impl GithubPullRequestDiffReader for Arc<StubReader> {
    async fn read(
        &self,
        _user: &MacroUserIdStr<'static>,
        pull_request: &PullRequestRef,
    ) -> Result<GithubPullRequestDiff, GithubPullRequestDiffError> {
        *self.calls.lock().unwrap() += 1;
        Ok(GithubPullRequestDiff {
            patch: self.patch.lock().unwrap().clone(),
            range: ChangesetRange {
                repository: Some(pull_request.repository.https_url()),
                base: GitRef {
                    name: Some("main".to_string()),
                    sha: Some("base-sha".to_string()),
                },
                head: GitRef {
                    name: Some("feature".to_string()),
                    sha: Some(self.head.lock().unwrap().clone()),
                },
            },
        })
    }
}

#[derive(Clone, Default)]
struct MemoryChangesets(Arc<Mutex<HashMap<Uuid, GithubPullRequestChangeset>>>);

impl GithubPullRequestChangesetRepository for MemoryChangesets {
    type Err = Infallible;

    async fn get_changeset(
        &self,
        id: Uuid,
    ) -> Result<Option<GithubPullRequestChangeset>, Self::Err> {
        Ok(self.0.lock().unwrap().get(&id).cloned())
    }

    async fn insert_changeset(
        &self,
        changeset: &GithubPullRequestChangeset,
    ) -> Result<(), Self::Err> {
        self.0
            .lock()
            .unwrap()
            .entry(changeset.id)
            .or_insert_with(|| changeset.clone());
        Ok(())
    }
}

#[derive(Clone, Default)]
struct MemoryPatches {
    patches: Arc<Mutex<HashMap<String, String>>>,
    puts: Arc<Mutex<usize>>,
}

impl MemoryPatches {
    fn puts(&self) -> usize {
        *self.puts.lock().unwrap()
    }

    fn expire_all(&self) {
        self.patches.lock().unwrap().clear();
    }
}

impl GithubPullRequestPatchStore for MemoryPatches {
    type Err = Infallible;

    async fn get_patch(&self, key: &str) -> Result<Option<String>, Self::Err> {
        Ok(self.patches.lock().unwrap().get(key).cloned())
    }

    async fn put_patch(&self, key: &str, patch: &str) -> Result<(), Self::Err> {
        *self.puts.lock().unwrap() += 1;
        self.patches
            .lock()
            .unwrap()
            .insert(key.to_string(), patch.to_string());
        Ok(())
    }
}

type Store = GithubPullRequestChangesetStore<Arc<StubReader>, MemoryChangesets, MemoryPatches>;

fn store(reader: &Arc<StubReader>, patches: &MemoryPatches) -> Store {
    GithubPullRequestChangesetStore::new(
        reader.clone(),
        MemoryChangesets::default(),
        patches.clone(),
    )
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER).unwrap()
}

fn pull_request() -> PullRequestRef {
    PullRequestRef {
        repository: RepositorySlug {
            owner: "macro".to_string(),
            name: "app".to_string(),
        },
        number: NonZeroU64::new(7).unwrap(),
    }
}

#[tokio::test]
async fn a_range_is_stored_once_however_often_it_is_captured() {
    let reader = StubReader::answering("head-1", PATCH);
    let patches = MemoryPatches::default();
    let store = store(&reader, &patches);

    let first = store.capture(&user(), &pull_request()).await.unwrap();
    let second = store.capture(&user(), &pull_request()).await.unwrap();

    assert_eq!(first.id, second.id);
    assert_eq!(
        first.id,
        changeset_id(&pull_request(), "base-sha", "head-1")
    );
    assert_eq!(first.files.len(), 1);
    assert_eq!((first.additions, first.deletions), (1, 1));
    assert_eq!(patches.puts(), 1);
}

#[tokio::test]
async fn a_stored_patch_is_served_without_asking_github() {
    let reader = StubReader::answering("head-1", PATCH);
    let patches = MemoryPatches::default();
    let store = store(&reader, &patches);
    let changeset = store.capture(&user(), &pull_request()).await.unwrap();

    let patch = store.patch(&user(), changeset.id).await.unwrap();

    assert_eq!(patch.trim_end(), PATCH.trim_end());
    assert_eq!(reader.calls(), 1);
}

#[tokio::test]
async fn an_expired_patch_is_read_again_while_the_range_is_unchanged() {
    let reader = StubReader::answering("head-1", PATCH);
    let patches = MemoryPatches::default();
    let store = store(&reader, &patches);
    let changeset = store.capture(&user(), &pull_request()).await.unwrap();
    patches.expire_all();

    let patch = store.patch(&user(), changeset.id).await.unwrap();

    assert_eq!(patch.trim_end(), PATCH.trim_end());
    assert_eq!(reader.calls(), 2);
    assert_eq!(patches.puts(), 2);
}

#[tokio::test]
async fn an_expired_patch_of_a_moved_pull_request_is_reported_as_moved() {
    let reader = StubReader::answering("head-1", PATCH);
    let patches = MemoryPatches::default();
    let store = store(&reader, &patches);
    let changeset = store.capture(&user(), &pull_request()).await.unwrap();
    patches.expire_all();
    reader.answer("head-2", PATCH);

    let result = store.patch(&user(), changeset.id).await;

    assert!(matches!(result, Err(GithubPullRequestChangesError::Moved)));
}

#[tokio::test]
async fn an_empty_diff_stores_no_patch() {
    let reader = StubReader::answering("head-1", "");
    let patches = MemoryPatches::default();
    let store = store(&reader, &patches);

    let changeset = store.capture(&user(), &pull_request()).await.unwrap();

    assert_eq!(changeset.patch_key, None);
    assert_eq!(store.patch(&user(), changeset.id).await.unwrap(), "");
    assert_eq!(patches.puts(), 0);
}

struct StubPullRequests {
    stored: StoredGithubPullRequest,
}

impl GithubPullRequestService for StubPullRequests {
    async fn upsert_pull_request(
        &self,
        _upsert: UpsertGithubPullRequest,
    ) -> Result<UpsertedGithubPullRequest, GithubPullRequestError> {
        unreachable!("changes never write pull requests")
    }

    async fn refresh_pull_request(
        &self,
        _pull_request: &EnrichedGithubPullRequest,
    ) -> Result<Vec<ForeignEntity>, GithubPullRequestError> {
        unreachable!("changes never write pull requests")
    }

    async fn get_pull_request(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<StoredGithubPullRequest, GithubPullRequestError> {
        Ok(self.stored.clone())
    }
}

fn stored_pull_request(github_key: &str, head_sha: Option<&str>) -> StoredGithubPullRequest {
    StoredGithubPullRequest {
        id: Uuid::new_v4(),
        github_key: github_key.to_string(),
        owner: "macro".to_string(),
        repo: "app".to_string(),
        number: 7,
        url: "https://github.com/macro/app/pull/7".to_string(),
        title: None,
        status: None,
        draft: false,
        author_login: None,
        author_github_user_id: None,
        description: None,
        additions: None,
        deletions: None,
        assignees: Vec::new(),
        labels: Vec::new(),
        requested_reviewer_github_user_ids: Vec::new(),
        reviews: Vec::new(),
        review_decision: None,
        comments: Vec::new(),
        checks: Vec::new(),
        github_updated_at: None,
        base: Some(GitRefDto {
            name: Some("main".to_string()),
            sha: Some("base-sha".to_string()),
        }),
        head: head_sha.map(|sha| GitRefDto {
            name: Some("feature".to_string()),
            sha: Some(sha.to_string()),
        }),
    }
}

fn receipt() -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_authenticated_user(
        user(),
        &Uuid::new_v4().to_string(),
        EntityType::ForeignEntity,
    )
}

#[tokio::test]
async fn changes_at_the_rows_commits_are_served_without_asking_github() {
    let reader = StubReader::answering("head-1", PATCH);
    let patches = MemoryPatches::default();
    let store = store(&reader, &patches);
    store.capture(&user(), &pull_request()).await.unwrap();
    let service = GithubPullRequestChangesServiceImpl::new(
        StubPullRequests {
            stored: stored_pull_request("macro/app/pull/7", Some("head-1")),
        },
        store,
    );

    let changeset = service.changes(receipt()).await.unwrap();

    assert_eq!(
        changeset.id,
        changeset_id(&pull_request(), "base-sha", "head-1")
    );
    assert_eq!(reader.calls(), 1);
}

#[tokio::test]
async fn changes_without_known_commits_are_read_from_github() {
    let reader = StubReader::answering("head-1", PATCH);
    let patches = MemoryPatches::default();
    let service = GithubPullRequestChangesServiceImpl::new(
        StubPullRequests {
            stored: stored_pull_request("macro/app/pull/7", None),
        },
        store(&reader, &patches),
    );

    service.changes(receipt()).await.unwrap();

    assert_eq!(reader.calls(), 1);
}

#[tokio::test]
async fn a_patch_of_another_pull_requests_changes_is_not_found() {
    let reader = StubReader::answering("head-1", PATCH);
    let patches = MemoryPatches::default();
    let store = store(&reader, &patches);
    let changeset = store.capture(&user(), &pull_request()).await.unwrap();
    let service = GithubPullRequestChangesServiceImpl::new(
        StubPullRequests {
            stored: stored_pull_request("macro/app/pull/8", Some("head-1")),
        },
        store,
    );

    let result = service.patch(receipt(), changeset.id).await;

    assert!(matches!(
        result,
        Err(GithubPullRequestChangesError::NotFound)
    ));
}
