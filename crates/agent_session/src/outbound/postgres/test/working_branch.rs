use super::*;
use crate::domain::repository_branch::RepositoryBranch;
use crate::domain::working_branch::{
    SessionWorkingBranchRepo, SessionWorkingBranchService, SessionWorkingBranches,
    WorkingBranchWrite,
};
use crate::testing::RecordingRealtime;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn runtime_branch_survives_without_pr_and_respects_owner_repository_and_fence(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let owner = session.owner_user().unwrap();
    let ClaimOutcome::Claimed(old) = repo.claim(session.id, ReplicaId::mint()).await.unwrap()
    else {
        panic!("claim")
    };
    let ClaimOutcome::Claimed(current) = repo.claim(session.id, old.replica).await.unwrap() else {
        panic!("reclaim")
    };
    let realtime = RecordingRealtime::new();
    let service = SessionWorkingBranchService::new(repo.clone(), realtime.clone());
    service
        .set_working_branch(
            session.id,
            owner,
            "github.com/example/example",
            "cursor/no-pr",
            Some(current),
        )
        .await
        .unwrap();
    for branch in ["cursor/no-pr", "stale"] {
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
    let row = sqlx::query!(
        "SELECT working_branch, pull_request_url, modified_at FROM agent_session WHERE id = $1",
        session.id.as_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.working_branch.as_deref(), Some("cursor/no-pr"));
    assert_eq!(row.pull_request_url, None);
    service
        .set_working_branch(
            session.id,
            owner,
            "github.com/example/example",
            "cursor/no-pr",
            Some(current),
        )
        .await
        .unwrap();
    let same = AgentSessionRepo::get(&repo, session.id).await.unwrap();
    assert_eq!(same.modified_at, row.modified_at);
    assert_eq!(realtime.updated(), [session.id]);
    let other = user_id("macro|other@example.com");
    assert!(matches!(
        repo.record_working_branch(
            session.id,
            &other,
            session.repo_url.as_deref().unwrap(),
            &RepositoryBranch::parse("bad-owner".into()).unwrap(),
            None
        )
        .await,
        Err(AgentSessionError::Forbidden)
    ));
    repo.set_repo_url(session.id, Some("https://github.com/example/new".into()))
        .await
        .unwrap();
    assert_eq!(
        repo.record_working_branch(
            session.id,
            owner,
            session.repo_url.as_deref().unwrap(),
            &RepositoryBranch::parse("old-repository".into()).unwrap(),
            Some(current)
        )
        .await
        .unwrap(),
        WorkingBranchWrite::RepositoryChanged
    );
    let cleared = sqlx::query_scalar!(
        "SELECT working_branch FROM agent_session WHERE id = $1",
        session.id.as_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cleared, None);
}
