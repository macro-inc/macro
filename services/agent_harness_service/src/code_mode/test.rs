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
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { self.verdict.clone() })
    }
}
#[tokio::test]
async fn owner_approval_is_required_before_credentials_and_cancel_skips_gate() {
    let session = test_agent_session(AgentSessionId::new());
    let identity = ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        session: session.id,
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
        verdict: NativeToolVerdict::Run,
        calls: AtomicUsize::new(0),
    };
    assert!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new())
            .await
            .is_ok()
    );
}
