use super::*;
use agent_session::domain::model::AgentSessionId;
use agent_session::testing::test_agent_session;
use std::{
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};

#[derive(Default)]
struct Tools(AtomicUsize);

#[async_trait]
impl CodeModeTools for Tools {
    fn catalog(&self) -> Vec<ToolDocumentation> {
        Vec::new()
    }
    async fn call(
        &self,
        _: &ExecutionIdentity,
        _: &str,
        _: &Value,
        _: CancellationToken,
    ) -> HostResult {
        self.0.fetch_add(1, Ordering::SeqCst);
        HostResult::Ok { value: Value::Null }
    }
}

struct Gate(NativeToolVerdict);
impl NativeToolGate for Gate {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
        _: &'a Value,
    ) -> Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async { self.0.clone() })
    }
}

#[tokio::test]
async fn code_cannot_bypass_owner_refusal_or_cancellation() {
    let session = test_agent_session(AgentSessionId::new());
    let identity = ExecutionIdentity {
        session: session.id,
        owner: session.owner_user().unwrap().clone(),
        bot: session.bot_id,
        turn: macro_uuid::Uuid::from_u128(1),
    };
    let tools = Arc::new(Tools::default());
    let denied = ApprovedCodeTools::new(
        tools.clone(),
        Arc::new(Gate(NativeToolVerdict::Refuse("Owner declined".into()))),
    );
    assert!(
        matches!(denied.call(&identity, "NameSearch", &Value::Null, CancellationToken::new()).await, HostResult::Error { message } if message == "Owner declined")
    );
    assert_eq!(tools.0.load(Ordering::SeqCst), 0);
    let approved = ApprovedCodeTools::new(tools.clone(), Arc::new(Gate(NativeToolVerdict::Run)));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(matches!(
        approved
            .call(&identity, "NameSearch", &Value::Null, cancel)
            .await,
        HostResult::Error { .. }
    ));
    assert_eq!(tools.0.load(Ordering::SeqCst), 0);
    assert!(matches!(
        approved
            .call(
                &identity,
                "NameSearch",
                &Value::Null,
                CancellationToken::new()
            )
            .await,
        HostResult::Ok { .. }
    ));
    assert_eq!(tools.0.load(Ordering::SeqCst), 1);
}
