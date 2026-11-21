use super::*;
use std::sync::Mutex;

/// A store with one local clone, counting the fetches asked of it.
struct CountingStore {
    clone: PathBuf,
    refreshes: Mutex<u32>,
}

impl RepositoryStore for CountingStore {
    async fn find(&self, _repository: &Repository) -> rootcause::Result<Option<PathBuf>> {
        Ok(Some(self.clone.clone()))
    }

    async fn clone_repository(&self, _repository: &Repository) -> rootcause::Result<PathBuf> {
        rootcause::bail!("the clone is always found")
    }

    async fn refresh_main(&self, _path: &Path) -> rootcause::Result<()> {
        *self.refreshes.lock().unwrap() += 1;
        Ok(())
    }
}

const URL: &str = "https://github.com/org/project";

/// A clone of `URL` with an `origin/main`, as a fetch would leave it.
async fn clone(root: &Path) -> PathBuf {
    let clone = root.join("clone");
    std::fs::create_dir(&clone).unwrap();
    git(&clone, &["init", "--initial-branch=main"]).await.unwrap();
    git(&clone, &["config", "user.email", "test@example.com"])
        .await
        .unwrap();
    git(&clone, &["config", "user.name", "Test"]).await.unwrap();
    git(&clone, &["remote", "add", "origin", URL]).await.unwrap();
    git(&clone, &["commit", "--allow-empty", "-m", "initial"])
        .await
        .unwrap();
    git(&clone, &["update-ref", "refs/remotes/origin/main", "HEAD"])
        .await
        .unwrap();
    clone
}

async fn workspaces(root: &Path) -> Workspaces<CountingStore> {
    Workspaces::with_store(
        CountingStore {
            clone: clone(root).await,
            refreshes: Mutex::new(0),
        },
        root.join("macrod"),
    )
}

#[tokio::test]
async fn a_new_session_fetches_main_and_gets_its_own_worktree() {
    let root = tempfile::tempdir().unwrap();
    let workspaces = workspaces(root.path()).await;

    let path = workspaces.prepare("session-a", URL).await.unwrap();

    assert_eq!(*workspaces.store.refreshes.lock().unwrap(), 1);
    assert_eq!(path, root.path().join("macrod/worktrees/session-a"));
    assert_eq!(
        git(&path, &["branch", "--show-current"]).await.unwrap(),
        "macro/session-a"
    );
}

#[tokio::test]
async fn a_session_without_a_worktree_here_fetches_even_when_others_have_one() {
    let root = tempfile::tempdir().unwrap();
    let workspaces = workspaces(root.path()).await;
    workspaces.prepare("session-a", URL).await.unwrap();

    workspaces.prepare("session-b", URL).await.unwrap();

    assert_eq!(*workspaces.store.refreshes.lock().unwrap(), 2);
}

#[tokio::test]
async fn an_existing_worktree_on_its_branch_is_reused_without_a_fetch() {
    let root = tempfile::tempdir().unwrap();
    let workspaces = workspaces(root.path()).await;
    let first = workspaces.prepare("session-a", URL).await.unwrap();
    std::fs::write(first.join("edit"), "the agent's work").unwrap();

    let again = workspaces.prepare("session-a", URL).await.unwrap();

    assert_eq!(again, first);
    assert_eq!(*workspaces.store.refreshes.lock().unwrap(), 1);
    assert_eq!(
        std::fs::read_to_string(again.join("edit")).unwrap(),
        "the agent's work"
    );
}

#[tokio::test]
async fn an_existing_worktree_on_another_branch_is_reused_without_a_fetch() {
    let root = tempfile::tempdir().unwrap();
    let workspaces = workspaces(root.path()).await;
    let first = workspaces.prepare("session-a", URL).await.unwrap();
    git(&first, &["checkout", "-b", "agents-feature"])
        .await
        .unwrap();

    let again = workspaces.prepare("session-a", URL).await.unwrap();

    assert_eq!(again, first);
    assert_eq!(*workspaces.store.refreshes.lock().unwrap(), 1);
    assert_eq!(
        git(&again, &["branch", "--show-current"]).await.unwrap(),
        "agents-feature"
    );
}
