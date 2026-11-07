use super::*;
use agent_session::domain::model::{ManagerFence, ReplicaId};
use std::sync::Mutex;

struct ReportedBranch {
    session: AgentSessionId,
    owner: String,
    repository: String,
    branch: String,
    claim: SessionClaim,
}

#[derive(Default)]
struct Branches(Mutex<Vec<ReportedBranch>>);

impl SessionWorkingBranches for Branches {
    fn set_working_branch<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        repository_url: &'a str,
        branch: &'a str,
        claim: Option<SessionClaim>,
    ) -> std::pin::Pin<
        Box<dyn Future<Output = agent_session::domain::error::Result<Option<String>>> + Send + 'a>,
    > {
        Box::pin(async move {
            self.0.lock().unwrap().push(ReportedBranch {
                session,
                owner: owner.to_string(),
                repository: repository_url.into(),
                branch: branch.into(),
                claim: claim.expect("branch reports require an active claim"),
            });
            // Ignoring an unrelated repository is a successful owning-domain decision.
            Ok(None)
        })
    }
}

#[tokio::test]
async fn branch_reports_require_activation_and_forward_repository_identity_and_fence() {
    let service = Arc::new(Branches::default());
    let reporter = CursorWorkingBranchReporter {
        service: service.clone(),
        session: AgentSessionId::new_from_uuid(uuid::Uuid::now_v7()),
        owner: MacroUserIdStr::try_from_email("branch@example.com").unwrap(),
        claim: Arc::new(OnceLock::new()),
    };
    assert!(
        reporter
            .set_working_branch("github.com/other/repo", "work")
            .await
            .is_err()
    );
    assert!(service.0.lock().unwrap().is_empty());
    let claim = SessionClaim {
        session: reporter.session,
        replica: ReplicaId::from_uuid(uuid::Uuid::now_v7()),
        fence: ManagerFence(7),
    };
    reporter.claim.set(claim).unwrap();
    for repository in ["github.com/other/repo", "github.com/macro-inc/macro"] {
        reporter
            .set_working_branch(repository, "cursor/actual-work")
            .await
            .unwrap();
    }
    let reports = service.0.lock().unwrap();
    assert_eq!(reports.len(), 2);
    for (report, repository) in reports
        .iter()
        .zip(["github.com/other/repo", "github.com/macro-inc/macro"])
    {
        assert_eq!(report.session, reporter.session);
        assert_eq!(report.owner, reporter.owner.as_ref());
        assert_eq!(report.repository, repository);
        assert_eq!(report.branch, "cursor/actual-work");
        assert_eq!(report.claim.session, claim.session);
        assert_eq!(report.claim.replica, claim.replica);
        assert_eq!(report.claim.fence, claim.fence);
    }
}
