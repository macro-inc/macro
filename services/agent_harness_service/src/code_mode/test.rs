use super::*;
use agent_session::domain::model::AgentSessionId;
use agent_session::testing::test_agent_session;
use std::{
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};
struct Gate {
    verdict: NativeToolVerdict,
    calls: AtomicUsize,
}
impl NativeToolGate for Gate {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        name: &'a str,
        args: &'a serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        assert_eq!(name, "ExecuteCode");
        assert_eq!(args["source"], "fixture");
        assert_eq!(args["turn_id"], macro_uuid::Uuid::from_u128(1).to_string());
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { self.verdict.clone() })
    }
}
#[tokio::test]
async fn owner_approval_is_required_before_credentials_and_cancel_skips_gate() {
    let session = test_agent_session(AgentSessionId::new());
    let identity = ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        acting_as: ai_toolset::actor::ToolActor::Owner,
        session: session.id,
        agent_id: session.bot_id,
        owner: session.owner_user().unwrap().clone(),
        turn: macro_uuid::Uuid::from_u128(1),
    };
    let gate = Gate {
        verdict: NativeToolVerdict::Refuse("Owner declined".into()),
        calls: AtomicUsize::new(0),
    };
    assert!(matches!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new()).await,
        Err(CodeModeError::Invalid(_))
    ));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(matches!(
        approve_run(&gate, &identity, "fixture", &cancel).await,
        Err(CodeModeError::Forbidden)
    ));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
    let gate = Gate {
        verdict: NativeToolVerdict::RunAs(session.owner_user().unwrap().clone()),
        calls: AtomicUsize::new(0),
    };
    assert!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new())
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn execution_credentials_use_the_gate_resolved_requester() {
    let session = test_agent_session(AgentSessionId::new());
    let requester =
        macro_user_id::user_id::MacroUserIdStr::try_from_email("requester@example.com").unwrap();
    let identity = ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        acting_as: ai_toolset::actor::ToolActor::Requester,
        session: session.id,
        owner: session.owner_user().unwrap().clone(),
        agent_id: session.bot_id,
        turn: macro_uuid::Uuid::from_u128(1),
    };
    let gate = Gate {
        verdict: NativeToolVerdict::RunAs(requester.clone()),
        calls: AtomicUsize::new(0),
    };
    assert_eq!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new())
            .await
            .unwrap(),
        requester
    );
}

struct Origins(Result<bool, &'static str>);

#[async_trait]
impl SessionOrigins for Origins {
    async fn reads_only(&self, _: AgentSessionId) -> anyhow::Result<bool> {
        self.0.map_err(|error| anyhow::anyhow!(error))
    }
}

#[tokio::test]
async fn a_routine_drafts_programs_run_as_dry_runs_and_an_unreadable_session_runs_none() {
    let session = AgentSessionId::new();
    assert!(dry_run_for(&Origins(Ok(true)), session).await.unwrap());
    assert!(!dry_run_for(&Origins(Ok(false)), session).await.unwrap());
    assert!(matches!(
        dry_run_for(&Origins(Err("database down")), session).await,
        Err(CodeModeError::Unavailable)
    ));
}
