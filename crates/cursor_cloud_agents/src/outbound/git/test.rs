use super::*;

#[tokio::test]
async fn each_checkout_supplies_its_own_repository_without_auto_opening_a_pr() {
    let root = std::env::temp_dir().join(format!("cursor-repos-{}", uuid::Uuid::now_v7()));
    let chooser = GitRepositoryChooser::default();
    for name in ["one", "two"] {
        let cwd = root.join(name);
        std::fs::create_dir_all(&cwd).unwrap();
        assert!(
            Command::new("git")
                .arg("init")
                .arg("--quiet")
                .arg(&cwd)
                .status()
                .unwrap()
                .success()
        );
        let url = format!("https://github.com/macro-inc/{name}");
        assert!(
            Command::new("git")
                .arg("-C")
                .arg(&cwd)
                .args(["remote", "add", "origin", &url])
                .status()
                .unwrap()
                .success()
        );
        let intent = chooser.choose("work here", &cwd).await.unwrap();
        assert_eq!(intent.repository, RepoUrl::parse(&url));
        assert!(!intent.open_pull_request);
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn override_does_not_require_a_checkout() {
    let repo = RepoUrl::parse("https://github.com/macro-inc/macro").unwrap();
    let chooser = GitRepositoryChooser {
        override_repo: Some(repo.clone()),
    };
    assert_eq!(
        chooser
            .choose("work here", Path::new(""))
            .await
            .unwrap()
            .repository,
        Some(repo)
    );
    assert!(
        GitRepositoryChooser::default()
            .choose("work here", Path::new(""))
            .await
            .unwrap()
            .repository
            .is_none()
    );
}
