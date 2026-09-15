use super::*;
use std::process::Command as StdCommand;

/// A throwaway repository with one commit on `main`, an `origin` remote
/// pointing at a bare clone, and `origin/HEAD` set.
fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temp dir");
    let work = dir.path().join("work");
    let bare = dir.path().join("origin.git");
    std::fs::create_dir_all(&work).unwrap();
    git(&work, &["init", "-q", "-b", "main"]);
    git(&work, &["config", "user.email", "agent@example.com"]);
    git(&work, &["config", "user.name", "Agent"]);
    std::fs::write(work.join("README.md"), "# Hello\n").unwrap();
    std::fs::write(work.join("keep.txt"), "one\ntwo\n").unwrap();
    git(&work, &["add", "."]);
    git(&work, &["commit", "-q", "-m", "initial"]);
    git(
        &work,
        &[
            "clone",
            "-q",
            "--bare",
            work.to_str().unwrap(),
            bare.to_str().unwrap(),
        ],
    );
    git(&work, &["remote", "add", "origin", bare.to_str().unwrap()]);
    git(&work, &["fetch", "-q", "origin"]);
    git(&work, &["remote", "set-head", "origin", "main"]);
    dir
}

fn git(cwd: &Path, args: &[&str]) {
    let status = StdCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed");
}

fn collected(
    result: CollectChangesResult,
) -> (String, ChangesRef, ChangesRef, Option<String>, bool) {
    match result {
        CollectChangesResult::Collected {
            patch,
            base,
            head,
            repository,
            truncated,
        } => (patch, base, head, repository, truncated),
        CollectChangesResult::Error { message } => panic!("expected changes, got {message}"),
    }
}

#[tokio::test]
async fn committed_staged_unstaged_and_untracked_work_is_one_patch() {
    let dir = repository();
    let work = dir.path().join("work");
    git(&work, &["checkout", "-q", "-b", "agent/work"]);
    std::fs::write(work.join("README.md"), "# Hello\n\nMore.\n").unwrap();
    git(&work, &["commit", "-q", "-am", "expand readme"]);
    std::fs::write(work.join("keep.txt"), "one\n").unwrap();
    git(&work, &["add", "keep.txt"]);
    std::fs::write(work.join("keep.txt"), "one\nthree\n").unwrap();
    std::fs::write(work.join("new.rs"), "fn main() {}\n").unwrap();

    let (patch, base, head, repository, truncated) =
        collected(WorkspaceChanges::new(&work).collect().await);
    assert!(!truncated);
    assert_eq!(base.name.as_deref(), Some("main"));
    assert!(base.sha.is_some());
    assert_eq!(head.name.as_deref(), Some("agent/work"));
    assert!(head.sha.is_some());
    assert!(repository.unwrap().ends_with("origin.git"));

    assert!(
        patch.contains("diff --git a/README.md b/README.md"),
        "{patch}"
    );
    assert!(patch.contains("+More."), "the commit is in");
    assert!(
        patch.contains("diff --git a/keep.txt b/keep.txt"),
        "{patch}"
    );
    assert!(
        patch.contains("-two") && patch.contains("+three"),
        "staged and unstaged edits are in"
    );
    assert!(patch.contains("diff --git a/new.rs b/new.rs"), "{patch}");
    assert!(
        patch.contains("+fn main() {}"),
        "the untracked file is an addition"
    );
    assert!(patch.contains("new file mode"), "{patch}");
}

#[tokio::test]
async fn a_clean_tree_on_the_default_branch_is_an_empty_patch() {
    let dir = repository();
    let work = dir.path().join("work");
    let (patch, base, head, _, _) = collected(WorkspaceChanges::new(&work).collect().await);
    assert!(patch.is_empty());
    assert_eq!(base.name.as_deref(), Some("main"));
    assert_eq!(head.name.as_deref(), Some("main"));
    assert_eq!(base.sha, head.sha);
}

#[tokio::test]
async fn a_directory_that_is_not_a_repository_is_a_safe_error() {
    let dir = tempfile::tempdir().unwrap();
    match WorkspaceChanges::new(dir.path()).collect().await {
        CollectChangesResult::Error { message } => {
            assert!(message.contains("not a git repository"))
        }
        other => panic!("expected an error, got {other:?}"),
    }
}

#[tokio::test]
async fn a_repository_without_a_remote_diffs_against_its_own_head() {
    let dir = tempfile::tempdir().unwrap();
    let work = dir.path();
    git(work, &["init", "-q", "-b", "trunk"]);
    git(work, &["config", "user.email", "a@example.com"]);
    git(work, &["config", "user.name", "A"]);
    std::fs::write(work.join("a.txt"), "a\n").unwrap();
    git(work, &["add", "."]);
    git(work, &["commit", "-q", "-m", "one"]);
    std::fs::write(work.join("a.txt"), "b\n").unwrap();

    let (patch, base, head, repository, _) = collected(WorkspaceChanges::new(work).collect().await);
    assert!(base.name.is_none(), "no default branch to name");
    assert_eq!(base.sha, head.sha, "HEAD is the base");
    assert!(repository.is_none());
    assert!(patch.contains("-a") && patch.contains("+b"));
}

#[test]
fn truncation_cuts_at_a_file_boundary() {
    let file = |name: &str| {
        format!("diff --git a/{name} b/{name}\n--- a/{name}\n+++ b/{name}\n@@ -1 +1 @@\n-x\n+y\n")
    };
    let patch = format!("{}{}{}", file("a"), file("b"), file("c"));
    let limit = file("a").len() + file("b").len() + 3;
    let (cut, truncated) = truncate_at_file_boundary(patch.clone(), limit);
    assert!(truncated);
    assert_eq!(cut, format!("{}{}", file("a"), file("b")));
    let (whole, truncated) = truncate_at_file_boundary(patch.clone(), patch.len());
    assert!(!truncated);
    assert_eq!(whole, patch);
    let (nothing, truncated) = truncate_at_file_boundary(patch, 5);
    assert!(truncated);
    assert!(nothing.is_empty());
}
