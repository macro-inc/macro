use super::*;
use crate::domain::model::{ClaimOutcome, ReplicaId};
use crate::domain::ports::SessionOwnership;
use crate::testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session};

#[test]
fn repository_identity_rejects_ambiguous_or_untrusted_urls() {
    let expected = RepositoryIdentity::parse("https://github.com/Org/Repo.git/").unwrap();
    assert_eq!(
        RepositoryIdentity::parse("github.com/org/repo"),
        Some(expected)
    );
    for url in [
        "https://user@github.com/org/repo",
        "https://github.com.evil.test/org/repo",
        "https://github.com/org/repo/tree/main",
        "https://github.com/org/repo?ref=main",
        "https://github.com/org/repo#branch",
        "https://github.com/../repo",
        "https://github.com/org/.git",
        "https://github.com/org/%2erepo",
        "https://github.com/org/repo\n",
    ] {
        assert_eq!(RepositoryIdentity::parse(url), None, "{url}");
    }
}

#[tokio::test]
async fn no_pr_branch_is_persistent_idempotent_and_owner_scoped() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    assert!(session.pull_request_url.is_none());
    repo.insert_session(session.clone());
    let realtime = RecordingRealtime::new();
    let service = SessionWorkingBranchService::new(repo.clone(), realtime.clone());
    let owner = session.owner_user().unwrap();
    let other = MacroUserIdStr::try_from_email("other@example.com").unwrap();
    assert!(matches!(
        service
            .set_working_branch(
                session.id,
                &other,
                "github.com/example/example",
                "fix",
                None
            )
            .await,
        Err(AgentSessionError::Forbidden)
    ));
    assert_eq!(
        service
            .set_working_branch(
                session.id,
                owner,
                "github.com/example/other",
                "wrong-repo",
                None
            )
            .await
            .unwrap(),
        None
    );
    assert_eq!(repo.working_branch(session.id), None);
    for _ in 0..2 {
        assert_eq!(
            service
                .set_working_branch(
                    session.id,
                    owner,
                    "github.com/EXAMPLE/example.git",
                    "cursor/fix",
                    None
                )
                .await
                .unwrap(),
            Some("cursor/fix".to_owned())
        );
    }
    assert_eq!(
        repo.working_branch(session.id).as_deref(),
        Some("cursor/fix")
    );
    assert_eq!(realtime.updated(), [session.id]);
    assert!(
        repo.get(session.id)
            .await
            .unwrap()
            .pull_request_url
            .is_none()
    );
    for branch in ["", "HEAD~1", "bad\nbranch", "../main"] {
        assert_eq!(
            service
                .set_working_branch(
                    session.id,
                    owner,
                    "github.com/example/example",
                    branch,
                    None
                )
                .await
                .unwrap(),
            None
        );
    }
    for repository in [
        "https://gitlab.com/example/example",
        "github.com/other/repository?unexpected=query",
        "https://user@github.com/example/example",
    ] {
        assert_eq!(
            service
                .set_working_branch(session.id, owner, repository, "ignored", None)
                .await
                .unwrap(),
            None
        );
    }
    assert_eq!(realtime.updated(), [session.id]);
    assert_eq!(
        repo.working_branch(session.id).as_deref(),
        Some("cursor/fix")
    );
}

#[tokio::test]
async fn runtime_branch_rejects_stale_claim_and_clears_with_repository_change() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    repo.insert_session(session.clone());
    let ClaimOutcome::Claimed(old) = repo.claim(session.id, ReplicaId::mint()).await.unwrap()
    else {
        panic!("claim")
    };
    let ClaimOutcome::Claimed(current) = repo.claim(session.id, old.replica).await.unwrap() else {
        panic!("reclaim")
    };
    let realtime = RecordingRealtime::new();
    let service = SessionWorkingBranchService::new(repo.clone(), realtime.clone());
    let owner = session.owner_user().unwrap();
    service
        .set_working_branch(
            session.id,
            owner,
            "github.com/example/example",
            "current",
            Some(current),
        )
        .await
        .unwrap();
    for branch in ["current", "old"] {
        assert!(matches!(
            service
                .set_working_branch(
                    session.id,
                    owner,
                    "github.com/example/example",
                    branch,
                    Some(old)
                )
                .await,
            Err(AgentSessionError::FencedOut(_))
        ));
    }
    assert_eq!(repo.working_branch(session.id).as_deref(), Some("current"));
    repo.set_repo_url(session.id, session.repo_url.clone())
        .await
        .unwrap();
    assert_eq!(repo.working_branch(session.id).as_deref(), Some("current"));
    repo.set_repo_url(
        session.id,
        Some("https://github.com/example/new".to_owned()),
    )
    .await
    .unwrap();
    assert_eq!(repo.working_branch(session.id), None);
    assert_eq!(
        service
            .set_working_branch(
                session.id,
                owner,
                "github.com/example/example",
                "old-repo",
                Some(current)
            )
            .await
            .unwrap(),
        None
    );
    assert_eq!(realtime.updated(), [session.id]);
}

#[tokio::test]
async fn realtime_failure_does_not_lose_the_runtime_branch() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    repo.insert_session(session.clone());
    let service = SessionWorkingBranchService::new(repo.clone(), RecordingRealtime::down());
    service
        .set_working_branch(
            session.id,
            session.owner_user().unwrap(),
            "github.com/example/example",
            "persisted",
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        repo.working_branch(session.id).as_deref(),
        Some("persisted")
    );
}
