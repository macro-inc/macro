use super::*;

#[tokio::test]
async fn finds_an_existing_ssh_clone_for_an_https_request() {
    let root = tempfile::tempdir().unwrap();
    let clone = root.path().join("existing");
    std::fs::create_dir(&clone).unwrap();
    git(&clone, &["init"]).await.unwrap();
    git(
        &clone,
        &["remote", "add", "origin", "git@github.com:org/project.git"],
    )
    .await
    .unwrap();
    let store = GitRepositories {
        search: root.path().to_owned(),
        cache: root.path().join("cache"),
    };
    assert_eq!(
        store
            .find(&Repository::parse("https://github.com/org/project").unwrap())
            .await
            .unwrap(),
        Some(clone)
    );
    assert!(
        store
            .find(&Repository::parse("https://github.com/other/project").unwrap())
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn session_worktrees_use_fresh_main_without_changing_the_users_branch_or_files() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    std::fs::create_dir(&source).unwrap();
    git(&source, &["init", "--initial-branch=main"])
        .await
        .unwrap();
    git(&source, &["config", "user.email", "test@example.com"])
        .await
        .unwrap();
    git(&source, &["config", "user.name", "Test"])
        .await
        .unwrap();
    std::fs::write(source.join("file"), "first").unwrap();
    git(&source, &["add", "file"]).await.unwrap();
    git(&source, &["commit", "-m", "initial"]).await.unwrap();
    let clone = root.path().join("clone");
    git(
        root.path(),
        &["clone", &source.to_string_lossy(), &clone.to_string_lossy()],
    )
    .await
    .unwrap();
    git(&clone, &["checkout", "-b", "users-work"])
        .await
        .unwrap();
    std::fs::write(clone.join("file"), "uncommitted work").unwrap();
    std::fs::write(source.join("file"), "latest main").unwrap();
    git(&source, &["commit", "-am", "advance"]).await.unwrap();
    let latest = git(&source, &["rev-parse", "HEAD"]).await.unwrap();
    let store = GitRepositories {
        search: clone.clone(),
        cache: root.path().join("cache"),
    };
    store.refresh_main(&clone).await.unwrap();
    assert_eq!(
        git(&clone, &["rev-parse", "origin/main"]).await.unwrap(),
        latest
    );
    let session = root.path().join("session with spaces");
    create_worktree(&clone, &session, "macro/session-one")
        .await
        .unwrap();
    assert_eq!(git(&session, &["rev-parse", "HEAD"]).await.unwrap(), latest);
    assert_eq!(
        git(&session, &["branch", "--show-current"]).await.unwrap(),
        "macro/session-one"
    );
    assert_eq!(
        std::fs::read_to_string(session.join("file")).unwrap(),
        "latest main"
    );
    std::fs::write(session.join("file"), "session edits").unwrap();
    let second = root.path().join("second session");
    create_worktree(&session, &second, "macro/session-two")
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(second.join("file")).unwrap(),
        "latest main"
    );
    assert_eq!(
        std::fs::read_to_string(session.join("file")).unwrap(),
        "session edits"
    );
    assert_eq!(
        git(&clone, &["branch", "--show-current"]).await.unwrap(),
        "users-work"
    );
    assert_eq!(
        std::fs::read_to_string(clone.join("file")).unwrap(),
        "uncommitted work"
    );
}
